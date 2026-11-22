/** Most tokens a query may have; more add nothing and slow the match. */
const MAX_TOKENS = 10;

/** The words of a query: runs of letters and digits, so punctuation never reaches FTS5. */
export const searchTokens = (input: string): string[] =>
  (input.normalize('NFC').match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_TOKENS);

/**
 * Turns what the user typed into a safe FTS5 MATCH expression (SRCH-3): every word quoted
 * and made a prefix (`fren` → `"fren"*`), all required. Only letters and digits survive,
 * so input can't inject FTS syntax (NEAR, OR, column filters, unbalanced quotes).
 * Returns null when there's nothing to search for.
 */
export function toFtsQuery(input: string): string | null {
  const tokens = searchTokens(input);
  return tokens.length ? tokens.map((t) => `"${t}"*`).join(' ') : null;
}

/** Delimiters `snippet()` wraps matches in; private-use characters never typed by users. */
export const MARK_START = '\u{E000}';
export const MARK_END = '\u{E001}';

/** Splits a snippet into plain and highlighted parts, for rendering `<mark>` without HTML. */
export function snippetParts(snippet: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  for (const piece of snippet.split(MARK_START)) {
    const [match, rest] = piece.includes(MARK_END) ? piece.split(MARK_END, 2) : [undefined, piece];
    if (match) parts.push({ text: match, match: true });
    if (rest) parts.push({ text: rest, match: false });
  }
  return parts;
}
