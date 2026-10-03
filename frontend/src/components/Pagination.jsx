export default function Pagination({ page, count, pageSize = 50, onChange }) {
  const pageCount = Math.max(1, Math.ceil(count / pageSize));

  return (
    <div className="pagination" aria-label="Pagination">
      <span className="muted">{count.toLocaleString()} records</span>
      <div className="pagination__controls">
        <button className="button button--quiet" type="button" onClick={() => onChange(page - 1)} disabled={page <= 1}>
          Previous
        </button>
        <span className="pagination__page">{page} / {pageCount}</span>
        <button className="button button--quiet" type="button" onClick={() => onChange(page + 1)} disabled={page >= pageCount}>
          Next
        </button>
      </div>
    </div>
  );
}