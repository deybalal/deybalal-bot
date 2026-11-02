import type { CachedSong } from "./searchTypes.ts";
import {
  normalizePersian,
  normalizeEnglish,
  cleanLyricsText,
} from "./searchNormalizer.ts";
import prisma from "../src/db.ts";

let cache: CachedSong[] = [];
let isInitialized = false;
let initPromise: Promise<CachedSong[]> | null = null;
let refreshPromise: Promise<void> | null = null;

let lastRefreshTime = 0;

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Preprocess a raw database song into an optimized in-memory CachedSong
 */
function preprocessSong(raw: any): CachedSong {
  const title = raw.title || "";
  const titleEn = raw.titleEn || "";
  const artist = raw.artist || "";
  const artistEn = raw.artistEn || "";
  const albumName = raw.albumName || null;
  const lyrics = raw.lyrics || null;

  const normTitle = normalizePersian(title);
  const normTitleEn = normalizeEnglish(titleEn);
  const noSpaceTitle = normTitle.replace(/\s+/g, "");
  const titleWords = normTitle.split(/\s+/).filter(Boolean);

  const normArtist = normalizePersian(artist);
  const normArtistEn = normalizeEnglish(artistEn);
  const noSpaceArtist = normArtist.replace(/\s+/g, "");
  const artistWords = normArtist.split(/\s+/).filter(Boolean);

  const artists = (raw.artists || []).map((a: any) => ({
    id: a.id,
    name: a.name,
    nameEn: a.nameEn,
  }));

  const relatedNamesNorm = artists.map((a: any) => normalizePersian(a.name));
  const relatedNamesEnNorm = artists.map((a: any) =>
    normalizeEnglish(a.nameEn)
  );

  const allArtistsNorm = [normArtist, ...relatedNamesNorm]
    .filter(Boolean)
    .join(" ");
  const allArtistsEnNorm = [normArtistEn, ...relatedNamesEnNorm]
    .filter(Boolean)
    .join(" ");
  const allArtistsNoSpace = allArtistsNorm.replace(/\s+/g, "");
  const allArtistsWords = allArtistsNorm.split(/\s+/).filter(Boolean);

  const normAlbum = normalizePersian(albumName);
  const albumWords = normAlbum.split(/\s+/).filter(Boolean);

  const normLyrics = lyrics ? normalizePersian(cleanLyricsText(lyrics)) : "";

  return {
    id: raw.id,
    title,
    titleEn,
    artist,
    artistEn,
    albumName,
    lyrics,
    playCount: Number(raw.playCount) || 0,
    index: Number(raw.index) || 0,
    artists,

    normTitle,
    normTitleEn,
    noSpaceTitle,
    titleWords,

    normArtist,
    normArtistEn,
    noSpaceArtist,
    artistWords,

    allArtistsNorm,
    allArtistsEnNorm,
    allArtistsNoSpace,
    allArtistsWords,

    normAlbum,
    albumWords,

    normLyrics,
  };
}

/**
 * Loads songs from PostgreSQL using minimal projection and populates the cache
 */
async function loadSongsFromDatabase(): Promise<CachedSong[]> {
  const startTime = Date.now();

  const rawSongs = await prisma.song.findMany({
    where: {
      isActive: true,
      isDisabled: false,
    },
    select: {
      id: true,
      title: true,
      titleEn: true,
      artist: true,
      artistEn: true,
      albumName: true,
      lyrics: true,
      playCount: true,
      index: true,
      artists: {
        select: {
          id: true,
          name: true,
          nameEn: true,
        },
      },
    },
    orderBy: { index: "asc" },
  });

  const processed = rawSongs.map(preprocessSong);
  const duration = Date.now() - startTime;
  console.log(
    `[SEARCH] Cache loaded ${processed.length} songs in ${duration}ms.`
  );
  return processed;
}

/**
 * Initializes the in-memory search cache with single-flight concurrency protection
 */
export async function initializeSearchCache(): Promise<CachedSong[]> {
  if (isInitialized) {
    return cache;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      const data = await loadSongsFromDatabase();

      cache = data;
      isInitialized = true;
      lastRefreshTime = Date.now();

      return cache;
    } catch (err) {
      console.error("[SEARCH] Error initializing search cache:", err);
      throw err;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

/**
 * Returns the current search cache, initializing if necessary
 */
export async function getSearchCache(): Promise<CachedSong[]> {
  if (!isInitialized) {
    return initializeSearchCache();
  }

  if (Date.now() - lastRefreshTime >= REFRESH_INTERVAL_MS) {
    await refreshSearchCache();
  }

  return cache;
}
/**
 * Safely refreshes the search cache in the background.
 * If refresh fails, the previous working cache is retained.
 */
export async function refreshSearchCache(): Promise<void> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const startTime = Date.now();

      const freshSongs = await loadSongsFromDatabase();

      // Replace cache even if the database currently contains zero active songs.
      cache = freshSongs;
      lastRefreshTime = Date.now();

      console.log(
        `[SEARCH] Cache refresh completed in ${Date.now() - startTime}ms (${
          cache.length
        } songs).`
      );
    } catch (err) {
      console.error(
        "[SEARCH] Cache refresh failed; keeping existing cache.",
        err
      );
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Manually invalidates the search cache (e.g. after a song or artist update)
 */
export async function invalidateSearchCache(): Promise<void> {
  console.log("[SEARCH] Manual cache invalidation requested.");
  await refreshSearchCache();
}

/**
 * Returns cache diagnostic info
 */
export function getCacheStats() {
  return {
    isInitialized,
    count: cache.length,
    lastRefreshTime: new Date(lastRefreshTime).toISOString(),
    refreshIntervalMs: REFRESH_INTERVAL_MS,
  };
}
