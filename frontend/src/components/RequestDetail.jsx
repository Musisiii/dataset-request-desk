import { useEffect, useState } from "react";

import { getRequest, transitionRequest } from "../api.js";
import StatusBadge from "./StatusBadge.jsx";

function permittedTransitions(role, status) {
  if (role === "client") return status === "delivered" ? ["accepted", "rejected"] : [];
  if (role === "operator" || role === "admin") {
    if (status === "submitted") return ["in_progress"];
    if (status === "in_progress") return ["delivered"];
    if (status === "rejected") return ["in_progress"];
  }
  return [];
}

const ACTION_LABELS = {
  in_progress: "Move to in progress",
  delivered: "Mark delivered",
  accepted: "Accept delivery",
  rejected: "Reject delivery",
};

export default function RequestDetail({ id, role, onAssign, onChanged, onClose }) {
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getRequest(id)
      .then((value) => active && setRequest(value))
      .catch((requestError) => active && setError(requestError.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [id]);

  async function changeStatus(nextStatus) {
    if (["accepted", "rejected", "delivered"].includes(nextStatus)) {
      const question = nextStatus === "rejected"
        ? "Reject this delivery and return it to operations for rework?"
        : nextStatus === "accepted"
          ? "Accept this delivery?"
          : "Mark this request delivered to the client?";
      if (!window.confirm(question)) return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await transitionRequest(id, nextStatus);
      setRequest(updated);
      onChanged();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <aside className="detail-panel"><p className="muted">Loading request…</p></aside>;
  if (error && !request) return <aside className="detail-panel"><div className="notice notice--error" role="alert">{error}</div></aside>;
  if (!request) return null;

  const actions = permittedTransitions(role, request.status);
  const assignedCount = request.assigned_episodes_count || 0;
  const deliveryReady = assignedCount >= request.episodes_requested;

  return (
    <aside className="detail-panel" aria-label={`Request ${request.id} details`}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Request / {String(request.id).padStart(4, "0")}</p>
          <h2>{request.task_name}</h2>
        </div>
        <button className="icon-button" type="button" aria-label="Close request details" onClick={onClose}>×</button>
      </div>
      {error && <div className="notice notice--error" role="alert">{error}</div>}
      <div className="detail-status"><StatusBadge status={request.status} /></div>
      <div className="progress-block">
        <div className="progress-block__label">
          <span>Episode allocation</span>
          <strong>{assignedCount} / {request.episodes_requested}</strong>
        </div>
        <div className="progress-track" aria-label={`${assignedCount} of ${request.episodes_requested} episodes assigned`}>
          <span style={{ width: `${Math.min(100, (assignedCount / request.episodes_requested) * 100)}%` }} />
        </div>
        {request.status === "in_progress" && !deliveryReady && (
          <p className="field-hint">Assign {request.episodes_requested - assignedCount} more episode{request.episodes_requested - assignedCount === 1 ? "" : "s"} before delivery.</p>
        )}
      </div>
      <dl className="detail-grid">
        <div><dt>Deadline</dt><dd>{request.deadline}</dd></div>
        <div><dt>Submitted</dt><dd>{new Date(request.created_at).toLocaleDateString()}</dd></div>
        <div className="detail-grid__wide"><dt>Notes</dt><dd>{request.notes || "No notes provided."}</dd></div>
      </dl>
      {role !== "client" && request.status === "in_progress" && (
        <button className="button button--secondary" type="button" onClick={() => onAssign(request)}>
          Find episodes to assign
        </button>
      )}
      {actions.length > 0 && (
        <div className="detail-actions" aria-label="Request actions">
          {actions.map((nextStatus) => (
            <button
              className={`button ${nextStatus === "rejected" ? "button--danger-outline" : "button--primary"}`}
              key={nextStatus}
              type="button"
              disabled={busy || (nextStatus === "delivered" && !deliveryReady)}
              onClick={() => changeStatus(nextStatus)}
            >
              {busy ? "Saving…" : ACTION_LABELS[nextStatus]}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}