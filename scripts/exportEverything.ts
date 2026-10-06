import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import fs from "fs/promises";
import path from "path";
import "dotenv/config";

declare global {
  interface BigInt {
    toJSON(): string;
  }
}

BigInt.prototype.toJSON = function () {
  return this.toString();
};

async function main(): Promise<void> {
  console.log("🚀 Starting Full Database Export...\n");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const fetchTable = async <T>(
      name: string,
      queryFn: () => Promise<T[]>
    ): Promise<T[]> => {
      try {
        const records = await queryFn();
        console.log(
          `  📦 Exported ${name.padEnd(20)}: ${records.length} records`
        );
        return records;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`  ⚠️ Could not export ${name}: ${message}`);
        return [];
      }
    };

    console.log("--- 1. Core Auth & System ---");
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

    console.log("\n--- 2. Taxonomy & Badges ---");
    const genres = await fetchTable("genres", () => prisma.genre.findMany());
    const badges = await fetchTable("badges", () => prisma.badge.findMany());
    const userBadges = await fetchTable("userBadges", () =>
      prisma.userBadge.findMany()
    );

    console.log("\n--- 3. Artists & Albums ---");
    const artists = await fetchTable("artists", () => prisma.artist.findMany());
    const follows = await fetchTable("follows", () => prisma.follow.findMany());
    const albums = await fetchTable("albums", () => prisma.album.findMany());

    console.log("\n--- 4. Songs & Media ---");
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
    console.log(`  📦 Exported songs               : ${songs.length} records`);

    const songCrews = await fetchTable("songCrews", () =>
      prisma.songCrew.findMany()
    );
    const contributors = await fetchTable("contributors", () =>
      prisma.contributor.findMany()
    );
    const lyricsSuggestions = await fetchTable("lyricsSuggestions", () =>
      prisma.lyricsSuggestion.findMany()
    );

    console.log("\n--- 5. Playlists & User Activity ---");
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

    console.log("\n--- 6. Many-to-Many Relations ---");
    const fetchImplicitRelation = async (
      relationName: string,
      tableName: string,
      fallbackFn: () => Promise<{ A: string; B: string }[]>
    ): Promise<{ A: string; B: string }[]> => {
      try {
        const rows = await prisma.$queryRawUnsafe<{ A: string; B: string }[]>(
          `SELECT "A", "B" FROM "${tableName}"`
        );
        console.log(
          `  🔗 Relation ${relationName.padEnd(17)}: ${rows.length} links`
        );
        return rows;
      } catch {
        try {
          const fallbackRows = await fallbackFn();
          console.log(
            `  🔗 Relation ${relationName.padEnd(17)}: ${
              fallbackRows.length
            } links (via relation fallback)`
          );
          return fallbackRows;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `  ⚠️ Could not export relation ${relationName}: ${message}`
          );
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
        return items.flatMap((s) =>
          s.artists.map((a) => ({ A: a.id, B: s.id }))
        );
      }
    );

    const genreToSong = await fetchImplicitRelation(
      "GenreToSong",
      "_GenreToSong",
      async () => {
        const items = await prisma.song.findMany({
          select: { id: true, genres: { select: { id: true } } },
        });
        return items.flatMap((s) =>
          s.genres.map((g) => ({ A: g.id, B: s.id }))
        );
      }
    );

    const albumToGenre = await fetchImplicitRelation(
      "AlbumToGenre",
      "_AlbumToGenre",
      async () => {
        const items = await prisma.album.findMany({
          select: { id: true, genres: { select: { id: true } } },
        });
        return items.flatMap((a) =>
          a.genres.map((g) => ({ A: a.id, B: g.id }))
        );
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

    const filename = `exportedEverything-${new Date()
      .toISOString()
      .slice(0, 16)
      .replace(/:/g, "-")}.json`;

    const outputPath = process.argv[2]
      ? path.resolve(process.argv[2])
      : path.join(process.cwd(), "scripts", filename);

    const jsonContent = JSON.stringify(exportPayload, null, 2);
    await fs.writeFile(outputPath, jsonContent, "utf-8");

    // Also update/create default exportedEverything.json for immediate import convenience
    if (!process.argv[2]) {
      const defaultPath = path.join(
        process.cwd(),
        "scripts",
        "exportedEverything.json"
      );
      await fs.writeFile(defaultPath, jsonContent, "utf-8");
    }

    console.log("\n=================================");
    console.log(`🎉 Export Completed Successfully!`);
    console.log(`📁 File saved to: ${outputPath}`);
    if (!process.argv[2]) {
      console.log(
        `📁 Also synced to: ${path.join(
          process.cwd(),
          "scripts",
          "exportedEverything.json"
        )}`
      );
    }
    console.log(`📊 Total items exported: ${totalRecords}`);
    console.log("=================================\n");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Critical error during database export:", message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error("Unhandled error:", message);
  process.exit(1);
});
