import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAccounts, createPayment } from '../api/client';
import PaymentForm from '../components/PaymentForm';
import LoadingState from '../components/LoadingState';

function PaymentFormPage() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadAccounts() {
      try {
        const res = await getAccounts();
        setAccounts(res.data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadAccounts();
  }, []);

  async function handleSubmit(paymentData) {
    setSubmitting(true);
    setError(null);

    const idempotencyKey = `pay-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      const res = await createPayment(paymentData, idempotencyKey);
      navigate(`/payments/${res.data.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="card-header" style={{ border: 'none', padding: '0 0 20px 0' }}>
        <h2>New Payment</h2>
      </div>

      <div className="card">
        <div className="card-body">
          <LoadingState isLoading={loading}>
            {error && (
              <div className="error-state" style={{ marginBottom: '20px' }}>
                <h3>Error</h3>
                <p>{error}</p>
              </div>
            )}
            <PaymentForm
              accounts={accounts}
              onSubmit={handleSubmit}
              isSubmitting={submitting}
            />
          </LoadingState>
        </div>
      </div>
    </div>
  );
}

export default PaymentFormPage;
