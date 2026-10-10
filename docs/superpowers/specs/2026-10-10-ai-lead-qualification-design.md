# AI Lead Qualification Assistant

Design for App 2. A chat assistant for BrightMart gathers a prospect’s needs, budget, and timeline, returns a validated JSON summary plus a suggested next step, and keeps completed summaries in a local SQLite store for a simple Past leads list. Synthetic leads only. No CRM.

## Decisions

- Conversation style is mixed: the bot guides with questions, but the user may answer freely or dump several fields in one message.
- Each turn uses one Gemini call that returns JSON: assistant reply plus extracted `needs`, `budget`, and `timeline`. The server validates with Pydantic, then applies fixed rules for `next_step`. The model does not invent next steps.
- Missing fields stay `null`. The app does not guess budget, timeline, or needs.
- UI is chat on the left and a live lead-summary panel on the right. On narrow screens the summary stacks below the chat.
- Startup shows a BrightMart welcome message plus 2–3 synthetic lead chips (for example Busy shop owner, Just browsing, Ready buyer).
- New lead clears local chat history and the live summary. It does not delete Past leads rows.
- Completed leads (needs, budget, and timeline all non-null) are saved to SQLite. Incomplete turns are not saved. Full chat transcripts are not stored.
- The browser never calls Gemini. Next.js is the UI. FastAPI owns validation, Gemini JSON, next-step rules, and SQLite.

## Architecture

Two processes.

Next.js renders the chat, synthetic chips, live summary panel, Past leads list, and New lead control. It sends chat turns to FastAPI and loads past leads from FastAPI.

FastAPI is mostly stateless for chat: the browser sends the new message and recent history. FastAPI calls Gemini, validates the structured fields, applies next-step rules, optionally inserts a completed summary into SQLite, and returns the assistant message plus summary.

SQLite holds only completed lead summaries (local demo store). No auth, no multi-tenant CRM.

```
Browser (Next.js)
    │  POST /chat, GET /status, GET /leads, GET /leads/{id}
    ▼
FastAPI
    ├── validate input
    ├── Gemini → JSON (assistant_message, needs, budget, timeline)
    ├── Pydantic validate
    ├── fixed next_step rules
    ├── SQLite save when complete
    └── return { assistant_message, summary, saved? }
```

## Components

**Chat screen.** Message list, composer, welcome text, synthetic lead chips, New lead button. Keeps history in the browser (about the last 10 turns). Calls only FastAPI.

**Live summary panel.** Shows `needs`, `budget`, `timeline`, and `next_step`. Null fields display as unknown / empty. Updates after every successful `/chat` response.

**Past leads.** List of saved summaries from SQLite. Clicking a row shows that summary read-only. Does not reload the chat transcript.

**Qualification service.** Builds the Gemini prompt for BrightMart lead intake. Expects structured JSON. On parse or validation failure, returns an error — no fake fields.

**Next-step rules.** Small fixed set, for example:

- needs + budget + timeline all present → `Book a product demo`
- needs present, budget null → `Ask about budget`
- clear browse / no-budget signal → `Send free resources`
- otherwise → `null` until enough signal exists

Exact rule table is implemented in code and covered by unit tests. Rules may refine labels but stay deterministic and closed (no free-form model next steps).

**SQLite store.** Table for completed leads: id, created_at, needs, budget, timeline, next_step. Path from env (default `leads.db`). File is gitignored. Docker mounts a volume so data survives container restarts.

**Synthetic chips.** Frontend-only starters that send a first user message, for example:

- Busy shop owner — needs a store soon, mentions rough budget
- Just browsing — low urgency, little budget
- Ready buyer — clear need, budget, and timeline in one message

## Data model

```json
{
  "needs": "string | null",
  "budget": "string | null",
  "timeline": "string | null",
  "next_step": "string | null"
}
```

## Data flow

**Chat turn.** Browser sends `{ message, history, previous_summary }`. FastAPI rejects a blank message with 400. Gemini returns JSON. Pydantic validates fields. Server sets `next_step` from rules. A row is inserted only when the new summary is complete (needs, budget, and timeline all non-null) and `previous_summary` was not complete. Later turns on the same completed lead return `saved: false` and do not insert duplicates. Response updates chat bubble and right panel.

**Past leads.** `GET /leads` returns newest-first list. `GET /leads/{id}` returns one summary.

**New lead.** Client clears messages and live summary. Past leads remain.

**Restart.** Chat history is gone (browser). SQLite past leads remain if the DB file or volume persists.

## API

- `GET /status` → `{ "ready": boolean, "model": string }` — ready when `GOOGLE_API_KEY` is set.
- `POST /chat` → body `{ "message": string, "history": [{ "role": "user" | "assistant", "content": string }], "previous_summary"?: LeadSummary }`. History longer than ten messages keeps the latest ten. Blank message → 400. Success → `{ "assistant_message": string, "summary": LeadSummary, "saved": boolean, "lead_id"?: number }`.
- `GET /leads` → `{ "leads": [{ "id", "created_at", "needs", "budget", "timeline", "next_step" }] }`.
- `GET /leads/{id}` → one lead or 404.

Missing `GOOGLE_API_KEY` or Gemini failure → 503. Invalid model JSON / validation failure → 502 or 503 with a clear message; no invented summary fields. SQLite write failure logs a warning; chat response can still succeed with `saved: false`.

## Error handling

| Case | Result |
| --- | --- |
| Blank message | 400, Gemini not called |
| Missing API key or Gemini error | 503 |
| Invalid / unparseable model JSON | 502 or 503, no guessed fields |
| Incomplete lead | 200 with nulls; not saved to SQLite |
| SQLite write fail | Chat 200 if qualification succeeded; `saved: false` |
| Unknown lead id | 404 |
| Out of scope | No CRM, no email send, no auth, no full chat archive |

## Testing

pytest. Gemini is mocked. Tests do not call the network. Use a temp SQLite file.

- Normal: mocked Gemini returns complete needs/budget/timeline; response has assistant message, rule-based next_step, and a saved row.
- Incomplete: mocked Gemini leaves budget null; next_step follows rules; no DB row (or `saved: false`).
- Blank message: 400; Gemini not called.
- Missing API key / Gemini error: 503; body has no made-up lead.
- Invalid JSON from model: error status; no guessed fields.
- Past leads list returns inserted rows newest first.

## Stack

- Backend: Python 3.11+, FastAPI, Pydantic, Gemini (`gemini-3.6-flash`, env-overridable), SQLite, pytest
- Frontend: Next.js, TypeScript, Tailwind CSS, shadcn/ui
- Delivery: README, `.env.example`, Docker Compose, volume for `leads.db`

## Out of scope

- Real CRM or WhatsApp
- Multi-user accounts / auth
- Persisting full chat transcripts
- Autonomous email or calendar booking
- Paid APIs beyond Google AI Studio Gemini

## Known limitations

- Local demo SQLite only; not a production lead database.
- Chat history lives in the browser; refresh clears the open conversation.
- Next-step labels are a small fixed set for predictability.
- Gemini quality varies; validation and nulls are the safety net.
