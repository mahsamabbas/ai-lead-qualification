import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchLead: vi.fn(),
  fetchLeads: vi.fn(),
  fetchStatus: vi.fn(),
  sendChat: vi.fn(),
}));

vi.mock("@/lib/api", () => api);

import Home from "./page";

const completedLead = {
  id: 7,
  created_at: "2026-10-10T12:00:00Z",
  needs: "BrightMart clothing store",
  budget: "$900-$1200",
  timeline: "Next month",
  next_step: "Book a product demo",
};

describe("lead qualification page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchStatus.mockResolvedValue({ ready: true, model: "gemini-test" });
    api.fetchLeads.mockResolvedValue([]);
  });

  it("shows the welcome, exact starter choices, and unknown summary", async () => {
    render(<Home />);

    expect(
      screen.getByText(/tell me about the store you want to build/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Busy shop owner" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Just browsing" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ready buyer" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("unknown")).toHaveLength(4);
    await waitFor(() => expect(api.fetchLeads).toHaveBeenCalled());
  });

  it("sends a starter message, updates summary, and keeps leads after reset", async () => {
    api.sendChat.mockResolvedValue({
      assistant_message: "You sound ready. Let's book a product demo.",
      summary: {
        needs: completedLead.needs,
        budget: completedLead.budget,
        timeline: completedLead.timeline,
        next_step: completedLead.next_step,
      },
      saved: true,
      lead_id: completedLead.id,
    });
    api.fetchLeads
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([completedLead]);
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Ready buyer" }));

    expect(api.sendChat).toHaveBeenCalledWith(
      "I need a BrightMart clothing store, budget $900-$1200, launch next month.",
      [],
      null,
      null,
    );
    expect(await screen.findByText(completedLead.budget)).toBeInTheDocument();
    expect(
      await screen.findByRole("button", {
        name: /BrightMart clothing store/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/lead qualified/i);
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "New lead" })[0]);

    expect(screen.queryByText(completedLead.budget)).not.toBeInTheDocument();
    expect(screen.getAllByText("unknown")).toHaveLength(4);
    expect(
      screen.getByRole("button", { name: /BrightMart clothing store/i }),
    ).toBeInTheDocument();
  });

  it("ignores in-flight chat after New lead clears the conversation", async () => {
    let resolveSendChat!: (value: Awaited<ReturnType<typeof api.sendChat>>) => void;
    api.sendChat.mockReturnValue(
      new Promise((resolve) => {
        resolveSendChat = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Ready buyer" }));
    expect(screen.getByLabelText("Assistant is responding")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "New lead" })[0]);

    expect(
      screen.getByText(/tell me about the store you want to build/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText("unknown")).toHaveLength(4);
    expect(
      screen.queryByLabelText("Assistant is responding"),
    ).not.toBeInTheDocument();

    resolveSendChat({
      assistant_message: "You sound ready. Let's book a product demo.",
      summary: {
        needs: completedLead.needs,
        budget: completedLead.budget,
        timeline: completedLead.timeline,
        next_step: completedLead.next_step,
      },
      saved: true,
      lead_id: completedLead.id,
    });

    await waitFor(() => expect(api.sendChat).toHaveBeenCalled());
    expect(
      screen.queryByText("You sound ready. Let's book a product demo."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(completedLead.budget)).not.toBeInTheDocument();
    expect(screen.getAllByText("unknown")).toHaveLength(4);
  });

  it("soft-completes chat and unlocks editing on request", async () => {
    api.sendChat.mockResolvedValue({
      assistant_message: "You sound ready. Let's book a product demo.",
      summary: {
        needs: completedLead.needs,
        budget: completedLead.budget,
        timeline: completedLead.timeline,
        next_step: completedLead.next_step,
      },
      saved: true,
      lead_id: completedLead.id,
    });
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Ready buyer" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      /book a product demo/i,
    );
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit answers" }));
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/update needs, budget, or timeline/i),
    ).toBeInTheDocument();
  });

  it("filters past leads from the search box", async () => {
    api.fetchLeads.mockResolvedValue([
      completedLead,
      {
        id: 8,
        created_at: "2026-10-10T13:00:00Z",
        needs: "Online bakery shop",
        budget: "$500",
        timeline: "Next week",
        next_step: "Book a product demo",
      },
    ]);
    const user = userEvent.setup();
    render(<Home />);

    expect(
      await screen.findByRole("button", { name: /BrightMart clothing store/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Online bakery shop/i }),
    ).toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Search past leads"),
      "bakery",
    );

    expect(
      screen.queryByRole("button", { name: /BrightMart clothing store/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Online bakery shop/i }),
    ).toBeInTheDocument();
  });

  it("shows backend errors and loads a past lead as read-only detail", async () => {
    api.fetchLeads.mockResolvedValue([completedLead]);
    api.fetchLead.mockResolvedValue(completedLead);
    api.sendChat.mockRejectedValue(new Error("Answer service unavailable."));
    const user = userEvent.setup();
    render(<Home />);

    const leadButton = await screen.findByRole("button", {
      name: /BrightMart clothing store/i,
    });
    await user.click(leadButton);
    expect(api.fetchLead).toHaveBeenCalledWith(7);
    expect(
      await screen.findByRole("dialog", { name: "Lead details" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close details" }));
    await user.type(
      screen.getByLabelText("Message"),
      "I need a store next week.",
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("Answer service unavailable.");
  });
});
