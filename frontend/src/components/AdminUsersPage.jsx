import { useEffect, useState } from "react";

import { changeUserRole, createUser, deactivateUser, getUsers } from "../api.js";
import OverlayModal from "./OverlayModal.jsx";
import Pagination from "./Pagination.jsx";

const PAGE_SIZE = 15;

export default function AdminUsersPage({ session, onNotice, onConfirm }) {
  const [page, setPage] = useState(1);
  const [pageData, setPageData] = useState(null);
  const [roleDrafts, setRoleDrafts] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [values, setValues] = useState({ name: "", email: "", password: "", role: "client", organisation: "" });

  async function loadUsers() {
    setLoading(true);
    setError("");
    try {
      setPageData(await getUsers(page));
    } catch (requestError) {
      setError(requestError.message);
      onNotice(requestError.message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadUsers(); }, [page]);

  async function handleCreate(event) {
    event.preventDefault();
    setError("");
    setBusyId("create");
    try {
      await createUser(values);
      setValues({ name: "", email: "", password: "", role: "client", organisation: "" });
      setShowForm(false);
      setPage(1);
      onNotice("User created.");
      await loadUsers();
    } catch (requestError) {
      setError(requestError.message);
      onNotice(requestError.message, "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRoleChange(user) {
    const role = roleDrafts[user.id] || user.role;
    if (role === user.role) return;
    setBusyId(user.id);
    setError("");
    try {
      await changeUserRole(user.id, role);
      onNotice(`Role updated for ${user.email}.`);
      await loadUsers();
    } catch (requestError) {
      setError(requestError.message);
      onNotice(requestError.message, "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeactivate(user) {
    const confirmed = await onConfirm({
      title: "Deactivate this account?",
      message: `${user.email} will no longer be able to sign in. Historical request records remain unchanged.`,
      confirmLabel: "Deactivate account",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusyId(user.id);
    setError("");
    try {
      await deactivateUser(user.id);
      onNotice(`${user.email} deactivated.`);
      await loadUsers();
    } catch (requestError) {
      setError(requestError.message);
      onNotice(requestError.message, "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Access control</p>
          <h1>User management</h1>
          <p className="muted">Manage account roles and active status.</p>
        </div>
        <button className="button button--primary" type="button" onClick={() => setShowForm((visible) => !visible)}>
          Create user
        </button>
      </section>

      {error && !showForm && <div className="notice notice--error" role="alert">{error}</div>}
      {showForm && (
        <OverlayModal title="Create user" onClose={() => busyId !== "create" && setShowForm(false)}>
          <p className="eyebrow">New account</p>
          {error && <div className="notice notice--error" role="alert">{error}</div>}
          <form className="form-grid" onSubmit={handleCreate}>
            <label className="field">Name<input value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} required /></label>
            <label className="field">Email<input type="email" autoComplete="off" value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} required /></label>
            <label className="field">Temporary password<input type="password" autoComplete="new-password" value={values.password} onChange={(event) => setValues({ ...values, password: event.target.value })} required /></label>
            <label className="field">Role<select value={values.role} onChange={(event) => setValues({ ...values, role: event.target.value })}><option value="client">Client</option><option value="operator">Operator</option><option value="admin">Admin</option></select></label>
            <label className="field field--wide">Organisation<input value={values.organisation} onChange={(event) => setValues({ ...values, organisation: event.target.value })} /></label>
            <div className="form-actions field--wide">
              <button className="button button--quiet" type="button" onClick={() => setShowForm(false)} disabled={busyId === "create"}>Cancel</button>
              <button className="button button--primary" type="submit" disabled={busyId === "create" || !values.name.trim() || !values.email.trim() || !values.password}>
                {busyId === "create" ? "Creating…" : "Create account"}
              </button>
            </div>
          </form>
        </OverlayModal>
      )}

      <section className="table-panel" aria-label="Users">
        {loading ? <div className="empty-state" role="status">Loading users…</div> : !pageData?.results.length ? (
          <div className="empty-state">No users found.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Organisation</th><th>Role</th><th>State</th><th /></tr></thead>
              <tbody>
                {pageData.results.map((user) => (
                  <tr key={user.id}>
                    <td className="table-primary">{user.name}</td>
                    <td>{user.email}</td>
                    <td>{user.organisation || "—"}</td>
                    <td>
                      <div className="inline-control">
                        <select aria-label={`Role for ${user.email}`} value={roleDrafts[user.id] ?? user.role} onChange={(event) => setRoleDrafts({ ...roleDrafts, [user.id]: event.target.value })}>
                          <option value="client">Client</option><option value="operator">Operator</option><option value="admin">Admin</option>
                        </select>
                        <button className="button button--quiet button--small" type="button" disabled={busyId === user.id || (roleDrafts[user.id] ?? user.role) === user.role} onClick={() => handleRoleChange(user)}>
                          Save
                        </button>
                      </div>
                    </td>
                    <td><span className={`active-state ${user.is_active ? "active-state--on" : "active-state--off"}`}>{user.is_active ? "Active" : "Inactive"}</span></td>
                    <td>
                      <button className="button button--danger-outline button--small" type="button" disabled={!user.is_active || user.email === session.email || busyId === user.id} onClick={() => handleDeactivate(user)}>
                        Deactivate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pageData && pageData.count > PAGE_SIZE && <Pagination page={page} count={pageData.count} pageSize={PAGE_SIZE} onChange={setPage} />}
      </section>
    </div>
  );
}