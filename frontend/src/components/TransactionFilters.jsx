function TransactionFilters({ filters, onFilterChange }) {
  const statuses = ['', 'initiated', 'funds_locked', 'processing', 'completed', 'failed', 'reversed'];

  return (
    <div className="filters">
      <select
        value={filters.status || ''}
        onChange={(e) => onFilterChange({ ...filters, status: e.target.value || null })}
      >
        <option value="">All Statuses</option>
        {statuses.filter(Boolean).map((s) => (
          <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
        ))}
      </select>
      <input
        type="date"
        value={filters.fromDate || ''}
        onChange={(e) => onFilterChange({ ...filters, fromDate: e.target.value || null })}
        placeholder="From date"
      />
      <input
        type="date"
        value={filters.toDate || ''}
        onChange={(e) => onFilterChange({ ...filters, toDate: e.target.value || null })}
        placeholder="To date"
      />
    </div>
  );
}

export default TransactionFilters;
