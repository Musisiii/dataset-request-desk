const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
const SESSION_KEY = "dataset-request-desk-session";

export class ApiError extends Error {
  constructor(status, data) {
    super(formatApiError(data, status));
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export function formatApiError(data, status) {
  if (status >= 500) return "The service encountered an error. Please try again or contact support.";
  if (data && typeof data === "object") {
    if (data.detail) return String(data.detail);
    return Object.entries(data)
      .map(([field, messages]) => {
        const label = field === "non_field_errors" ? "Request" : field.replaceAll("_", " ");
        return `${label}: ${Array.isArray(messages) ? messages.join(" ") : String(messages)}`;
      })
      .join(" ");
  }
  if (typeof data === "string" && data.trim().startsWith("<")) {
    return "The service returned an unexpected response. Please try again.";
  }
  return typeof data === "string" && data ? data : `Request failed (${status}).`;
}

function encodeBasicCredentials(email, password) {
  const bytes = new TextEncoder().encode(`${email}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

export function readSession() {
  try {
    const value = sessionStorage.getItem(SESSION_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function saveSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export async function apiRequest(path, { method = "GET", body, authHeader, headers = {} } = {}) {
  const storedSession = readSession();
  const currentAuth = authHeader || storedSession?.authHeader;
  const isApiPath = path.startsWith("/api/");
  const isHealthPath = path === "/health" || path.startsWith("/health/");
  const url = path.startsWith("http")
    ? path
    : isApiPath || isHealthPath
      ? path
      : `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const requestHeaders = { Accept: "application/json", ...headers };
  if (currentAuth) requestHeaders.Authorization = currentAuth;
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach the service. Check that the backend is running.");
  }

  let data = null;
  if (response.status !== 204) {
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
  }

  if (response.status === 401 && storedSession?.authHeader === currentAuth) {
    window.dispatchEvent(new Event("auth-expired"));
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

export async function login(email, password) {
  const authHeader = encodeBasicCredentials(email.trim(), password);
  await apiRequest("/requests/", { authHeader });

  let role = "client";
  let name = email.trim();
  try {
    const users = await apiRequest("/users/", { authHeader });
    role = "admin";
    const currentUser = users.results?.find((user) => user.email.toLowerCase() === email.trim().toLowerCase());
    if (currentUser?.name) name = currentUser.name;
  } catch (error) {
    if (error.status !== 403) throw error;
    try {
      await apiRequest("/episodes/", { authHeader });
      role = "operator";
    } catch (episodeError) {
      if (episodeError.status !== 403) throw episodeError;
    }
  }

  const session = { email: email.trim(), name, role, authHeader };
  saveSession(session);
  return session;
}

export function logout() {
  clearSession();
}

export function getRequests(pageOrOptions = 1, maybeOptions = {}) {
  const options = typeof pageOrOptions === "object" ? pageOrOptions : { page: pageOrOptions, ...maybeOptions };
  const query = new URLSearchParams({ page: String(options.page ?? 1) });
  if (options.taskName) query.set("task_name", options.taskName.trim());
  if (options.status && options.status !== "all") query.set("status", options.status);
  if (options.deadlineAfter) query.set("deadline_after", options.deadlineAfter);
  if (options.deadlineBefore) query.set("deadline_before", options.deadlineBefore);
  if (options.allocationState && options.allocationState !== "all") query.set("allocation_state", options.allocationState);
  return apiRequest(`/requests/?${query.toString()}`);
}

export function getRequest(id) {
  return apiRequest(`/requests/${id}/`);
}

export function createRequest(values) {
  return apiRequest("/requests/", { method: "POST", body: values });
}

export function transitionRequest(id, status, reason = "") {
  return apiRequest(`/requests/${id}/transition/`, { method: "POST", body: { status, ...(reason ? { reason } : {}) } });
}

export function getEpisodes({ page = 1, taskName = "", quality = "", search = "" } = {}) {
  const query = new URLSearchParams({ page: String(page) });
  if (taskName.trim()) query.set("task_name", taskName.trim());
  if (quality) query.set("quality", quality);
  if (search.trim()) query.set("search", search.trim());
  return apiRequest(`/episodes/?${query.toString()}`);
}

export function assignEpisode(requestId, episodeId) {
  return apiRequest(`/requests/${requestId}/assignments/`, {
    method: "POST",
    body: { episode_id: episodeId },
  });
}

export function getUsers(page = 1) {
  return apiRequest(`/users/?page=${page}`);
}

export function createUser(values) {
  return apiRequest("/users/", { method: "POST", body: values });
}

export function changeUserRole(id, role) {
  return apiRequest(`/users/${id}/change-role/`, { method: "POST", body: { role } });
}

export function deactivateUser(id) {
  return apiRequest(`/users/${id}/deactivate/`, { method: "POST" });
}

export function getAnalytics(startDate, endDate) {
  const query = new URLSearchParams({ start_date: startDate, end_date: endDate });
  return apiRequest(`/analytics/?${query.toString()}`);
}

export function getHealth() {
  return apiRequest("/health");
}