import { useState } from "react";

import { getAnalytics } from "../api.js";

function toDateInput(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const hours = seconds / 3600;
  if (hours >= 24) return `${(hours / 24).toFixed(1)} days`;
  if (hours >= 1) return `${hours.toFixed(1)} hours`;
  return `${Math.round(seconds)} seconds`;
}

export default function AnalyticsPage() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  const [startDate, setStartDate] = useState(toDateInput(start));
  const [endDate, setEndDate] = useState(toDateInput(end));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadAnalytics(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      setData(await getAnalytics(startDate, endDate));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div><p className="eyebrow">Operations / reporting</p><h1>Analytics</h1><p className="muted">Date ranges include both selected dates.</p></div>
      </section>
      <section className="filter-panel">
        <form className="filter-row analytics-filters" onSubmit={loadAnalytics}>
          <label className="filter-control"><span>Start date</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
          <label className="filter-control"><span>End date</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
          <button className="button button--primary" type="submit" disabled={loading}>{loading ? "Loading…" : "Run report"}</button>
        </form>
      </section>
      {error && <div className="notice notice--error" role="alert">{error}</div>}
      {data && (
        <>
          <section className="metric-strip" aria-label="Request fulfillment summary">
            <div className="metric-cell"><span>Median to delivery</span><strong>{formatDuration(data.request_fulfilment.median_seconds_to_deliver)}</strong></div>
            <div className="metric-cell"><span>Episode groups</span><strong>{data.episodes_recorded.length}</strong></div>
            <div className="metric-cell"><span>Delivered requests</span><strong>{data.request_fulfilment.counts_by_status.delivered}</strong></div>
          </section>
          <section className="analytics-grid">
            <div className="table-panel">
              <div className="panel-heading"><div><p className="eyebrow">Recording volume</p><h2>Episodes per day / robot</h2></div></div>
              {!data.episodes_recorded.length ? <div className="empty-state">No episodes in this date range.</div> : (
                <div className="table-scroll"><table><thead><tr><th>Date</th><th>Robot</th><th>Count</th></tr></thead><tbody>
                  {data.episodes_recorded.map((item) => <tr key={`${item.date}-${item.robot_id}`}><td>{item.date}</td><td className="mono">{item.robot_id}</td><td>{item.count}</td></tr>)}
                </tbody></table></div>
              )}
            </div>
            <div className="table-panel">
              <div className="panel-heading"><div><p className="eyebrow">Quality output</p><h2>Top task names</h2></div></div>
              {!data.top_tasks_by_good_episodes.length ? <div className="empty-state">No good episodes in this date range.</div> : (
                <div className="table-scroll"><table><thead><tr><th>Task</th><th>Good episodes</th></tr></thead><tbody>
                  {data.top_tasks_by_good_episodes.map((item) => <tr key={item.task_name}><td>{item.task_name}</td><td>{item.good_episodes_count}</td></tr>)}
                </tbody></table></div>
              )}
            </div>
          </section>
          <section className="table-panel status-counts">
            <div className="panel-heading"><div><p className="eyebrow">Current workload</p><h2>Requests by status</h2></div></div>
            <div className="status-counts__grid">
              {Object.entries(data.request_fulfilment.counts_by_status).map(([status, count]) => <div key={status}><span>{status.replaceAll("_", " ")}</span><strong>{count}</strong></div>)}
            </div>
          </section>
        </>
      )}
    </div>
  );
}