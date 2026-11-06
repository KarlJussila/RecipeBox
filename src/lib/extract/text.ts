const BLOCK_TAGS = /<\s*(br|\/p|\/li|\/div|\/h[1-6])\b[^>]*>/gi;

/** Decodes HTML entities, drops tags, and tidies whitespace. Keeps line breaks. */
export function cleanText(value: unknown, decodePasses = 2): string {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return "";
  let text = value;
  if (decodePasses > 0 && /[<&]/.test(text)) {
    const doc = new DOMParser().parseFromString(
      `<body>${text.replace(BLOCK_TAGS, "\n")}</body>`,
      "text/html",
    );
    text = doc.body.textContent ?? "";
    // Some sites double-encode (e.g. "&amp;amp;").
    if (/&[a-z#0-9]+;/i.test(text)) return cleanText(text, decodePasses - 1);
  }
  return text
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** cleanText, but always a single line. */
export function cleanLine(value: unknown): string {
  return cleanText(value).replace(/\n/g, " ");
}

/** Splits comma-separated strings and arrays into unique, trimmed values. */
export function splitList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    for (const part of cleanLine(item).split(/\s*[,;]\s*/)) {
      const key = part.toLowerCase();
      if (part && !seen.has(key)) {
        seen.add(key);
        out.push(part);
      }
    }
  }
  return out;
}

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

/** Headline case for titles a site writes all in lowercase. */
export function headlineCase(value: string): string {
  return value.replace(/\p{L}[\p{L}'’]*/gu, (word, offset: number) =>
    offset > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
  );
}

export function titleCase(value: string): string {
  return value.replace(/(^|[\s-])(\p{Ll})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** A title as it's saved: some blogs (Smitten Kitchen) style titles in lowercase, and old pages in capitals. */
export function tidyTitle(title: string): string {
  return title === title.toLowerCase() || title === title.toUpperCase() ? headlineCase(title.toLowerCase()) : title;
}
