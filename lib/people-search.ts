/**
 * Match one search token against person identity fields.
 *
 * Ordinary text only searches the email username so a query such as "mark" does not
 * match everyone through the shared @example.com domain. Typing an explicit email
 * token containing "@" still searches the complete address.
 */
export function personSearchTokenMatches(
  token: string,
  fields: Array<string | null | undefined>,
  email: string,
): boolean {
  const normalizedToken = token.toLowerCase();
  if (fields.some((field) => field?.toLowerCase().includes(normalizedToken)))
    return true;

  const normalizedEmail = email.toLowerCase();
  const emailText = normalizedToken.includes("@")
    ? normalizedEmail
    : (normalizedEmail.split("@", 1)[0] ?? "");
  return emailText.includes(normalizedToken);
}
