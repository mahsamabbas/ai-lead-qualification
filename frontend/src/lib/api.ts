const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:8000";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type LeadSummary = {
  needs: string | null;
  budget: string | null;
  timeline: string | null;
  next_step: string | null;
};

export type ChatResult = {
  assistant_message: string;
  summary: LeadSummary;
  saved: boolean;
  lead_id: number | null;
};

export type LeadRecord = {
  id: number;
  created_at: string;
  needs: string;
  budget: string;
  timeline: string;
  next_step: string | null;
};

async function readError(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (
      typeof data === "object" &&
      data !== null &&
      "detail" in data &&
      typeof data.detail === "string"
    ) {
      return data.detail;
    }
  } catch {
    // Fall through to a stable message for non-JSON responses.
  }

  return "Request failed";
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json() as Promise<T>;
}

export async function fetchStatus(): Promise<{
  ready: boolean;
  model: string;
}> {
  const response = await fetch(`${API_URL}/status`);
  return readJson(response);
}

export async function sendChat(
  message: string,
  history: ChatMessage[],
  previous_summary: LeadSummary | null,
): Promise<ChatResult> {
  const response = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, previous_summary }),
  });
  return readJson(response);
}

export async function fetchLeads(): Promise<LeadRecord[]> {
  const response = await fetch(`${API_URL}/leads`);
  const data = await readJson<{ leads: LeadRecord[] }>(response);
  return data.leads;
}

export async function fetchLead(id: number): Promise<LeadRecord> {
  const response = await fetch(`${API_URL}/leads/${id}`);
  return readJson(response);
}
