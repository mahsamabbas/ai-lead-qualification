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
