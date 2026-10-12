# AI Lead Qualification Assistant

A BrightMart demo that guides prospects through lead qualification, turns each conversation into a validated JSON summary, recommends a deterministic next step, and stores completed summaries in a local SQLite-backed Past leads list.

## Stack

- Backend: Python 3.12, FastAPI, Pydantic, Gemini, SQLite, pytest
- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS
- Delivery: Docker Compose with a persistent SQLite volume

## Run with Docker

App 2 uses **different host ports** from App 1 so both can run side by side:

| Service | App 2 (this repo) | App 1 |
| --- | --- | --- |
| Frontend | http://localhost:3001 | http://localhost:3000 |
| API | http://localhost:8001 | http://localhost:8000 |

Create the backend environment file and add a Google AI Studio API key:

```bash
cp backend/.env.example backend/.env
# Edit backend/.env and set GOOGLE_API_KEY.
docker compose up --build
```

Open [http://localhost:3001](http://localhost:3001). The API is at [http://localhost:8001](http://localhost:8001). Completed leads persist in the `leads_data` Docker volume.

Override ports via root `.env` (`FRONTEND_PORT`, `BACKEND_PORT`, `NEXT_PUBLIC_API_URL`) if needed. Rebuild after changing `NEXT_PUBLIC_API_URL` / `BACKEND_PORT`.

## Run locally

Start the backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and set GOOGLE_API_KEY.
uvicorn app.main:app --reload
```

In another terminal, start the frontend:

```bash
cd frontend
npm ci
npm run dev
```

The frontend uses `http://localhost:8000` by default. Set `NEXT_PUBLIC_API_URL` before building or starting it if the backend is elsewhere.

## Tests

```bash
cd backend
PYTHONPATH=. pytest -v
```

Frontend tests can be run with `cd frontend && npm test`.

## Known limitations

- SQLite is a local demo store, not a production lead database.
- Chat history stays in the browser and is cleared on refresh.
- Suggested next steps come from a small fixed set.
- There is no CRM integration.
- Gemini and a valid `GOOGLE_API_KEY` are required for live chat.

## Project docs

- [Design specification](docs/superpowers/specs/2026-10-10-ai-lead-qualification-design.md)
- [Implementation plan](docs/superpowers/plans/2026-10-10-ai-lead-qualification.md)
