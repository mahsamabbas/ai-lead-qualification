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
        return {"assistant_message": "hi"}

    with pytest.raises(BadModelResponseError):
        qualify_turn("hello", [], None, db_path, json_fn=fake_json)


def test_bad_field_type(db_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")

    def fake_json(message, history, api_key):
        return {
            "assistant_message": "hi",
            "needs": ["store"],
            "budget": None,
            "timeline": None,
        }

    with pytest.raises(BadModelResponseError):
        qualify_turn("hello", [], None, db_path, json_fn=fake_json)


def test_transport_failure_is_service_unavailable(
    db_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")

    def failing_json(message, history, api_key):
        raise ConnectionError("Gemini unavailable")

    with pytest.raises(ServiceUnavailableError):
        qualify_turn("hello", [], None, db_path, json_fn=failing_json)


def test_default_client_function_can_be_patched(
    db_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setattr(
        "app.qualify.generate_qualification_json",
        lambda message, history, api_key: {
            "assistant_message": "What is your budget?",
            "needs": "Online store",
            "budget": None,
            "timeline": None,
        },
    )

    result = qualify_turn("I need a store", [], None, db_path)

    assert result.summary.next_step == "Ask about budget"


def test_history_is_trimmed(db_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    history = [ChatMessage(role="user", content=str(i)) for i in range(12)]

    def fake_json(message, trimmed_history, api_key):
        assert [item.content for item in trimmed_history] == [str(i) for i in range(2, 12)]
        return {
            "assistant_message": "What do you need?",
            "needs": None,
            "budget": None,
            "timeline": None,
        }

    qualify_turn("hello", history, None, db_path, json_fn=fake_json)


def test_sqlite_failure_does_not_fail_chat(
    db_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setattr(
        "app.qualify.insert_lead",
        lambda path, summary: (_ for _ in ()).throw(OSError("disk full")),
    )

    result = qualify_turn(
        "ready",
        [],
        None,
        db_path,
        json_fn=lambda message, history, api_key: {
            "assistant_message": "Book a demo.",
            "needs": "Online store",
            "budget": "$800",
            "timeline": "Next month",
        },
    )

    assert result.saved is False
    assert result.lead_id is None
