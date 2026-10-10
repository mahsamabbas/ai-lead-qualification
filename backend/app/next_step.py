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
