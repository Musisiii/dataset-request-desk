import { useEffect, useState } from "react";

import { assignEpisode, getEpisodes, getRequest, transitionRequest } from "../api.js";
import Pagination from "./Pagination.jsx";

const PAGE_SIZE = 15;

export default function EpisodesPage({ targetRequest, onTargetRequest, onNotice, onChanged, onConfirm }) {
  const [page, setPage] = useState(1);
  const [taskName, setTaskName] = useState("");
  const [quality, setQuality] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [duration, setDuration] = useState("");
  const [recordedDate, setRecordedDate] = useState("");
  const [filters, setFilters] = useState({ taskName: "", quality: "", search: "", duration: "", recordedDate: "" });
  const [pageData, setPageData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyEpisode, setBusyEpisode] = useState("");
  const [busyDelivery, setBusyDelivery] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getEpisodes({ page, ...filters })
      .then((data) => active && setPageData(data))
      .catch((requestError) => {
        if (!active) return;
        setError(requestError.message);
        onNotice(requestError.message, "error");
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [page, filters]);

  function updateFilter(name, value) {
    setPage(1);
    if (name === "taskName") setTaskName(value);
    if (name === "quality") setQuality(value);
    if (name === "search") setSearchDraft(value);
    if (name === "duration") setDuration(value);
    if (name === "recordedDate") setRecordedDate(value);
    setFilters((current) => ({ ...current, [name]: value }));
  }

  async function handleAssign(episode) {
    if (!targetRequest) return;
    setBusyEpisode(episode.episode_id);
    setError("");
    try {
      await assignEpisode(targetRequest.id, episode.episode_id);
      const updatedRequest = await getRequest(targetRequest.id);
      onTargetRequest(updatedRequest);
      onChanged();
      onNotice(`${episode.episode_id} assigned to request ${targetRequest.id}.`);
      const refreshed = await getEpisodes({ page, ...filters });
      setPageData(refreshed);
    } catch (requestError) {
      setError(requestError.message);
      onNotice(requestError.message, "error");
    } finally {
      setBusyEpisode("");
    }
  }

  async function handleDeliver() {
    if (!targetRequest || busyDelivery) return;
    const confirmed = await onConfirm({
      title: "Deliver this request?",
      message: "This will make the assigned episodes available to the client for review.",
      confirmLabel: "Deliver request",
    });
    if (!confirmed) return;
    setBusyDelivery(true);
    setError("");
    try {
      const updatedRequest = await transitionRequest(targetRequest.id, "delivered");
      onTargetRequest(updatedRequest);
      onChanged();
      onNotice("Request delivered successfully.");
    } catch (requestError) {
      setError(requestError.message);
      onNotice(requestError.message, "error");
    } finally {
      setBusyDelivery(false);
    }
  }

  const canAssign = targetRequest?.status === "in_progress" && !busyDelivery;
  const canDeliver = targetRequest?.status === "in_progress"
    && targetRequest.assigned_episodes_count >= targetRequest.episodes_requested;

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Recording library</p>
          <h1>Available episodes</h1>
          <p className="muted">Search eligible recordings and allocate them to an in-progress request.</p>
        </div>
      </section>

      {targetRequest ? (
        <section className="target-banner">
          <div>
            <span className="eyebrow">Assigning to request {targetRequest.id}</span>
            <strong>{targetRequest.task_name}</strong>
          </div>
          <div className="target-banner__count">
            <span>Allocation</span>
            <strong>{targetRequest.assigned_episodes_count} / {targetRequest.episodes_requested}</strong>
          </div>
          {canDeliver && (
            <button className="button button--primary" type="button" disabled={busyDelivery} onClick={handleDeliver}>
              {busyDelivery ? "Delivering…" : "Deliver request now"}
            </button>
          )}
          <button className="button button--quiet" type="button" onClick={() => onTargetRequest(null)}>Clear target</button>
        </section>
      ) : (
        <div className="notice notice--neutral">Choose an in-progress request from the Requests page to start assigning episodes.</div>
      )}

      <section className="table-panel">
        <form className="filter-row episode-filters" onSubmit={(event) => event.preventDefault()}>
          <label className="filter-control">
            <span>Search</span>
            <input value={searchDraft} onChange={(event) => updateFilter("search", event.target.value)} placeholder="episode ID, robot, task, operator, quality" />
          </label>
          <label className="filter-control">
            <span>Task name</span>
            <input value={taskName} onChange={(event) => updateFilter("taskName", event.target.value)} placeholder="Filter tasks as you type" />
          </label>
          <label className="filter-control filter-control--compact">
            <span>Duration (seconds)</span>
            <input inputMode="numeric" value={duration} onChange={(event) => updateFilter("duration", event.target.value)} placeholder="e.g. 43" />
          </label>
          <label className="filter-control filter-control--compact">
            <span>Recorded date</span>
            <input type="date" value={recordedDate} onChange={(event) => updateFilter("recordedDate", event.target.value)} />
          </label>
          <label className="filter-control filter-control--compact">
            <span>Quality</span>
            <select value={quality} onChange={(event) => updateFilter("quality", event.target.value)}>
              <option value="">Good and usable</option>
              <option value="good">Good</option>
              <option value="usable">Usable</option>
            </select>
          </label>
        </form>
        {error && <div className="notice notice--error" role="alert">{error}</div>}
        {loading ? (
          <div className="empty-state" role="status">Loading episodes…</div>
        ) : !pageData?.results.length ? (
          <div className="empty-state"><strong>No available episodes match.</strong><span>Try clearing one or more filters.</span></div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Episode ID</th><th>Robot</th><th>Task</th><th>Recorded</th><th>Duration</th><th>Operator</th><th>Quality</th><th /></tr>
              </thead>
              <tbody>
                {pageData.results.map((episode) => (
                  <tr key={episode.episode_id}>
                    <td className="mono">{episode.episode_id}</td>
                    <td className="mono">{episode.robot_id}</td>
                    <td>{episode.task_name}</td>
                    <td>{new Date(episode.recorded_at).toLocaleString()}</td>
                    <td>{episode.duration_seconds}s</td>
                    <td>{episode.operator_name}</td>
                    <td><span className={`quality-badge quality-badge--${episode.quality}`}>{episode.quality}</span></td>
                    <td>
                      <button
                        className="button button--primary button--small"
                        type="button"
                        disabled={!canAssign || busyEpisode === episode.episode_id}
                        onClick={() => handleAssign(episode)}
                      >
                        {busyEpisode === episode.episode_id ? "Assigning…" : "Assign"}
                      </button>
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
    </div>
  );
}