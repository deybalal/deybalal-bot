import * as fuzzysort from "fuzzysort";
import type {
  Artist,
  SearchResult,
  Song,
  SongLinks,
  TelegramFile,
  TelegramSongWithFiles,
  TelegramUser,
} from "../types/types";
import { lyricSnippet } from "../tools/lyricsSnippet.ts";
import crypto from "crypto";
import prisma from "./db.ts";
import {
  getTokenVariants,
  normalizePersianText,
  parseSearchQuery,
} from "../tools/search-utils.ts";
import type { Prisma } from "@prisma/client";
import { getStringSimilarity } from "../tools/getStringSimilarity.ts";
import { PERSIAN_STOP_WORDS } from "../tools/constants.ts";

/**
 * Normalizes a database Song object (with its related Telegram record)
 * into the TelegramSongWithFiles format expected by the Telegram Bot.
 */
export function formatSongWithTelegram(song: any): TelegramSongWithFiles {
  const tg = song.telegram;

  const coverArtFileId = tg?.cover_art_file_id || null;
  const coverArtFileUniqueId = tg?.cover_art_file_unique_id || "";

  const oggFileId = tg?.file_id_ogg || null;
  const oggFileUniqueId = tg?.file_unique_id_ogg || "";

  const file64Id = tg?.file_id_64 || null;
  const file64UniqueId = tg?.file_unique_id_64 || "";

  const file128Id = tg?.file_id_128 || null;
  const file128UniqueId = tg?.file_unique_id_128 || "";

  const file320Id = tg?.file_id_320 || null;
  const file320UniqueId = tg?.file_unique_id_320 || "";

  const makeFile = (
    type: string,
    quality: string,
    fileId: string | null,
    fileUniqueId: string
  ): TelegramFile | null => {
    if (!fileId) return null;
    return {
      songId: song.id,
      type,
      quality,
      fileId,
      file_id: fileId,
      fileUniqueId,
      file_unique_id: fileUniqueId,
      uploadedAt: tg?.updatedAt ? new Date(tg.updatedAt).getTime() : Date.now(),
    };
  };

  return {
    ...song,
    songIndex: song.index ?? 0,
    telegram: {
      coverArt: makeFile("photo", "", coverArtFileId, coverArtFileUniqueId),
      ogg: makeFile("voice", "", oggFileId, oggFileUniqueId),
      "64": makeFile("audio", "64", file64Id, file64UniqueId),
      "128": makeFile("audio", "128", file128Id, file128UniqueId),
      "320": makeFile("audio", "320", file320Id, file320UniqueId),
      message_id: tg?.message_id || null,
      ogg_message_id: tg?.ogg_message_id || null,
      has_posted: tg?.has_posted || false,
      createdAt: tg?.createdAt ? new Date(tg.createdAt).getTime() : undefined,
      updatedAt: tg?.updatedAt ? new Date(tg.updatedAt).getTime() : undefined,
    },
  };
}

/**
 * Helper to get or create a user and their default favorite playlist.
 */
async function getOrCreateUserFavoritePlaylist(telegramId: number) {
  const telegramIdBigInt = BigInt(telegramId);
  let user = await prisma.user.findFirst({
    where: { telegramId: telegramIdBigInt },
  });

  if (!user) {
    const newId = crypto.randomUUID();
    const userSlug = crypto.randomBytes(5).toString("hex");
    user = await prisma.user.create({
      data: {
        id: newId,
        name: `کاربر تلگرام (${telegramId})`,
        email: `tg_${telegramId}@telegram.deybalal.ir`,
        emailVerified: false,
        telegramId: telegramIdBigInt,
        userSlug,
        downloadPreference: 128,
      },
    });
  }

  let favPlaylist = await prisma.playlist.findFirst({
    where: { userId: user.id, isFavorite: true },
  });

  if (!favPlaylist) {
    favPlaylist = await prisma.playlist.create({
      data: {
        id: crypto.randomUUID(),
        name: "موردعلاقه ها",
        description: "آهنگ های موردعلاقه",
        isFavorite: true,
        userId: user.id,
      },
    });
  }

  return { user, playlist: favPlaylist };
}

/**
 * Ensures a user exists in the PostgreSQL database.
 * If new, creates user with telegramId, names, username, and default favorites playlist.
 * Returns true if newly created, false if existing.
 */
export async function ensureUser(user: TelegramUser): Promise<boolean> {
  const existing = await prisma.user.findFirst({
    where: { telegramId: BigInt(user.id) },
  });

  if (!existing) {
    const newUserId = crypto.randomUUID();
    const userSlug = crypto.randomBytes(5).toString("hex");
    const fullName =
      [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
      user.username ||
      `کاربر تلگرام (${user.id})`;

    await prisma.user.create({
      data: {
        id: newUserId,
        name: fullName,
        email: `tg_${user.id}@telegram.deybalal.ir`,
        emailVerified: true,
        telegramId: BigInt(user.id),
        telegramUsername: user.username ?? null,
        telegramFirstName: user.first_name ?? null,
        telegramLastName: user.last_name ?? null,
        userSlug,
        role: "user",
        downloadPreference: 128,
        sendDailyFeatured: true,
        playlists: {
          create: {
            id: crypto.randomUUID(),
            name: "موردعلاقه ها",
            description: "آهنگ های موردعلاقه شما",
            isFavorite: true,
            duration: 0,
          },
        },
      },
    });

    return true;
  }

  // Update profile information if changed
  const now = Date.now();
  const FIFTEEN_DAYS = 15 * 24 * 60 * 60 * 1000;
  const lastUpdated = new Date(existing.updatedAt).getTime();

  if (
    now - lastUpdated >= FIFTEEN_DAYS ||
    existing.telegramUsername !== (user.username ?? null) ||
    existing.telegramFirstName !== (user.first_name ?? null) ||
    existing.telegramLastName !== (user.last_name ?? null) ||
    existing.hasBlockedBot
  ) {
    const fullName =
      [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
      user.username ||
      existing.name;

    await prisma.user.update({
      where: { id: existing.id },
      data: {
        telegramUsername: user.username ?? null,
        telegramFirstName: user.first_name ?? null,
        telegramLastName: user.last_name ?? null,
        name: fullName,
        hasBlockedBot: false,
      },
    });
  }

  return false;
}

/**
 * Returns all active, enabled songs ordered by index.
 */
export async function getSongs(): Promise<TelegramSongWithFiles[]> {
  const songs = await prisma.song.findMany({
    where: { isActive: true, isDisabled: false },
    include: { telegram: true, artists: true },
    orderBy: { index: "asc" },
  });

  return songs.map(formatSongWithTelegram);
}

/**
 * Debug logger helper.
 */
export async function logger(): Promise<TelegramFile[] | null> {
  const tg = await prisma.telegram.findFirst();
  if (!tg) return null;

  return [
    {
      songId: tg.songId,
      type: "audio",
      quality: "128",
      fileId: tg.file_id_128 || "",
      file_id: tg.file_id_128 || "",
      fileUniqueId: tg.file_unique_id_128 || "",
      file_unique_id: tg.file_unique_id_128 || "",
    },
  ];
}

/**
 * Retrieves a single Telegram file record for a given song, type, and quality.
 */
export async function getTelegramFile(
  songId: string,
  type: string,
  quality: string | null
): Promise<TelegramFile | null> {
  const tg = await prisma.telegram.findUnique({
    where: { songId },
  });

  if (!tg) return null;

  let fileId: string | null = null;
  let fileUniqueId: string = "";

  if (type === "photo") {
    fileId = tg.cover_art_file_id;
    fileUniqueId = tg.cover_art_file_unique_id || "";
  } else if (type === "voice") {
    fileId = tg.file_id_ogg;
    fileUniqueId = tg.file_unique_id_ogg || "";
  } else if (type === "audio") {
    const q = String(quality || "").trim();
    if (q === "64") {
      fileId = tg.file_id_64;
      fileUniqueId = tg.file_unique_id_64 || "";
    } else if (q === "128") {
      fileId = tg.file_id_128;
      fileUniqueId = tg.file_unique_id_128 || "";
    } else if (q === "320") {
      fileId = tg.file_id_320;
      fileUniqueId = tg.file_unique_id_320 || "";
    }
  }

  if (!fileId) return null;

  return {
    songId,
    type,
    quality: quality || "",
    fileId,
    file_id: fileId,
    fileUniqueId,
    file_unique_id: fileUniqueId,
    uploadedAt: tg.updatedAt ? new Date(tg.updatedAt).getTime() : Date.now(),
  };
}

/**
 * Saves/updates a Telegram fileId and fileUniqueId for a given song and quality.
 */
export async function saveTelegramFile(
  songId: string,
  type: string,
  quality: string | null,
  fileId: string,
  fileUniqueId: string
): Promise<any> {
  const data: Record<string, any> = {};

  if (type === "photo") {
    data.cover_art_file_id = fileId;
    data.cover_art_file_unique_id = fileUniqueId;
  } else if (type === "voice") {
    data.file_id_ogg = fileId;
    data.file_unique_id_ogg = fileUniqueId;
  } else if (type === "audio") {
    const q = String(quality || "").trim();
    if (q === "64") {
      data.file_id_64 = fileId;
      data.file_unique_id_64 = fileUniqueId;
    } else if (q === "128") {
      data.file_id_128 = fileId;
      data.file_unique_id_128 = fileUniqueId;
    } else if (q === "320") {
      data.file_id_320 = fileId;
      data.file_unique_id_320 = fileUniqueId;
    }
  }

  return await prisma.telegram.upsert({
    where: { songId },
    create: {
      songId,
      ...data,
    },
    update: data,
  });
}

/**
 * Deletes a Telegram file association by setting the corresponding fields to null.
 */
export async function deleteTelegramFile(
  songId: string,
  type: string,
  quality: string | null
): Promise<any> {
  const data: Record<string, any> = {};

  if (type === "photo") {
    data.cover_art_file_id = null;
    data.cover_art_file_unique_id = null;
  } else if (type === "voice") {
    data.file_id_ogg = null;
    data.file_unique_id_ogg = null;
  } else if (type === "audio") {
    const q = String(quality || "").trim();
    if (q === "64") {
      data.file_id_64 = null;
      data.file_unique_id_64 = null;
    } else if (q === "128") {
      data.file_id_128 = null;
      data.file_unique_id_128 = null;
    } else if (q === "320") {
      data.file_id_320 = null;
      data.file_unique_id_320 = null;
    }
  }

  return await prisma.telegram.update({
    where: { songId },
    data,
  });
}

/**
 * Returns a random active song with its Telegram files.
 */
export async function getRandomSong(): Promise<TelegramSongWithFiles | null> {
  const count = await prisma.song.count({
    where: { isActive: true, isDisabled: false },
  });

  if (count === 0) return null;

  const skip = Math.floor(Math.random() * count);
  const song = await prisma.song.findFirst({
    where: { isActive: true, isDisabled: false },
    skip,
    include: { telegram: true, artists: true },
  });

  return song ? formatSongWithTelegram(song) : null;
}

/**
 * Returns total count of songs and artists in the database.
 */
export async function getStats(): Promise<{ songs: number; artists: number }> {
  const [songs, artists] = await Promise.all([
    prisma.song.count({ where: { isActive: true, isDisabled: false } }),
    prisma.artist.count(),
  ]);

  return { songs, artists };
}

/**
 * Finds a song by ID including all Telegram files.
 */
export async function getSongById(
  songId: string
): Promise<TelegramSongWithFiles | null> {
  const song = await prisma.song.findUnique({
    where: { id: songId },
    include: { telegram: true, artists: true },
  });

  if (!song) return null;
  return formatSongWithTelegram(song);
}

/**
 * Finds all active songs by an artist ID.
 */
export async function getSongsByArtistId(artistId: string): Promise<Song[]> {
  const songs = await prisma.song.findMany({
    where: {
      isActive: true,
      isDisabled: false,
      artists: { some: { id: artistId } },
    },
    orderBy: { title: "asc" },
  });

  return songs.map((s) => ({
    ...s,
    songIndex: s.index,
    links: s.links as unknown as SongLinks | null,
  }));
}

/**
 * Returns a random song for a specific artist.
 */
export async function getRandomSongByArtistId(
  artistId: string
): Promise<TelegramSongWithFiles | null> {
  const count = await prisma.song.count({
    where: {
      isActive: true,
      isDisabled: false,
      artists: { some: { id: artistId } },
    },
  });

  if (count === 0) return null;

  const skip = Math.floor(Math.random() * count);
  const song = await prisma.song.findFirst({
    where: {
      isActive: true,
      isDisabled: false,
      artists: { some: { id: artistId } },
    },
    skip,
    include: { telegram: true, artists: true },
  });

  return song ? formatSongWithTelegram(song) : null;
}

/**
 * Fuzzy search across songs (title, titleEn, artist, artistEn, lyrics).
 */
export async function searchSongs(
  query: string,
  limit: number = 50
): Promise<SearchResult[]> {
  if (!query || !query.trim()) return [];

  const rawQuery = query.trim();
  const parsed = parseSearchQuery(rawQuery);

  if (!parsed.raw) {
    return [];
  }

  // Filter out single-letter tokens and stop words unless entire query was a stop word
  const rawTokens = parsed.allTokens;
  const filteredTokens = rawTokens.filter(
    (t) =>
      (t.length > 1 || rawTokens.length === 1) && !PERSIAN_STOP_WORDS.has(t)
  );
  const coreTokens = filteredTokens.length > 0 ? filteredTokens : rawTokens;

  if (coreTokens.length === 0) {
    return [];
  }

  const { normalized } = parsed;
  const cleanPhrase = coreTokens.join(" ");
  const cleanPhraseNorm = normalizePersianText(cleanPhrase);
  const noSpaceQuery = normalized.replace(/\s+/g, "");
  const noSpacePhrase = cleanPhraseNorm.replace(/\s+/g, "");

  // 1. Build High-Precision conditions
  // Full phrase condition (with orthographic variants)
  const fullPhraseVariants = Array.from(
    new Set([...getTokenVariants(rawQuery), ...getTokenVariants(cleanPhrase)])
  );

  const fullPhraseCondition: Prisma.SongWhereInput = {
    OR: fullPhraseVariants.flatMap((v) => [
      { title: { contains: v, mode: "insensitive" } },
      { artist: { contains: v, mode: "insensitive" } },
      { albumName: { contains: v, mode: "insensitive" } },
      { titleEn: { contains: v, mode: "insensitive" } },
      { artistEn: { contains: v, mode: "insensitive" } },
      {
        artists: {
          some: {
            OR: [
              { name: { contains: v, mode: "insensitive" } },
              { nameEn: { contains: v, mode: "insensitive" } },
            ],
          },
        },
      },
      { lyrics: { contains: v } },
    ]),
  };

  // Per-token conditions
  const tokenConditions: Prisma.SongWhereInput[] = coreTokens.map((token) => {
    const variants = getTokenVariants(token);
    return {
      OR: variants.flatMap((v) => [
        { title: { contains: v, mode: "insensitive" } },
        { artist: { contains: v, mode: "insensitive" } },
        { albumName: { contains: v, mode: "insensitive" } },
        { titleEn: { contains: v, mode: "insensitive" } },
        { artistEn: { contains: v, mode: "insensitive" } },
        {
          artists: {
            some: {
              OR: [
                { name: { contains: v, mode: "insensitive" } },
                { nameEn: { contains: v, mode: "insensitive" } },
              ],
            },
          },
        },
        // Only search lyrics if token is at least 3 chars to prevent huge false positive matches
        ...(v.length >= 3 ? [{ lyrics: { contains: v } }] : []),
      ]),
    };
  });

  // High-precision query: song matches full phrase OR every token in query matches at least one field
  const highPrecisionWhere: Prisma.SongWhereInput = {
    isActive: true,
    isDisabled: false,
    OR: [
      fullPhraseCondition,
      ...(coreTokens.length > 1 ? [{ AND: tokenConditions }] : []),
      ...(coreTokens.length === 1 ? tokenConditions : []),
    ],
  };

  const highPrecisionCandidates = await prisma.song.findMany({
    where: highPrecisionWhere,
    take: 60,
    include: {
      artists: true,
      telegram: true,
    },
    orderBy: [{ playCount: "desc" }],
  });

  let allCandidates = [...highPrecisionCandidates];

  // 2. Broad Recall if candidates are sparse and multi-word query (>= 3 words)
  if (allCandidates.length < 15 && coreTokens.length >= 3) {
    const existingIds = new Set(allCandidates.map((s) => s.id));
    const broadConditions: Prisma.SongWhereInput[] = [];

    // Check pairs of tokens ONLY against title and artist (NEVER lyrics in broad recall to prevent noise)
    const titleArtistTokenConditions: Prisma.SongWhereInput[] = coreTokens.map(
      (token) => {
        const variants = getTokenVariants(token);
        return {
          OR: variants.flatMap((v) => [
            { title: { contains: v, mode: "insensitive" } },
            { artist: { contains: v, mode: "insensitive" } },
            { albumName: { contains: v, mode: "insensitive" } },
            { titleEn: { contains: v, mode: "insensitive" } },
            { artistEn: { contains: v, mode: "insensitive" } },
            {
              artists: {
                some: {
                  OR: [
                    { name: { contains: v, mode: "insensitive" } },
                    { nameEn: { contains: v, mode: "insensitive" } },
                  ],
                },
              },
            },
          ]),
        };
      }
    );

    const maxTokens = Math.min(coreTokens.length, 5);
    for (let i = 0; i < maxTokens; i++) {
      for (let j = i + 1; j < maxTokens; j++) {
        broadConditions.push({
          AND: [titleArtistTokenConditions[i], titleArtistTokenConditions[j]],
        });
      }
    }

    if (broadConditions.length > 0) {
      const broadCandidates = await prisma.song.findMany({
        where: {
          isActive: true,
          isDisabled: false,
          id: { notIn: Array.from(existingIds) },
          OR: broadConditions,
        },
        take: 30,
        include: {
          artists: true,
          telegram: true,
        },
        orderBy: [{ playCount: "desc" }],
      });

      allCandidates.push(...broadCandidates);
    }
  }

  // If no candidates found from intelligent DB matching, return empty immediately
  if (allCandidates.length === 0) {
    return [];
  }

  // 3. Score each candidate
  interface ScoredCandidate {
    song: any;
    score: number;
    coverage: number;
    titleTokensCount: number;
    artistTokensCount: number;
    reason: "title" | "artist" | "lyrics";
    snippet?: string;
  }

  const isLatinQuery = /[a-zA-Z]/.test(rawQuery);
  const rawQueryLower = rawQuery.toLowerCase();

  let scoredList: ScoredCandidate[] = [];

  for (const song of allCandidates) {
    const title = song.title || "";
    const titleEn = song.titleEn || "";
    const artist = song.artist || "";
    const artistEn = song.artistEn || "";
    const album = song.albumName || "";
    const lyrics = song.lyrics || "";

    const titleNorm = normalizePersianText(title);
    const titleEnNorm = titleEn.toLowerCase().trim();
    const artistNorm = normalizePersianText(artist);
    const artistEnNorm = artistEn.toLowerCase().trim();
    const albumNorm = normalizePersianText(album);
    const lyricsNorm = normalizePersianText(lyrics);

    const artistRelNames = (song.artists || []).map((a: any) =>
      normalizePersianText(a.name || "")
    );
    const artistRelNamesEn = (song.artists || []).map((a: any) =>
      (a.nameEn || "").toLowerCase().trim()
    );

    const allArtistsNorm = [artistNorm, ...artistRelNames]
      .filter(Boolean)
      .join(" ");
    const allArtistsEnNorm = [artistEnNorm, ...artistRelNamesEn]
      .filter(Boolean)
      .join(" ");

    const titleNoSpace = titleNorm.replace(/\s+/g, "");
    const artistNoSpace = artistNorm.replace(/\s+/g, "");
    const allArtistsNoSpace = allArtistsNorm.replace(/\s+/g, "");

    let score = 0;
    let titleHit = false;
    let artistHit = false;
    let lyricsHit = false;

    // A. Exact Matches
    const isExactTitle =
      titleNorm === normalized ||
      titleNorm === cleanPhraseNorm ||
      (noSpaceQuery.length > 2 && titleNoSpace === noSpaceQuery) ||
      (noSpacePhrase.length > 2 && titleNoSpace === noSpacePhrase);

    const isExactArtist =
      artistNorm === normalized ||
      artistNorm === cleanPhraseNorm ||
      (noSpaceQuery.length > 2 && artistNoSpace === noSpaceQuery) ||
      allArtistsNorm === normalized;

    if (isExactTitle) {
      score += 350;
      titleHit = true;
    }

    if (isExactArtist) {
      score += 260;
      artistHit = true;
    }

    if (albumNorm === normalized || albumNorm === cleanPhraseNorm) {
      score += 160;
    }

    // Latin Exact Matches
    if (isLatinQuery) {
      if (titleEnNorm === rawQueryLower) {
        score += 320;
        titleHit = true;
      }
      if (
        allArtistsEnNorm === rawQueryLower ||
        artistEnNorm === rawQueryLower
      ) {
        score += 260;
        artistHit = true;
      }
    }

    // B. Prefix Matches
    if (
      titleNorm.startsWith(normalized) ||
      titleNorm.startsWith(cleanPhraseNorm) ||
      (isLatinQuery && titleEnNorm.startsWith(rawQueryLower))
    ) {
      score += 150;
      titleHit = true;
    }

    if (
      allArtistsNorm.startsWith(normalized) ||
      (isLatinQuery && allArtistsEnNorm.startsWith(rawQueryLower))
    ) {
      score += 100;
      artistHit = true;
    }

    // C. Substring Phrase Matches
    if (
      titleNorm.includes(normalized) ||
      titleNorm.includes(cleanPhraseNorm) ||
      (noSpaceQuery.length > 3 && titleNoSpace.includes(noSpaceQuery)) ||
      (isLatinQuery && titleEnNorm.includes(rawQueryLower))
    ) {
      score += 110;
      titleHit = true;
    }

    if (
      allArtistsNorm.includes(normalized) ||
      allArtistsNorm.includes(cleanPhraseNorm) ||
      (noSpaceQuery.length > 3 && allArtistsNoSpace.includes(noSpaceQuery)) ||
      (isLatinQuery && allArtistsEnNorm.includes(rawQueryLower))
    ) {
      score += 80;
      artistHit = true;
    }

    if (albumNorm.includes(normalized)) {
      score += 40;
    }

    // Full phrase in lyrics
    const phraseInLyrics =
      lyricsNorm.length > 0 &&
      (lyricsNorm.includes(normalized) ||
        (cleanPhraseNorm.length >= 4 && lyricsNorm.includes(cleanPhraseNorm)));

    if (phraseInLyrics) {
      score += 60;
      lyricsHit = true;
    }

    // D. Token Analysis
    let titleTokensCount = 0;
    let artistTokensCount = 0;
    let albumTokensCount = 0;
    let lyricsTokensCount = 0;
    let totalMatchedTokens = 0;

    const allTitleArtistWords = `${titleNorm} ${allArtistsNorm}`
      .split(/\s+/)
      .filter((w) => w.length > 0);

    for (const token of coreTokens) {
      const tokenNorm = normalizePersianText(token);
      const tokenNoSpace = tokenNorm.replace(/\s+/g, "");
      const tokenLower = token.toLowerCase();

      const inTitle =
        titleNorm.includes(tokenNorm) ||
        (tokenNoSpace.length > 2 && titleNoSpace.includes(tokenNoSpace)) ||
        (isLatinQuery && titleEnNorm.includes(tokenLower));

      const inArtist =
        allArtistsNorm.includes(tokenNorm) ||
        (tokenNoSpace.length > 2 && allArtistsNoSpace.includes(tokenNoSpace)) ||
        (isLatinQuery && allArtistsEnNorm.includes(tokenLower));

      const inAlbum = albumNorm.includes(tokenNorm);

      const inLyrics = tokenNorm.length >= 3 && lyricsNorm.includes(tokenNorm);

      if (inTitle) {
        titleTokensCount++;
        totalMatchedTokens++;
        score += 45;
        titleHit = true;
      } else if (inArtist) {
        artistTokensCount++;
        totalMatchedTokens++;
        score += 35;
        artistHit = true;
      } else if (inAlbum) {
        albumTokensCount++;
        totalMatchedTokens++;
        score += 20;
      } else if (inLyrics) {
        lyricsTokensCount++;
        totalMatchedTokens++;
        score += 15;
        lyricsHit = true;
      } else {
        // Fuzzy Levenshtein check against individual words of title & artist
        let bestSim = 0;
        for (const w of allTitleArtistWords) {
          if (Math.abs(w.length - tokenNorm.length) <= 2) {
            const sim = getStringSimilarity(tokenNorm, w);
            if (sim > bestSim) bestSim = sim;
          }
        }
        if (bestSim >= 0.78) {
          totalMatchedTokens += bestSim;
          score += 28 * bestSim;
          titleHit = true;
        }
      }
    }

    // E. Composite Query Bonus (e.g. "Artist Title")
    if (coreTokens.length > 1) {
      if (titleTokensCount > 0 && artistTokensCount > 0) {
        // Incredible composite match! The user searched both the artist and the song title!
        score += 220;
      }
    }

    // F. Coverage Calculation & Penalty
    const coverage =
      coreTokens.length > 0
        ? Math.min(totalMatchedTokens / coreTokens.length, 1)
        : 0;

    if (coverage >= 0.99) {
      score += 90; // All words found!
    } else {
      score += coverage * 45;
    }

    // Strict penalty for multi-token queries when coverage is poor
    if (coreTokens.length > 1 && coverage < 0.5) {
      score -= 75;
    }

    // G. Popularity Tiebreaker (log-scaled)
    const playCount = Number(song.playCount) || 0;
    if (playCount > 0) {
      score += Math.min(Math.log10(playCount + 1) * 3.5, 18);
    }

    // Strict Relevancy Filtering: Drop irrelevant items!
    // For queries with >= 3 tokens, require at least 2 tokens matched!
    if (coreTokens.length >= 3 && totalMatchedTokens < 2) continue;

    // For queries with >= 2 tokens, require at least 50% token coverage!
    if (coreTokens.length >= 2 && coverage < 0.5) continue;

    // For queries that only matched lyrics, require either full phrase or >= 70% coverage
    if (!titleHit && !artistHit && !isExactTitle && !isExactArtist) {
      if (!phraseInLyrics && coverage < 0.7) continue;
    }

    // Minimum absolute score threshold
    if (score < 40) continue;
    if (coreTokens.length >= 2 && coverage < 0.75 && score < 120) continue;

    // H. Determine Search Reason
    let reason: "title" | "artist" | "lyrics" = "title";
    if (titleHit || isExactTitle) {
      reason = "title";
    } else if (artistHit || isExactArtist) {
      reason = "artist";
    } else if (lyricsHit || phraseInLyrics) {
      reason = "lyrics";
    }

    // I. Snippet for lyrics matches
    let snippet: string | undefined;
    if (reason === "lyrics" || (phraseInLyrics && lyrics)) {
      snippet = lyricSnippet(lyrics, cleanPhraseNorm || rawQuery);
    }

    scoredList.push({
      song,
      score,
      coverage,
      titleTokensCount,
      artistTokensCount,
      reason,
      snippet,
    });
  }

  // If there are true composite matches (matching BOTH title and artist) for a multi-word query,
  // prioritize them over songs that only matched the artist or only the title.
  const hasComposite = scoredList.some(
    (c) => c.titleTokensCount > 0 && c.artistTokensCount > 0
  );
  if (hasComposite && coreTokens.length >= 3) {
    const topScore =
      scoredList.sort((a, b) => b.score - a.score)[0]?.score || 0;
    scoredList = scoredList.filter(
      (c) =>
        (c.titleTokensCount > 0 && c.artistTokensCount > 0) ||
        c.score >= topScore * 0.65
    );
  }

  // 4. Sort by score descending and return
  scoredList.sort((a, b) => b.score - a.score);

  return scoredList.slice(0, limit).map((item) => ({
    song: {
      ...item.song,
      songIndex: item.song.index ?? 0,
      links: item.song.links as unknown as SongLinks | null,
    },
    reason: item.reason,
    ...(item.reason === "lyrics" && item.snippet
      ? { snippet: item.snippet }
      : {}),
  }));
}

/**
 * Increments play count when downloaded.
 */
export async function incrementSongDownloads(id: string): Promise<void> {
  await prisma.song
    .update({
      where: { id },
      data: { downloads: { increment: 1 } },
    })
    .catch(() => {});
}

/**
 * Increments play count on view.
 */
export async function incrementViewCount(id: string): Promise<void> {
  await prisma.song
    .update({
      where: { id },
      data: { playCount: { increment: 1 } },
    })
    .catch(() => {});
}

/**
 * Increments song play count.
 */
export async function incrementSongPlayCount(songId: string): Promise<void> {
  await prisma.song
    .update({
      where: { id: songId },
      data: { playCount: { increment: 1 } },
    })
    .catch(() => {});
}

/**
 * Adds a song to the user's favorites playlist.
 */
export async function addFavorite(
  userId: number,
  songId: string
): Promise<void> {
  const { playlist } = await getOrCreateUserFavoritePlaylist(userId);

  await prisma.playlistSong.upsert({
    where: {
      playlistId_songId: {
        playlistId: playlist.id,
        songId,
      },
    },
    create: {
      playlistId: playlist.id,
      songId,
    },
    update: {},
  });
}

/**
 * Removes a song from the user's favorites playlist.
 */
export async function removeFavorite(
  userId: number,
  songId: string
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { telegramId: BigInt(userId) },
  });
  if (!user) return;

  const favPlaylist = await prisma.playlist.findFirst({
    where: { userId: user.id, isFavorite: true },
  });
  if (!favPlaylist) return;

  await prisma.playlistSong.deleteMany({
    where: {
      playlistId: favPlaylist.id,
      songId,
    },
  });
}

/**
 * Checks whether a song is in the user's favorites playlist.
 */
export async function isFavorite(
  userId: number,
  songId: string
): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { telegramId: BigInt(userId) },
  });
  if (!user) return false;

  const favPlaylist = await prisma.playlist.findFirst({
    where: { userId: user.id, isFavorite: true },
  });
  if (!favPlaylist) return false;

  const count = await prisma.playlistSong.count({
    where: {
      playlistId: favPlaylist.id,
      songId,
    },
  });

  return count > 0;
}

/**
 * Returns all favorite songs for a user by telegramId.
 */
export async function getFavoriteSongs(
  userId: number
): Promise<TelegramSongWithFiles[]> {
  const user = await prisma.user.findFirst({
    where: { telegramId: BigInt(userId) },
  });
  if (!user) return [];

  const favPlaylist = await prisma.playlist.findFirst({
    where: { userId: user.id, isFavorite: true },
    include: {
      songs: {
        orderBy: { addedAt: "desc" },
        include: {
          song: {
            include: {
              telegram: true,
              artists: true,
            },
          },
        },
      },
    },
  });

  if (!favPlaylist || !favPlaylist.songs) return [];

  return favPlaylist.songs
    .filter(
      (ps: { song: { isActive: any; isDisabled: any } }) =>
        ps.song && ps.song.isActive && !ps.song.isDisabled
    )
    .map((ps: { song: any }) => formatSongWithTelegram(ps.song));
}

/**
 * Returns user's preferred quality using the 'downloadPreference' field (64, 128, 320).
 * Defaults to "320" if not set.
 */
export async function getPreferredQuality(userId: number): Promise<string> {
  const user = await prisma.user.findFirst({
    where: { telegramId: BigInt(userId) },
    select: { downloadPreference: true },
  });

  return String(user?.downloadPreference ?? 320);
}

/**
 * Sets user's preferred quality using the 'downloadPreference' integer field (e.g. 64, 128, 320).
 */
export async function setPreferredQuality(
  userId: number,
  quality: string | number
): Promise<void> {
  const qualityNum = parseInt(String(quality), 10) || 128;

  const user = await prisma.user.findFirst({
    where: { telegramId: BigInt(userId) },
  });

  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { downloadPreference: qualityNum },
    });
  } else {
    const newId = crypto.randomUUID();
    const userSlug = crypto.randomBytes(5).toString("hex");
    await prisma.user.create({
      data: {
        id: newId,
        name: `کاربر تلگرام (${userId})`,
        email: `tg_${userId}@telegram.deybalal.ir`,
        emailVerified: true,
        telegramId: userId,
        userSlug,
        downloadPreference: qualityNum,
      },
    });
  }
}

/**
 * Returns top played songs.
 */
export async function getTopPlayedSongs(
  limit: number = 50
): Promise<TelegramSongWithFiles[]> {
  const songs = await prisma.song.findMany({
    where: { isActive: true, isDisabled: false },
    orderBy: { playCount: "desc" },
    take: limit,
    include: { telegram: true, artists: true },
  });

  return songs.map(formatSongWithTelegram);
}

/**
 * Returns most downloaded / most played songs.
 */
export async function getMostDownloadedSongs(
  limit: number = 50
): Promise<TelegramSongWithFiles[]> {
  const songs = await prisma.song.findMany({
    where: { isActive: true, isDisabled: false },
    orderBy: { downloads: "desc" },
    take: limit,
    include: { telegram: true, artists: true },
  });

  return songs.map(formatSongWithTelegram);
}

/**
 * Returns all active albums with their active song count.
 */
export async function getAllAlbums(): Promise<
  {
    albumId?: string | null;
    albumName: string;
    songCount: number;
  }[]
> {
  const albums = await prisma.album.findMany({
    where: { isActive: true },
    include: {
      _count: {
        select: {
          songs: {
            where: { isActive: true, isDisabled: false },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return albums.map((a: { id: any; name: any; _count: { songs: any } }) => ({
    albumId: a.id,
    albumName: a.name,
    songCount: a._count.songs,
  }));
}

/**
 * Returns all songs belonging to an album ID or album name.
 */
export async function getSongsByAlbumId(
  id: string
): Promise<TelegramSongWithFiles[]> {
  const songs = await prisma.song.findMany({
    where: {
      isActive: true,
      isDisabled: false,
      OR: [{ albumId: id }, { albumName: id }],
    },
    orderBy: { index: "asc" },
    include: { telegram: true },
  });

  return songs.map(formatSongWithTelegram);
}

/**
 * Updates a song's Telegram channel post information.
 */
export async function updateSongWithPostDetails(
  songId: string,
  messageId: number,
  oggMessageId: number,
  _mp3MessageId?: number
): Promise<any> {
  return await prisma.telegram.upsert({
    where: { songId },
    create: {
      songId,
      has_posted: true,
      message_id: messageId,
      ogg_message_id: oggMessageId,
    },
    update: {
      has_posted: true,
      message_id: messageId,
      ogg_message_id: oggMessageId,
    },
  });
}

/**
 * Returns songs that have not yet been posted to the Telegram channel.
 */
export async function getUnpostedSongs(): Promise<TelegramSongWithFiles[]> {
  const songs = await prisma.song.findMany({
    where: {
      isActive: true,
      isDisabled: false,
      OR: [{ telegram: null }, { telegram: { has_posted: false } }],
    },
    orderBy: { index: "asc" },
    include: { telegram: true, artists: true },
  });

  return songs.map(formatSongWithTelegram);
}

/**
 * Adds or updates an artist record, including Telegram fileId and fileUniqueId.
 */
export async function addArtist(
  artist: Artist & { telegram?: { fileId: string; fileUniqueId: string } }
): Promise<any> {
  const fileId =
    artist.telegram?.fileId || artist.telegramFileId || artist.fileId || null;
  const fileUniqueId =
    artist.telegram?.fileUniqueId ||
    artist.telegramFileUniqueId ||
    artist.fileUniqueId ||
    null;

  return await prisma.artist.upsert({
    where: { id: artist.id },
    create: {
      id: artist.id,
      name: artist.name,
      nameEn: artist.nameEn ?? null,
      image: artist.image ?? null,
      isVerified: Boolean(artist.isVerified),
      ig: artist.ig ?? null,
      igFollowers: artist.followers ?? null,
      description: artist.description ?? null,
      fileId,
      fileUniqueId,
    },
    update: {
      name: artist.name,
      nameEn: artist.nameEn ?? undefined,
      image: artist.image ?? undefined,
      isVerified: Boolean(artist.isVerified),
      ig: artist.ig ?? undefined,
      igFollowers: artist.followers ?? undefined,
      description: artist.description ?? undefined,
      fileId: fileId ?? undefined,
      fileUniqueId: fileUniqueId ?? undefined,
    },
  });
}

/**
 * Finds an artist by ID.
 */
export async function getArtistById(id: string): Promise<Artist | null> {
  const artist = await prisma.artist.findUnique({
    where: { id },
  });

  if (!artist) return null;

  return {
    ...artist,
    followers: artist.igFollowers ?? 0,
    telegramFileId: artist.fileId,
    telegramFileUniqueId: artist.fileUniqueId,
  };
}

/**
 * Returns a random active song that has at least 225 characters of lyrics.
 */
export async function getRandomSongWithLyrics(): Promise<TelegramSongWithFiles | null> {
  const candidates = await prisma.song.findMany({
    where: {
      isActive: true,
      isDisabled: false,
      lyrics: { not: null },
    },
    include: { telegram: true, artists: true },
  });

  const filtered = candidates.filter((s) => (s.lyrics?.length ?? 0) >= 225);
  if (filtered.length === 0) return null;

  const randomSong = filtered[Math.floor(Math.random() * filtered.length)];
  return formatSongWithTelegram(randomSong);
}
