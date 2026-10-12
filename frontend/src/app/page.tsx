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

export function isLeadComplete(summary: LeadSummary | null) {
  return Boolean(
    summary?.needs?.trim() &&
      summary?.budget?.trim() &&
      summary?.timeline?.trim(),
  );
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

function leadMatchesQuery(lead: LeadRecord, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    lead.needs,
    lead.budget,
    lead.timeline,
    lead.next_step ?? "",
    formatDate(lead.created_at),
    String(lead.id),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
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
  const [editingUnlocked, setEditingUnlocked] = useState(false);
  const [activeLeadId, setActiveLeadId] = useState<number | null>(null);
  const [leadQuery, setLeadQuery] = useState("");
  const conversationRef = useRef<HTMLDivElement>(null);
  const chatGenerationRef = useRef(0);

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
    const container = conversationRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function submitMessage(rawMessage: string) {
    const message = rawMessage.trim();
    if (!message || pending) return;
    if (isLeadComplete(summary) && !editingUnlocked) return;

    const history = messages.slice(-10);
    const previousSummary = summary;
    setError(null);
    setDraft("");
    setMessages((current) => [...current, { role: "user", content: message }]);
    const generation = chatGenerationRef.current;
    setPending(true);

    try {
      const result = await sendChat(
        message,
        history,
        previousSummary,
        activeLeadId,
      );
      if (generation !== chatGenerationRef.current) return;
      setMessages((current) => [
        ...current,
        { role: "assistant", content: result.assistant_message },
      ]);
      setSummary(result.summary);
      if (result.lead_id != null) {
        setActiveLeadId(result.lead_id);
      }
      if (isLeadComplete(result.summary)) {
        setEditingUnlocked(false);
      }
      // Don't block the typing indicator on the leads refresh.
      void refreshLeads();
    } catch (requestError) {
      if (generation !== chatGenerationRef.current) return;
      setError(errorMessage(requestError));
    } finally {
      if (generation === chatGenerationRef.current) {
        setPending(false);
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage(draft);
  }

  function startNewLead() {
    chatGenerationRef.current += 1;
    setMessages([]);
    setSummary(null);
    setSelectedLead(null);
    setError(null);
    setDraft("");
    setPending(false);
    setEditingUnlocked(false);
    setActiveLeadId(null);
  }

  function unlockEditing() {
    setEditingUnlocked(true);
    setError(null);
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
  const leadComplete = isLeadComplete(summary);
  const chatLocked = leadComplete && !editingUnlocked;
  const filteredLeads = leads.filter((lead) =>
    leadMatchesQuery(lead, leadQuery),
  );

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

          <div className="conversation" ref={conversationRef}>
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
                        disabled={pending || chatLocked}
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
          </div>

          {chatLocked ? (
            <div className="complete-panel" role="status">
              <div>
                <p>Lead qualified</p>
                <h3>
                  {summary?.next_step?.trim()
                    ? summary.next_step
                    : "All required details are captured"}
                </h3>
                <span>
                  Chat is paused so this summary stays stable. Edit if something
                  needs a correction, or start a new lead.
                </span>
              </div>
              <div className="complete-actions">
                <button type="button" onClick={unlockEditing}>
                  Edit answers
                </button>
                <button type="button" className="primary" onClick={startNewLead}>
                  New lead
                </button>
              </div>
            </div>
          ) : (
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
                  placeholder={
                    editingUnlocked
                      ? "Update needs, budget, or timeline…"
                      : "Describe your store, budget, and ideal launch date…"
                  }
                />
                <button
                  type="submit"
                  aria-label="Send message"
                  disabled={pending || !draft.trim()}
                >
                  <span aria-hidden="true">↗</span>
                </button>
              </div>
              <p>
                {editingUnlocked
                  ? "Editing is open. When the three fields are complete again, chat will pause."
                  : "Your answers are used only to prepare this lead summary."}
              </p>
            </form>
          )}
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
            {leads.length > 0 && (
              <label className="lead-search">
                <span className="sr-only">Search past leads</span>
                <input
                  type="search"
                  value={leadQuery}
                  onChange={(event) => setLeadQuery(event.target.value)}
                  placeholder="Search needs, budget, timeline…"
                  autoComplete="off"
                />
              </label>
            )}
            {leads.length === 0 ? (
              <div className="empty-leads">
                <strong>No qualified leads yet</strong>
                <span>Completed conversations will appear here.</span>
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="empty-leads">
                <strong>No matching leads</strong>
                <span>Try a different search term.</span>
              </div>
            ) : (
              <div className="lead-list">
                {filteredLeads.map((lead) => (
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
