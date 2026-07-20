/* Shared helpers: phone masking + display-string -> enum normalization */
export const maskPhone = (p?: string | null): string => {
  if (!p || p.length < 6) return '------';
  return p.slice(0, 4) + '****' + p.slice(-2);
};

/* Accepts "No Answer" or "NO_ANSWER" and returns "NO_ANSWER" */
export const toEnumName = (v?: string | null): string | undefined =>
  v ? v.trim().toUpperCase().replace(/[\s-]+/g, '_') : undefined;

export const toNum = (d: unknown): number => Number(d ?? 0);
