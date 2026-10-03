import { useEffect, useRef, useState } from "react";

import { clearSession, logout, readSession } from "./api.js";
import AdminUsersPage from "./components/AdminUsersPage.jsx";
import AnalyticsPage from "./components/AnalyticsPage.jsx";
import AuthScreen from "./components/AuthScreen.jsx";
import ConfirmDialog from "./components/ConfirmDialog.jsx";
import EpisodesPage from "./components/EpisodesPage.jsx";
import GlobalFooter from "./components/GlobalFooter.jsx";
import GlobalHeader from "./components/GlobalHeader.jsx";
import RequestsPage from "./components/RequestsPage.jsx";
import Toast from "./components/Toast.jsx";

const ROLE_LABELS = { client: "Client", operator: "Operator", admin: "Admin" };

export default function App() {
  const [session, setSession] = useState(readSession);
  const [view, setView] = useState("requests");
  const [targetRequest, setTargetRequest] = useState(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [toast, setToast] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dialog, setDialog] = useState(null);
  const toastId = useRef(0);
  const dialogResolver = useRef(null);

  function notify(message, type = "success") {
    toastId.current += 1;
    setToast({ id: toastId.current, message, type });
  }

  function askConfirmation(options) {
    return new Promise((resolve) => {
      dialogResolver.current = resolve;
      setDialog(options);
    });
  }

  function finishConfirmation(confirmed) {
    setDialog(null);
    dialogResolver.current?.(confirmed);
    dialogResolver.current = null;
  }

  useEffect(() => {
    function expireSession() {
      clearSession();
      setSession(null);
      setDialog(null);
      dialogResolver.current?.(false);
      dialogResolver.current = null;
      notify("Your session is no longer valid. Sign in again.", "error");
    }
    window.addEventListener("auth-expired", expireSession);
    return () => window.removeEventListener("auth-expired", expireSession);
  }, []);

  function handleLogout() {
    logout();
    setSession(null);
    setTargetRequest(null);
    setView("requests");
    setMobileMenuOpen(false);
    notify("You have been signed out.", "info");
  }

  function startAssignment(request) {
    setTargetRequest(request);
    setView("episodes");
  }

  const tabs = session ? [
    { id: "requests", label: session.role === "client" ? "My requests" : "Requests" },
    ...(session.role === "operator" || session.role === "admin"
      ? [
          { id: "episodes", label: "Episodes" },
          { id: "analytics", label: "Analytics" },
        ]
      : []),
    ...(session.role === "admin" ? [{ id: "users", label: "Users" }] : []),
  ] : [];

  return (
    <div className="app-shell">
      <GlobalHeader />

      <div className={`app-body ${session ? "app-body--authenticated" : "app-body--login"}`}>
        {session && (
          <>
            {mobileMenuOpen && <button className="sidebar-backdrop" type="button" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)} />}
            <aside className={`sidebar ${mobileMenuOpen ? "sidebar--open" : ""}`} aria-label="Application navigation">
              <nav className="sidebar__nav">
                <span className="sidebar__section-label">Workspace</span>
                {tabs.map((tab) => (
                  <button
                    className={`sidebar-link ${view === tab.id ? "sidebar-link--active" : ""}`}
                    type="button"
                    key={tab.id}
                    aria-current={view === tab.id ? "page" : undefined}
                    onClick={() => { setView(tab.id); setMobileMenuOpen(false); }}
                  >
                    <span className={`sidebar-link__marker sidebar-link__marker--${tab.id}`} aria-hidden="true" />
                    {tab.label}
                  </button>
                ))}
              </nav>
              <div className="sidebar-profile">
                <div className="sidebar-profile__avatar" aria-hidden="true">{session.name.charAt(0).toUpperCase()}</div>
                <div className="sidebar-profile__identity">
                  <strong>{session.email}</strong>
                  <span>{ROLE_LABELS[session.role]}</span>
                </div>
                <button className="button button--quiet sidebar-profile__logout" type="button" onClick={handleLogout}>Log out</button>
              </div>
            </aside>
          </>
        )}

        <main className={`main-content ${session ? "" : "main-content--login"}`}>
          {!session ? (
            <AuthScreen onAuthenticated={setSession} onToast={notify} />
          ) : (
            <>
              <div className="mobile-toolbar">
                <button className="button button--quiet" type="button" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(true)}>
                  Menu
                </button>
                <span>{tabs.find((tab) => tab.id === view)?.label}</span>
              </div>
              {view === "requests" && (
                <RequestsPage
                  session={session}
                  onNotice={notify}
                  onConfirm={askConfirmation}
                  onOpenAssignments={startAssignment}
                  onRequestChanged={() => setRefreshSignal((value) => value + 1)}
                  refreshSignal={refreshSignal}
                />
              )}
              {view === "episodes" && (session.role === "operator" || session.role === "admin") && (
                <EpisodesPage
                  targetRequest={targetRequest}
                  onTargetRequest={setTargetRequest}
                  onNotice={notify}
                  onChanged={() => setRefreshSignal((value) => value + 1)}
                />
              )}
              {view === "analytics" && (session.role === "operator" || session.role === "admin") && <AnalyticsPage />}
              {view === "users" && session.role === "admin" && <AdminUsersPage session={session} onNotice={notify} onConfirm={askConfirmation} />}
            </>
          )}
        </main>
      </div>

      <GlobalFooter />
      {toast && <Toast key={toast.id} {...toast} onDismiss={(id) => setToast((current) => current?.id === id ? null : current)} />}
      <ConfirmDialog
        open={Boolean(dialog)}
        {...dialog}
        onCancel={() => finishConfirmation(false)}
        onConfirm={() => finishConfirmation(true)}
      />
    </div>
  );
}