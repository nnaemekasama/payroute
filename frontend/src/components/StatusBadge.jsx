function StatusBadge({ status }) {
  const label = status ? status.replace(/_/g, ' ') : 'unknown';
  return <span className={`badge badge-${status || 'initiated'}`}>{label}</span>;
}

export default StatusBadge;
