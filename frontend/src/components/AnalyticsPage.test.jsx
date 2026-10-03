import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AnalyticsPage from "./AnalyticsPage.jsx";
import { getAnalytics } from "../api.js";

vi.mock("../api.js", () => ({ getAnalytics: vi.fn() }));

function analyticsPayload() {
  return {
    date_range: { start_date: "2026-09-26", end_date: "2026-10-03", inclusive: true },
    episodes_recorded: Array.from({ length: 12 }, (_, index) => ({
      date: `2026-10-${String(index + 1).padStart(2, "0")}`,
      robot_id: `arm-${index + 1}`,
      count: index + 1,
    })),
    quality_counts: { good: 9, usable: 4, bad: 2 },
    request_fulfilment: {
      counts_by_status: { submitted: 1, in_progress: 2, delivered: 3, accepted: 1, rejected: 0 },
      median_seconds_to_deliver: 3600,
    },
    top_tasks_by_good_episodes: [
      { task_name: "pick cup", good_episodes_count: 7 },
      { task_name: "wipe table", good_episodes_count: 3 },
    ],
  };
}

function localDate(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

describe("analytics dashboard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("loads the previous seven days by default and shows an accessible quality bar chart", async () => {
    getAnalytics.mockResolvedValue(analyticsPayload());
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 7);

    render(<AnalyticsPage />);

    expect(await screen.findByRole("heading", { name: "Top tasks by good episodes" })).toBeInTheDocument();
    expect(getAnalytics).toHaveBeenCalledWith(localDate(start), localDate(end));
    expect(screen.getByRole("group", { name: "Top task names by count of good episodes" })).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "pick cup: 7" })).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "wipe table: 3" })).toBeInTheDocument();
  });

  it("paginates recording volume at ten records and places workload beneath quality output", async () => {
    getAnalytics.mockResolvedValue(analyticsPayload());
    const actor = userEvent.setup();
    render(<AnalyticsPage />);

    const recording = (await screen.findByRole("heading", { name: "Episodes per day / robot" })).closest("section");
    await screen.findByText("Current workload");
    expect(within(recording).getAllByRole("row")).toHaveLength(11);

    const jump = screen.getByRole("spinbutton", { name: "Go to page" });
    await actor.clear(jump);
    await actor.type(jump, "2");
    await actor.click(screen.getByRole("button", { name: "Go" }));
    expect(within(recording).getAllByRole("row")).toHaveLength(3);
    expect(within(recording).getByText("arm-12")).toBeInTheDocument();

    const quality = screen.getByRole("heading", { name: "Top tasks by good episodes" }).closest("section");
    expect(quality.nextElementSibling).toHaveTextContent("Current workload");
  });
});
