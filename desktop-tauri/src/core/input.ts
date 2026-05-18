export function splitTargetInput(input: string): string[] {
  return input
    .trim()
    .split(/\s+/)
    .map(value => value.trim())
    .filter(Boolean);
}

export function normalizeTargetToken(token: string): string {
  const trimmed = token.trim();
  if (/^\d{17}$/.test(trimmed)) {
    return trimmed;
  }

  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const profileMatch = url.pathname.match(/^\/profiles\/(\d{17})(?:\/|$)/);
    if (profileMatch) {
      return profileMatch[1];
    }
    const vanityMatch = url.pathname.match(/^\/id\/([^/?#]+)(?:\/|$)/);
    if (vanityMatch) {
      return decodeURIComponent(vanityMatch[1]);
    }
  } catch {
    // Plain vanity IDs are handled below.
  }

  return trimmed.replace(/^@/, "");
}

