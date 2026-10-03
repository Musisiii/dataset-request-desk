import { useEffect, useState } from "react";

import { getAnalytics } from "../api.js";
import Pagination from "./Pagination.jsx";

const RECORDS_PER_PAGE = 10;

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

function BarChart({ items, labelKey, valueKey, label }) {
  const maximum = Math.max(1, ...items.map((item) => item[valueKey]));
  return (
    <div className="bar-chart" role="group" aria-label={label}>
      {items.map((item) => (
        <div className="bar-chart__row" key={item[labelKey]}>
          <span className="bar-chart__label">{item[labelKey]}</span>
          <span className="bar-chart__track">
            <meter min="0" max={maximum} value={item[valueKey]} aria-label={`${item[labelKey]}: ${item[valueKey]}`} />
          </span>
          <output className="bar-chart__value">{item[valueKey].toLocaleString()}</output>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage({ onNotice }) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  const [startDate, setStartDate] = useState(toDateInput(start));
  const [endDate, setEndDate] = useState(toDateInput(end));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [recordingPage, setRecordingPage] = useState(1);

  async function loadAnalytics(startValue, endValue) {
    setLoading(true);
    setError("");
    try {
      setData(await getAnalytics(startValue, endValue));
      setRecordingPage(1);
    } catch (requestError) {
      setData(null);
      setError(requestError.message);
      onNotice?.(requestError.message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAnalytics(startDate, endDate);
  }, []);

  function submitReport(event) {
    event.preventDefault();
    loadAnalytics(startDate, endDate);
  }

  const recordingResults = data?.episodes_recorded || [];
  const pageRecords = recordingResults.slice((recordingPage - 1) * RECORDS_PER_PAGE, recordingPage * RECORDS_PER_PAGE);
  const qualityCounts = Object.entries(data?.quality_counts || {}).map(([quality, count]) => ({
    quality,
    count,
  }));

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div><p className="eyebrow">Operations / reporting</p><h1>Analytics</h1><p className="muted">Date ranges include both selected dates.</p></div>
      </section>
      <section className="filter-panel">
        <form className="filter-row analytics-filters" onSubmit={submitReport}>
          <label className="filter-control"><span>Start date</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
          <label className="filter-control"><span>End date</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
          <button className="button button--primary" type="submit" disabled={loading}>{loading ? "Loading…" : "Run report"}</button>
        </form>
      </section>
      {error && <div className="notice notice--error" role="alert">{error}</div>}
      {loading && <div className="empty-state" role="status">Loading analytics report…</div>}
      {!loading && !error && data && (
        <>
          <section className="table-panel status-counts">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Current workload</p>
                <h2>Requests by status</h2>
              </div>
            </div>
            <div className="status-counts__grid">
              {Object.entries(data.request_fulfilment.counts_by_status).map(([status, count]) => <div key={status}><span>{status.replaceAll("_", " ")}</span><strong>{count}</strong></div>)}
            </div>
          </section>
          <section className="metric-strip" aria-label="Request fulfillment summary">
            <div className="metric-cell"><span>Median to delivery</span><strong>{formatDuration(data.request_fulfilment.median_seconds_to_deliver)}</strong></div>
            <div className="metric-cell"><span>Episode groups</span><strong>{data.episodes_recorded.length.toLocaleString()}</strong></div>
            <div className="metric-cell"><span>Delivered requests</span><strong>{data.request_fulfilment.counts_by_status.delivered}</strong></div>
          </section>
          <section className="analytics-grid">
            <div className="analytics-stack">
              <section className="table-panel">
                <div className="panel-heading"><div><p className="eyebrow">Recording volume</p><h2>Episodes per day / robot</h2></div></div>
                {!recordingResults.length ? <div className="empty-state">No episodes in this date range.</div> : (
                  <>
                    <div className="table-scroll"><table><thead><tr><th>Date</th><th>Robot</th><th>Count</th></tr></thead><tbody>
                      {pageRecords.map((item) => <tr key={`${item.date}-${item.robot_id}`}><td>{item.date}</td><td className="mono">{item.robot_id}</td><td>{item.count}</td></tr>)}
                    </tbody></table></div>
                    {recordingResults.length > RECORDS_PER_PAGE && (
                      <Pagination page={recordingPage} count={recordingResults.length} pageSize={RECORDS_PER_PAGE} onChange={setRecordingPage} />
                    )}
                  </>
                )}
              </section>
            </div>
            <aside className="analytics-side">
              {qualityCounts.length > 0 && (
                <section className="table-panel">
                  <div className="panel-heading"><div><p className="eyebrow">Quality mix</p><h2>Episodes by quality</h2></div></div>
                  <BarChart items={qualityCounts} labelKey="quality" valueKey="count" label="Episode counts by quality" />
                </section>
              )}
              <section className="table-panel">
                <div className="panel-heading"><div><p className="eyebrow">Quality output</p><h2>Top tasks by good episodes</h2></div></div>
                {!data.top_tasks_by_good_episodes.length ? <div className="empty-state">No good episodes in this date range.</div> : (
                  <BarChart
                    items={data.top_tasks_by_good_episodes}
                    labelKey="task_name"
                    valueKey="good_episodes_count"
                    label="Top task names by count of good episodes"
                  />
                )}
              </section>
            </aside>
          </section>
        </>
      )}
    </div>
  );
}
