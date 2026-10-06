import * as fuzzysort from "fuzzysort";
import { prisma } from "./db";
import type {
  Artist,
  SearchResult,
  Song,
  SongLinks,
  TelegramFile,
  TelegramSongWithFiles,
  TelegramUser,
} from "../types/types";
import { lyricSnippet } from "../tools/lyricsSnippet";
import crypto from "crypto";

/**
 * Normalizes a database Song object (with its related Telegram record)
 * into the TelegramSongWithFiles format expected by the Telegram Bot.
 */
export function formatSongWithTelegram(song: any): TelegramSongWithFiles {
  const tg = song.telegram;

  const coverArtFileId = tg?.cover_art_file_id || null;
  const coverArtFileUniqueId = tg?.cover_art_file_unique_id || "";

  const oggFileId = tg?.file_id_ogg || tg?.ogg_file_id || null;
  const oggFileUniqueId =
    tg?.file_unique_id_ogg || tg?.ogg_file_unique_id || "";

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
    existing.telegramLastName !== (user.last_name ?? null)
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
    include: { telegram: true },
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
    fileId = tg.file_id_ogg || tg.ogg_file_id;
    fileUniqueId = tg.file_unique_id_ogg || tg.ogg_file_unique_id || "";
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
    data.ogg_file_id = fileId;
    data.ogg_file_unique_id = fileUniqueId;
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
    data.ogg_file_id = null;
    data.ogg_file_unique_id = null;
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

  return await prisma.telegram
    .update({
      where: { songId },
      data,
    })
    .catch(() => null);
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
    include: { telegram: true },
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
    links: s.links as SongLinks | null,
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
    include: { telegram: true },
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

  const cleanQuery = query.trim();

  // Try matching candidate songs directly from PostgreSQL
  const matchedSongs = await prisma.song.findMany({
    where: {
      isActive: true,
      isDisabled: false,
      OR: [
        { title: { contains: cleanQuery } },
        { titleEn: { contains: cleanQuery } },
        { artist: { contains: cleanQuery } },
        { artistEn: { contains: cleanQuery } },
        { lyrics: { contains: cleanQuery } },
      ],
    },
    take: 100,
    orderBy: { playCount: "desc" },
  });

  let candidates = matchedSongs.map((s: { index: any }) => ({
    ...s,
    songIndex: s.index,
  }));

  // If no direct substring matches, fallback to top played songs for fuzzy matching
  if (candidates.length === 0) {
    const fallback = await prisma.song.findMany({
      where: { isActive: true, isDisabled: false },
      take: 200,
      orderBy: { playCount: "desc" },
    });
    candidates = fallback.map((s: { index: any }) => ({
      ...s,
      songIndex: s.index,
    }));
  }

  const results = fuzzysort.go(cleanQuery, candidates, {
    keys: ["title", "titleEn", "artist", "artistEn", "lyrics"],
    limit,
  });

  return results.map((r: any) => {
    let reason: SearchResult["reason"] = "lyrics";
    const keys = r.obj;

    if (
      keys.title?.toLowerCase().includes(cleanQuery.toLowerCase()) ||
      keys.titleEn?.toLowerCase().includes(cleanQuery.toLowerCase())
    ) {
      reason = "title";
    } else if (
      keys.artist?.toLowerCase().includes(cleanQuery.toLowerCase()) ||
      keys.artistEn?.toLowerCase().includes(cleanQuery.toLowerCase())
    ) {
      reason = "artist";
    }

    if (reason === "lyrics") {
      return {
        song: r.obj,
        reason,
        snippet: lyricSnippet(r.obj.lyrics || "", cleanQuery),
      };
    } else {
      return {
        song: r.obj,
        reason,
      };
    }
  });
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
    include: { telegram: true },
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
    include: { telegram: true },
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
    include: { telegram: true },
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
    include: { telegram: true },
  });

  const filtered = candidates.filter((s) => (s.lyrics?.length ?? 0) >= 225);
  if (filtered.length === 0) return null;

  const randomSong = filtered[Math.floor(Math.random() * filtered.length)];
  return formatSongWithTelegram(randomSong);
}
