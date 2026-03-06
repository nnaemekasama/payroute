function formatTime(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const STATUS_ORDER = ['initiated', 'funds_locked', 'processing', 'completed', 'failed', 'reversed'];

function TransactionTimeline({ transaction }) {
  if (!transaction) return null;

  const currentIdx = STATUS_ORDER.indexOf(transaction.status);

  // Build a relevant path through the states
  let path;
  if (transaction.status === 'completed') {
    path = ['initiated', 'funds_locked', 'processing', 'completed'];
  } else if (transaction.status === 'reversed') {
    path = ['initiated', 'funds_locked', 'processing', 'failed', 'reversed'];
  } else if (transaction.status === 'failed') {
    path = ['initiated', 'funds_locked', 'processing', 'failed'];
  } else {
    path = STATUS_ORDER.slice(0, currentIdx + 1);
    if (path.length < 2) path = ['initiated', ...path.filter(s => s !== 'initiated')];
  }

  // Deduplicate
  path = [...new Set(path)];

  function getDotClass(step) {
    const stepIdx = STATUS_ORDER.indexOf(step);
    if (step === transaction.status) {
      if (step === 'completed') return 'completed';
      if (step === 'failed' || step === 'reversed') return 'failed';
      return 'active';
    }
    if (stepIdx < currentIdx) return 'completed';
    return '';
  }

  function getTime(step) {
    if (step === 'initiated') return formatTime(transaction.created_at);
    if (step === 'completed') return formatTime(transaction.completed_at);
    if (step === transaction.status) return formatTime(transaction.updated_at);
    return null;
  }

  return (
    <div className="timeline">
      {path.map((step) => (
        <div key={step} className="timeline-item">
          <div className={`timeline-dot ${getDotClass(step)}`} />
          <div className="timeline-label">{step.replace(/_/g, ' ')}</div>
          {getTime(step) && (
            <div className="timeline-time">{getTime(step)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

export default TransactionTimeline;
