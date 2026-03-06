import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPayments } from '../api/client';
import TransactionList from '../components/TransactionList';
import TransactionFilters from '../components/TransactionFilters';
import Pagination from '../components/Pagination';

const POLL_INTERVAL_MS = 10000;

function TransactionListPage() {
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, total_pages: 0 });
  const [filters, setFilters] = useState({ status: null, fromDate: null, toDate: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [livePolling, setLivePolling] = useState(false);
  const [rowFlash, setRowFlash] = useState(null);
  const prevStatusByRef = useRef({});

  const fetchData = useCallback(async (isPoll = false) => {
    if (!isPoll) {
      setLoading(true);
      setError(null);
    }
    try {
      const params = {
        page: pagination.page,
        limit: pagination.limit,
      };
      if (filters.status) params.status = filters.status;
      if (filters.fromDate) params.from_date = filters.fromDate;
      if (filters.toDate) params.to_date = filters.toDate;

      const res = await getPayments(params);
      const data = res.data.data || res.data;

      if (isPoll && data.length > 0) {
        const prev = prevStatusByRef.current;
        for (const txn of data) {
          const wasProcessing = prev[txn.id] === 'processing';
          if (wasProcessing && (txn.status === 'completed' || txn.status === 'failed')) {
            setRowFlash({ id: txn.id, type: txn.status });
            setTimeout(() => setRowFlash(null), 1200);
            break;
          }
        }
      }
      const nextStatus = {};
      data.forEach((t) => { nextStatus[t.id] = t.status; });
      prevStatusByRef.current = nextStatus;

      setTransactions(data);
      setPagination((prev) => ({ ...prev, ...(res.data.pagination || {}) }));

      const hasProcessing = data.some((t) => t.status === 'processing');
      setLivePolling(hasProcessing);
    } catch (err) {
      if (!isPoll) setError(err.message);
    } finally {
      if (!isPoll) setLoading(false);
    }
  }, [pagination.page, pagination.limit, filters]);

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  useEffect(() => {
    if (!livePolling) return;
    const interval = setInterval(() => fetchData(true), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [livePolling, fetchData]);

  function handleFilterChange(newFilters) {
    setFilters(newFilters);
    setPagination((prev) => ({ ...prev, page: 1 }));
  }

  function handlePageChange(newPage) {
    setPagination((prev) => ({ ...prev, page: newPage }));
  }

  return (
    <div>
      <div className="card-header" style={{ border: 'none', padding: '0 0 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <h2>Transactions</h2>
        {livePolling && (
          <span className="live-indicator">
            <span className="live-indicator-dot" />
            Live
          </span>
        )}
      </div>

      <TransactionFilters filters={filters} onFilterChange={handleFilterChange} />

      <div className="card">
        {error ? (
          <div className="error-state">
            <h3>Failed to load transactions</h3>
            <p>{error}</p>
            <button className="btn-secondary" onClick={() => fetchData(false)}>Retry</button>
          </div>
        ) : loading ? (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Source</th>
                  <th>Destination</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <tr key={i}>
                    <td><span className="skeleton" style={{ width: '80px', display: 'inline-block' }} /></td>
                    <td><span className="skeleton" style={{ width: '100px', display: 'inline-block' }} /></td>
                    <td><span className="skeleton" style={{ width: '100px', display: 'inline-block' }} /></td>
                    <td><span className="skeleton" style={{ width: '70px', display: 'inline-block' }} /></td>
                    <td><span className="skeleton" style={{ width: '90px', display: 'inline-block' }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <TransactionList
              transactions={transactions}
              onRowClick={(id) => navigate(`/payments/${id}`)}
              rowFlash={rowFlash}
            />
            <Pagination
              page={pagination.page}
              totalPages={pagination.total_pages}
              onPageChange={handlePageChange}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default TransactionListPage;
