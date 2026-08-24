import React, { useEffect, useState } from 'react';
import { cellText } from '../shared/cell-text';
import type { ParquetDocument } from '../shared/types';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatCell(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="cell-null">null</span>;
  }
  return cellText(value);
}

interface ParquetTableProps {
  document: ParquetDocument;
  onError: (message: string) => void;
}

export function ParquetTable({ document, onError }: ParquetTableProps): React.JSX.Element {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Record<string, unknown>[]>(document.rows);
  const [loading, setLoading] = useState(false);
  const [filterInput, setFilterInput] = useState('');
  const [filter, setFilter] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [totalMatching, setTotalMatching] = useState(document.totalRows);
  const [scannedRows, setScannedRows] = useState(document.totalRows);
  const [truncated, setTruncated] = useState(false);
  const { pageSize, totalRows, columns } = document;
  const totalPages = Math.max(1, Math.ceil(totalMatching / pageSize));

  // Debounce the filter input so typing doesn't hammer the IPC channel.
  useEffect(() => {
    const timer = window.setTimeout(() => setFilter(filterInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [filterInput]);

  // A changed filter or sort restarts from the first page.
  useEffect(() => {
    setPage(1);
  }, [filter, sortColumn, sortDirection]);

  useEffect(() => {
    let cancelled = false;
    const useInitialRows = page === 1 && !filter && !sortColumn;
    if (useInitialRows) {
      setRows(document.rows);
      setTotalMatching(document.totalRows);
      setScannedRows(document.totalRows);
      setTruncated(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    void window.viewer
      .queryParquet(document.path, { page, filter: filter || null, sortColumn, sortDirection })
      .then((result) => {
        if (!cancelled) {
          setRows(result.rows);
          setTotalMatching(result.totalMatching);
          setScannedRows(result.scannedRows);
          setTruncated(result.truncated);
        }
      })
      .catch((error) => {
        if (!cancelled) onError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [document, page, filter, sortColumn, sortDirection, onError]);

  const goTo = (target: number): void => {
    setPage(Math.max(1, Math.min(target, totalPages)));
  };

  const toggleSort = (column: string): void => {
    if (sortColumn === column) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const sortIndicator = (column: string): string => {
    if (sortColumn !== column) return '';
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  };

  const filterActive = filter.length > 0 || sortColumn !== null;

  return (
    <div className="parquet-view">
      <div className="parquet-summary">
        {filterActive
          ? truncated
            ? <span>{totalMatching.toLocaleString()} matches in first {scannedRows.toLocaleString()} of {totalRows.toLocaleString()} rows</span>
            : <span>{totalMatching.toLocaleString()} of {totalRows.toLocaleString()} rows</span>
          : <span>{totalRows.toLocaleString()} rows</span>}
        <span>{columns.length} column{columns.length === 1 ? '' : 's'}</span>
        <span>{formatBytes(document.fileSize)}</span>
        {truncated && <span className="parquet-truncated" title="Filtering and sorting inspect only the first 200,000 rows">sampled query</span>}
      </div>
      <div className="parquet-toolbar">
        <input
          className="parquet-filter"
          value={filterInput}
          onChange={(event) => setFilterInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape') setFilterInput(''); }}
          placeholder="Filter rows… (e.g. NIFTY CE)"
          spellCheck={false}
          aria-label="Filter rows"
        />
        {filterInput && (
          <button className="parquet-filter-clear" onClick={() => setFilterInput('')} title="Clear filter" aria-label="Clear filter">×</button>
        )}
      </div>
      <div className="parquet-table-wrap">
        <table className="parquet-table">
          <thead>
            <tr>
              <th className="parquet-row-number">#</th>
              {columns.map((column) => (
                <th
                  key={column.name}
                  onClick={() => toggleSort(column.name)}
                  className={sortColumn === column.name ? 'sorted' : ''}
                  aria-sort={sortColumn === column.name ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                  title={`Sort by ${column.name}`}
                >
                  <span className="parquet-col-name">{column.name}<span className="parquet-sort-indicator">{sortIndicator(column.name)}</span></span>
                  <span className="parquet-col-type">{column.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={rowStartOf(page, pageSize) + index}>
                <td className="parquet-row-number">{rowStartOf(page, pageSize) + index + 1}</td>
                {columns.map((column) => (
                  <td key={column.name} title={cellText(row[column.name])}>
                    {formatCell(row[column.name])}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td className="parquet-empty" colSpan={columns.length + 1}>
                  {filterActive
                    ? truncated ? 'No rows match in the scanned sample.' : 'No rows match the filter.'
                    : 'No rows to show.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {loading && <div className="parquet-loading">Loading…</div>}
      </div>
      <div className="parquet-pagination">
        <button onClick={() => goTo(1)} disabled={page <= 1 || loading} title="First page">« First</button>
        <button onClick={() => goTo(page - 1)} disabled={page <= 1 || loading} title="Previous page">‹ Prev</button>
        <span className="parquet-page-info" title={truncated ? 'Pagination covers the scanned sample, not the entire file.' : undefined}>
          Page {page} of {totalPages}{truncated ? ' (sample)' : ''}
        </span>
        <button onClick={() => goTo(page + 1)} disabled={page >= totalPages || loading} title="Next page">Next ›</button>
        <button onClick={() => goTo(totalPages)} disabled={page >= totalPages || loading} title="Last page">Last »</button>
      </div>
    </div>
  );
}

function rowStartOf(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}
