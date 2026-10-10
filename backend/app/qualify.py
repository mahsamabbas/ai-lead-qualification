from collections.abc import Callable
from pathlib import Path
from typing import Any

from app.config import MAX_HISTORY
from app.db import init_db, insert_lead
from app.gemini_clients import ModelJsonError, generate_qualification_json, get_api_key
from app.models import ChatMessage, ChatResponse, LeadSummary
from app.next_step import apply_next_step, is_complete


class BlankMessageError(ValueError):
    pass


class ServiceUnavailableError(RuntimeError):
    pass


class BadModelResponseError(RuntimeError):
    pass


JsonFn = Callable[[str, list[ChatMessage], str], dict[str, Any]]


def _trim_history(history: list[ChatMessage]) -> list[ChatMessage]:
    return history[-MAX_HISTORY:] if len(history) > MAX_HISTORY else history


def _parse_model_dict(data: dict[str, Any]) -> tuple[str, LeadSummary]:
    required = ("assistant_message", "needs", "budget", "timeline")
    if not all(key in data for key in required):
        raise BadModelResponseError("Model JSON missing required keys.")
    assistant = data["assistant_message"]
    if not isinstance(assistant, str) or not assistant.strip():
        raise BadModelResponseError("Model assistant_message must be a non-empty string.")

    def field(name: str) -> str | None:
        value = data[name]
        if value is None:
            return None
        if not isinstance(value, str):
            raise BadModelResponseError(f"Model field {name} must be string or null.")
        value = value.strip()
        return value or None

    needs, budget, timeline = field("needs"), field("budget"), field("timeline")
    summary = LeadSummary(
        needs=needs,
        budget=budget,
        timeline=timeline,
        next_step=apply_next_step(needs, budget, timeline),
    )
    return assistant.strip(), summary


def qualify_turn(
    message: str,
    history: list[ChatMessage],
    previous_summary: LeadSummary | None,
    db_path: Path,
    *,
    json_fn: JsonFn | None = None,
) -> ChatResponse:
    if not message or not message.strip():
        raise BlankMessageError("Message must not be blank.")

    api_key = get_api_key()
    if not api_key:
        raise ServiceUnavailableError("Answer service unavailable.")

    call_json = json_fn or generate_qualification_json
    try:
        raw = call_json(message.strip(), _trim_history(history), api_key)
    except BadModelResponseError:
        raise
    except ModelJsonError as exc:
        raise BadModelResponseError("Model returned non-JSON.") from exc
    except Exception as exc:  # noqa: BLE001
        raise ServiceUnavailableError("Answer service unavailable.") from exc

    try:
        assistant_message, summary = _parse_model_dict(raw)
    except BadModelResponseError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise BadModelResponseError("Invalid model response.") from exc

    saved = False
    lead_id: int | None = None
    was_complete = bool(previous_summary and is_complete(previous_summary))
    if is_complete(summary) and not was_complete:
        try:
            init_db(db_path)
            lead_id = insert_lead(db_path, summary)
            saved = True
        except Exception:  # noqa: BLE001
            saved = False
            lead_id = None

    return ChatResponse(
        assistant_message=assistant_message,
        summary=summary,
        saved=saved,
        lead_id=lead_id,
    )
