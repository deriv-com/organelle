/** Allow http(s) avatar / image URLs only. Rejects javascript:, data:, and relative values. */
export function isSafeHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** Safe `mailto:` href, or null when the address could smuggle headers / extra URLs. */
export function mailtoHref(email: string): string | null {
  const trimmed = email.trim();
  if (trimmed.length === 0) return null;
  if (/[?#\r\n]/.test(trimmed)) return null;
  return `mailto:${encodeURIComponent(trimmed)}`;
}
