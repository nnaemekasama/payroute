import { useState, useEffect } from 'react';
import { formatCurrency } from '../utils/formatCurrency';

function FxQuoteDisplay({ quote, onExpired }) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!quote?.expiresAt) return;

    function updateTimer() {
      const remaining = Math.max(0, Math.floor((new Date(quote.expiresAt) - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0 && onExpired) {
        onExpired();
      }
    }

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [quote?.expiresAt, onExpired]);

  if (!quote) return null;

  return (
    <div className="fx-quote">
      <div className="fx-quote-rate">
        1 {quote.sourceCurrency} = {parseFloat(quote.rate).toFixed(5)} {quote.destinationCurrency}
      </div>
      <div className="fx-quote-amount">
        {formatCurrency(quote.sourceAmount, quote.sourceCurrency)}
        {' → '}
        {formatCurrency(quote.destinationAmount, quote.destinationCurrency)}
      </div>
      <div className={`fx-quote-expiry ${secondsLeft <= 10 ? 'urgent' : ''}`}>
        {secondsLeft > 0 ? `Quote expires in ${secondsLeft}s` : 'Quote expired'}
      </div>
    </div>
  );
}

export default FxQuoteDisplay;
