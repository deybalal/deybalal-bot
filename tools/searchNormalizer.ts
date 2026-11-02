import type { ParsedQuery } from "./searchTypes.ts";

/**
 * Standardize Persian & Arabic text:
 * - Unifies Arabic/Persian Yeh and Kaf
 * - Normalizes Alefs with diacritics/madda
 * - Normalizes Teh Marbuta
 * - Strips Persian/Arabic diacritics (Harakat)
 * - Converts Persian & Arabic digits to ASCII digits
 * - Normalizes Zero-Width Non-Joiner (ZWNJ) and invisible spaces
 * - Strips Tatweel (Kashida)
 */
export function normalizePersian(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .normalize("NFKC")
    .replace(/[\u0649\u064A\u06D2\u0626]/g, "ی") // Arabic yeh / yaa / hamza on yeh -> Persian yeh
    .replace(/[\u0643]/g, "ک") // Arabic kaf -> Persian kaf
    .replace(/[\u0622\u0623\u0625\u0671]/g, "ا") // Alefs -> ا
    .replace(/[\u0629\u06C0]/g, "ه") // Teh marbuta -> ه
    .replace(/[\u064B-\u065F\u0670]/g, "") // Diacritics (Fatha, Damma, Kasra, Tanween, etc.)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776)) // Persian digits -> ASCII
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632)) // Arabic-Indic digits -> ASCII
    .replace(/[\u200B-\u200D\uFEFF]/g, " ") // ZWNJ / zero-width space -> space
    .replace(/[ـ]/g, "") // Tatweel
    .replace(/[\(\)\[\]\{\}\<\>\"\'\`«»؛;:،,!؟?\/\\+=_\-—*~^%$#@|]/g, " ") // Punctuation to space
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/**
 * Normalizes English text:
 * - Lowercase
 * - Normalizes punctuation and apostrophes
 * - Collapses spaces
 */
export function normalizeEnglish(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/['’`]/g, "") // remove apostrophes: don't -> dont
    .replace(/[\(\)\[\]\{\}\<\>\"؛;:،,!؟?\/\\+=_\-—*~^%$#@|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Common Persian & English stop words, conjunctions, prepositions, and music filler words
 */
export const STOP_WORDS = new Set([
  "و",
  "یا",
  "به",
  "از",
  "در",
  "با",
  "بر",
  "برای",
  "تا",
  "که",
  "چو",
  "چون",
  "رو",
  "را",
  "بی",
  "سی",
  "د",
  "ز",
  "ای",
  "او",
  "هم",
  "این",
  "آن",
  "اهنگ",
  "آهنگ",
  "موزیک",
  "ترانه",
  "دانلود",
  "البوم",
  "آلبوم",
  "خواننده",
  "قطعه",
  "صوت",
  "فایل",
  "های",
  "ها",
  "and",
  "or",
  "the",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "song",
  "track",
  "music",
  "download",
  "mp3",
  "audio",
]);

/**
 * Parse and tokenize a search query into clean, searchable tokens
 */
export function parseQuery(query: string): ParsedQuery {
  const raw = (query || "").trim();
  const normalized = normalizePersian(raw);
  const normalizedNoSpaces = normalized.replace(/\s+/g, "");
  const isLatin = /[a-zA-Z]/.test(raw);
  const rawLower = raw.toLowerCase().trim();

  // Split on any whitespace
  const allTokens = normalized
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  // Filter out single-character tokens and stop words unless all are stop words
  const coreTokens = allTokens.filter(
    (t) => (t.length > 1 || allTokens.length === 1) && !STOP_WORDS.has(t)
  );
  const finalTokens = coreTokens.length > 0 ? coreTokens : allTokens;

  const cleanPhrase = finalTokens.join(" ");
  const cleanPhraseNorm = normalizePersian(cleanPhrase);
  const cleanPhraseNoSpaces = cleanPhraseNorm.replace(/\s+/g, "");

  return {
    raw,
    normalized,
    normalizedNoSpaces,
    cleanPhrase,
    cleanPhraseNorm,
    cleanPhraseNoSpaces,
    allTokens,
    coreTokens: finalTokens,
    isLatin,
    rawLower,
  };
}

/**
 * Fast Levenshtein distance similarity (0.0 to 1.0)
 * Optimized with two-row DP for low memory allocation.
 */
export function calculateStringSimilarity(str1: string, str2: string): number {
  const s1 = str1.trim();
  const s2 = str2.trim();

  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const l1 = s1.length;
  const l2 = s2.length;

  if (Math.abs(l1 - l2) > 3) return 0.0; // Early exit for words of very different lengths

  let prev = new Int32Array(l2 + 1);
  let curr = new Int32Array(l2 + 1);

  for (let j = 0; j <= l2; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= l1; i++) {
    curr[0] = i;
    const c1 = s1.charCodeAt(i - 1);

    for (let j = 1; j <= l2; j++) {
      const c2 = s2.charCodeAt(j - 1);
      const cost = c1 === c2 ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }

    const temp = prev;
    prev = curr;
    curr = temp;
  }

  const distance = prev[l2];
  const maxLen = Math.max(l1, l2);
  return 1.0 - distance / maxLen;
}

/**
 * Clean LRC timestamps from lyrics
 */
export function cleanLyricsText(lyrics: string | null | undefined): string {
  if (!lyrics) return "";
  return lyrics
    .replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, " ")
    .replace(/\r?\n/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract a readable snippet of lyrics around the matched query
 */
export function extractLyricSnippet(
  lyrics: string | null | undefined,
  query: string,
  maxLength: number = 85
): string {
  if (!lyrics || !query || !query.trim()) return "";

  const lines = lyrics
    .split(/\r?\n/)
    .map((l) => l.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, " ").trim())
    .filter(Boolean);

  if (lines.length === 0) return "";

  const normQuery = normalizePersian(query);
  const queryTokens = normQuery.split(/\s+/).filter((t) => t.length > 1);

  // 1. Try finding a line containing the full phrase
  for (let i = 0; i < lines.length; i++) {
    const normLine = normalizePersian(lines[i]);
    if (normLine.includes(normQuery)) {
      let snippet = lines[i];
      if (snippet.length < 40 && i + 1 < lines.length) {
        snippet += " / " + lines[i + 1];
      }
      return formatSnippet(snippet, maxLength, i > 0, i + 1 < lines.length);
    }
  }

  // 2. Try line with highest token match
  let bestIdx = -1;
  let maxMatches = 0;

  for (let i = 0; i < lines.length; i++) {
    const normLine = normalizePersian(lines[i]);
    let count = 0;
    for (const t of queryTokens) {
      if (normLine.includes(t)) count++;
    }
    if (count > maxMatches) {
      maxMatches = count;
      bestIdx = i;
    }
  }

  if (bestIdx !== -1 && maxMatches > 0) {
    let snippet = lines[bestIdx];
    if (snippet.length < 40 && bestIdx + 1 < lines.length) {
      snippet += " / " + lines[bestIdx + 1];
    }
    return formatSnippet(snippet, maxLength, bestIdx > 0, bestIdx + 1 < lines.length);
  }

  return formatSnippet(lines[0], maxLength, false, lines.length > 1);
}

function formatSnippet(
  text: string,
  maxLength: number,
  hasPrefix: boolean,
  hasSuffix: boolean
): string {
  let trimmed = text.trim();
  if (trimmed.length > maxLength) {
    trimmed = trimmed.slice(0, maxLength).trim() + "...";
  }
  const prefix = hasPrefix && !trimmed.startsWith("...") ? "... " : "";
  const suffix = hasSuffix && !trimmed.endsWith("...") ? " ..." : "";
  return `${prefix}${trimmed}${suffix}`.trim();
}
