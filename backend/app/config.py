import os
from pathlib import Path

MAX_HISTORY = 10
DEFAULT_CHAT_MODEL = "gemini-3.6-flash"

NEXT_STEP_DEMO = "Book a product demo"
NEXT_STEP_RESOURCES = "Send free resources"
NEXT_STEP_ASK_BUDGET = "Ask about budget"

BROWSE_MARKERS = ("browsing", "just looking", "no budget", "zero", "none")

DEFAULT_DB_PATH = Path("leads.db")


def get_chat_model() -> str:
    return os.getenv("GEMINI_CHAT_MODEL", DEFAULT_CHAT_MODEL).strip() or DEFAULT_CHAT_MODEL


def get_db_path() -> Path:
    raw = os.getenv("LEADS_DB_PATH", "").strip()
    return Path(raw) if raw else DEFAULT_DB_PATH
