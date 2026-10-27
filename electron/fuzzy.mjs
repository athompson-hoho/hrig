// Shared by the renderer and the local file scanner. This module has no Node APIs.
export function fuzzyScore(value, query) {
  const text = String(value).replaceAll("\\", "/").toLowerCase();
  const needle = String(query)
    .trim()
    .replaceAll("\\", "/")
    .toLowerCase()
    .replace(/\s/g, "");
  if (!needle) return 0;
  const chars = Array.from(text);
  let previous = -1,
    score = 0;
  for (const ch of needle) {
    const index = chars.indexOf(ch, previous + 1);
    if (index < 0) return null;
    score += 10;
    if (index === previous + 1) score += 12;
    if (index === 0 || "/_- .".includes(chars[index - 1])) score += 18;
    score -= Math.min(50, index - previous - 1);
    previous = index;
  }
  const basename = text.slice(text.lastIndexOf("/") + 1);
  if (text.includes(needle)) score += 120;
  if (basename.startsWith(needle)) score += 150;
  return score - Math.min(100, chars.length / 6);
}
