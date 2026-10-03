import { useState } from "react";

import { login } from "../api.js";

export default function AuthScreen({ onAuthenticated, onToast }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    try {
      const session = await login(email, password);
      setPassword("");
      onAuthenticated(session);
    } catch (requestError) {
      const message = requestError.status === 401
        ? "Email or password did not match."
        : requestError.status >= 500
          ? "Sign-in is temporarily unavailable. Please try again."
          : requestError.message || "Could not sign in. Please try again.";
      onToast(message, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="login-layout" aria-label="Sign in">
      <section className="login-panel">
        <p className="eyebrow">Operations portal</p>
        <h1>Sign in to your workspace</h1>
        <p className="muted">Use your assigned company account.</p>
        <form className="stack-form" onSubmit={handleSubmit}>
          <label>
            Email address
            <input
              autoComplete="username"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button className="button button--primary button--wide" type="submit" disabled={loading}>
            {loading ? "Checking account…" : "Sign in"}
          </button>
        </form>
      </section>
      <aside className="login-aside" aria-label="Workspace description">
        <p className="eyebrow">Field operations / 01</p>
        <p className="login-aside__statement">From request to recorded episode, in one place.</p>
        <div className="login-aside__rule" />
        <span className="mono">INTERNAL DATA PLATFORM</span>
      </aside>
    </section>
  );
}