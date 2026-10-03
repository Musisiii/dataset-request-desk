import { useEffect, useState } from "react";

import { getRequest, transitionRequest } from "../api.js";
import OverlayModal from "./OverlayModal.jsx";
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

function allocationState(assigned, requested) {
  if (assigned <= 0) return "zero";
  if (assigned >= requested) return "complete";
  return "partial";
}

export default function RequestDetail({ id, role, onAssign, onChanged, onClose, onConfirm, onNotice }) {
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showRejection, setShowRejection] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getRequest(id)
      .then((value) => active && setRequest(value))
      .catch((requestError) => {
        if (!active) return;
        setError(requestError.message);
        onNotice(requestError.message, "error");
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [id]);

  async function changeStatus(nextStatus, reason = "") {
    if (nextStatus === "rejected") {
      setShowRejection(true);
      return;
    }
    if (["accepted", "delivered"].includes(nextStatus)) {
      const messages = {
        accepted: { title: "Accept delivery?", message: "Confirm that this dataset delivery meets your request.", confirmLabel: "Accept delivery" },
        delivered: { title: "Mark request delivered?", message: "The client will be able to review and accept or reject this delivery.", confirmLabel: "Mark delivered" },
      };
      if (!(await onConfirm(messages[nextStatus]))) return;
    }
    await submitTransition(nextStatus, reason);
  }

  async function submitTransition(nextStatus, reason = "") {
    setBusy(true);
    setError("");
    try {
      const trimmedReason = reason.trim();
      const updated = trimmedReason
        ? await transitionRequest(id, nextStatus, trimmedReason)
        : await transitionRequest(id, nextStatus);
      setRequest(updated);
      setShowRejection(false);
      setRejectionReason("");
      onChanged(nextStatus);
    } catch (requestError) {
      setError(requestError.message);
      onNotice(requestError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  const requestLabel = `Request ${String(id).padStart(4, "0")}`;
  return (
    <>
      <OverlayModal title={requestLabel} onClose={onClose}>
        {loading ? <div className="empty-state" role="status">Loading request…</div> : error && !request ? (
          <div className="notice notice--error" role="alert">{error}</div>
        ) : !request ? null : (
          <div className="detail-panel detail-panel--modal">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{requestLabel} details</p>
                <h2>{request.task_name}</h2>
              </div>
            </div>
            {error && !showRejection && <div className="notice notice--error" role="alert">{error}</div>}
            <div className="detail-status"><StatusBadge status={request.status} /></div>
            <div className="progress-block">
              <div className="progress-block__label">
                <span>Episode allocation</span>
                <strong>{request.assigned_episodes_count} / {request.episodes_requested}</strong>
              </div>
              <div
                className={`progress-track progress-track--${allocationState(request.assigned_episodes_count || 0, request.episodes_requested)}`}
                role="progressbar"
                aria-label={`${request.assigned_episodes_count || 0} of ${request.episodes_requested} episodes assigned`}
                aria-valuemin="0"
                aria-valuemax={request.episodes_requested}
                aria-valuenow={request.assigned_episodes_count || 0}
              >
                <span style={{ width: `${Math.min(100, ((request.assigned_episodes_count || 0) / request.episodes_requested) * 100)}%` }} />
              </div>
              {(role === "operator" || role === "admin") && request.status === "in_progress" && (request.assigned_episodes_count || 0) < request.episodes_requested && (
                <p className="field-hint">Assign {request.episodes_requested - (request.assigned_episodes_count || 0)} more episode{request.episodes_requested - (request.assigned_episodes_count || 0) === 1 ? "" : "s"} before delivery.</p>
              )}
            </div>
            <dl className="detail-grid">
              <div><dt>Deadline</dt><dd>{request.deadline}</dd></div>
              <div><dt>Submitted</dt><dd>{new Date(request.created_at).toLocaleDateString()}</dd></div>
              {role !== "client" && <div><dt>Client ID</dt><dd>{request.client}</dd></div>}
              {request.updated_at && <div><dt>Last updated</dt><dd>{new Date(request.updated_at).toLocaleString()}</dd></div>}
              <div className="detail-grid__wide"><dt>Notes</dt><dd>{request.notes || "No notes provided."}</dd></div>
            </dl>
            <section className="assigned-episodes" aria-labelledby="assigned-episodes-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">{request.status === "delivered" || request.status === "accepted" ? "Delivered dataset" : "Allocation"}</p>
                  <h3 id="assigned-episodes-title">Assigned episodes ({request.assigned_episodes?.length || 0})</h3>
                </div>
              </div>
              {!request.assigned_episodes?.length ? (
                <p className="muted">No episodes have been assigned yet.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Episode ID</th><th>Task</th><th>Robot</th><th>Quality</th><th>Duration</th><th>Recorded</th><th>Operator</th></tr></thead>
                    <tbody>
                      {request.assigned_episodes.map((episode) => (
                        <tr key={episode.episode_id}>
                          <td className="mono">{episode.episode_id}</td>
                          <td>{episode.task_name}</td>
                          <td className="mono">{episode.robot_id}</td>
                          <td>{episode.quality}</td>
                          <td>{episode.duration_seconds}s</td>
                          <td>{new Date(episode.recorded_at).toLocaleString()}</td>
                          <td>{episode.operator_name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            {role !== "client" && request.status === "in_progress" && (
              <button className="button button--secondary" type="button" onClick={() => onAssign(request)}>
                Find episodes to assign
              </button>
            )}
            {permittedTransitions(role, request.status).length > 0 && (
              <div className="detail-actions" aria-label="Request actions">
                {permittedTransitions(role, request.status).map((nextStatus) => (
                  <button
                    className={`button ${nextStatus === "rejected" ? "button--danger-outline" : "button--primary"}`}
                    key={nextStatus}
                    type="button"
                    disabled={busy || (nextStatus === "delivered" && (request.assigned_episodes_count || 0) < request.episodes_requested)}
                    onClick={() => changeStatus(nextStatus)}
                  >
                    {busy ? "Saving…" : ACTION_LABELS[nextStatus]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </OverlayModal>
      {showRejection && (
        <OverlayModal title="Reject delivery?" onClose={() => !busy && setShowRejection(false)} layer="top">
          <p className="muted">This will return the request to operations for rework. You may optionally explain why you are rejecting this delivery.</p>
          {error && <div className="notice notice--error" role="alert">{error}</div>}
          <form className="stack-form" onSubmit={(event) => { event.preventDefault(); submitTransition("rejected", rejectionReason); }}>
            <label className="field">
              Reason (optional)
              <textarea rows="4" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} disabled={busy} />
            </label>
            <div className="form-actions">
              <button className="button button--quiet" type="button" onClick={() => setShowRejection(false)} disabled={busy}>Cancel</button>
              <button className="button button--danger" type="submit" disabled={busy}>
                {busy ? "Rejecting…" : "Reject delivery"}
              </button>
            </div>
          </form>
        </OverlayModal>
      )}
    </>
  );
}
