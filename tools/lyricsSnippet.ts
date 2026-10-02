/**
 * Extracts a relevant snippet from song lyrics around a search query match.
 */
export function lyricSnippet(
  lyrics: string,
  query: string,
  radius: number = 60
): string {
  if (!lyrics || !query) return "";

  const lowerLyrics = lyrics.toLowerCase();
  const lowerQuery = query.toLowerCase();

  const matchIndex = lowerLyrics.indexOf(lowerQuery);
  if (matchIndex === -1) {
    return (
      lyrics.slice(0, radius * 2).trim() +
      (lyrics.length > radius * 2 ? "..." : "")
    );
  }

  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(lyrics.length, matchIndex + query.length + radius);

  let snippet = lyrics
    .slice(start, end)
    .replace(/[\r\n]+/g, " ")
    .trim();

  if (start > 0) {
    snippet = "..." + snippet;
  }
  if (end < lyrics.length) {
    snippet = snippet + "...";
  }

  return snippet;
}
