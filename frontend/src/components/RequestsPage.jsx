import { useEffect, useState } from "react";

import { createRequest, getRequests } from "../api.js";
import Pagination from "./Pagination.jsx";
import RequestDetail from "./RequestDetail.jsx";
import RequestForm from "./RequestForm.jsx";
import StatusBadge from "./StatusBadge.jsx";

const PAGE_SIZE = 50;

export default function RequestsPage({ session, onNotice, onOpenAssignments, onRequestChanged, refreshSignal }) {
  const [page, setPage] = useState(1);
  const [pageData, setPageData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [taskFilter, setTaskFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getRequests(page)
      .then((data) => active && setPageData(data))
      .catch((requestError) => active && setError(requestError.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [page, refreshSignal]);

  async function submitRequest(values) {
    const created = await createRequest(values);
    setShowForm(false);
    setPage(1);
    onNotice("Request submitted.");
    onCreated(created.id);
  }

  function onCreated(id) {
    setSelectedId(id);
    setPageData(null);
    setLoading(true);
    getRequests(1)
      .then(setPageData)
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }

  const rows = (pageData?.results || []).filter((request) => {
    const matchesTask = request.task_name.toLowerCase().includes(taskFilter.trim().toLowerCase());
    return matchesTask && (statusFilter === "all" || request.status === statusFilter);
  });
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

      {showForm && <RequestForm onCreate={submitRequest} onCancel={() => setShowForm(false)} />}
      {error && <div className="notice notice--error" role="alert">{error}</div>}

      <section className="table-panel" aria-label="Requests">
        <div className="filter-row">
          <label className="filter-control">
            <span>Task</span>
            <input value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)} placeholder="Filter this page" />
          </label>
          <label className="filter-control filter-control--compact">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="submitted">Submitted</option>
              <option value="in_progress">In progress</option>
              <option value="delivered">Delivered</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
        </div>

        {loading ? (
          <div className="empty-state" role="status">Loading requests…</div>
        ) : rows.length === 0 ? (
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
                {rows.map((request) => (
                  <tr key={request.id} className={selectedId === request.id ? "is-selected" : ""}>
                    <td>
                      <span className="table-primary">{request.task_name}</span>
                      <span className="table-secondary">REQ-{String(request.id).padStart(4, "0")}</span>
                    </td>
                    {!isClient && <td className="mono">{request.client}</td>}
                    <td>
                      <span className="allocation-number">{request.assigned_episodes_count} / {request.episodes_requested}</span>
                      <span className="table-secondary">assigned</span>
                    </td>
                    <td>{request.deadline}</td>
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
                ))}
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
          onAssign={onOpenAssignments}
          onChanged={() => {
            onNotice("Request status updated.");
            onRequestChanged();
          }}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}