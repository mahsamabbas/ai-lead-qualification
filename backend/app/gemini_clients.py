import json
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from typing import Any

from app.config import get_chat_model
from app.models import ChatMessage

logger = logging.getLogger(__name__)

# Keep each Gemini attempt bounded so the UI never spins forever.
ATTEMPT_TIMEOUT_SECONDS = 25
MAX_ATTEMPTS = 2


class ModelJsonError(ValueError):
    """Gemini returned a successful response that was not valid JSON."""


def get_api_key() -> str | None:
    key = os.getenv("GOOGLE_API_KEY", "").strip()
    return key or None


SYSTEM_PROMPT = """You are BrightMart's lead qualification assistant.
BrightMart helps people set up online stores.
Gather needs, budget, and timeline. Guide with questions, but accept free-form answers.
Extract only facts the prospect stated. Use JSON null when unknown. Never invent values.
Return ONLY a JSON object with keys:
assistant_message (string), needs (string|null), budget (string|null), timeline (string|null).
Do not include next_step.
"""


def _strip_fences(text: str) -> str:
    text = text.strip()
    fence = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```$", text)
    return fence.group(1).strip() if fence else text


def _call_gemini(api_key: str, user_blob: str) -> str:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=get_chat_model(),
        contents=user_blob,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
        ),
    )
    return (response.text or "").strip()


def generate_qualification_json(
    message: str,
    history: list[ChatMessage],
    api_key: str,
) -> dict[str, Any]:
    lines = [f"{item.role}: {item.content}" for item in history]
    lines.append(f"user: {message}")
    user_blob = "\n".join(lines)
    raw = ""
    last_error: Exception | None = None

    for attempt in range(MAX_ATTEMPTS):
        pool = ThreadPoolExecutor(max_workers=1)
        try:
            future = pool.submit(_call_gemini, api_key, user_blob)
            raw = future.result(timeout=ATTEMPT_TIMEOUT_SECONDS)
            last_error = None
            break
        except FuturesTimeoutError:
            last_error = TimeoutError(
                f"Gemini timed out after {ATTEMPT_TIMEOUT_SECONDS}s"
            )
            logger.warning(
                "Gemini qualification attempt %s timed out after %ss",
                attempt + 1,
                ATTEMPT_TIMEOUT_SECONDS,
            )
            if attempt < MAX_ATTEMPTS - 1:
                time.sleep(0.5)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            logger.warning(
                "Gemini qualification attempt %s failed: %s",
                attempt + 1,
                exc,
            )
            if attempt < MAX_ATTEMPTS - 1:
                time.sleep(0.6)
        finally:
            # Do not wait on a hung Gemini call or the API worker stays blocked.
            pool.shutdown(wait=False, cancel_futures=True)

    if last_error is not None:
        raise last_error
    try:
        return json.loads(_strip_fences(raw))
    except json.JSONDecodeError as exc:
        logger.warning("Gemini returned non-JSON: %s", raw[:200])
        raise ModelJsonError("Model returned non-JSON") from exc
