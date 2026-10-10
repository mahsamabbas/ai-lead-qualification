# AI Lead Qualification Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a BrightMart lead-qualification chat that extracts needs/budget/timeline into validated JSON, applies fixed next-step rules, shows a live summary panel, and saves completed leads to SQLite for a Past leads list.

**Architecture:** Next.js talks only to FastAPI. Each chat turn: one Gemini JSON call → Pydantic validate → deterministic `next_step` rules → optional SQLite insert when the lead newly becomes complete. Chat history lives in the browser; SQLite stores completed summaries only.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic, Google Gemini (`google-genai`), SQLite, pytest, Next.js, TypeScript, Tailwind CSS, shadcn/ui

## Global Constraints

- Product / brand copy: **BrightMart** (online store / e‑commerce setup leads). Synthetic leads only. No CRM.
- Browser never calls Gemini. Secrets only in `backend/.env`. Parent `.github_key` is never copied into this repo.
- Env: `GOOGLE_API_KEY` required for real chat. Optional `GEMINI_CHAT_MODEL` (default `gemini-3.6-flash`). Optional `LEADS_DB_PATH` (default `leads.db` under backend cwd).
- Missing key or Gemini failure → HTTP `503`. Invalid / unparseable model JSON → HTTP `502`. Blank message → HTTP `400`. Never invent needs/budget/timeline.
- Missing fields stay JSON `null`. Model must not invent next steps; server sets `next_step` only via rules.
- History: keep at most the latest `10` messages from the client payload.
- Save to SQLite only when new summary is complete (`needs`, `budget`, `timeline` all non-null) AND `previous_summary` was not complete. Full chat transcripts are never stored.
- Next-step labels (exact strings):
  - complete → `Book a product demo`
  - browse / weak budget signal (incomplete) → `Send free resources`
  - needs present, budget null (and not browse) → `Ask about budget`
  - otherwise → `null`
- Browse signal (case-insensitive substring on needs or budget text): `browsing`, `just looking`, `no budget`, `zero`, `none`.
- Git commits in this repo use author `mahsamabbas` / `6658043+mahsamabbas@users.noreply.github.com` via `git -c user.name=... -c user.email=...` (do not change global git config). No GitHub remote until the user provides access.
- Tests: pytest with Gemini mocked. No network calls. Use a temp SQLite path per test.

## File map

```
ai-lead-qualification/
  backend/
    .env.example
    requirements.txt
    Dockerfile
    app/
      __init__.py
      config.py           # constants + env helpers
      models.py           # Pydantic request/response types
      next_step.py        # deterministic next_step rules
      db.py               # SQLite init + insert/list/get
      gemini_clients.py   # thin Gemini JSON chat wrapper
      qualify.py          # orchestrate chat turn
      main.py             # FastAPI routes
    tests/
      conftest.py
      test_next_step.py
      test_db.py
      test_qualify.py
      test_api.py
  frontend/
    (Next.js: chat left, summary right, chips, past leads)
  docker-compose.yml
  .env.example
  README.md
  docs/superpowers/specs/2026-10-10-ai-lead-qualification-design.md
  docs/superpowers/plans/2026-10-10-ai-lead-qualification.md
```

---

### Task 1: Config, models, and next-step rules

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/app/__init__.py`
- Create: `backend/app/config.py`
- Create: `backend/app/models.py`
- Create: `backend/app/next_step.py`
- Create: `backend/tests/test_next_step.py`

**Interfaces:**
- Consumes: none
- Produces:
  - `LeadSummary` with `needs/budget/timeline/next_step: str | None`
  - `is_complete(summary: LeadSummary) -> bool` — true iff needs, budget, timeline all non-null (ignores `next_step`)
  - `apply_next_step(needs, budget, timeline: str | None) -> str | None` — exact label strings from Global Constraints
  - Constants: `MAX_HISTORY = 10`, `DEFAULT_CHAT_MODEL = "gemini-3.6-flash"`, next-step string constants

- [ ] **Step 1: Create backend skeleton and requirements**

```text
# backend/requirements.txt
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
python-dotenv>=1.0.0
pydantic>=2.0.0
google-genai>=1.0.0
pytest>=8.0.0
httpx>=0.27.0
```

```python
# backend/app/__init__.py
```

```python
# backend/app/config.py
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
```

```python
# backend/app/models.py
from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class LeadSummary(BaseModel):
    needs: str | None = None
    budget: str | None = None
    timeline: str | None = None
    next_step: str | None = None


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    previous_summary: LeadSummary | None = None


class ChatResponse(BaseModel):
    assistant_message: str
    summary: LeadSummary
    saved: bool = False
    lead_id: int | None = None


class StatusResponse(BaseModel):
    ready: bool
    model: str


class LeadRecord(BaseModel):
    id: int
    created_at: str
    needs: str
    budget: str
    timeline: str
    next_step: str | None = None


class LeadsListResponse(BaseModel):
    leads: list[LeadRecord]
```

- [ ] **Step 2: Write failing next-step tests**

```python
# backend/tests/test_next_step.py
from app.models import LeadSummary
from app.next_step import apply_next_step, is_complete


def test_complete_gets_demo():
    assert (
        apply_next_step("Online store", "$800-$1000", "Next month")
        == "Book a product demo"
    )


def test_needs_without_budget_asks_budget():
    assert apply_next_step("Online store", None, None) == "Ask about budget"


def test_browse_signal_gets_resources():
    assert (
        apply_next_step("Just browsing free options", "almost zero", None)
        == "Send free resources"
    )


def test_otherwise_null():
    assert apply_next_step(None, None, None) is None


def test_complete_beats_browse_markers_in_text():
    # All three fields present → always demo
    assert (
        apply_next_step("browsing maybe", "zero urgency budget $50", "someday")
        == "Book a product demo"
    )


def test_is_complete():
    assert is_complete(
        LeadSummary(needs="a", budget="b", timeline="c", next_step=None)
    )
    assert not is_complete(
        LeadSummary(needs="a", budget=None, timeline="c", next_step=None)
    )
```

- [ ] **Step 3: Run tests — expect fail**

Run: `cd backend && PYTHONPATH=. pytest tests/test_next_step.py -v`  
Expected: FAIL (import / module missing)

- [ ] **Step 4: Implement next_step**

```python
# backend/app/next_step.py
from app.config import (
    BROWSE_MARKERS,
    NEXT_STEP_ASK_BUDGET,
    NEXT_STEP_DEMO,
    NEXT_STEP_RESOURCES,
)
from app.models import LeadSummary


def is_complete(summary: LeadSummary) -> bool:
    return (
        summary.needs is not None
        and summary.budget is not None
        and summary.timeline is not None
    )


def _has_browse_signal(needs: str | None, budget: str | None) -> bool:
    blob = f"{needs or ''} {budget or ''}".lower()
    return any(marker in blob for marker in BROWSE_MARKERS)


def apply_next_step(
    needs: str | None,
    budget: str | None,
    timeline: str | None,
) -> str | None:
    if needs is not None and budget is not None and timeline is not None:
        return NEXT_STEP_DEMO
    if _has_browse_signal(needs, budget):
        return NEXT_STEP_RESOURCES
    if needs is not None and budget is None:
        return NEXT_STEP_ASK_BUDGET
    return None
```

- [ ] **Step 5: Run tests — expect pass**

Run: `cd backend && PYTHONPATH=. pytest tests/test_next_step.py -v`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/app backend/tests/test_next_step.py
git -c user.name="mahsamabbas" -c user.email="6658043+mahsamabbas@users.noreply.github.com" commit -m "$(cat <<'EOF'
Add lead summary models and next-step rules.

Deterministic labels keep qualification predictable without model-invented steps.
EOF
)"
```

---

### Task 2: SQLite lead store

**Files:**
- Create: `backend/app/db.py`
- Create: `backend/tests/test_db.py`
- Create: `backend/tests/conftest.py`

**Interfaces:**
- Consumes: `LeadSummary`, `is_complete`, `get_db_path` pattern (tests pass explicit path)
- Produces:
  - `init_db(path: Path) -> None`
  - `insert_lead(path: Path, summary: LeadSummary) -> int` — raises `ValueError` if not complete
  - `list_leads(path: Path) -> list[LeadRecord]` — newest first
  - `get_lead(path: Path, lead_id: int) -> LeadRecord | None`

- [ ] **Step 1: Write failing DB tests**

```python
# backend/tests/test_db.py
from pathlib import Path

import pytest

from app.db import get_lead, init_db, insert_lead, list_leads
from app.models import LeadSummary


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    path = tmp_path / "test_leads.db"
    init_db(path)
    return path


def test_insert_and_list_newest_first(db_path: Path):
    id1 = insert_lead(
        db_path,
        LeadSummary(
            needs="Store A",
            budget="$500",
            timeline="Q1",
            next_step="Book a product demo",
        ),
    )
    id2 = insert_lead(
        db_path,
        LeadSummary(
            needs="Store B",
            budget="$900",
            timeline="Next month",
            next_step="Book a product demo",
        ),
    )
    leads = list_leads(db_path)
    assert [row.id for row in leads] == [id2, id1]
    assert leads[0].needs == "Store B"


def test_get_lead(db_path: Path):
    lead_id = insert_lead(
        db_path,
        LeadSummary(
            needs="Clothes store",
            budget="$800",
            timeline="Soon",
            next_step="Book a product demo",
        ),
    )
    row = get_lead(db_path, lead_id)
    assert row is not None
    assert row.budget == "$800"
    assert get_lead(db_path, 99999) is None


def test_reject_incomplete(db_path: Path):
    with pytest.raises(ValueError):
        insert_lead(
            db_path,
            LeadSummary(needs="x", budget=None, timeline="y", next_step=None),
        )
```

- [ ] **Step 2: Run — expect fail**

Run: `cd backend && PYTHONPATH=. pytest tests/test_db.py -v`  
Expected: FAIL (db module missing)

- [ ] **Step 3: Implement db.py**

```python
# backend/app/db.py
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.models import LeadRecord, LeadSummary
from app.next_step import is_complete


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with _connect(path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                needs TEXT NOT NULL,
                budget TEXT NOT NULL,
                timeline TEXT NOT NULL,
                next_step TEXT
            )
            """
        )
        conn.commit()


def insert_lead(path: Path, summary: LeadSummary) -> int:
    if not is_complete(summary):
        raise ValueError("Refusing to save incomplete lead.")
    created = datetime.now(timezone.utc).isoformat()
    with _connect(path) as conn:
        cur = conn.execute(
            """
            INSERT INTO leads (created_at, needs, budget, timeline, next_step)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                created,
                summary.needs,
                summary.budget,
                summary.timeline,
                summary.next_step,
            ),
        )
        conn.commit()
        return int(cur.lastrowid)


def list_leads(path: Path) -> list[LeadRecord]:
    with _connect(path) as conn:
        rows = conn.execute(
            """
            SELECT id, created_at, needs, budget, timeline, next_step
            FROM leads
            ORDER BY id DESC
            """
        ).fetchall()
    return [LeadRecord(**dict(row)) for row in rows]


def get_lead(path: Path, lead_id: int) -> LeadRecord | None:
    with _connect(path) as conn:
        row = conn.execute(
            """
            SELECT id, created_at, needs, budget, timeline, next_step
            FROM leads
            WHERE id = ?
            """,
            (lead_id,),
        ).fetchone()
    return LeadRecord(**dict(row)) if row else None
```

```python
# backend/tests/conftest.py
# Reserved for shared fixtures; API tests will add client fixtures in Task 4.
```

- [ ] **Step 4: Run — expect pass**

Run: `cd backend && PYTHONPATH=. pytest tests/test_db.py tests/test_next_step.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/db.py backend/tests/test_db.py backend/tests/conftest.py
git -c user.name="mahsamabbas" -c user.email="6658043+mahsamabbas@users.noreply.github.com" commit -m "$(cat <<'EOF'
Add SQLite store for completed lead summaries.

Past leads stay local and demo-sized without becoming a CRM.
EOF
)"
```

---

### Task 3: Gemini client and qualify orchestration

**Files:**
- Create: `backend/app/gemini_clients.py`
- Create: `backend/app/qualify.py`
- Create: `backend/tests/test_qualify.py`

**Interfaces:**
- Consumes: `ChatMessage`, `LeadSummary`, `ChatResponse`, `apply_next_step`, `is_complete`, `insert_lead`, `init_db`
- Produces:
  - `get_api_key() -> str | None`
  - `generate_qualification_json(message, history, api_key) -> dict` — raw parsed dict with keys `assistant_message`, `needs`, `budget`, `timeline` (values str or null). Raises on transport/API failure or unparseable JSON.
  - `qualify_turn(message, history, previous_summary, db_path, *, json_fn=generate_qualification_json) -> ChatResponse`
  - Exceptions: `BlankMessageError`, `ServiceUnavailableError` (503), `BadModelResponseError` (502)

Gemini prompt requirements (implement in `gemini_clients.py`):
- System/user content: BrightMart lead intake; mix of guiding questions and free answers; extract only stated facts; use JSON null when unknown; never invent budget/timeline/needs; return ONLY JSON object with those four keys (no `next_step`).
- Prefer `response_mime_type="application/json"` if the SDK supports it on `generate_content`; otherwise strip markdown fences before `json.loads`.

- [ ] **Step 1: Write failing qualify tests**

```python
# backend/tests/test_qualify.py
from pathlib import Path

import pytest

from app.db import init_db, list_leads
from app.models import ChatMessage, LeadSummary
from app.qualify import (
    BadModelResponseError,
    BlankMessageError,
    ServiceUnavailableError,
    qualify_turn,
)


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    path = tmp_path / "q.db"
    init_db(path)
    return path


def test_blank_message(db_path: Path):
    with pytest.raises(BlankMessageError):
        qualify_turn("   ", [], None, db_path, json_fn=lambda *a, **k: {})


def test_complete_turn_saves(db_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")

    def fake_json(message, history, api_key):
        return {
            "assistant_message": "Great — you look ready. A demo is next.",
            "needs": "Online clothing store",
            "budget": "$800-$1000",
            "timeline": "Next month",
        }

    result = qualify_turn(
        "I need a store, $900, next month",
        [],
        None,
        db_path,
        json_fn=fake_json,
    )
    assert result.summary.next_step == "Book a product demo"
    assert result.saved is True
    assert result.lead_id is not None
    assert len(list_leads(db_path)) == 1


def test_incomplete_does_not_save(db_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")

    def fake_json(message, history, api_key):
        return {
            "assistant_message": "What budget works for you?",
            "needs": "Online store",
            "budget": None,
            "timeline": None,
        }

    result = qualify_turn("I need a store", [], None, db_path, json_fn=fake_json)
    assert result.summary.next_step == "Ask about budget"
    assert result.saved is False
    assert list_leads(db_path) == []


def test_no_duplicate_save_when_already_complete(
    db_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    previous = LeadSummary(
        needs="Online store",
        budget="$800",
        timeline="Next month",
        next_step="Book a product demo",
    )

    def fake_json(message, history, api_key):
        return {
            "assistant_message": "Anything else?",
            "needs": "Online store",
            "budget": "$800",
            "timeline": "Next month",
        }

    result = qualify_turn(
        "Thanks",
        [ChatMessage(role="user", content="hi")],
        previous,
        db_path,
        json_fn=fake_json,
    )
    assert result.saved is False
    assert list_leads(db_path) == []


def test_missing_key(db_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    with pytest.raises(ServiceUnavailableError):
        qualify_turn(
            "hello",
            [],
            None,
            db_path,
            json_fn=lambda *a, **k: (_ for _ in ()).throw(AssertionError("no call")),
        )


def test_bad_json_shape(db_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")

    def fake_json(message, history, api_key):
        return {"assistant_message": "hi"}  # missing field keys → validation error path

    with pytest.raises(BadModelResponseError):
        qualify_turn("hello", [], None, db_path, json_fn=fake_json)
```

Note: for `test_bad_json_shape`, `qualify_turn` should require keys `assistant_message`, `needs`, `budget`, `timeline` (null allowed for the three fields). Missing keys → `BadModelResponseError`.

- [ ] **Step 2: Run — expect fail**

Run: `cd backend && PYTHONPATH=. pytest tests/test_qualify.py -v`  
Expected: FAIL

- [ ] **Step 3: Implement gemini_clients.py and qualify.py**

```python
# backend/app/gemini_clients.py
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
    lines = [f"{m.role}: {m.content}" for m in history]
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
```

```python
# backend/app/qualify.py
from collections.abc import Callable
from pathlib import Path
from typing import Any

from app.config import MAX_HISTORY
from app.db import init_db, insert_lead
from app.gemini_clients import generate_qualification_json, get_api_key
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
    if not all(k in data for k in required):
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
    next_step = apply_next_step(needs, budget, timeline)
    summary = LeadSummary(
        needs=needs,
        budget=budget,
        timeline=timeline,
        next_step=next_step,
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

    trimmed = _trim_history(history)
    call_json = json_fn or generate_qualification_json
    try:
        raw = call_json(message.strip(), trimmed, api_key)
    except BadModelResponseError:
        raise
    except Exception as exc:  # noqa: BLE001 — Gemini / parse failures
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
        except Exception:  # noqa: BLE001 — chat still succeeds
            saved = False
            lead_id = None

    return ChatResponse(
        assistant_message=assistant_message,
        summary=summary,
        saved=saved,
        lead_id=lead_id,
    )
```

Important: `generate_qualification_json` raises `ValueError` on bad JSON → `qualify_turn` maps that to `ServiceUnavailableError`. For missing keys inside a parsed dict, `_parse_model_dict` raises `BadModelResponseError`. Adjust `test_bad_json_shape` expectations to match: missing keys → `BadModelResponseError` (HTTP 502 at API layer). If `json_fn` returns a dict missing keys, that is 502, not 503.

If `json.loads` fails inside the real client, map to 503 at the API (transport-ish failure) OR treat as 502 — **use 502 for any parse/shape problem after a successful HTTP-ish model call**. Simplest rule for implementers:
- exceptions from `json_fn` other than `BadModelResponseError` → `ServiceUnavailableError` (503)
- `_parse_model_dict` failures → `BadModelResponseError` (502)
- To make `test_bad_json_shape` pass, missing keys must be detected in `_parse_model_dict`, not inside `json_fn`.

- [ ] **Step 4: Run — expect pass**

Run: `cd backend && PYTHONPATH=. pytest tests/test_qualify.py tests/test_db.py tests/test_next_step.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/gemini_clients.py backend/app/qualify.py backend/tests/test_qualify.py
git -c user.name="mahsamabbas" -c user.email="6658043+mahsamabbas@users.noreply.github.com" commit -m "$(cat <<'EOF'
Add Gemini JSON qualification turn with mocked tests.

One model call extracts fields; server rules and SQLite handle the rest.
EOF
)"
```

---

### Task 4: FastAPI routes and API tests

**Files:**
- Create: `backend/app/main.py`
- Create: `backend/tests/test_api.py`
- Create: `backend/.env.example`
- Modify: `backend/tests/conftest.py` if helpful for `TestClient`

**Interfaces:**
- Consumes: `qualify_turn`, `get_api_key`, `get_chat_model`, `get_db_path`, `list_leads`, `get_lead`, `init_db`
- Produces HTTP:
  - `GET /status` → `StatusResponse`
  - `POST /chat` → `ChatResponse` (400 / 502 / 503 as specified)
  - `GET /leads` → `LeadsListResponse`
  - `GET /leads/{id}` → `LeadRecord` or 404
- `create_app(db_path: Path | None = None)` for tests

- [ ] **Step 1: Write failing API tests**

```python
# backend/tests/test_api.py
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.db import init_db, insert_lead
from app.main import create_app
from app.models import LeadSummary


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    path = tmp_path / "api.db"
    init_db(path)
    return path


@pytest.fixture
def client(db_path: Path):
    app = create_app(db_path=db_path)
    with TestClient(app) as c:
        yield c


def test_status_not_ready_without_key(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    res = client.get("/status")
    assert res.status_code == 200
    body = res.json()
    assert body["ready"] is False
    assert "model" in body


def test_chat_blank_400(client: TestClient):
    res = client.post("/chat", json={"message": "  ", "history": []})
    assert res.status_code == 400


def test_chat_complete_saves(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")

    def fake_json(message, history, api_key):
        return {
            "assistant_message": "You are ready for a demo.",
            "needs": "Online store",
            "budget": "$1000",
            "timeline": "2 weeks",
        }

    with patch("app.qualify.generate_qualification_json", side_effect=fake_json):
        res = client.post(
            "/chat",
            json={"message": "store, 1000, 2 weeks", "history": []},
        )
    assert res.status_code == 200
    body = res.json()
    assert body["summary"]["next_step"] == "Book a product demo"
    assert body["saved"] is True

    listed = client.get("/leads")
    assert listed.status_code == 200
    assert len(listed.json()["leads"]) == 1


def test_chat_gemini_failure_503(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")

    def boom(*args, **kwargs):
        raise RuntimeError("network down")

    with patch("app.qualify.generate_qualification_json", side_effect=boom):
        res = client.post("/chat", json={"message": "hi", "history": []})
    assert res.status_code == 503
    assert "unavailable" in res.json()["detail"].lower()


def test_chat_bad_model_502(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")

    def bad(message, history, api_key):
        return {"assistant_message": "x"}

    with patch("app.qualify.generate_qualification_json", side_effect=bad):
        res = client.post("/chat", json={"message": "hi", "history": []})
    assert res.status_code == 502


def test_get_lead_404(client: TestClient):
    assert client.get("/leads/999").status_code == 404


def test_get_lead_ok(client: TestClient, db_path: Path):
    lead_id = insert_lead(
        db_path,
        LeadSummary(
            needs="n",
            budget="b",
            timeline="t",
            next_step="Book a product demo",
        ),
    )
    res = client.get(f"/leads/{lead_id}")
    assert res.status_code == 200
    assert res.json()["needs"] == "n"
```

Note: `create_app` must call `qualify_turn` with the injected `db_path`. Patching `app.qualify.generate_qualification_json` works because `qualify_turn` default arg binds the name looked up at call time only if qualify uses the default — **default args are bound at function definition**. So either:
- patch `app.gemini_clients.generate_qualification_json` and have `qualify_turn` call it by looking up the module attribute inside the function body, OR
- change `qualify_turn` to call `gemini_clients.generate_qualification_json(...)` inside the body when `json_fn` is default.

**Required implementation detail:** In `qualify.py`, do not use the default-argument binding for the real client. Pattern:

```python
def qualify_turn(..., json_fn: JsonFn | None = None) -> ChatResponse:
    call_json = json_fn or generate_qualification_json
    raw = call_json(...)
```

Then API tests patch `app.qualify.generate_qualification_json`. Update Task 3 code accordingly if already written with default-arg binding.

- [ ] **Step 2: Run — expect fail**

Run: `cd backend && PYTHONPATH=. pytest tests/test_api.py -v`  
Expected: FAIL

- [ ] **Step 3: Implement main.py**

```python
# backend/app/main.py
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_chat_model, get_db_path
from app.db import get_lead, init_db, list_leads
from app.gemini_clients import get_api_key
from app.models import (
    ChatRequest,
    ChatResponse,
    LeadRecord,
    LeadsListResponse,
    StatusResponse,
)
from app.qualify import (
    BadModelResponseError,
    BlankMessageError,
    ServiceUnavailableError,
    qualify_turn,
)

load_dotenv()

UNAVAILABLE = "Answer service unavailable."
BAD_MODEL = "Invalid model response."


def create_app(db_path: Path | None = None) -> FastAPI:
    path = db_path or get_db_path()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_db(path)
        app.state.db_path = path
        yield

    app = FastAPI(title="AI Lead Qualification Assistant", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3001",
        ],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/status", response_model=StatusResponse)
    def status() -> StatusResponse:
        return StatusResponse(ready=bool(get_api_key()), model=get_chat_model())

    @app.post("/chat", response_model=ChatResponse)
    def chat(body: ChatRequest) -> ChatResponse:
        try:
            return qualify_turn(
                body.message,
                body.history,
                body.previous_summary,
                app.state.db_path,
            )
        except BlankMessageError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except BadModelResponseError as exc:
            raise HTTPException(status_code=502, detail=BAD_MODEL) from exc
        except ServiceUnavailableError as exc:
            raise HTTPException(status_code=503, detail=UNAVAILABLE) from exc

    @app.get("/leads", response_model=LeadsListResponse)
    def leads() -> LeadsListResponse:
        return LeadsListResponse(leads=list_leads(app.state.db_path))

    @app.get("/leads/{lead_id}", response_model=LeadRecord)
    def lead_detail(lead_id: int) -> LeadRecord:
        row = get_lead(app.state.db_path, lead_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Lead not found.")
        return row

    return app


app = create_app()
```

```text
# backend/.env.example
GOOGLE_API_KEY=
GEMINI_CHAT_MODEL=gemini-3.6-flash
LEADS_DB_PATH=leads.db
```

Fix `qualify_turn` default `json_fn` lookup as noted above if tests fail to patch.

- [ ] **Step 4: Run full backend suite**

Run: `cd backend && PYTHONPATH=. pytest -v`  
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_api.py backend/.env.example backend/app/qualify.py
git -c user.name="mahsamabbas" -c user.email="6658043+mahsamabbas@users.noreply.github.com" commit -m "$(cat <<'EOF'
Expose FastAPI chat, status, and past-leads routes.

API tests cover happy path, blank input, 502/503, and SQLite list/get.
EOF
)"
```

---

### Task 5: Next.js UI (chat + summary + past leads)

**Files:**
- Create: `frontend/` via `create-next-app`
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/app/page.tsx` (and polish `globals.css` / `layout.tsx`)
- Create: `frontend/.env.example`

**Interfaces:**
- Consumes: `GET /status`, `POST /chat`, `GET /leads`, `GET /leads/{id}`
- Produces: browser UI that never calls Gemini

UI requirements:

1. Layout **A**: chat left / live summary right; stack on small screens.
2. Brand header: **BrightMart** + subtitle Lead Qualification Assistant.
3. Welcome assistant message on empty chat + three chips:
   - Busy shop owner → `I run a small shop and need an online store soon. Budget is around $700.`
   - Just browsing → `Just browsing for now, almost no budget, no rush.`
   - Ready buyer → `I need a BrightMart clothing store, budget $900-$1200, launch next month.`
4. Composer sends `{ message, history, previous_summary }` with last 10 history messages.
5. After each success, update messages + live summary panel (`null` → show `unknown`).
6. **New lead** clears messages + live summary (keep past leads).
7. Past leads list under or below the summary panel; click loads read-only detail (from list payload or `GET /leads/{id}`).
8. Show error banner for 502/503 using API `detail`.
9. Prefer shadcn/ui for button/input/textarea; plain Tailwind acceptable if shadcn init blocks the clock.

- [ ] **Step 1: Scaffold Next.js**

```bash
cd /Users/azc/Desktop/azc/mahsamabbas_repos/ai-lead-qualification
mkdir -p frontend && cd frontend
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --turbopack=false
```

Add `.env.example` / `.env.local`:

```text
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Optional: `npx shadcn@latest init` + button/input/textarea.

- [ ] **Step 2: API helper**

```typescript
// frontend/src/lib/api.ts
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type LeadSummary = {
  needs: string | null;
  budget: string | null;
  timeline: string | null;
  next_step: string | null;
};
export type ChatResult = {
  assistant_message: string;
  summary: LeadSummary;
  saved: boolean;
  lead_id: number | null;
};
export type LeadRecord = {
  id: number;
  created_at: string;
  needs: string;
  budget: string;
  timeline: string;
  next_step: string | null;
};

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return typeof data.detail === "string" ? data.detail : "Request failed";
  } catch {
    return "Request failed";
  }
}

export async function fetchStatus(): Promise<{ ready: boolean; model: string }> {
  const res = await fetch(`${API_URL}/status`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function sendChat(
  message: string,
  history: ChatMessage[],
  previous_summary: LeadSummary | null,
): Promise<ChatResult> {
  const res = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, previous_summary }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchLeads(): Promise<LeadRecord[]> {
  const res = await fetch(`${API_URL}/leads`);
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.leads;
}
```

- [ ] **Step 3: Implement page**

Implement `frontend/src/app/page.tsx` with:

- state: `messages`, `summary`, `leads`, `error`, `pending`, `selectedLead`
- `WELCOME` constant assistant message
- chips calling the same send path as the composer
- `New lead` reset
- after successful chat / on mount: `fetchLeads()`
- display summary fields with `unknown` for null
- keep visual distinct from App 1 (not a clone of teal/coral FAQ UI); still one composition, brand-first BrightMart

- [ ] **Step 4: Manual smoke**

Terminal 1:

```bash
cd backend && python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # set GOOGLE_API_KEY
uvicorn app.main:app --reload --port 8000
```

Terminal 2:

```bash
cd frontend && npm install && cp .env.example .env.local && npm run dev
```

Verify:

1. Welcome + chips visible; summary shows unknowns
2. Ready buyer chip → panel fills → `Book a product demo` → Past leads gains a row
3. New lead clears chat/summary; past lead remains
4. Stop backend / bad key → 503 banner on send

- [ ] **Step 5: Commit**

```bash
git add frontend
git -c user.name="mahsamabbas" -c user.email="6658043+mahsamabbas@users.noreply.github.com" commit -m "$(cat <<'EOF'
Add Next.js lead qualification UI with live summary.

Chat stays on the left; completed leads appear in Past leads from the API.
EOF
)"
```

---

### Task 6: Docker, root env example, README

**Files:**
- Create: `backend/Dockerfile`
- Create: `frontend/Dockerfile`
- Create: `docker-compose.yml`
- Create: `.env.example` (root)
- Create: `README.md`
- Create: `backend/.dockerignore`, `frontend/.dockerignore` as needed

- [ ] **Step 1: Dockerfiles + compose**

```dockerfile
# backend/Dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
ENV LEADS_DB_PATH=/data/leads.db
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```dockerfile
# frontend/Dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["npm", "run", "start"]
```

(If frontend `next start` needs more files from the build stage, copy the same set App 1 used — mirror `business-faq-assistant/frontend/Dockerfile` if the slim copy fails.)

```yaml
# docker-compose.yml
services:
  backend:
    build:
      context: ./backend
    ports:
      - "8000:8000"
    env_file:
      - ./backend/.env
    volumes:
      - leads_data:/data
    environment:
      LEADS_DB_PATH: /data/leads.db
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      args:
        NEXT_PUBLIC_API_URL: http://localhost:8000
    ports:
      - "${FRONTEND_PORT:-3000}:3000"
    depends_on:
      - backend
    restart: unless-stopped

volumes:
  leads_data:
```

```text
# .env.example (repo root)
# Prefer backend/.env for the API key.
GOOGLE_API_KEY=
FRONTEND_PORT=3000
```

- [ ] **Step 2: README**

Root `README.md` must include:

1. One-paragraph description (BrightMart lead qualification + JSON summary + Past leads)
2. Stack
3. Docker: `docker compose up --build` (needs `backend/.env` with `GOOGLE_API_KEY`)
4. Local backend + frontend setup
5. Tests: `cd backend && PYTHONPATH=. pytest -v`
6. Known limitations: local SQLite only; chat history in browser; fixed next-step set; no CRM; Gemini required for live chat
7. Links to design spec and this plan

- [ ] **Step 3: Final verification**

```bash
cd backend && PYTHONPATH=. pytest -v
```

Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml backend/Dockerfile frontend/Dockerfile .env.example README.md backend/.dockerignore frontend/.dockerignore
git -c user.name="mahsamabbas" -c user.email="6658043+mahsamabbas@users.noreply.github.com" commit -m "$(cat <<'EOF'
Add Docker Compose, env examples, and README for App 2.

One-command demo with a persistent volume for past leads.
EOF
)"
```

---

## Self-review checklist (plan author)

1. **Spec coverage**
   - Mix guided + free answers → Task 3 prompt + Task 5 chips
   - One Gemini JSON call + Pydantic + server next_step → Tasks 1, 3
   - null for missing fields → Tasks 1, 3, 5
   - Layout A chat/summary → Task 5
   - Welcome + synthetic chips → Task 5
   - New lead clears local state only → Task 5
   - SQLite save on newly complete only → Tasks 2, 3, 4
   - API shapes status/chat/leads → Task 4
   - Errors 400/502/503/404 → Tasks 3, 4
   - pytest cases from design Testing → Tasks 1–4
   - Docker volume + README → Task 6
   - No browser Gemini → Task 5

2. **Placeholders:** none intentional. Frontend Dockerfile may need to mirror App 1’s working copy set if the slim production image misses files — keep API contract unchanged.

3. **Type consistency:** `LeadSummary`, `ChatRequest.previous_summary`, `ChatResponse.saved/lead_id`, `LeadRecord`, `apply_next_step` exact strings, `qualify_turn(..., json_fn=)` patchable via module attribute lookup, `create_app(db_path=)`.

4. **Commit author:** every commit step uses `git -c user.name="mahsamabbas" -c user.email="6658043+mahsamabbas@users.noreply.github.com"`.
