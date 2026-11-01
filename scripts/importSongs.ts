import { PrismaClient, Prisma } from "@prisma/client";
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

interface ArtistJson {
  id: string;
  name: string;
  nameEn?: string | null;
  image?: string | null;
  isVerified?: boolean;
  description?: string | null;
  userId?: string | null;
  ig?: string | null;
  igFollowers?: number | null;
  fileId?: string | null;
  fileUniqueId?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface SongJson {
  id?: string;
  slug: string;
  title: string;
  titleEn?: string | null;
  artist: string;
  artistEn?: string | null;
  albumName?: string | null;
  coverArt?: string | null;
  year?: number;
  duration?: number;
  uri: string;
  filename?: string | null;
  index?: number;
  lyrics?: string | null;
  syncedLyrics?: string | null;
  playCount?: number;
  downloads?: number;
  isDisabled?: boolean;
  disabledDescription?: string | null;
  isActive?: boolean;
  isFeatured?: boolean;
  albumId?: string | null;
  userId?: string;
  lyricsSource?: string | null;
  lyricsSourceUrl?: string | null;
  links?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null;
  ogg?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  artists?: {
    id: string;
    name?: string;
    nameEn?: string | null;
    fileId?: string | null;
    fileUniqueId?: string | null;
  }[];
  telegram?: {
    "64"?: { file_id: string; file_unique_id: string } | null;
    "128"?: { file_id: string; file_unique_id: string } | null;
    "320"?: { file_id: string; file_unique_id: string } | null;
    coverArt?: { file_id: string; file_unique_id: string } | null;
    ogg?: { file_id: string; file_unique_id: string } | null;
  } | null;
  post?: {
    has_posted?: boolean;
    message_id?: number | null;
    ogg_message_id?: number | null;
  } | null;
}

interface TelegramJson {
  id?: string;
  songId: string;
  file_id_64?: string | null;
  file_unique_id_64?: string | null;
  file_id_128?: string | null;
  file_unique_id_128?: string | null;
  file_id_320?: string | null;
  file_unique_id_320?: string | null;
  file_id_ogg?: string | null;
  file_unique_id_ogg?: string | null;
  cover_art_file_id?: string | null;
  cover_art_file_unique_id?: string | null;
  has_posted?: boolean;
  message_id?: number | null;
  ogg_message_id?: number | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface RelationLink {
  A: string;
  B: string;
}

interface BackupRelations {
  artistToSong?: RelationLink[];
  _ArtistToSong?: RelationLink[];
}

interface BackupData extends BackupRelations {
  artists?: ArtistJson[];
  Artist?: ArtistJson[];
  songs?: SongJson[];
  Song?: SongJson[];
  telegrams?: TelegramJson[];
  Telegram?: TelegramJson[];
  artistToSong?: RelationLink[];
  _ArtistToSong?: RelationLink[];
  relations?: BackupRelations;
}

interface BackupPayload {
  version?: string;
  exportedAt?: string;
  counts?: Record<string, number>;
  totalRecords?: number;
  data?: BackupData;
  relations?: BackupRelations;
}

function parseDate(
  value: string | number | Date | null | undefined
): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

function parseJsonField(
  value: unknown
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null || value === undefined) return Prisma.JsonNull;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Prisma.InputJsonValue;
    } catch {
      return value;
    }
  }
  return value as Prisma.InputJsonValue;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findInputFile(): Promise<string> {
  if (process.argv[2]) {
    return path.resolve(process.argv[2]);
  }

  const preferredCandidates = [
    path.join(process.cwd(), "scripts", "exportedEverything.json"),
    path.join(process.cwd(), "exportedEverything.json"),
  ];

  for (const cand of preferredCandidates) {
    if (await fileExists(cand)) return cand;
  }

  const searchDirs = [path.join(process.cwd(), "scripts"), process.cwd()];
  for (const dir of searchDirs) {
    try {
      const files = await fs.readdir(dir);
      const matches = files.filter(
        (f) => f.startsWith("exportedEverything") && f.endsWith(".json")
      );
      if (matches.length > 0) {
        matches.sort().reverse();
        return path.join(dir, matches[0]!);
      }
    } catch {}
  }

  const fallbackCandidates = [
    path.join(process.cwd(), "data", "fancysongsexample.json"),
    path.join(process.cwd(), "scripts", "songs.json"),
    path.join(process.cwd(), "scripts", "songsId.json"),
  ];

  for (const cand of fallbackCandidates) {
    if (await fileExists(cand)) return cand;
  }

  return path.join(process.cwd(), "scripts", "exportedEverything.json");
}

const logProgress = (name: string, current: number, total: number) => {
  if (total > 50 && (current % 100 === 0 || current === total)) {
    process.stdout.write(`  ⏳ ${name}: ${current}/${total} processed...\r`);
    if (current === total) {
      process.stdout.write("\n");
    }
  }
};

async function main(): Promise<void> {
  console.log("🚀 Starting Songs, Telegram & Artists Import...\n");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const inputPath = await findInputFile();

  if (!(await fileExists(inputPath))) {
    console.error(`❌ Input file not found: ${inputPath}`);
    console.error(`Please provide a valid file path:`);
    console.error(
      `   npx tsx scripts/importSongs.ts [path/to/exportedEverything.json]`
    );
    process.exit(1);
  }

  console.log(`📂 Reading input file: ${inputPath}`);
  const rawData = await fs.readFile(inputPath, "utf-8");
  const parsed: unknown = JSON.parse(rawData);

  let songs: SongJson[] = [];
  let telegrams: TelegramJson[] = [];
  let payloadData: BackupData = {};
  let relations: BackupRelations = {};

  if (Array.isArray(parsed)) {
    songs = parsed as SongJson[];
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const data = ((obj.data as BackupData) || obj) as BackupData;
    payloadData = data;
    songs =
      data.songs ||
      ((data as Record<string, unknown>).Song as SongJson[]) ||
      [];
    telegrams =
      data.telegrams ||
      ((data as Record<string, unknown>).Telegram as TelegramJson[]) ||
      [];
    relations =
      (obj.relations as BackupRelations) ||
      data.relations ||
      (data as BackupRelations) ||
      {};
  }

  console.log(`🎵 Identified ${songs.length} songs to process.`);
  const artistsList = payloadData.artists || payloadData.Artist || [];
  if (artistsList.length > 0) {
    console.log(`🎨 Identified ${artistsList.length} artists to process.`);
  }
  if (telegrams.length > 0) {
    console.log(
      `📡 Identified ${telegrams.length} standalone telegram records.`
    );
  }

  const stats = {
    artistsImported: 0,
    songsCreated: 0,
    songsUpdated: 0,
    songsUnchanged: 0,
    songsFailed: 0,
    telegramsImported: 0,
    telegramsFailed: 0,
    artistToSongLinks: 0,
  };

  // Helper to upsert artists safely without foreign key conflicts
  const upsertArtist = async (art: ArtistJson): Promise<string | null> => {
    if (!art.name && !art.id) return null;

    try {
      const existing = await prisma.artist.findFirst({
        where: {
          OR: [
            ...(art.id ? [{ id: art.id }] : []),
            ...(art.name ? [{ name: art.name }] : []),
          ],
        },
      });

      // Check if art.userId exists in DB, otherwise avoid setting invalid FK
      let validUserId: string | null = null;
      if (art.userId) {
        const u = await prisma.user.findUnique({
          where: { id: art.userId },
          select: { id: true },
        });
        if (u) validUserId = u.id;
      }

      if (existing) {
        const updated = await prisma.artist.update({
          where: { id: existing.id },
          data: {
            name: art.name || existing.name,
            nameEn: art.nameEn !== undefined ? art.nameEn : existing.nameEn,
            image: art.image !== undefined ? art.image : existing.image,
            isVerified:
              art.isVerified !== undefined
                ? Boolean(art.isVerified)
                : existing.isVerified,
            description:
              art.description !== undefined
                ? art.description
                : existing.description,
            ig: art.ig !== undefined ? art.ig : existing.ig,
            igFollowers:
              art.igFollowers !== undefined
                ? art.igFollowers
                : existing.igFollowers,
            fileId: art.fileId || existing.fileId,
            fileUniqueId: art.fileUniqueId || existing.fileUniqueId,
            ...(validUserId && !existing.userId ? { userId: validUserId } : {}),
          },
        });
        return updated.id;
      } else {
        const created = await prisma.artist.create({
          data: {
            ...(art.id ? { id: art.id } : {}),
            name: art.name,
            nameEn: art.nameEn ?? null,
            image: art.image ?? null,
            isVerified: Boolean(art.isVerified),
            description: art.description ?? null,
            userId: validUserId,
            ig: art.ig ?? null,
            igFollowers: art.igFollowers ?? null,
            fileId: art.fileId ?? null,
            fileUniqueId: art.fileUniqueId ?? null,
            createdAt: parseDate(art.createdAt) || new Date(),
            updatedAt: parseDate(art.updatedAt) || new Date(),
          },
        });
        return created.id;
      }
    } catch (err) {
      console.warn(
        `  ⚠️ Could not upsert artist "${art.name || art.id}":`,
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }
  };

  try {
    // Disable Foreign Key checks for clean bulk import in PostgreSQL
    try {
      await prisma.$executeRawUnsafe(
        "SET session_replication_role = 'replica';"
      );
      console.log("🔒 Temporarily disabled foreign key checks for import.");
    } catch {
      console.warn(
        "⚠️ Could not set replica role; proceeding with standard execution."
      );
    }

    // Cache fallback user in case a new song references a userId that doesn't exist
    const defaultUser = await prisma.user.findFirst({ select: { id: true } });

    // --- 1. Import Artists (from export payload) ---
    if (artistsList.length > 0) {
      console.log("\n--- 1. Importing Artists ---");
      for (let i = 0; i < artistsList.length; i++) {
        const id = await upsertArtist(artistsList[i]!);
        if (id) stats.artistsImported++;
        logProgress("artists", i + 1, artistsList.length);
      }
      console.log(
        `  ✅ Artists Processed: ${stats.artistsImported} imported/synced`
      );
    }

    // Fields to sync on songs (Note: userId is deliberately omitted from update
    // so dev imports NEVER overwrite existing production user ownership!)
    const fieldsToSync = [
      "slug",
      "title",
      "titleEn",
      "artist",
      "artistEn",
      "albumName",
      "coverArt",
      "year",
      "duration",
      "uri",
      "filename",
      "index",
      "lyrics",
      "syncedLyrics",
      "playCount",
      "downloads",
      "isDisabled",
      "disabledDescription",
      "isActive",
      "isFeatured",
      "albumId",
      "lyricsSource",
      "lyricsSourceUrl",
      "links",
      "ogg",
    ];

    console.log("\n--- 2. Importing Songs & Telegram Data ---");

    for (let i = 0; i < songs.length; i++) {
      const jsonSong = songs[i];
      if (!jsonSong) {
        console.log("Song Not Found! Index: ", i);
        continue;
      }
      try {
        const dbSong = await prisma.song.findFirst({
          where: {
            OR: [
              ...(jsonSong.id ? [{ id: jsonSong.id }] : []),
              ...(jsonSong.slug ? [{ slug: jsonSong.slug }] : []),
            ],
          },
          include: { telegram: true },
        });

        let targetSongId = dbSong?.id;

        if (!dbSong) {
          // Song does not exist in DB -> Create it!
          // Ensure valid userId exists on DB
          let songUserId = jsonSong.userId;
          if (songUserId) {
            const userExists = await prisma.user.findUnique({
              where: { id: songUserId },
              select: { id: true },
            });
            if (!userExists && defaultUser) {
              songUserId = defaultUser.id;
            }
          } else if (defaultUser) {
            songUserId = defaultUser.id;
          }

          if (!songUserId) {
            throw new Error(
              `Cannot create song "${jsonSong.title}": No valid userId found in DB.`
            );
          }

          // Check if albumId exists in DB, otherwise nullify to avoid FK error
          let songAlbumId = jsonSong.albumId ?? null;
          if (songAlbumId) {
            const albumExists = await prisma.album.findUnique({
              where: { id: songAlbumId },
              select: { id: true },
            });
            if (!albumExists) {
              songAlbumId = null;
            }
          }

          const createdSong = await prisma.song.create({
            data: {
              ...(jsonSong.id ? { id: jsonSong.id } : {}),
              slug: jsonSong.slug,
              title: jsonSong.title || "بدون عنوان",
              titleEn: jsonSong.titleEn || "",
              artist: jsonSong.artist || "",
              artistEn: jsonSong.artistEn || "",
              albumName: jsonSong.albumName ?? null,
              coverArt: jsonSong.coverArt ?? null,
              year: jsonSong.year ?? 0,
              duration: jsonSong.duration ?? 0,
              uri: jsonSong.uri || "",
              filename: jsonSong.filename ?? null,
              index: jsonSong.index ?? 0,
              lyrics: jsonSong.lyrics ?? null,
              syncedLyrics: jsonSong.syncedLyrics ?? null,
              playCount: jsonSong.playCount ?? 0,
              downloads: jsonSong.downloads ?? 0,
              isDisabled: Boolean(jsonSong.isDisabled),
              disabledDescription: jsonSong.disabledDescription ?? null,
              isActive: Boolean(jsonSong.isActive ?? true),
              isFeatured: Boolean(jsonSong.isFeatured),
              albumId: songAlbumId,
              userId: songUserId,
              lyricsSource: jsonSong.lyricsSource ?? null,
              lyricsSourceUrl: jsonSong.lyricsSourceUrl ?? null,
              links: parseJsonField(jsonSong.links),
              ogg: jsonSong.ogg ?? null,
              createdAt: parseDate(jsonSong.createdAt) || new Date(),
              updatedAt: parseDate(jsonSong.updatedAt) || new Date(),
            },
          });

          targetSongId = createdSong.id;
          stats.songsCreated++;

          if (songs.length <= 50) {
            console.log(
              `✨ Created song: "${createdSong.title}" (${createdSong.id})`
            );
          }
        } else {
          // Song exists in DB -> Check fields and update if changed
          const updates: Record<string, unknown> = {};
          let hasChanges = false;
          const changedFields: string[] = [];

          for (const field of fieldsToSync) {
            if (Object.prototype.hasOwnProperty.call(jsonSong, field)) {
              let jsonValue = (jsonSong as unknown as Record<string, unknown>)[
                field
              ];
              if (field === "links") {
                jsonValue = parseJsonField(jsonValue);
              }
              const dbValue = (dbSong as unknown as Record<string, unknown>)[
                field
              ];

              const isDifferent =
                typeof jsonValue === "object" && jsonValue !== null
                  ? JSON.stringify(jsonValue) !== JSON.stringify(dbValue)
                  : jsonValue !== dbValue;

              if (isDifferent) {
                updates[field] = jsonValue;
                hasChanges = true;
                changedFields.push(field);
              }
            }
          }

          if (hasChanges) {
            await prisma.song.update({
              where: { id: dbSong.id },
              data: updates,
            });
            stats.songsUpdated++;
            if (songs.length <= 50) {
              console.log(
                `✅ Updated song: "${
                  dbSong.title
                }" (Fields: ${changedFields.join(", ")})`
              );
            }
          } else {
            stats.songsUnchanged++;
          }
        }

        // Handle Song Artists (connect & update fileId/fileUniqueId)
        if (
          jsonSong.artists &&
          Array.isArray(jsonSong.artists) &&
          jsonSong.artists.length > 0 &&
          targetSongId
        ) {
          const connectedArtistIds: string[] = [];
          for (const art of jsonSong.artists) {
            const actualArtistId = await upsertArtist({
              id: art.id,
              name: art.name || "",
              nameEn: art.nameEn,
              fileId: art.fileId,
              fileUniqueId: art.fileUniqueId,
            });
            if (actualArtistId) {
              connectedArtistIds.push(actualArtistId);
            }
          }

          if (connectedArtistIds.length > 0) {
            await prisma.song.update({
              where: { id: targetSongId },
              data: {
                artists: {
                  connect: connectedArtistIds.map((id) => ({ id })),
                },
              },
            });
          }
        }

        // Handle Telegram and Post data for the song
        if ((jsonSong.telegram || jsonSong.post) && targetSongId) {
          const tg = jsonSong.telegram;
          const pt = jsonSong.post;

          const tgUpdateData = {
            file_id_64: tg?.["64"]?.file_id ?? null,
            file_unique_id_64: tg?.["64"]?.file_unique_id ?? null,
            file_id_128: tg?.["128"]?.file_id ?? null,
            file_unique_id_128: tg?.["128"]?.file_unique_id ?? null,
            file_id_320: tg?.["320"]?.file_id ?? null,
            file_unique_id_320: tg?.["320"]?.file_unique_id ?? null,
            cover_art_file_id: tg?.coverArt?.file_id ?? null,
            cover_art_file_unique_id: tg?.coverArt?.file_unique_id ?? null,
            file_id_ogg: tg?.ogg?.file_id ?? null,
            file_unique_id_ogg: tg?.ogg?.file_unique_id ?? null,
            has_posted: pt?.has_posted ?? false,
            message_id: pt?.message_id ?? null,
            ogg_message_id: pt?.ogg_message_id ?? null,
          };

          await prisma.telegram.upsert({
            where: { songId: targetSongId },
            update: tgUpdateData,
            create: {
              songId: targetSongId,
              ...tgUpdateData,
            },
          });
          stats.telegramsImported++;
        }
      } catch (err) {
        stats.songsFailed++;
        console.error(
          `❌ Error processing song "${jsonSong.title || "Unknown"}":`,
          err
        );
      }

      logProgress("songs", i + 1, songs.length);
    }

    console.log(
      `  ✅ Songs Processed: ${stats.songsCreated} created, ${stats.songsUpdated} updated, ${stats.songsUnchanged} unchanged` +
        (stats.songsFailed > 0 ? `, ${stats.songsFailed} failed` : "")
    );

    // --- 3. Import standalone Telegram records from export payload ---
    if (telegrams && telegrams.length > 0) {
      console.log("\n--- 3. Importing Standalone Telegram Records ---");
      for (let i = 0; i < telegrams.length; i++) {
        const tg = telegrams[i];
        if (!tg) {
          console.log("Telegram Record Not Found! Index: ", i);
          continue;
        }
        try {
          const songExists = await prisma.song.findUnique({
            where: { id: tg.songId },
            select: { id: true },
          });

          if (!songExists) continue;

          const updateData = {
            file_id_64: tg.file_id_64 ?? null,
            file_unique_id_64: tg.file_unique_id_64 ?? null,
            file_id_128: tg.file_id_128 ?? null,
            file_unique_id_128: tg.file_unique_id_128 ?? null,
            file_id_320: tg.file_id_320 ?? null,
            file_unique_id_320: tg.file_unique_id_320 ?? null,
            file_id_ogg: tg.file_id_ogg ?? null,
            file_unique_id_ogg: tg.file_unique_id_ogg ?? null,
            cover_art_file_id: tg.cover_art_file_id ?? null,
            cover_art_file_unique_id: tg.cover_art_file_unique_id ?? null,
            has_posted: Boolean(tg.has_posted),
            message_id: tg.message_id ?? null,
            ogg_message_id: tg.ogg_message_id ?? null,
            createdAt: parseDate(tg.createdAt),
            updatedAt: parseDate(tg.updatedAt),
          };

          await prisma.telegram.upsert({
            where: { songId: tg.songId },
            update: updateData,
            create: {
              ...(tg.id ? { id: tg.id } : {}),
              songId: tg.songId,
              ...updateData,
            },
          });
          stats.telegramsImported++;
        } catch {
          stats.telegramsFailed++;
        }
        logProgress("telegrams", i + 1, telegrams.length);
      }
      console.log(
        `  ✅ Telegram Records Processed: ${stats.telegramsImported} imported` +
          (stats.telegramsFailed > 0 ? `, ${stats.telegramsFailed} failed` : "")
      );
    }

    // --- 4. Import Many-to-Many ArtistToSong Relations ---
    const artistToSong =
      relations.artistToSong ||
      relations._ArtistToSong ||
      payloadData.artistToSong ||
      payloadData._ArtistToSong;

    if (artistToSong && artistToSong.length > 0) {
      console.log("\n--- 4. Importing ArtistToSong Relations ---");
      const chunkSize = 200;
      for (let i = 0; i < artistToSong.length; i += chunkSize) {
        const chunk = artistToSong.slice(i, i + chunkSize);
        try {
          const valuesPlaceholders = chunk
            .map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2})`)
            .join(", ");
          const params = chunk.flatMap((c) => [c.A, c.B]);
          await prisma.$executeRawUnsafe(
            `INSERT INTO "_ArtistToSong" ("A", "B") VALUES ${valuesPlaceholders} ON CONFLICT DO NOTHING`,
            ...params
          );
          stats.artistToSongLinks += chunk.length;
        } catch {
          for (const item of chunk) {
            try {
              await prisma.$executeRawUnsafe(
                `INSERT INTO "_ArtistToSong" ("A", "B") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                item.A,
                item.B
              );
              stats.artistToSongLinks++;
            } catch {
              try {
                await prisma.song.update({
                  where: { id: item.B },
                  data: { artists: { connect: { id: item.A } } },
                });
                stats.artistToSongLinks++;
              } catch {}
            }
          }
        }
        logProgress(
          "artistToSong",
          Math.min(i + chunkSize, artistToSong.length),
          artistToSong.length
        );
      }
      console.log(
        `  🔗 ArtistToSong Links: ${stats.artistToSongLinks} links imported`
      );
    }

    console.log("\n=================================");
    console.log(`🎉 Songs, Artists & Telegram Import Completed!`);
    console.log(`📊 Summary:`);
    if (stats.artistsImported > 0) {
      console.log(`   - Artists Synced: ${stats.artistsImported}`);
    }
    console.log(`   - Songs Created: ${stats.songsCreated}`);
    console.log(`   - Songs Updated: ${stats.songsUpdated}`);
    console.log(`   - Songs Unchanged: ${stats.songsUnchanged}`);
    if (stats.songsFailed > 0) {
      console.log(`   - Songs Failed: ${stats.songsFailed}`);
    }
    console.log(`   - Telegram Records: ${stats.telegramsImported}`);
    if (stats.telegramsFailed > 0) {
      console.log(`   - Telegram Records Failed: ${stats.telegramsFailed}`);
    }
    if (stats.artistToSongLinks > 0) {
      console.log(`   - ArtistToSong Links: ${stats.artistToSongLinks}`);
    }
    console.log("=================================\n");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Critical error during import:", message);
    process.exit(1);
  } finally {
    try {
      await prisma.$executeRawUnsafe(
        "SET session_replication_role = 'origin';"
      );
      console.log("🔓 Re-enabled foreign key checks.");
    } catch {}
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error("Unhandled error:", message);
  process.exit(1);
});
