import { useState } from 'react';
import { formatCurrency } from '../utils/formatCurrency';

function PaymentForm({ accounts, onSubmit, isSubmitting }) {
  const [senderAccountId, setSenderAccountId] = useState('');
  const [recipientAccountId, setRecipientAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [destinationCurrency, setDestinationCurrency] = useState('');

  const ngnAccounts = accounts.filter((a) => a.currency === 'NGN');
  const foreignAccounts = accounts.filter((a) => a.currency !== 'NGN');

  const selectedSender = accounts.find((a) => a.id === senderAccountId);

  function handleSubmit(e) {
    e.preventDefault();
    if (!senderAccountId || !recipientAccountId || !amount || !destinationCurrency) return;

    const recipient = accounts.find((a) => a.id === recipientAccountId);
    onSubmit({
      sender_account_id: senderAccountId,
      recipient_account_id: recipientAccountId,
      amount: parseFloat(amount),
      source_currency: 'NGN',
      destination_currency: recipient?.currency || destinationCurrency,
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Sender Account (NGN)</label>
        <select
          value={senderAccountId}
          onChange={(e) => setSenderAccountId(e.target.value)}
          required
        >
          <option value="">Select sender account</option>
          {ngnAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} — {formatCurrency(a.balance, a.currency)}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Recipient Account</label>
        <select
          value={recipientAccountId}
          onChange={(e) => {
            setRecipientAccountId(e.target.value);
            const acct = foreignAccounts.find((a) => a.id === e.target.value);
            if (acct) setDestinationCurrency(acct.currency);
          }}
          required
        >
          <option value="">Select recipient account</option>
          {foreignAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} — {a.currency}
            </option>
          ))}
        </select>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Amount (NGN)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 1,500,000"
            min="1"
            step="0.01"
            required
          />
        </div>
        <div className="form-group">
          <label>Destination Currency</label>
          <input
            type="text"
            value={destinationCurrency}
            readOnly
            placeholder="Selected automatically"
          />
        </div>
      </div>

      {selectedSender && amount && (
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          Available balance: {formatCurrency(selectedSender.balance, selectedSender.currency)}
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={isSubmitting}>
        {isSubmitting ? 'Processing...' : 'Get FX Quote & Send Payment'}
      </button>
    </form>
  );
}

export default PaymentForm;
