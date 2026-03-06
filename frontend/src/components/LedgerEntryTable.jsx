import { formatCurrency } from '../utils/formatCurrency';

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function LedgerEntryTable({ entries }) {
  if (!entries || entries.length === 0) {
    return <p style={{ color: 'var(--text-secondary)', padding: '16px 0' }}>No ledger entries yet.</p>;
  }

  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Account</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Currency</th>
            <th>Description</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td style={{ fontSize: '13px' }}>
                {entry.account_name != null
                  ? `${entry.account_name} (${entry.currency})`
                  : entry.account_id || '-'}
              </td>
              <td>
                <span
                  style={{
                    color: entry.entry_type === 'debit' ? 'var(--danger)' : 'var(--success)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    fontSize: '12px',
                  }}
                >
                  {entry.entry_type}
                </span>
              </td>
              <td style={{ fontFamily: 'monospace' }}>{formatCurrency(entry.amount, entry.currency)}</td>
              <td>{entry.currency}</td>
              <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                {entry.description || '-'}
              </td>
              <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                {formatDate(entry.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default LedgerEntryTable;
