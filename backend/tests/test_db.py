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
