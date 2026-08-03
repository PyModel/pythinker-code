export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1024 * 1024) return `${trimDecimal(n / (1024 * 1024))}M`;
  if (n >= 1024) {
    const k = n / 1024;
    return `${k >= 100 ? Math.round(k) : trimDecimal(k)}k`;
  }
  return String(n);
}

function trimDecimal(value: number): string {
  const formatted = value.toFixed(1);
  return formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
}
