import { useEffect, useState } from "react";

import { createRequest, getRequests } from "../api.js";
import Pagination from "./Pagination.jsx";
import RequestDetail from "./RequestDetail.jsx";
import RequestForm from "./RequestForm.jsx";
import StatusBadge from "./StatusBadge.jsx";

const PAGE_SIZE = 15;

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDeadlineState(deadline) {
  const dueDate = parseDate(deadline);
  if (!dueDate) return "normal";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "overdue";
  if (diffDays <= 7) return "soon";
  return "normal";
}

export default function RequestsPage({ session, onNotice, onConfirm, onOpenAssignments, onRequestChanged, refreshSignal }) {
  const [page, setPage] = useState(1);
  const [pageData, setPageData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [taskFilter, setTaskFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [allocationFilter, setAllocationFilter] = useState("all");
  const [deadlineAfter, setDeadlineAfter] = useState("");
  const [deadlineBefore, setDeadlineBefore] = useState("");
  const [submittedFrom, setSubmittedFrom] = useState("");
  const [submittedTo, setSubmittedTo] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getRequests({
      page,
      taskName: taskFilter,
      status: statusFilter,
      deadlineAfter,
      deadlineBefore,
      submittedFrom,
      submittedTo,
      allocationState: allocationFilter,
    })
      .then((data) => active && setPageData(data))
      .catch((requestError) => {
        if (!active) return;
        setError(requestError.message);
        onNotice(requestError.message, "error");
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [page, refreshSignal, taskFilter, statusFilter, deadlineAfter, deadlineBefore, submittedFrom, submittedTo, allocationFilter]);

  async function submitRequest(values) {
    const created = await createRequest(values);
    setShowForm(false);
    setPage(1);
    onNotice("Request submitted.");
    setSelectedId(created.id);
    onRequestChanged();
  }

  const isClient = session.role === "client";

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Request pipeline</p>
          <h1>{isClient ? "Your requests" : "All requests"}</h1>
          <p className="muted">Track intake, allocation, and delivery status.</p>
        </div>
        {isClient && (
          <button className="button button--primary" type="button" onClick={() => setShowForm((visible) => !visible)}>
            {showForm ? "Close form" : "New request"}
          </button>
        )}
      </section>

      {showForm && (
        <RequestForm
          onCreate={submitRequest}
          onCancel={() => setShowForm(false)}
          onError={(message) => onNotice(message, "error")}
        />
      )}
      {error && <div className="notice notice--error" role="alert">{error}</div>}

      <section className="table-panel" aria-label="Requests">
        <div className="filter-row request-filter-row">
          <label className="filter-control">
            <span>Task</span>
            <input value={taskFilter} onChange={(event) => { setPage(1); setTaskFilter(event.target.value); }} placeholder="Filter this page" />
          </label>
          <label className="filter-control filter-control--compact">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => { setPage(1); setStatusFilter(event.target.value); }}>
              <option value="all">All statuses</option>
              <option value="submitted">Submitted</option>
              <option value="in_progress">In progress</option>
              <option value="delivered">Delivered</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          {/* <label className="filter-control filter-control--compact">
            <span>Allocation</span>
            <select value={allocationFilter} onChange={(event) => { setPage(1); setAllocationFilter(event.target.value); }}>
              <option value="all">All</option>
              <option value="needs_allocation">Needs allocation</option>
              <option value="ready_for_delivery">Ready for delivery</option>
            </select>
          </label>
          <label className="filter-control filter-control--compact">
            <span>Deadline from</span>
            <input type="date" value={deadlineAfter} onChange={(event) => { setPage(1); setDeadlineAfter(event.target.value); }} />
          </label>
          <label className="filter-control filter-control--compact">
            <span>Deadline to</span>
            <input type="date" value={deadlineBefore} onChange={(event) => { setPage(1); setDeadlineBefore(event.target.value); }} />
          </label>
          <label className="filter-control filter-control--compact">
            <span>Submitted from</span>
            <input type="date" value={submittedFrom} onChange={(event) => { setPage(1); setSubmittedFrom(event.target.value); }} />
          </label>
          <label className="filter-control filter-control--compact">
            <span>Submitted to</span>
            <input type="date" value={submittedTo} onChange={(event) => { setPage(1); setSubmittedTo(event.target.value); }} />
          </label> */}
        </div>

        {loading ? (
          <div className="empty-state" role="status">Loading requests…</div>
        ) : pageData?.results.length === 0 ? (
          <div className="empty-state">
            <strong>{pageData?.count ? "No requests match these filters." : "No requests yet."}</strong>
            {isClient && !pageData?.count && <span>Create a request to start a dataset delivery.</span>}
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  {!isClient && <th>Client ID</th>}
                  <th>Episode allocation</th>
                  <th>Deadline</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {(pageData?.results || []).map((request) => {
                  const deadlineState = getDeadlineState(request.deadline);
                  return (
                    <tr key={request.id} className={`${selectedId === request.id ? "is-selected" : ""} ${deadlineState !== "normal" ? `deadline-row deadline-row--${deadlineState}` : ""}`}>
                      <td>
                        <span className="table-primary">{request.task_name}</span>
                        <span className="table-secondary">REQ-{String(request.id).padStart(4, "0")}</span>
                      </td>
                      {!isClient && <td className="mono">{request.client}</td>}
                      <td>
                        <span className="allocation-number">{request.assigned_episodes_count} / {request.episodes_requested}</span>
                        <span className="table-secondary">assigned</span>
                      </td>
                      <td className={`deadline-cell deadline-cell--${deadlineState}`}>
                        {request.deadline}
                        {deadlineState !== "normal" && <span className={`deadline-indicator deadline-indicator--${deadlineState}`}>{deadlineState === "overdue" ? "Overdue" : "Due soon"}</span>}
                      </td>
                      <td><StatusBadge status={request.status} /></td>
                      <td>{new Date(request.created_at).toLocaleDateString()}</td>
                      <td className="table-actions">
                        <button className="button button--quiet button--small" type="button" onClick={() => setSelectedId(request.id)}>
                          Details
                        </button>
                        {!isClient && request.status === "in_progress" && (
                          <button className="button button--quiet button--small" type="button" onClick={() => onOpenAssignments(request)}>
                            Assign
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pageData && pageData.count > PAGE_SIZE && (
          <Pagination page={page} count={pageData.count} pageSize={PAGE_SIZE} onChange={setPage} />
        )}
      </section>

      {selectedId && (
        <RequestDetail
          key={selectedId}
          id={selectedId}
          role={session.role}
          onConfirm={onConfirm}
          onAssign={onOpenAssignments}
          onChanged={(status) => {
            const messages = {
              in_progress: "Request moved to in progress.",
              delivered: "Request delivered successfully.",
              accepted: "Request accepted successfully.",
              rejected: "Request rejected and returned for rework.",
            };
            onNotice(messages[status] || "Request status updated.");
            onRequestChanged();
          }}
          onNotice={onNotice}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}