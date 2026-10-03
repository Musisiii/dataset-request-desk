import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiRequest, formatApiError, getEpisodes, getRequests, login, readSession } from "./api.js";

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body === null ? "" : JSON.stringify(body),
  };
}

describe("API authentication", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe("API filters", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("sends server-side submission date and full episode search parameters", async () => {
      const fetchMock = vi.fn().mockResolvedValue(response(200, { count: 0, results: [] }));
      vi.stubGlobal("fetch", fetchMock);

      await getRequests({ page: 2, submittedFrom: "2026-10-01", submittedTo: "2026-10-03" });
      await getEpisodes({
        page: 3,
        taskName: "up",
        quality: "good",
        search: "EP-42",
        duration: "43",
        recordedDate: "2026-10-01",
      });

      expect(fetchMock.mock.calls[0][0]).toContain("submitted_from=2026-10-01");
      expect(fetchMock.mock.calls[0][0]).toContain("submitted_to=2026-10-03");
      expect(fetchMock.mock.calls[1][0]).toContain("task_name=up");
      expect(fetchMock.mock.calls[1][0]).toContain("search=EP-42");
      expect(fetchMock.mock.calls[1][0]).toContain("duration=43");
      expect(fetchMock.mock.calls[1][0]).toContain("recorded_date=2026-10-01");
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("validates Basic Auth, infers the backend role, and stores only tab-scoped credentials", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { results: [] }))
      .mockResolvedValueOnce(response(403, { detail: "Admin only." }))
      .mockResolvedValueOnce(response(200, { results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const session = await login("ops1@example.com", "ops123");

    expect(session.role).toBe("operator");
    expect(session.email).toBe("ops1@example.com");
    expect(sessionStorage.getItem("dataset-request-desk-session")).toContain("ops1@example.com");
    expect(sessionStorage.getItem("dataset-request-desk-session")).not.toContain("ops123");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every(([, options]) => options.headers.Authorization.startsWith("Basic "))).toBe(true);
  });

  it("does not save an invalid login", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(401, { detail: "Invalid credentials." })));

    await expect(login("client-a@example.com", "bad-password")).rejects.toBeInstanceOf(ApiError);
    expect(readSession()).toBeNull();
  });

  it("infers client and admin roles from the existing permission endpoints", async () => {
    const adminFetch = vi.fn()
      .mockResolvedValueOnce(response(200, { results: [] }))
      .mockResolvedValueOnce(response(200, { results: [{ email: "admin@example.com", name: "Ada Admin" }] }));
    vi.stubGlobal("fetch", adminFetch);
    expect((await login("admin@example.com", "admin123")).role).toBe("admin");

    sessionStorage.clear();
    const clientFetch = vi.fn()
      .mockResolvedValueOnce(response(200, { results: [] }))
      .mockResolvedValueOnce(response(403, { detail: "Admin only." }))
      .mockResolvedValueOnce(response(403, { detail: "Operators only." }));
    vi.stubGlobal("fetch", clientFetch);
    expect((await login("client-a@example.com", "client123")).role).toBe("client");
  });

  it("does not expose HTML server errors to the user", () => {
    expect(formatApiError("<html><body>Traceback with internals</body></html>", 500))
      .toBe("The service encountered an error. Please try again or contact support.");
    expect(formatApiError("<html><body>Not Found</body></html>", 404))
      .toBe("The service returned an unexpected response. Please try again.");
  });

  it("clears an existing session signal on a later unauthorized API response", async () => {
    sessionStorage.setItem("dataset-request-desk-session", JSON.stringify({ authHeader: "Basic stale" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(401, { detail: "Authentication credentials were not provided." })));
    const expired = vi.fn();
    window.addEventListener("auth-expired", expired);

    await expect(apiRequest("/requests/")).rejects.toMatchObject({ status: 401 });

    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener("auth-expired", expired);
  });
});