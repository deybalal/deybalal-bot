export function hashtagify(text: string): string {
  return (
    "#" +
    text
      .trim()
      .replace(/[\s]+/g, "_")
      .replace(/[^\p{L}\p{N}_]/gu, "")
  );
}
