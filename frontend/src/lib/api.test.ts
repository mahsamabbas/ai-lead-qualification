import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchLead,
  fetchLeads,
  fetchStatus,
  sendChat,
  type LeadSummary,
} from "./api";

const summary: LeadSummary = {
  needs: "Online shop",
  budget: "$900",
  timeline: "Next month",
  next_step: "Book a product demo",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API client", () => {
  it("sends chat context to the backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          assistant_message: "Let's schedule a demo.",
          summary,
          saved: true,
          lead_id: 7,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendChat(
      "Ready to launch",
      [{ role: "assistant", content: "Tell me about your project." }],
      summary,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          message: "Ready to launch",
          history: [
            { role: "assistant", content: "Tell me about your project." },
          ],
          previous_summary: summary,
        }),
      }),
    );
  });

  it("surfaces the backend error detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Gemini is unavailable" }), {
          status: 503,
        }),
      ),
    );

    await expect(fetchStatus()).rejects.toThrow("Gemini is unavailable");
  });

  it("reads lead collections and individual records", async () => {
    const lead = {
      id: 7,
      created_at: "2026-10-10T12:00:00Z",
      needs: "Online shop",
      budget: "$900",
      timeline: "Next month",
      next_step: "Book a product demo",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ leads: [lead] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(lead), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLeads()).resolves.toEqual([lead]);
    await expect(fetchLead(7)).resolves.toEqual(lead);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:8000/leads/7",
    );
  });
});
