import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
    assigned_episodes: [],
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

    await actor.click(screen.getByRole("button", { name: "Close dialog" }));
    await actor.click((await screen.findAllByRole("button", { name: "Details" }))[1]);
    expect(await screen.findByRole("button", { name: "Accept delivery" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject delivery" })).toBeInTheDocument();
  });

  it("renders the fixed-shell landmarks on login and shows auth errors as a toast", async () => {
    api.login.mockRejectedValue({ status: 401, message: "Authentication failed." });
    const actor = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("banner")).toHaveTextContent("Dataset Request Desk");
    expect(screen.getByRole("contentinfo")).toHaveTextContent("© Dataset Request Desk @ 2026");
    await actor.type(screen.getByLabelText("Email address"), "client-a@example.com");
    await actor.type(screen.getByLabelText("Password"), "wrong-password");
    await actor.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password did not match.");
  });

  it("shows a safe error toast for an unexpected login server failure", async () => {
    api.login.mockRejectedValue({ status: 500, message: "Internal Server Error" });
    const actor = userEvent.setup();
    render(<App />);
    await actor.type(screen.getByLabelText("Email address"), "client-a@example.com");
    await actor.type(screen.getByLabelText("Password"), "client123");
    await actor.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in is temporarily unavailable. Please try again.");
    expect(screen.queryByText("Internal Server Error")).not.toBeInTheDocument();
  });

  it("keeps admin navigation and logout in the sidebar", async () => {
    const actor = await signIn("admin@example.com", "admin");

    const sidebar = screen.getByRole("complementary", { name: "Application navigation" });
    expect(within(sidebar).getByRole("button", { name: "Requests" })).toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: "Episodes" })).toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: "Analytics" })).toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("Dataset Request Desk");
    expect(screen.getByRole("contentinfo")).toHaveTextContent("© Dataset Request Desk @ 2026");
    await actor.click(within(sidebar).getByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("status")).toHaveTextContent("You have been signed out.");
    expect(screen.getByRole("heading", { name: "Sign in to your workspace" })).toBeInTheDocument();
  });

  it("submits client acceptance and rejection transitions only for delivered requests", async () => {
    const delivered = request({ id: 18, status: "delivered", assigned_episodes_count: 2 });
    api.getRequests.mockResolvedValue(page([delivered]));
    api.getRequest.mockResolvedValue(delivered);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
    const actor = await signIn("client-b@example.com", "client");

    await actor.click(await screen.findByRole("button", { name: "Details" }));
    await actor.click(await screen.findByRole("button", { name: "Accept delivery" }));
    const dialog = await screen.findByRole("dialog", { name: "Accept delivery?" });
    await actor.click(within(dialog).getByRole("button", { name: "Accept delivery" }));
    await waitFor(() => expect(api.transitionRequest).toHaveBeenCalledWith(18, "accepted"));
    expect(await screen.findByText("Request accepted successfully.")).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("submits rejection as a delivered-request client action", async () => {
    const delivered = request({ id: 19, status: "delivered", assigned_episodes_count: 2 });
    api.getRequests.mockResolvedValue(page([delivered]));
    api.getRequest.mockResolvedValue(delivered);
    api.transitionRequest.mockResolvedValue(request({ id: 19, status: "rejected", assigned_episodes_count: 2 }));
    const actor = await signIn("client-b@example.com", "client");

    await actor.click(await screen.findByRole("button", { name: "Details" }));
    await actor.click(await screen.findByRole("button", { name: "Reject delivery" }));
    const dialog = await screen.findByRole("dialog", { name: "Reject delivery?" });
    await actor.click(within(dialog).getByRole("button", { name: "Reject delivery" }));

    await waitFor(() => expect(api.transitionRequest).toHaveBeenCalledWith(19, "rejected"));
    expect(await screen.findByText("Rejected", { selector: ".status-badge" })).toBeInTheDocument();
  });

  it("allows keyboard dismissal of the rejection reason modal without submitting the action", async () => {
    const delivered = request({ status: "delivered", assigned_episodes_count: 2 });
    api.getRequests.mockResolvedValue(page([delivered]));
    api.getRequest.mockResolvedValue(delivered);
    const actor = await signIn("client-a@example.com", "client");

    await actor.click(await screen.findByRole("button", { name: "Details" }));
    await actor.click(await screen.findByRole("button", { name: "Reject delivery" }));
    expect(await screen.findByRole("dialog", { name: "Reject delivery?" })).toBeInTheDocument();
    await actor.keyboard("{Escape}");

    expect(screen.getByRole("dialog", { name: "Request 0017" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Reject delivery?" })).not.toBeInTheDocument();
    expect(api.transitionRequest).not.toHaveBeenCalled();
  });

  it("dismisses the top confirmation dialog without closing request details", async () => {
    const delivered = request({ status: "delivered", assigned_episodes_count: 2 });
    api.getRequests.mockResolvedValue(page([delivered]));
    api.getRequest.mockResolvedValue(delivered);
    const actor = await signIn("client-a@example.com", "client");

    await actor.click(await screen.findByRole("button", { name: "Details" }));
    await actor.click(await screen.findByRole("button", { name: "Accept delivery" }));
    expect(await screen.findByRole("dialog", { name: "Accept delivery?" })).toBeInTheDocument();
    await actor.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Accept delivery?" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Request 0017" })).toBeInTheDocument();
    expect(api.transitionRequest).not.toHaveBeenCalled();
  });

  it("submits a client request without a client ID and refreshes the list", async () => {
    api.getRequests.mockResolvedValue(page([request({ id: 18 })]));
    const actor = await signIn("client-a@example.com", "client");
    await actor.click(await screen.findByRole("button", { name: "New request" }));
    expect(screen.getByRole("dialog", { name: "Create request" })).toBeInTheDocument();
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
    expect(screen.getByRole("status")).toHaveClass("toast", "toast--success");
  });

  it("closes the request creation modal with Escape", async () => {
    const actor = await signIn("client-a@example.com", "client");
    await actor.click(await screen.findByRole("button", { name: "New request" }));
    expect(await screen.findByRole("dialog", { name: "Create request" })).toBeInTheDocument();
    await actor.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Create request" })).not.toBeInTheDocument();
  });

  it("marks every required request field and keeps submit disabled until values are valid", async () => {
    const actor = await signIn("client-a@example.com", "client");
    await actor.click(await screen.findByRole("button", { name: "New request" }));

    expect(screen.getAllByText("*")).toHaveLength(3);
    expect(screen.getAllByText("*").every((indicator) => indicator.classList.contains("required-mark"))).toBe(true);
    const submit = screen.getByRole("button", { name: "Submit request" });
    expect(submit).toBeDisabled();
    await actor.type(screen.getByLabelText("Task name"), "fold towels");
    await actor.type(screen.getByLabelText("Episodes requested"), "1.5");
    await actor.type(screen.getByLabelText("Deadline"), "2099-12-31");
    expect(submit).toBeDisabled();
    await actor.clear(screen.getByLabelText("Episodes requested"));
    await actor.type(screen.getByLabelText("Episodes requested"), "2");
    expect(submit).toBeEnabled();
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

  it("shows assigned episode metadata in request details", async () => {
    const delivered = request({
      status: "delivered",
      assigned_episodes_count: 1,
      assigned_episodes: [{
        episode_id: "EP-DELIVERED-8",
        task_name: "wipe table",
        robot_id: "arm-02",
        quality: "good",
        duration_seconds: 67,
        recorded_at: "2026-09-20T14:35:00Z",
        operator_name: "Morgan",
      }],
    });
    api.getRequests.mockResolvedValue(page([delivered]));
    api.getRequest.mockResolvedValue(delivered);
    const actor = await signIn("client-a@example.com", "client");

    await actor.click(await screen.findByRole("button", { name: "Details" }));
    expect(await screen.findByText("Delivered dataset")).toBeInTheDocument();
    expect(screen.getByText("EP-DELIVERED-8")).toBeInTheDocument();
    expect(screen.getByText("arm-02")).toBeInTheDocument();
    expect(screen.getByText("Morgan")).toBeInTheDocument();
  });

  it("keeps allocation guidance away from clients and applies neutral progress at zero", async () => {
    const inProgress = request({ status: "in_progress", assigned_episodes_count: 0 });
    api.getRequests.mockResolvedValue(page([inProgress]));
    api.getRequest.mockResolvedValue(inProgress);
    const actor = await signIn("client-a@example.com", "client");

    await actor.click(await screen.findByRole("button", { name: "Details" }));
    expect(await screen.findByRole("progressbar")).toHaveClass("progress-track--zero");
    expect(screen.queryByText(/Assign \d+ more episodes? before delivery/)).not.toBeInTheDocument();
  });

  it("shows operator allocation guidance and amber partial progress", async () => {
    const inProgress = request({ status: "in_progress", assigned_episodes_count: 1 });
    api.getRequests.mockResolvedValue(page([inProgress]));
    api.getRequest.mockResolvedValue(inProgress);
    const actor = await signIn("ops1@example.com", "operator");

    await actor.click(await screen.findAllByRole("button", { name: "Details" }).then((buttons) => buttons[0]));
    expect(await screen.findByText("Assign 1 more episode before delivery.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveClass("progress-track--partial");
  });

  it("uses green progress only after requested allocation is complete", async () => {
    const ready = request({ status: "in_progress", assigned_episodes_count: 2 });
    api.getRequests.mockResolvedValue(page([ready]));
    api.getRequest.mockResolvedValue(ready);
    const actor = await signIn("ops1@example.com", "operator");

    await actor.click((await screen.findAllByRole("button", { name: "Details" }))[0]);
    expect(await screen.findByRole("progressbar")).toHaveClass("progress-track--complete");
    expect(screen.queryByText(/Assign \d+ more episodes? before delivery/)).not.toBeInTheDocument();
  });

  it("filters requests by submitted date using server-side query options", async () => {
    const actor = await signIn("ops1@example.com", "operator");
    await screen.findByRole("heading", { name: "All requests" });
    await actor.type(screen.getByLabelText("Submitted from"), "2026-10-01");
    await actor.type(screen.getByLabelText("Submitted to"), "2026-10-02");

    await waitFor(() => expect(api.getRequests).toHaveBeenLastCalledWith(expect.objectContaining({
      submittedFrom: "2026-10-01",
      submittedTo: "2026-10-02",
    })));
  });

  it("shows accessible deadline urgency labels for overdue and due-soon requests", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const soon = new Date();
    soon.setDate(soon.getDate() + 3);
    const asDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    api.getRequests.mockResolvedValue(page([
      request({ id: 40, deadline: asDate(yesterday) }),
      request({ id: 41, deadline: asDate(soon) }),
    ]));
    const actor = await signIn("ops1@example.com", "operator");
    await screen.findByText("Overdue");

    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("Due soon")).toBeInTheDocument();
  });

  it("delivers an allocated request directly from the Episodes workflow", async () => {
    const readyRequest = request({ status: "in_progress", assigned_episodes_count: 2 });
    api.getRequests.mockResolvedValue(page([readyRequest]));
    api.getEpisodes.mockResolvedValue(page());
    api.transitionRequest.mockResolvedValue(request({ status: "delivered", assigned_episodes_count: 2 }));
    const actor = await signIn("ops1@example.com", "operator");

    await actor.click((await screen.findAllByRole("button", { name: "Assign" }))[0]);
    await actor.click(await screen.findByRole("button", { name: "Deliver request now" }));
    const confirmation = await screen.findByRole("dialog", { name: "Deliver this request?" });
    await actor.click(within(confirmation).getByRole("button", { name: "Deliver request" }));

    await waitFor(() => expect(api.transitionRequest).toHaveBeenCalledWith(17, "delivered"));
    expect(await screen.findByText("Request delivered successfully.")).toBeInTheDocument();
  });

  it("submits a trimmed optional rejection reason through the existing transition API", async () => {
    const delivered = request({ status: "delivered", assigned_episodes_count: 2 });
    api.getRequests.mockResolvedValue(page([delivered]));
    api.getRequest.mockResolvedValue(delivered);
    api.transitionRequest.mockResolvedValue(request({ status: "rejected", assigned_episodes_count: 2 }));
    const actor = await signIn("client-a@example.com", "client");

    await actor.click(await screen.findByRole("button", { name: "Details" }));
    await actor.click(await screen.findByRole("button", { name: "Reject delivery" }));
    const dialog = await screen.findByRole("dialog", { name: "Reject delivery?" });
    await actor.type(within(dialog).getByLabelText("Reason (optional)"), "  Missing recording  ");
    await actor.click(within(dialog).getByRole("button", { name: "Reject delivery" }));

    await waitFor(() => expect(api.transitionRequest).toHaveBeenCalledWith(17, "rejected", "Missing recording"));
    expect(screen.queryByRole("dialog", { name: "Reject delivery?" })).not.toBeInTheDocument();
    expect(await screen.findByText("Request rejected and returned for rework.")).toBeInTheDocument();
  });

  it("filters episodes by task name while the user types", async () => {
    api.getRequests.mockResolvedValue(page());
    api.getEpisodes.mockResolvedValue(page());
    const actor = await signIn("ops1@example.com", "operator");
    await actor.click(await screen.findByRole("button", { name: "Episodes" }));
    await actor.type(screen.getByLabelText("Task name"), "up");

    await waitFor(() => expect(api.getEpisodes).toHaveBeenLastCalledWith(expect.objectContaining({ taskName: "up" })));
  });

  it("jumps directly to a distant request page", async () => {
    api.getRequests.mockResolvedValue({ count: 750, next: null, previous: null, results: [] });
    const actor = await signIn("ops1@example.com", "operator");
    const jump = await screen.findByRole("spinbutton", { name: "Go to page" });
    await actor.clear(jump);
    await actor.type(jump, "30");
    await actor.click(screen.getByRole("button", { name: "Go" }));

    await waitFor(() => expect(api.getRequests).toHaveBeenLastCalledWith(expect.objectContaining({ page: 30 })));
  });

  it("shows backend transition errors instead of assuming the change succeeded", async () => {
    const inProgress = request({ status: "in_progress", assigned_episodes_count: 2 });
    api.getRequests.mockResolvedValue(page([inProgress]));
    api.getRequest.mockResolvedValue(inProgress);
    api.transitionRequest.mockRejectedValue(new Error("Cannot deliver until enough episodes have been assigned."));
    const actor = await signIn("ops2@example.com", "operator");

    await actor.click((await screen.findAllByRole("button", { name: "Details" }))[0]);
    await actor.click(await screen.findByRole("button", { name: "Mark delivered" }));
    const dialog = await screen.findByRole("dialog", { name: "Mark request delivered?" });
    await actor.click(within(dialog).getByRole("button", { name: "Mark delivered" }));
    expect(await screen.findByText("Cannot deliver until enough episodes have been assigned.", { selector: ".toast__message" })).toBeInTheDocument();
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
    const actor = await signIn("admin@example.com", "admin");

    await actor.click(await screen.findByRole("button", { name: "Users" }));
    await actor.click(await screen.findByRole("button", { name: "Create user" }));
    expect(screen.getByRole("dialog", { name: "Create user" })).toBeInTheDocument();
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
    const dialog = await screen.findByRole("dialog", { name: "Deactivate this account?" });
    await actor.click(within(dialog).getByRole("button", { name: "Deactivate account" }));
    await waitFor(() => expect(api.deactivateUser).toHaveBeenCalledWith(2));
  });

  it("uses the backend 15-record page size for admin user pagination", async () => {
    api.getUsers.mockResolvedValue({ count: 16, next: "?page=2", previous: null, results: [
      { id: 1, email: "admin@example.com", name: "Ada Admin", role: "admin", is_active: true },
    ] });
    const actor = await signIn("admin@example.com", "admin");
    await actor.click(await screen.findByRole("button", { name: "Users" }));
    await actor.click(await screen.findByRole("button", { name: "Next" }));

    await waitFor(() => expect(api.getUsers).toHaveBeenLastCalledWith(2));
  });
});

function withinRow(email, buttonName) {
  const row = screen.getByText(email).closest("tr");
  return row.querySelector(`button[aria-label="${buttonName}"]`) || Array.from(row.querySelectorAll("button")).find((button) => button.textContent === buttonName);
}