/**
 * Format amount with thousands separators and currency symbol where applicable.
 * e.g. ₦500,000.00  or  $1,234.56  or  1,234.56 USD
 */
export function formatCurrency(amount, currency = '') {
  const num = parseFloat(amount);
  if (Number.isNaN(num)) return '-';
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  const sym = currency === 'NGN' ? '₦' : currency === 'USD' ? '$' : '';
  if (sym) return sym + formatted;
  return formatted + (currency ? ' ' + currency : '');
}
