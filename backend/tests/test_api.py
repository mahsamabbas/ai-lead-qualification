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


def test_status_not_ready_without_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    res = client.get("/status")
    assert res.status_code == 200
    body = res.json()
    assert body["ready"] is False
    assert "model" in body


def test_chat_blank_400(client: TestClient):
    res = client.post("/chat", json={"message": "  ", "history": []})
    assert res.status_code == 400


def test_chat_complete_saves(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
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


def test_chat_edit_updates_saved_lead(
    client: TestClient, db_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    lead_id = insert_lead(
        db_path,
        LeadSummary(
            needs="Online store",
            budget="$900",
            timeline="Next week",
            next_step="Book a product demo",
        ),
    )

    def fake_json(message, history, api_key):
        return {
            "assistant_message": "Budget updated to $500.",
            "needs": "Online store",
            "budget": "$500",
            "timeline": "Next week",
        }

    with patch("app.qualify.generate_qualification_json", side_effect=fake_json):
        res = client.post(
            "/chat",
            json={
                "message": "change budget to 500$",
                "history": [],
                "previous_summary": {
                    "needs": "Online store",
                    "budget": "$900",
                    "timeline": "Next week",
                    "next_step": "Book a product demo",
                },
                "lead_id": lead_id,
            },
        )
    assert res.status_code == 200
    body = res.json()
    assert body["saved"] is True
    assert body["lead_id"] == lead_id
    assert body["summary"]["budget"] == "$500"
    detail = client.get(f"/leads/{lead_id}")
    assert detail.json()["budget"] == "$500"
    assert len(client.get("/leads").json()["leads"]) == 1


def test_chat_gemini_failure_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")

    def boom(*args, **kwargs):
        raise RuntimeError("network down")

    with patch("app.qualify.generate_qualification_json", side_effect=boom):
        res = client.post("/chat", json={"message": "hi", "history": []})
    assert res.status_code == 503
    assert "unavailable" in res.json()["detail"].lower()


def test_chat_bad_model_502(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
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
