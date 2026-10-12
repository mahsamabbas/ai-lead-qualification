# AI Lead Qualification Assistant

BrightMart demo chat that qualifies commerce leads. The assistant asks about store needs, budget, and timeline, then returns a validated JSON summary plus a fixed suggested next step. Completed leads are saved locally and listed under Past leads.

Synthetic / demo use only — no CRM sync, no real customer data pipeline.

**Live idea:** left panel is the qualification conversation; right panel shows a live lead snapshot and searchable past leads. When a lead is complete, chat soft-pauses so the summary stays stable until you edit or start a new lead.

## What’s included

- Guided chat with starter scenario chips
- Live summary panel (needs, budget, timeline, next step)
- Soft-complete flow: edit answers or start a new lead
- Past leads list with search, persisted in SQLite
- Single-page layout: chat and past-leads scroll inside their own panels
- API timeouts / retries so a slow Gemini call does not leave the UI stuck

## Tech stack

| Layer | Choices |
| --- | --- |
| Frontend | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4 (`@tailwindcss/turbopack`), custom CSS in `globals.css` |
| Backend | Python 3.12, FastAPI, Uvicorn |
| Validation | Pydantic v2 request/response models |
| AI | Google Gemini via `google-genai` (`GEMINI_CHAT_MODEL`, default `gemini-3.8-flash`) |
| Storage | SQLite (`sqlite3` stdlib) for completed lead summaries |
| Config | `python-dotenv` + `backend/.env` |
| Delivery | Docker Compose (frontend + backend), named volume `leads_data` |
| Backend tests | `pytest`, `httpx` (API + DB + qualify unit tests) |
| Frontend tests | Vitest, Testing Library, jsdom |

### Libraries & smaller pieces

**Backend**

- `fastapi` / `uvicorn[standard]` — HTTP API
- `pydantic` — chat payloads, lead summary, status/leads responses
- `google-genai` — one JSON-shaped Gemini turn per message
- `python-dotenv` — load `GOOGLE_API_KEY`, model name, DB path
- `sqlite3` — insert / update / list / get leads
- Deterministic `next_step` rules in Python (not invented by the model)
- Thread timeout + retries around Gemini calls

**Frontend**

- `next` / `react` / `react-dom` — UI shell
- `typescript` — typed API client and page state
- `tailwindcss` + custom layout CSS — viewport-locked workspace, scrollable conversation / lead list
- `vitest` + `@testing-library/react` — UI/API client tests
- `eslint` / `eslint-config-next` — lint

**API surface (browser → FastAPI only)**

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/status` | Ready flag + active model name |
| `POST` | `/chat` | Qualify turn; optional `lead_id` to update an existing row |
| `GET` | `/leads` | Past leads list |
| `GET` | `/leads/{id}` | Single lead detail |

The browser never calls Gemini directly.

## Run with Docker

App 2 uses **different host ports** from App 1 so both can run side by side:

| Service | App 2 (this repo) | App 1 |
| --- | --- | --- |
| Frontend | http://localhost:3001 | http://localhost:3000 |
| API | http://localhost:8001 | http://localhost:8000 |

```bash
cp backend/.env.example backend/.env
# Edit backend/.env and set GOOGLE_API_KEY.
docker compose up --build
```

Open [http://localhost:3001](http://localhost:3001). The API is at [http://localhost:8001](http://localhost:8001). Completed leads persist in the `leads_data` Docker volume.

Override ports via root `.env` (`FRONTEND_PORT`, `BACKEND_PORT`, `NEXT_PUBLIC_API_URL`) if needed. Rebuild after changing `NEXT_PUBLIC_API_URL` / `BACKEND_PORT`.

## Run locally

**Backend**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and set GOOGLE_API_KEY.
uvicorn app.main:app --reload
```

**Frontend** (another terminal)

```bash
cd frontend
npm ci
npm run dev
```

Default API URL is `http://localhost:8000`. Set `NEXT_PUBLIC_API_URL` if the backend is elsewhere.

## Environment

| Variable | Where | Notes |
| --- | --- | --- |
| `GOOGLE_API_KEY` | `backend/.env` | Required for live chat |
| `GEMINI_CHAT_MODEL` | `backend/.env` | Default `gemini-3.8-flash` |
| `LEADS_DB_PATH` | `backend/.env` / Compose | Default `leads.db`; Docker uses `/data/leads.db` |
| `NEXT_PUBLIC_API_URL` | frontend build / Compose | Docker default `http://localhost:8001` |

## Tests

```bash
cd backend
PYTHONPATH=. pytest -v
```

```bash
cd frontend
npm test
```

## Known limitations

- SQLite is a local demo store, not a production lead database.
- In-progress chat history stays in the browser and clears on refresh.
- Suggested next steps come from a small fixed set.
- No CRM integration.
- Gemini and a valid `GOOGLE_API_KEY` are required for live chat.

## Docs

- [Design specification](docs/superpowers/specs/2026-10-10-ai-lead-qualification-design.md)
- [Implementation plan](docs/superpowers/plans/2026-10-10-ai-lead-qualification.md)
