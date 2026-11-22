export function parseNotes(
  text: string,
  version?: string,
): { version: string; body: string; error?: undefined } | { error: string };
