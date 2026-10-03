import { useEffect, useState } from "react";

import { assignEpisode, getEpisodes, getRequest } from "../api.js";
import Pagination from "./Pagination.jsx";

const PAGE_SIZE = 15;

export default function EpisodesPage({ targetRequest, onTargetRequest, onNotice, onChanged }) {
  const [page, setPage] = useState(1);
  const [taskDraft, setTaskDraft] = useState("");
  const [qualityDraft, setQualityDraft] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [filters, setFilters] = useState({ taskName: "", quality: "", search: "" });
  const [pageData, setPageData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyEpisode, setBusyEpisode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getEpisodes({ page, ...filters })
      .then((data) => active && setPageData(data))
      .catch((requestError) => active && setError(requestError.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [page, filters]);

  function applyFilters(event) {
    event.preventDefault();
    setPage(1);
    setFilters({ taskName: taskDraft, quality: qualityDraft, search: searchDraft });
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
    } finally {
      setBusyEpisode("");
    }
  }

  const canAssign = targetRequest?.status === "in_progress";
  const canDeliver = targetRequest && targetRequest.assigned_episodes_count >= targetRequest.episodes_requested;

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
            <button className="button button--secondary" type="button" onClick={() => onChanged()}>
              Deliver request now
            </button>
          )}
          <button className="button button--quiet" type="button" onClick={() => onTargetRequest(null)}>Clear target</button>
        </section>
      ) : (
        <div className="notice notice--neutral">Choose an in-progress request from the Requests page to start assigning episodes.</div>
      )}

      <section className="table-panel">
        <form className="filter-row episode-filters" onSubmit={applyFilters}>
          <label className="filter-control">
            <span>Search</span>
            <input value={searchDraft} onChange={(event) => { setSearchDraft(event.target.value); setPage(1); setFilters((current) => ({ ...current, search: event.target.value })); }} placeholder="episode ID, robot, task, operator" />
          </label>
          <label className="filter-control">
            <span>Task name</span>
            <input value={taskDraft} onChange={(event) => setTaskDraft(event.target.value)} placeholder="e.g. pick cup" />
          </label>
          <label className="filter-control filter-control--compact">
            <span>Quality</span>
            <select value={qualityDraft} onChange={(event) => setQualityDraft(event.target.value)}>
              <option value="">Good and usable</option>
              <option value="good">Good</option>
              <option value="usable">Usable</option>
            </select>
          </label>
          <button className="button button--secondary" type="submit">Apply filters</button>
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