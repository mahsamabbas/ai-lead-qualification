import json
import logging
import os
import re
from typing import Any

from app.config import get_chat_model
from app.models import ChatMessage

logger = logging.getLogger(__name__)


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


def generate_qualification_json(
    message: str,
    history: list[ChatMessage],
    api_key: str,
) -> dict[str, Any]:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    lines = [f"{item.role}: {item.content}" for item in history]
    lines.append(f"user: {message}")
    user_blob = "\n".join(lines)
    try:
        response = client.models.generate_content(
            model=get_chat_model(),
            contents=user_blob,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                response_mime_type="application/json",
            ),
        )
        raw = (response.text or "").strip()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Gemini qualification call failed: %s", exc)
        raise
    try:
        return json.loads(_strip_fences(raw))
    except json.JSONDecodeError as exc:
        logger.warning("Gemini returned non-JSON: %s", raw[:200])
        raise ValueError("Model returned non-JSON") from exc
