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
    lead_id: int | None = None


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
