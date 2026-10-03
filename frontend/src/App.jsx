import { useEffect, useState } from "react";

import { clearSession, logout, readSession } from "./api.js";
import AdminUsersPage from "./components/AdminUsersPage.jsx";
import AnalyticsPage from "./components/AnalyticsPage.jsx";
import AuthScreen from "./components/AuthScreen.jsx";
import EpisodesPage from "./components/EpisodesPage.jsx";
import RequestsPage from "./components/RequestsPage.jsx";

const ROLE_LABELS = { client: "Client", operator: "Operator", admin: "Admin" };

export default function App() {
  const [session, setSession] = useState(readSession);
  const [view, setView] = useState("requests");
  const [targetRequest, setTargetRequest] = useState(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    function expireSession() {
      clearSession();
      setSession(null);
      setNotice("Your session is no longer valid. Sign in again.");
    }
    window.addEventListener("auth-expired", expireSession);
    return () => window.removeEventListener("auth-expired", expireSession);
  }, []);

  function handleLogout() {
    logout();
    setSession(null);
    setTargetRequest(null);
    setView("requests");
    setNotice("");
  }

  function startAssignment(request) {
    setTargetRequest(request);
    setView("episodes");
  }

  if (!session) return <AuthScreen onAuthenticated={setSession} />;

  const tabs = [
    { id: "requests", label: session.role === "client" ? "My requests" : "Requests" },
    ...(session.role === "operator" || session.role === "admin"
      ? [
          { id: "episodes", label: "Episodes" },
          { id: "analytics", label: "Analytics" },
        ]
      : []),
    ...(session.role === "admin" ? [{ id: "users", label: "Users" }] : []),
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand-lockup" href="#requests" onClick={(event) => { event.preventDefault(); setView("requests"); }}>
          <span className="brand-mark" aria-hidden="true">D</span>
          <span>Dataset Request Desk</span>
        </a>
        <nav className="primary-nav" aria-label="Main navigation">
          {tabs.map((tab) => (
            <button
              className={`nav-tab ${view === tab.id ? "nav-tab--active" : ""}`}
              type="button"
              key={tab.id}
              aria-current={view === tab.id ? "page" : undefined}
              onClick={() => setView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="account-strip">
          <div className="account-strip__identity">
            <strong>{session.name}</strong>
            <span>{ROLE_LABELS[session.role]}</span>
          </div>
          <button className="button button--quiet" type="button" onClick={handleLogout}>Log out</button>
        </div>
      </header>

      <main className="main-content">
        {notice && (
          <div className="notice notice--success" role="status">
            <span>{notice}</span>
            <button className="icon-button" aria-label="Dismiss message" type="button" onClick={() => setNotice("")}>×</button>
          </div>
        )}
        {view === "requests" && (
          <RequestsPage
            session={session}
            onNotice={setNotice}
            onOpenAssignments={startAssignment}
            onRequestChanged={() => setRefreshSignal((value) => value + 1)}
            refreshSignal={refreshSignal}
          />
        )}
        {view === "episodes" && (session.role === "operator" || session.role === "admin") && (
          <EpisodesPage
            targetRequest={targetRequest}
            onTargetRequest={setTargetRequest}
            onNotice={setNotice}
            onChanged={() => setRefreshSignal((value) => value + 1)}
          />
        )}
        {view === "analytics" && (session.role === "operator" || session.role === "admin") && <AnalyticsPage />}
        {view === "users" && session.role === "admin" && <AdminUsersPage session={session} onNotice={setNotice} />}
      </main>
      <footer className="app-footer">
        <span>Internal operations</span>
        <span className="mono">{session.email}</span>
      </footer>
    </div>
  );
}