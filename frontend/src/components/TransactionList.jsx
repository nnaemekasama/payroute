import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge';
import { formatCurrency } from '../utils/formatCurrency';

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncateId(id) {
  return id ? id.substring(0, 8) + '...' : '-';
}

function TransactionList({ transactions, onRowClick, rowFlash }) {
  if (!transactions || transactions.length === 0) {
    return (
      <div className="empty-state">
        <h3>No transactions found</h3>
        <p>Create a new payment to get started.</p>
        <Link to="/payments/new" className="btn-primary" style={{ marginTop: '12px', display: 'inline-block' }}>
          Create your first payment
        </Link>
      </div>
    );
  }

  return (
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
          {transactions.map((txn) => {
            const flashClass = rowFlash?.id === txn.id ? (rowFlash.type === 'completed' ? 'tr-row-flash-completed' : 'tr-row-flash-failed') : '';
            return (
              <tr
                key={txn.id}
                className={`clickable ${flashClass}`.trim()}
                onClick={() => onRowClick(txn.id)}
              >
                <td style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                  {truncateId(txn.id)}
                </td>
                <td>{formatCurrency(txn.source_amount, txn.source_currency)}</td>
                <td>{formatCurrency(txn.destination_amount, txn.destination_currency)}</td>
                <td><StatusBadge status={txn.status} /></td>
                <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                  {formatDate(txn.created_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default TransactionList;
