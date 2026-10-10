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
