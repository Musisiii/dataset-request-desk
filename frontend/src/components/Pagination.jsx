import { useEffect, useState } from "react";

export default function Pagination({ page, count, pageSize = 15, onChange }) {
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const [jumpPage, setJumpPage] = useState(String(page));

  useEffect(() => setJumpPage(String(page)), [page]);

  function getVisiblePages() {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
    const pages = new Set([1, 2, pageCount - 1, pageCount]);
    const window = [page - 1, page, page + 1].filter((value) => value > 1 && value < pageCount);
    window.forEach((value) => pages.add(value));
    const sorted = [...pages].sort((a, b) => a - b);
    const result = [];
    for (let index = 0; index < sorted.length; index += 1) {
      const value = sorted[index];
      const previous = sorted[index - 1];
      if (previous !== undefined && value - previous > 1) result.push("ellipsis");
      result.push(value);
    }
    return result;
  }

  const visiblePages = getVisiblePages();

  return (
    <div className="pagination" aria-label="Pagination">
      <span className="muted">{count.toLocaleString()} records</span>
      <div className="pagination__controls">
        <button className="button button--quiet" type="button" onClick={() => onChange(page - 1)} disabled={page <= 1}>
          Previous
        </button>
        {visiblePages.map((item, index) => item === "ellipsis" ? <span key={`ellipsis-${index}`} className="pagination__ellipsis">…</span> : (
          <button
            key={item}
            className={`button button--quiet pagination__button ${item === page ? "pagination__button--active" : ""}`}
            type="button"
            onClick={() => onChange(item)}
            aria-current={item === page ? "page" : undefined}
            disabled={item === page}
          >
            {item}
          </button>
        ))}
        <button className="button button--quiet" type="button" onClick={() => onChange(page + 1)} disabled={page >= pageCount}>
          Next
        </button>
        <form
          className="pagination__jump"
          onSubmit={(event) => {
            event.preventDefault();
            const target = Number(jumpPage);
            if (Number.isInteger(target) && target >= 1 && target <= pageCount) onChange(target);
          }}
        >
          <label htmlFor="pagination-jump">Go to page</label>
          <input
            id="pagination-jump"
            aria-label="Go to page"
            type="number"
            min="1"
            max={pageCount}
            value={jumpPage}
            onChange={(event) => setJumpPage(event.target.value)}
          />
          <button className="button button--quiet button--small" type="submit">Go</button>
        </form>
      </div>
    </div>
  );
}