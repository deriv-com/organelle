import { personSearchTokenMatches } from "@/lib/people-search";

export const SANDBOX_RECIPIENT_RESULT_LIMIT = 20;

export type RecipientSearch = {
  normalized: string;
  tokens: string[];
};

type RecipientCandidate = {
  name: string;
  email: string;
};

export function parseRecipientSearch(query: string): RecipientSearch | null {
  const normalized = query.replace(/\s+/g, " ").trim().slice(0, 120).toLowerCase();
  if (normalized.length === 0) return null;

  const tokens = [...new Set(normalized.split(" ").filter(Boolean))].slice(0, 8);
  return tokens.length > 0 ? { normalized, tokens } : null;
}

export function searchRecipientCandidates<T extends RecipientCandidate>(
  candidates: T[],
  query: string,
): T[] {
  const search = parseRecipientSearch(query);
  if (!search) return [];

  return candidates
    .map((candidate) => {
      const name = candidate.name.toLowerCase();
      const email = candidate.email.toLowerCase();
      if (
        !search.tokens.every((token) => personSearchTokenMatches(token, [name], email))
      ) {
        return null;
      }

      const rank =
        email === search.normalized
          ? 0
          : name === search.normalized
            ? 1
            : name.startsWith(search.normalized)
              ? 2
              : email.startsWith(search.normalized)
                ? 3
                : name.startsWith(search.tokens[0]!)
                  ? 4
                  : 5;
      return { candidate, rank };
    })
    .filter((item): item is { candidate: T; rank: number } => item !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.candidate.name.localeCompare(b.candidate.name) ||
        a.candidate.email.localeCompare(b.candidate.email),
    )
    .slice(0, SANDBOX_RECIPIENT_RESULT_LIMIT)
    .map((item) => item.candidate);
}
