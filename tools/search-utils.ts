import { Prisma } from "@prisma/client";
import { getStringSimilarity } from "./utils";

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
export function normalizePersianText(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\u0649\u064A\u06D2]/g, "ی") // Arabic yeh -> Persian yeh
    .replace(/[\u0643]/g, "ک") // Arabic kaf -> Persian kaf
    .replace(/[\u0622\u0623\u0625\u0671]/g, "ا") // Alefs -> ا
    .replace(/[\u0629\u06C0]/g, "ه") // Teh marbuta -> ه
    .replace(/[\u064B-\u065F\u0670]/g, "") // Diacritics (Fatha, Damma, Kasra, Tanween, etc.)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776)) // Persian digits
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632)) // Arabic-Indic digits
    .replace(/[\u200B-\u200D\uFEFF]/g, " ") // ZWNJ / zero-width space -> space
    .replace(/[ـ]/g, "") // Tatweel
    .toLowerCase()
    .trim();
}

/**
 * Common music search noise / filler words in Persian & English
 */
const NOISE_WORDS = new Set([
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
export function parseSearchQuery(query: string) {
  const raw = (query || "").trim();
  const normalized = normalizePersianText(raw);

  // Split on any whitespace or punctuation
  const allTokens = normalized
    .split(/[\s,،\-_\/\\|()\[\]"':;!?{}<>+=~*^%$#@`]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // Filter out noise words unless all tokens are noise words
  const coreTokens = allTokens.filter((t) => !NOISE_WORDS.has(t));
  const finalTokens = coreTokens.length > 0 ? coreTokens : allTokens;

  return {
    raw,
    normalized,
    allTokens,
    coreTokens: finalTokens,
    isMultiWord: finalTokens.length > 1,
  };
}

/**
 * Generate orthographic spelling variants for a single token to ensure
 * PostgreSQL ILIKE queries find candidates regardless of data formatting.
 */
export function getTokenVariants(rawToken: string): string[] {
  const token = rawToken.trim();
  if (!token) return [];

  const normalized = normalizePersianText(token);
  const variants = new Set<string>();

  variants.add(token);
  if (normalized) variants.add(normalized);

  // Alef variations at beginning: both 'آ' and 'ا'
  if (normalized.startsWith("ا")) {
    variants.add("آ" + normalized.slice(1));
  } else if (token.startsWith("آ")) {
    variants.add("ا" + token.slice(1));
  }

  // Arabic Yeh and Kaf variations
  if (normalized.includes("ی")) {
    variants.add(normalized.replace(/ی/g, "ي"));
  }
  if (normalized.includes("ک")) {
    variants.add(normalized.replace(/ک/g, "ك"));
  }

  // Latin / English case variants
  if (/[a-zA-Z]/.test(token)) {
    const lower = token.toLowerCase();
    const upper = token.toUpperCase();
    const capitalized =
      token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    variants.add(lower);
    variants.add(upper);
    variants.add(capitalized);
  }

  return Array.from(variants).filter((v) => v.length > 0);
}

export type ParsedSearchQuery = ReturnType<typeof parseSearchQuery>;

export interface ScorableItem {
  id: string;
  type: "song" | "artist" | "album" | "playlist" | "radioPlaylist";
  title?: string | null;
  titleEn?: string | null;
  name?: string | null;
  nameEn?: string | null;
  artist?: string | null;
  artistEn?: string | null;
  artistName?: string | null;
  artistNameEn?: string | null;
  albumName?: string | null;
  playCount?: number | null;
  score?: number;
  coverage?: number;
  [key: string]: unknown;
}

/**
 * Compute an intelligent relevance score for any item against the query.
 * Considers exact match, composite token coverage (artist + song), substring, prefix,
 * fuzzy string distance, and a popularity tiebreaker.
 */
export function calculateRelevance(
  parsed: ParsedSearchQuery,
  item: ScorableItem
): { score: number; coverage: number } {
  const mainText = typeof item.title === "string" ? item.title : typeof item.name === "string" ? item.name : "";
  const mainEn = typeof item.titleEn === "string" ? item.titleEn : typeof item.nameEn === "string" ? item.nameEn : "";
  const artistText = typeof item.artist === "string" ? item.artist : typeof item.artistName === "string" ? item.artistName : "";
  const artistEn = typeof item.artistEn === "string" ? item.artistEn : typeof item.artistNameEn === "string" ? item.artistNameEn : "";
  const albumText = typeof item.albumName === "string" ? item.albumName : "";

  const normMain = normalizePersianText(mainText);
  const normMainEn = mainEn.toLowerCase();
  const normArtist = normalizePersianText(artistText);
  const normArtistEn = artistEn.toLowerCase();
  const normAlbum = normalizePersianText(albumText);

  // Combined text representations
  const combinedForward = `${normMain} ${normMainEn} ${normArtist} ${normArtistEn} ${normAlbum}`.trim();
  const combinedReverse = `${normArtist} ${normArtistEn} ${normMain} ${normMainEn} ${normAlbum}`.trim();
  const combinedWords = `${combinedForward} ${combinedReverse}`.split(/\s+/).filter(Boolean);

  let score = 0;
  const qNorm = parsed.normalized;
  const qRaw = parsed.raw.toLowerCase();

  // 1. Exact match on main title/name
  if (normMain === qNorm || normMainEn === qRaw) {
    score += 160;
  } else if (normArtist === qNorm || normArtistEn === qRaw) {
    // Exact match on artist name
    score += item.type === "artist" ? 170 : 120;
  } else if (normAlbum === qNorm) {
    score += item.type === "album" ? 160 : 100;
  }

  // 2. Exact match on combined (e.g. "artist song" or "song artist")
  if (
    combinedForward.includes(qNorm) ||
    combinedReverse.includes(qNorm) ||
    combinedForward.includes(qRaw) ||
    combinedReverse.includes(qRaw)
  ) {
    score += 90;
  }

  // 3. Prefix match
  if (normMain.startsWith(qNorm) || normMainEn.startsWith(qRaw)) {
    score += 50;
  } else if (normArtist.startsWith(qNorm) || normArtistEn.startsWith(qRaw)) {
    score += 40;
  }

  // 4. Token coverage analysis
  const tokens = parsed.coreTokens;
  let matchedTokensCount = 0;

  for (const token of tokens) {
    const tokenLower = token.toLowerCase();
    const directHit =
      combinedForward.includes(token) ||
      combinedForward.includes(tokenLower) ||
      combinedReverse.includes(token) ||
      combinedReverse.includes(tokenLower);

    if (directHit) {
      matchedTokensCount++;
      // Bonus if token is in main title/name
      if (normMain.includes(token) || normMainEn.includes(tokenLower)) {
        score += 30;
      }
      // Bonus if token is in artist
      if (normArtist.includes(token) || normArtistEn.includes(tokenLower)) {
        score += 25;
      }
      // Bonus if token is in album
      if (normAlbum.includes(token)) {
        score += 15;
      }
    } else {
      // Fuzzy check against candidate words for slight typos
      let bestSim = 0;
      for (const w of combinedWords) {
        if (Math.abs(w.length - token.length) <= 2) {
          const sim = getStringSimilarity(token, w);
          if (sim > bestSim) bestSim = sim;
        }
      }
      if (bestSim >= 0.75) {
        matchedTokensCount += bestSim; // partial credit
        score += 20 * bestSim;
      }
    }
  }

  const coverage = tokens.length > 0 ? Math.min(matchedTokensCount / tokens.length, 1) : 0;

  // Reward high coverage heavily: 100% token coverage gets +70 points
  if (coverage >= 0.99) {
    score += 70;
  } else {
    score += coverage * 40;
  }

  // Penalty for items missing tokens when multiple tokens were queried
  if (tokens.length > 1 && coverage < 0.5) {
    score -= 30;
  }

  // 5. Popularity tie-breaker (log-scaled)
  if (item.playCount && item.playCount > 0) {
    score += Math.min(Math.log10(item.playCount + 1) * 2.5, 12);
  }

  return { score: Math.max(score, 0), coverage };
}

/**
 * Builds Prisma WhereInput for Songs supporting composite multi-token queries
 */
export function buildSongSearchWhere(
  parsed: ParsedSearchQuery,
  scope?: {
    type: "artist" | "album" | "playlist" | "radioPlaylist";
    id: string;
  } | null
): {
  highPrecisionWhere: Prisma.SongWhereInput;
  broadRecallWhere: Prisma.SongWhereInput;
} {
  const scopeCondition: Prisma.SongWhereInput = {
    isActive: true,
    ...(scope?.type === "artist" ? { artists: { some: { id: scope.id } } } : {}),
    ...(scope?.type === "album" ? { albumId: scope.id } : {}),
    ...(scope?.type === "playlist" ? { playlists: { some: { playlistId: scope.id } } } : {}),
  };

  const tokens = parsed.coreTokens;

  // For each token, match across song fields
  const tokenConditions: Prisma.SongWhereInput[] = tokens.map((token) => {
    const variants = getTokenVariants(token);
    return {
      OR: variants.flatMap((v) => [
        { title: { contains: v } },
        { artist: { contains: v } },
        { albumName: { contains: v } },
        { titleEn: { contains: v } },
        { artistEn: { contains: v } },
        { lyrics: { contains: v } },
        {
          artists: {
            some: {
              OR: [
                { name: { contains: v } },
                { nameEn: { contains: v } },
              ],
            },
          },
        },
      ]),
    };
  });

  // Full raw query condition
  const rawVariants = getTokenVariants(parsed.raw);
  const fullPhraseCondition: Prisma.SongWhereInput = {
    OR: rawVariants.flatMap((v) => [
      { title: { contains: v } },
      { artist: { contains: v } },
      { albumName: { contains: v } },
      { titleEn: { contains: v } },
      { artistEn: { contains: v } },
      { lyrics: { contains: v } },
    ]),
  };

  // High precision: Full phrase OR all tokens match
  const highPrecisionWhere: Prisma.SongWhereInput = {
    AND: [
      scopeCondition,
      {
        OR: [
          fullPhraseCondition,
          ...(tokens.length > 0 ? [{ AND: tokenConditions }] : []),
        ],
      },
    ],
  };

  // Broad recall: Pairs of tokens if >= 3 tokens, otherwise any token
  const pairConditions: Prisma.SongWhereInput[] = [];
  if (tokens.length >= 3) {
    const maxTokens = Math.min(tokens.length, 5);
    for (let i = 0; i < maxTokens; i++) {
      for (let j = i + 1; j < maxTokens; j++) {
        pairConditions.push({
          AND: [tokenConditions[i], tokenConditions[j]],
        });
      }
    }
  }

  const broadRecallWhere: Prisma.SongWhereInput = {
    AND: [
      scopeCondition,
      {
        OR: pairConditions.length > 0 ? pairConditions : tokenConditions,
      },
    ],
  };

  return { highPrecisionWhere, broadRecallWhere };
}

/**
 * Builds Prisma WhereInput for Albums
 */
export function buildAlbumSearchWhere(
  parsed: ParsedSearchQuery,
  scope?: {
    type: "artist" | "album" | "playlist" | "radioPlaylist";
    id: string;
  } | null
): Prisma.AlbumWhereInput {
  const scopeCondition: Prisma.AlbumWhereInput = {
    isActive: true,
    ...(scope?.type === "artist" ? { artistId: scope.id } : {}),
  };

  const tokens = parsed.coreTokens;
  const tokenConditions: Prisma.AlbumWhereInput[] = tokens.map((token) => {
    const variants = getTokenVariants(token);
    return {
      OR: variants.flatMap((v) => [
        { name: { contains: v } },
        { artistName: { contains: v } },
        { artistNameEn: { contains: v } },
      ]),
    };
  });

  const rawVariants = getTokenVariants(parsed.raw);
  const fullPhraseCondition: Prisma.AlbumWhereInput = {
    OR: rawVariants.flatMap((v) => [
      { name: { contains: v } },
      { artistName: { contains: v } },
      { artistNameEn: { contains: v } },
    ]),
  };

  return {
    AND: [
      scopeCondition,
      {
        OR: [
          fullPhraseCondition,
          ...(tokens.length > 0 ? [{ AND: tokenConditions }] : []),
          ...tokenConditions,
        ],
      },
    ],
  };
}

/**
 * Builds Prisma WhereInput for Artists
 */
export function buildArtistSearchWhere(parsed: ParsedSearchQuery): Prisma.ArtistWhereInput {
  const tokens = parsed.coreTokens;
  const rawVariants = getTokenVariants(parsed.raw);

  const tokenConditions: Prisma.ArtistWhereInput[] = tokens.map((token) => {
    const variants = getTokenVariants(token);
    return {
      OR: variants.flatMap((v) => [
        { name: { contains: v } },
        { nameEn: { contains: v } },
      ]),
    };
  });

  return {
    OR: [
      ...rawVariants.flatMap((v) => [
        { name: { contains: v } },
        { nameEn: { contains: v } },
      ]),
      ...(tokens.length > 0 ? [{ AND: tokenConditions }] : []),
      ...tokenConditions,
    ],
  };
}

/**
 * Builds Prisma WhereInput for Playlists
 */
export function buildPlaylistSearchWhere(parsed: ParsedSearchQuery): Prisma.PlaylistWhereInput {
  const tokens = parsed.coreTokens;
  const rawVariants = getTokenVariants(parsed.raw);

  const tokenConditions: Prisma.PlaylistWhereInput[] = tokens.map((token) => {
    const variants = getTokenVariants(token);
    return {
      OR: variants.flatMap((v) => [
        { name: { contains: v } },
        { description: { contains: v } },
      ]),
    };
  });

  return {
    AND: [
      { isPrivate: false },
      {
        OR: [
          ...rawVariants.flatMap((v) => [
            { name: { contains: v } },
            { description: { contains: v } },
          ]),
          ...(tokens.length > 0 ? [{ AND: tokenConditions }] : []),
          ...tokenConditions,
        ],
      },
    ],
  };
}

