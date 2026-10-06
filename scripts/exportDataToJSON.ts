import * as fs from "fs/promises";
import * as path from "path";
import { prisma } from "../src/db";

declare global {
  interface BigInt {
    toJSON(): string;
  }
}

if (!BigInt.prototype.toJSON) {
  BigInt.prototype.toJSON = function () {
    return this.toString();
  };
}

function getTimestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(
    d.getHours()
  )}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

export async function exportSongsToJson(): Promise<string> {
  const fetchTable = async <T>(
    name: string,
    queryFn: () => Promise<T[]>
  ): Promise<T[]> => {
    try {
      const records = await queryFn();
      return records;
    } catch (err: unknown) {
      console.warn(`⚠️ Could not export ${name}`);
      return [];
    }
  };

  const users = await fetchTable("users", () => prisma.user.findMany());
  const accounts = await fetchTable("accounts", () =>
    prisma.account.findMany()
  );
  const sessions = await fetchTable("sessions", () =>
    prisma.session.findMany()
  );
  const verifications = await fetchTable("verifications", () =>
    prisma.verification.findMany()
  );
  const genres = await fetchTable("genres", () => prisma.genre.findMany());
  const badges = await fetchTable("badges", () => prisma.badge.findMany());
  const userBadges = await fetchTable("userBadges", () =>
    prisma.userBadge.findMany()
  );
  const artists = await fetchTable("artists", () => prisma.artist.findMany());
  const follows = await fetchTable("follows", () => prisma.follow.findMany());
  const albums = await fetchTable("albums", () => prisma.album.findMany());

  const rawSongs = await prisma.song.findMany({
    orderBy: { index: "asc" },
    include: {
      artists: {
        select: {
          id: true,
          name: true,
          nameEn: true,
          fileId: true,
          fileUniqueId: true,
        },
      },
      telegram: true,
    },
  });

  const songs = rawSongs.map((song) => {
    const { telegram, ...rest } = song;

    const telegramObj = {
      "64": telegram?.file_id_64
        ? {
            file_id: telegram.file_id_64,
            file_unique_id: telegram.file_unique_id_64,
          }
        : null,
      "128": telegram?.file_id_128
        ? {
            file_id: telegram.file_id_128,
            file_unique_id: telegram.file_unique_id_128,
          }
        : null,
      "320": telegram?.file_id_320
        ? {
            file_id: telegram.file_id_320,
            file_unique_id: telegram.file_unique_id_320,
          }
        : null,
      coverArt: telegram?.cover_art_file_id
        ? {
            file_id: telegram.cover_art_file_id,
            file_unique_id: telegram.cover_art_file_unique_id,
          }
        : null,
      ogg:
        telegram?.ogg_file_id || telegram?.file_id_ogg
          ? {
              file_id: telegram.ogg_file_id || telegram.file_id_ogg,
              file_unique_id:
                telegram.ogg_file_unique_id || telegram.file_unique_id_ogg,
            }
          : null,
    };

    const postObj = {
      has_posted: telegram?.has_posted ?? false,
      message_id: telegram?.message_id ?? null,
      ogg_message_id: telegram?.ogg_message_id ?? null,
    };

    return {
      ...rest,
      telegram: telegramObj,
      post: postObj,
    };
  });

  const songCrews = await fetchTable("songCrews", () =>
    prisma.songCrew.findMany()
  );
  const contributors = await fetchTable("contributors", () =>
    prisma.contributor.findMany()
  );
  const lyricsSuggestions = await fetchTable("lyricsSuggestions", () =>
    prisma.lyricsSuggestion.findMany()
  );
  const playlists = await fetchTable("playlists", () =>
    prisma.playlist.findMany()
  );
  const playlistSongs = await fetchTable("playlistSongs", () =>
    prisma.playlistSong.findMany()
  );
  const comments = await fetchTable("comments", () =>
    prisma.comment.findMany()
  );
  const notifications = await fetchTable("notifications", () =>
    prisma.notification.findMany()
  );
  const radioPlaylists = await fetchTable("radioPlaylists", () =>
    prisma.radioPlaylist.findMany()
  );
  const radioTracks = await fetchTable("radioTracks", () =>
    prisma.radioTrack.findMany()
  );
  const telegrams = await fetchTable("telegrams", () =>
    prisma.telegram.findMany()
  );

  const fetchImplicitRelation = async (
    relationName: string,
    tableName: string,
    fallbackFn: () => Promise<{ A: string; B: string }[]>
  ): Promise<{ A: string; B: string }[]> => {
    try {
      const rows = await prisma.$queryRawUnsafe<{ A: string; B: string }[]>(
        `SELECT "A", "B" FROM "${tableName}"`
      );
      return rows;
    } catch {
      try {
        return await fallbackFn();
      } catch (err) {
        return [];
      }
    }
  };

  const artistToSong = await fetchImplicitRelation(
    "ArtistToSong",
    "_ArtistToSong",
    async () => {
      const items = await prisma.song.findMany({
        select: { id: true, artists: { select: { id: true } } },
      });
      return items.flatMap((s) => s.artists.map((a) => ({ A: a.id, B: s.id })));
    }
  );

  const genreToSong = await fetchImplicitRelation(
    "GenreToSong",
    "_GenreToSong",
    async () => {
      const items = await prisma.song.findMany({
        select: { id: true, genres: { select: { id: true } } },
      });
      return items.flatMap((s) => s.genres.map((g) => ({ A: g.id, B: s.id })));
    }
  );

  const albumToGenre = await fetchImplicitRelation(
    "AlbumToGenre",
    "_AlbumToGenre",
    async () => {
      const items = await prisma.album.findMany({
        select: { id: true, genres: { select: { id: true } } },
      });
      return items.flatMap((a) => a.genres.map((g) => ({ A: a.id, B: g.id })));
    }
  );

  const songSimilarity = await fetchImplicitRelation(
    "SongSimilarity",
    "_SongSimilarity",
    async () => {
      const items = await prisma.song.findMany({
        select: { id: true, similarSongs: { select: { id: true } } },
      });
      return items.flatMap((s) =>
        s.similarSongs.map((sim) => ({ A: s.id, B: sim.id }))
      );
    }
  );

  const counts = {
    users: users.length,
    accounts: accounts.length,
    sessions: sessions.length,
    verifications: verifications.length,
    genres: genres.length,
    badges: badges.length,
    userBadges: userBadges.length,
    artists: artists.length,
    follows: follows.length,
    albums: albums.length,
    songs: songs.length,
    songCrews: songCrews.length,
    playlists: playlists.length,
    playlistSongs: playlistSongs.length,
    comments: comments.length,
    lyricsSuggestions: lyricsSuggestions.length,
    notifications: notifications.length,
    contributors: contributors.length,
    radioPlaylists: radioPlaylists.length,
    radioTracks: radioTracks.length,
    telegrams: telegrams.length,
    artistToSong: artistToSong.length,
    genreToSong: genreToSong.length,
    albumToGenre: albumToGenre.length,
    songSimilarity: songSimilarity.length,
  };

  const totalRecords = Object.values(counts).reduce((acc, c) => acc + c, 0);

  const exportPayload = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    counts,
    totalRecords,
    data: {
      users,
      accounts,
      sessions,
      verifications,
      genres,
      badges,
      userBadges,
      artists,
      follows,
      albums,
      songs,
      songCrews,
      playlists,
      playlistSongs,
      comments,
      lyricsSuggestions,
      notifications,
      contributors,
      radioPlaylists,
      radioTracks,
      telegrams,
      artistToSong,
      genreToSong,
      albumToGenre,
      songSimilarity,
    },
  };

  const exportDir = path.resolve(process.cwd(), "data");
  await fs.mkdir(exportDir, { recursive: true });

  const filename = `everything-export-${getTimestamp()}.json`;
  const filePath = path.join(exportDir, filename);

  await fs.writeFile(filePath, JSON.stringify(exportPayload, null, 2), "utf8");

  return filePath;
}

if (
  (typeof import.meta !== "undefined" && (import.meta as any).main) ||
  process.argv[1]?.includes("exportDataToJSON")
) {
  exportSongsToJson()
    .then((savedPath) => console.log("Saved export to:", savedPath))
    .catch((err) => console.error("Export error:", err))
    .finally(() => prisma.$disconnect());
}
