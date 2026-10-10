"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  fetchLead,
  fetchLeads,
  fetchStatus,
  sendChat,
  type ChatMessage,
  type LeadRecord,
  type LeadSummary,
} from "@/lib/api";

export const WELCOME =
  "Welcome! Tell me about the store you want to build, your budget, and when you'd like to launch.";

const STARTERS = [
  {
    label: "Busy shop owner",
    message:
      "I run a small shop and need an online store soon. Budget is around $700.",
  },
  {
    label: "Just browsing",
    message: "Just browsing for now, almost no budget, no rush.",
  },
  {
    label: "Ready buyer",
    message:
      "I need a BrightMart clothing store, budget $900-$1200, launch next month.",
  },
] as const;

const EMPTY_SUMMARY: LeadSummary = {
  needs: null,
  budget: null,
  timeline: null,
  next_step: null,
};

const FIELDS: Array<{ key: keyof LeadSummary; label: string }> = [
  { key: "needs", label: "Store needs" },
  { key: "budget", label: "Budget" },
  { key: "timeline", label: "Timeline" },
  { key: "next_step", label: "Next step" },
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [summary, setSummary] = useState<LeadSummary | null>(null);
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [selectedLead, setSelectedLead] = useState<LeadRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [detailPending, setDetailPending] = useState(false);
  const [draft, setDraft] = useState("");
  const [serviceReady, setServiceReady] = useState<boolean | null>(null);
  const conversationEnd = useRef<HTMLDivElement>(null);

  const refreshLeads = useCallback(async () => {
    try {
      setLeads(await fetchLeads());
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }, []);

  useEffect(() => {
    void fetchLeads()
      .then((records) => setLeads(records))
      .catch((requestError) => setError(errorMessage(requestError)));
    void fetchStatus()
      .then(({ ready }) => setServiceReady(ready))
      .catch(() => setServiceReady(false));
  }, []);

  useEffect(() => {
    conversationEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  async function submitMessage(rawMessage: string) {
    const message = rawMessage.trim();
    if (!message || pending) return;

    const history = messages.slice(-10);
    const previousSummary = summary;
    setError(null);
    setDraft("");
    setMessages((current) => [...current, { role: "user", content: message }]);
    setPending(true);

    try {
      const result = await sendChat(message, history, previousSummary);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: result.assistant_message },
      ]);
      setSummary(result.summary);
      await refreshLeads();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage(draft);
  }

  function startNewLead() {
    setMessages([]);
    setSummary(null);
    setSelectedLead(null);
    setError(null);
    setDraft("");
  }

  async function openLead(id: number) {
    setError(null);
    setDetailPending(true);
    try {
      setSelectedLead(await fetchLead(id));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setDetailPending(false);
    }
  }

  const visibleSummary = summary ?? EMPTY_SUMMARY;

  return (
    <div className="app-shell">
      <header className="brand-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-mark">B</span>
            <div>
              <div className="brand-line">
                <h1>BrightMart</h1>
                <span>Commerce studio</span>
              </div>
              <p>Lead Qualification Assistant</p>
            </div>
          </div>
          <button type="button" onClick={startNewLead} className="new-lead">
            <span aria-hidden="true">↻</span> New lead
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="chat-card">
          <div className="section-heading">
            <div>
              <h2>Qualification conversation</h2>
              <p>A few details help us recommend the right next step.</p>
            </div>
            <div className="service-state">
              <span className={serviceReady ? "ready" : "waiting"} />
              {serviceReady ? "Assistant ready" : "Setup required"}
            </div>
          </div>

          {error && (
            <div role="alert" className="error-banner">
              <span>{error}</span>
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={() => setError(null)}
              >
                ×
              </button>
            </div>
          )}

          <div className="conversation">
            {messages.length === 0 && (
              <>
                <MessageBubble role="assistant" content={WELCOME} />
                <div className="starters">
                  <p>Try a scenario</p>
                  <div>
                    {STARTERS.map((starter) => (
                      <button
                        type="button"
                        key={starter.label}
                        disabled={pending}
                        onClick={() => void submitMessage(starter.message)}
                      >
                        {starter.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {messages.map((message, index) => (
              <MessageBubble
                key={`${message.role}-${index}`}
                role={message.role}
                content={message.content}
              />
            ))}

            {pending && (
              <div className="message assistant-message">
                <span className="assistant-mark">B</span>
                <div className="typing" aria-label="Assistant is responding">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            )}
            <div ref={conversationEnd} />
          </div>

          <form onSubmit={handleSubmit} className="composer">
            <div>
              <label htmlFor="message" className="sr-only">
                Message
              </label>
              <textarea
                id="message"
                value={draft}
                rows={2}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submitMessage(draft);
                  }
                }}
                placeholder="Describe your store, budget, and ideal launch date…"
              />
              <button
                type="submit"
                aria-label="Send message"
                disabled={pending || !draft.trim()}
              >
                <span aria-hidden="true">↗</span>
              </button>
            </div>
            <p>Your answers are used only to prepare this lead summary.</p>
          </form>
        </section>

        <aside className="sidebar">
          <section className="summary-card">
            <div className="summary-heading">
              <div>
                <p>Live summary</p>
                <h2>Lead snapshot</h2>
              </div>
              <span>Auto-updating</span>
            </div>
            <SummaryList summary={visibleSummary} />
          </section>

          <section className="leads-card">
            <div className="leads-heading">
              <div>
                <p>Past leads</p>
                <h2>
                  {leads.length} saved {leads.length === 1 ? "lead" : "leads"}
                </h2>
              </div>
              {detailPending && <span>Loading…</span>}
            </div>
            {leads.length === 0 ? (
              <div className="empty-leads">
                <strong>No qualified leads yet</strong>
                <span>Completed conversations will appear here.</span>
              </div>
            ) : (
              <div className="lead-list">
                {leads.map((lead) => (
                  <button
                    type="button"
                    key={lead.id}
                    onClick={() => void openLead(lead.id)}
                  >
                    <span>
                      <strong>{lead.needs}</strong>
                      <small>
                        {lead.budget} · {formatDate(lead.created_at)}
                      </small>
                    </span>
                    <b aria-hidden="true">→</b>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </main>

      {selectedLead && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedLead(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Lead details"
            className="lead-modal"
          >
            <div className="modal-heading">
              <div>
                <p>Saved lead #{selectedLead.id}</p>
                <h2>Lead details</h2>
                <span>{formatDate(selectedLead.created_at)} · Read only</span>
              </div>
              <button
                type="button"
                aria-label="Close details"
                onClick={() => setSelectedLead(null)}
              >
                ×
              </button>
            </div>
            <SummaryList summary={selectedLead} detail />
          </section>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ role, content }: ChatMessage) {
  return (
    <div className={`message ${role}-message`}>
      {role === "assistant" && <span className="assistant-mark">B</span>}
      <div>{content}</div>
    </div>
  );
}

function SummaryList({
  summary,
  detail = false,
}: {
  summary: LeadSummary;
  detail?: boolean;
}) {
  return (
    <dl className={detail ? "detail-grid" : "summary-list"}>
      {FIELDS.map((field, index) => (
        <div key={field.key}>
          <span className="field-number">0{index + 1}</span>
          <div>
            <dt>{field.label}</dt>
            <dd className={summary[field.key] ? "" : "unknown"}>
              {summary[field.key] ?? "unknown"}
            </dd>
          </div>
        </div>
      ))}
    </dl>
  );
}
