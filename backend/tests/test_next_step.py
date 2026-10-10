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
