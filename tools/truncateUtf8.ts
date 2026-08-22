export function truncateUtf8(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();

  if (encoder.encode(text).length <= maxBytes) {
    return text;
  }

  let result = "";

  for (const char of text) {
    const candidate = result + char;

    if (encoder.encode(candidate).length > maxBytes) {
      break;
    }

    result = candidate;
  }

  return result;
}
