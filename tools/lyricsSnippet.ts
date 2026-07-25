export function lyricSnippet(lyrics: string, query: string, radius = 18) {
  const i = lyrics.toLowerCase().indexOf(query.toLowerCase());

  if (i === -1) return "";

  const start = Math.max(0, i - radius);
  const end = Math.min(lyrics.length, i + query.length + radius);

  return (
    (start ? "..." : "") +
    lyrics.slice(start, end).replace(/\n/g, " ") +
    (end < lyrics.length ? "..." : "")
  );
}
