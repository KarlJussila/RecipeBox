const ISO = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i;

/**
 * Parses recipe durations into minutes. Handles ISO 8601 ("PT1H15M") and the
 * plain English some sites use instead ("1 hour 20 minutes", "45 mins").
 */
export function parseDuration(value: unknown): number | null {
  if (typeof value === "number") return value > 0 ? Math.round(value) : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  const iso = ISO.exec(text.replace(/\s+/g, ""));
  if (iso) {
    const [, d, h, m, s] = iso.map((part) => Number(part ?? 0));
    const minutes = Math.round(d * 1440 + h * 60 + m + s / 60);
    return minutes > 0 ? minutes : null;
  }

  let minutes = 0;
  let matched = false;
  const unit = /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)\b/gi;
  for (const [, amount, name] of text.matchAll(unit)) {
    matched = true;
    const n = Number(amount);
    const u = name.toLowerCase();
    if (u.startsWith("d")) minutes += n * 1440;
    else if (u.startsWith("h")) minutes += n * 60;
    else minutes += n;
  }
  if (!matched && /^\d+$/.test(text)) minutes = Number(text);
  return minutes > 0 ? Math.round(minutes) : null;
}

/** "1 hr 15 min", "45 min", "2 hr". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}
