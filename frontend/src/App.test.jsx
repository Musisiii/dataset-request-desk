import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "./App.jsx";

vi.mock("./api.js", () => ({
  login: vi.fn(),
  readSession: vi.fn(),
  logout: vi.fn(),
  clearSession: vi.fn(),
  getRequests: vi.fn(),
  getRequest: vi.fn(),
  createRequest: vi.fn(),
  transitionRequest: vi.fn(),
  getEpisodes: vi.fn(),
  assignEpisode: vi.fn(),
  getUsers: vi.fn(),
  createUser: vi.fn(),
  changeUserRole: vi.fn(),
  deactivateUser: vi.fn(),
  getAnalytics: vi.fn(),
}));

import * as api from "./api.js";

const page = (results = []) => ({ count: results.length, next: null, previous: null, results });

function request(overrides = {}) {
  return {
    id: 17,
    client: 3,
    task_name: "pick cup",
    episodes_requested: 2,
    assigned_episodes_count: 0,
    deadline: "2026-12-01",
    notes: "Use arm 1",
    status: "submitted",
    created_at: "2026-10-01T08:00:00Z",
    ...overrides,
  };
}

async function signIn(user, role) {
  const session = { email: user, name: user, role, authHeader: "Basic test" };
  api.login.mockResolvedValue(session);
  const actor = userEvent.setup();
  render(<App />);
  await actor.type(screen.getByLabelText("Email address"), user);
  await actor.type(screen.getByLabelText("Password"), "test-password");
  await actor.click(screen.getByRole("button", { name: "Sign in" }));
  return actor;
}

describe("role-aware workspace", () => {
  beforeEach(() => {
    api.readSession.mockReturnValue(null);
    api.getRequests.mockResolvedValue(page());
    api.getRequest.mockResolvedValue(request());
    api.createRequest.mockResolvedValue(request({ id: 18 }));
    api.transitionRequest.mockResolvedValue(request({ status: "accepted" }));
    api.getEpisodes.mockResolvedValue(page());
    api.assignEpisode.mockResolvedValue({ episode_id: "EP-00001" });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("shows only client navigation and only offers decisions for delivered requests", async () => {
    const delivered = request({ id: 18, status: "delivered", assigned_episodes_count: 2 });
    api.getRequests.mockResolvedValue(page([request(), delivered]));
    api.getRequest.mockImplementation(async (id) => id === 18 ? delivered : request());
    const actor = await signIn("client-a@example.com", "client");

    expect(screen.getByRole("heading", { name: "Your requests" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Episodes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Users" })).not.toBeInTheDocument();
    const detailsButtons = await screen.findAllByRole("button", { name: "Details" });
    await actor.click(detailsButtons[0]);
    expect(screen.queryByRole("button", { name: "Accept delivery" })).not.toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Close request details" }));
    await actor.click((await screen.findAllByRole("button", { name: "Details" }))[1]);
    expect(await screen.findByRole("button", { name: "Accept delivery" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject delivery" })).toBeInTheDocument();
  });

  it("submits client acceptance and rejection transitions only for delivered requests", async () => {
    const delivered = request({ id: 18, status: "delivered", assigned_episodes_count: 2 });
    api.getRequests.mockResolvedValue(page([delivered]));
    api.getRequest.mockResolvedValue(delivered);
    vi.stubGlobal("confirm", vi.fn(() => true));
    const actor = await signIn("client-b@example.com", "client");

    await actor.click(await screen.findByRole("button", { name: "Details" }));
    await actor.click(await screen.findByRole("button", { name: "Accept delivery" }));
    await waitFor(() => expect(api.transitionRequest).toHaveBeenCalledWith(18, "accepted"));
    expect(await screen.findByText("Request status updated.")).toBeInTheDocument();
  });

  it("submits rejection as a delivered-request client action", async () => {
    const delivered = request({ id: 19, status: "delivered", assigned_episodes_count: 2 });
    api.getRequests.mockResolvedValue(page([delivered]));
    api.getRequest.mockResolvedValue(delivered);
    api.transitionRequest.mockResolvedValue(request({ id: 19, status: "rejected", assigned_episodes_count: 2 }));
    vi.stubGlobal("confirm", vi.fn(() => true));
    const actor = await signIn("client-b@example.com", "client");

    await actor.click(await screen.findByRole("button", { name: "Details" }));
    await actor.click(await screen.findByRole("button", { name: "Reject delivery" }));

    await waitFor(() => expect(api.transitionRequest).toHaveBeenCalledWith(19, "rejected"));
    expect(await screen.findByText("Rejected", { selector: ".status-badge" })).toBeInTheDocument();
  });

  it("submits a client request without a client ID and refreshes the list", async () => {
    api.getRequests.mockResolvedValue(page([request({ id: 18 })]));
    const actor = await signIn("client-a@example.com", "client");
    await actor.click(await screen.findByRole("button", { name: "New request" }));
    await actor.type(screen.getByLabelText("Task name"), "fold towel");
    await actor.type(screen.getByLabelText("Episodes requested"), "12");
    await actor.type(screen.getByLabelText("Deadline"), "2026-12-10");
    await actor.type(screen.getByLabelText("Notes"), "White towels");
    await actor.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => expect(api.createRequest).toHaveBeenCalledWith({
      task_name: "fold towel",
      episodes_requested: 12,
      deadline: "2026-12-10",
      notes: "White towels",
    }));
    expect(api.createRequest.mock.calls[0][0]).not.toHaveProperty("client");
    expect(await screen.findByText("Request submitted.")).toBeInTheDocument();
  });

  it("lets operators assign an episode to the selected request by business ID", async () => {
    api.getRequests.mockResolvedValue(page([request({ status: "in_progress" })]));
    api.getRequest.mockResolvedValue(request({ status: "in_progress", assigned_episodes_count: 1 }));
    api.getEpisodes.mockResolvedValue(page([{
      episode_id: "EP-00001",
      robot_id: "arm-01",
      task_name: "pick cup",
      recorded_at: "2026-09-01T10:00:00Z",
      duration_seconds: 43,
      operator_name: "Aline",
      quality: "good",
    }]));
    const actor = await signIn("ops1@example.com", "operator");

    await actor.click((await screen.findAllByRole("button", { name: "Assign" }))[0]);
    expect(await screen.findByText("Assigning to request 17")).toBeInTheDocument();
    await actor.click(await screen.findByRole("button", { name: "Assign", exact: true }));

    await waitFor(() => expect(api.assignEpisode).toHaveBeenCalledWith(17, "EP-00001"));
    expect(await screen.findByText("EP-00001 assigned to request 17.")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("shows backend transition errors instead of assuming the change succeeded", async () => {
    const inProgress = request({ status: "in_progress", assigned_episodes_count: 2 });
    api.getRequests.mockResolvedValue(page([inProgress]));
    api.getRequest.mockResolvedValue(inProgress);
    api.transitionRequest.mockRejectedValue(new Error("Cannot deliver until enough episodes have been assigned."));
    vi.stubGlobal("confirm", vi.fn(() => true));
    const actor = await signIn("ops2@example.com", "operator");

    await actor.click((await screen.findAllByRole("button", { name: "Details" }))[0]);
    await actor.click(await screen.findByRole("button", { name: "Mark delivered" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot deliver until enough episodes have been assigned.");
    expect(api.transitionRequest).toHaveBeenCalledWith(17, "delivered");
  });

  it("only shows user management navigation to admins", async () => {
    api.getUsers.mockResolvedValue(page([{ id: 1, email: "admin@example.com", name: "Ada Admin", role: "admin", is_active: true }]));
    await signIn("admin@example.com", "admin");

    expect(await screen.findByRole("button", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analytics" })).toBeInTheDocument();
  });

  it("lets admins create users, change roles, and deactivate accounts", async () => {
    const users = [
      { id: 1, email: "admin@example.com", name: "Ada Admin", role: "admin", is_active: true, organisation: "" },
      { id: 2, email: "ops2@example.com", name: "Odile Operator", role: "operator", is_active: true, organisation: "" },
    ];
    api.getUsers.mockResolvedValue(page(users));
    api.createUser.mockResolvedValue({ id: 3 });
    api.changeUserRole.mockResolvedValue({ id: 2, role: "client" });
    api.deactivateUser.mockResolvedValue({ id: 2, is_active: false });
    vi.stubGlobal("confirm", vi.fn(() => true));
    const actor = await signIn("admin@example.com", "admin");

    await actor.click(await screen.findByRole("button", { name: "Users" }));
    await actor.click(await screen.findByRole("button", { name: "Create user" }));
    await actor.type(screen.getByLabelText("Name"), "New Client");
    await actor.type(screen.getByLabelText("Email"), "new-client@example.com");
    await actor.type(screen.getByLabelText("Temporary password"), "temp-password-123");
    await actor.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(api.createUser).toHaveBeenCalledWith({
      name: "New Client",
      email: "new-client@example.com",
      password: "temp-password-123",
      role: "client",
      organisation: "",
    }));

    const roleControl = screen.getByLabelText("Role for ops2@example.com");
    await actor.selectOptions(roleControl, "client");
    await actor.click(withinRow("ops2@example.com", "Save"));
    await waitFor(() => expect(api.changeUserRole).toHaveBeenCalledWith(2, "client"));
    await actor.click(withinRow("ops2@example.com", "Deactivate"));
    await waitFor(() => expect(api.deactivateUser).toHaveBeenCalledWith(2));
  });
});

function withinRow(email, buttonName) {
  const row = screen.getByText(email).closest("tr");
  return row.querySelector(`button[aria-label="${buttonName}"]`) || Array.from(row.querySelectorAll("button")).find((button) => button.textContent === buttonName);
}