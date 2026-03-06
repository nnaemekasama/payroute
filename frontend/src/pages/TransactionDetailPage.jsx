import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getPayment } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import TransactionTimeline from '../components/TransactionTimeline';
import LedgerEntryTable from '../components/LedgerEntryTable';
import LoadingState from '../components/LoadingState';
import { formatCurrency } from '../utils/formatCurrency';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'reversed']);

function TransactionDetailPage() {
  const { id } = useParams();
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    async function fetchPayment() {
      try {
        const res = await getPayment(id);
        setPayment(res.data);
        setError(null);

        if (TERMINAL_STATUSES.has(res.data.status)) {
          if (pollRef.current) {
            clearTimeout(pollRef.current);
            pollRef.current = null;
          }
        } else {
          pollRef.current = setTimeout(fetchPayment, 5000);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchPayment();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [id]);

  return (
    <div>
      <Link to="/" className="btn-secondary" style={{ marginBottom: '20px', display: 'inline-block' }}>
        &larr; Back to Transactions
      </Link>

      <LoadingState isLoading={loading}>
        {error ? (
          <div className="error-state">
            <h3>Failed to load payment</h3>
            <p>{error}</p>
          </div>
        ) : payment ? (
          <>
            <div className="detail-header">
              <h1>Payment Details</h1>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <StatusBadge status={payment.status} />
                {payment.status === 'processing' && (
                  <span className="badge badge-processing badge-processing-pulse" style={{ fontSize: '10px' }}>
                    Updating…
                  </span>
                )}
              </span>
            </div>

            <div className="detail-grid">
              {/* Left column: Payment info */}
              <div className="card">
                <div className="card-header">
                  <h2>Payment Information</h2>
                </div>
                <div className="card-body">
                  <div className="amount-large">
                    {formatCurrency(payment.source_amount, payment.source_currency)}
                  </div>
                  <div className="amount-arrow">
                    → {formatCurrency(payment.destination_amount, payment.destination_currency)}
                    {payment.fx_rate && (
                      <span style={{ fontSize: '13px' }}>
                        (1 {payment.source_currency} = {parseFloat(payment.fx_rate).toFixed(5)} {payment.destination_currency})
                      </span>
                    )}
                  </div>

                  <div style={{ marginTop: '24px' }}>
                    <div className="detail-field">
                      <div className="detail-field-label">Transaction ID</div>
                      <div className="detail-field-value" style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                        {payment.id}
                      </div>
                    </div>
                    <div className="detail-field">
                      <div className="detail-field-label">Provider Reference</div>
                      <div className="detail-field-value" style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                        {payment.provider_reference || '-'}
                      </div>
                    </div>
                    <div className="detail-field">
                      <div className="detail-field-label">Sender Account</div>
                      <div className="detail-field-value" style={{ fontSize: '13px' }}>
                        {payment.sender_account_name ?? payment.sender_account_id}
                      </div>
                    </div>
                    <div className="detail-field">
                      <div className="detail-field-label">Recipient Account</div>
                      <div className="detail-field-value" style={{ fontSize: '13px' }}>
                        {payment.recipient_account_name ?? payment.recipient_account_id}
                      </div>
                    </div>
                    {payment.failure_reason && (
                      <div className="detail-field">
                        <div className="detail-field-label">Failure Reason</div>
                        <div className="detail-field-value" style={{ color: 'var(--danger)' }}>
                          {payment.failure_reason}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right column: Timeline */}
              <div className="card">
                <div className="card-header">
                  <h2>Status Timeline</h2>
                </div>
                <div className="card-body">
                  <TransactionTimeline transaction={payment} />
                </div>
              </div>
            </div>

            {/* Ledger entries */}
            <div className="card">
              <div className="card-header">
                <h2>Ledger Entries</h2>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <LedgerEntryTable entries={payment.ledger_entries} />
              </div>
            </div>
          </>
        ) : null}
      </LoadingState>
    </div>
  );
}

export default TransactionDetailPage;
