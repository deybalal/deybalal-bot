import {
  PrismaClient,
  Prisma,
  Role,
  SuggestionStatus,
  SuggestionType,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import fs from "fs/promises";
import path from "path";
import "dotenv/config";

interface UserJson {
  id: string;
  name: string;
  email: string;
  emailVerified?: boolean;
  image?: string | null;
  bio?: string;
  isPrivate?: boolean;
  isBanned?: boolean;
  artistId?: string | null;
  userIndex: number;
  userSlug: string;
  instagramHandle?: string | null;
  role?: Role | string;
  isVerified?: boolean;
  isUserAnArtist?: boolean;
  downloadPreference?: number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface AccountJson {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  idToken?: string | null;
  accessTokenExpiresAt?: string | Date | null;
  refreshTokenExpiresAt?: string | Date | null;
  scope?: string | null;
  password?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface SessionJson {
  id: string;
  expiresAt: string | Date;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  userId: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface VerificationJson {
  id: string;
  identifier: string;
  value: string;
  expiresAt: string | Date;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface GenreJson {
  id: string;
  name: string;
  slug: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface BadgeJson {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface UserBadgeJson {
  id: string;
  userId: string;
  badgeId: string;
  awardedAt?: string | Date;
}

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
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface FollowJson {
  id: string;
  userId: string;
  artistId: string;
  createdAt?: string | Date;
}

interface AlbumJson {
  id: string;
  name: string;
  artistName: string;
  artistNameEn: string;
  coverArt?: string | null;
  releaseDate?: number | null;
  duration?: number;
  isActive?: boolean;
  isFeatured?: boolean;
  artistId?: string | null;
  userId: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface SongJson {
  id: string;
  slug: string;
  title: string;
  titleEn: string;
  artist: string;
  artistEn: string;
  albumName?: string | null;
  coverArt?: string | null;
  year?: number;
  duration?: number;
  uri: string;
  filename?: string | null;
  index: number;
  lyrics?: string | null;
  syncedLyrics?: string | null;
  playCount?: number;
  downloads?: number;
  isDisabled?: boolean;
  disabledDescription?: string | null;
  isActive?: boolean;
  isFeatured?: boolean;
  albumId?: string | null;
  userId: string;
  lyricsSource?: string | null;
  lyricsSourceUrl?: string | null;
  links?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null;
  ogg?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  artists?: {
    id: string;
    name: string;
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

interface SongCrewJson {
  id: string;
  songId: string;
  role: string;
  name: string;
}

interface ContributorJson {
  id: string;
  songId: string;
  userId: string;
  type: string;
  percentage?: number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface LyricsSuggestionJson {
  id: string;
  songId: string;
  userId: string;
  lyrics?: string | null;
  syncedLyrics?: string | null;
  status?: SuggestionStatus | string;
  type?: SuggestionType | string;
  lyricsSource?: string | null;
  lyricsSourceUrl?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface PlaylistJson {
  id: string;
  name: string;
  description?: string | null;
  coverArt?: string | null;
  duration?: number;
  isFavorite?: boolean;
  isDownload?: boolean;
  isPrivate?: boolean;
  userId: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface PlaylistSongJson {
  playlistId: string;
  songId: string;
  addedAt?: string | Date;
}

interface CommentJson {
  id: string;
  content: string;
  userId: string;
  userSlug: string;
  songId?: string | null;
  albumId?: string | null;
  postTitle: string;
  isActive?: boolean;
  isDeleted?: boolean;
  parentId?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface NotificationJson {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  link?: string | null;
  isRead?: boolean;
  createdAt?: string | Date;
}

interface PlayHistoryJson {
  id: string;
  userId: string;
  songId: string;
  playedAt?: string | Date;
}

interface RadioPlaylistJson {
  id: string;
  date: string | Date;
  startTime: string | Date;
  totalDuration: number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface RadioTrackJson {
  id: string;
  playlistId: string;
  songId: string;
  order: number;
  duration: number;
  startOffset: number;
}

interface TelegramJson {
  id: string;
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
  ogg_file_id?: string | null;
  ogg_file_unique_id?: string | null;
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

interface BackupData {
  users?: UserJson[];
  User?: UserJson[];
  accounts?: AccountJson[];
  Account?: AccountJson[];
  sessions?: SessionJson[];
  Session?: SessionJson[];
  verifications?: VerificationJson[];
  Verification?: VerificationJson[];
  genres?: GenreJson[];
  Genre?: GenreJson[];
  badges?: BadgeJson[];
  Badge?: BadgeJson[];
  userBadges?: UserBadgeJson[];
  UserBadge?: UserBadgeJson[];
  artists?: ArtistJson[];
  Artist?: ArtistJson[];
  follows?: FollowJson[];
  Follow?: FollowJson[];
  albums?: AlbumJson[];
  Album?: AlbumJson[];
  songs?: SongJson[];
  Song?: SongJson[];
  songCrews?: SongCrewJson[];
  SongCrew?: SongCrewJson[];
  playlists?: PlaylistJson[];
  Playlist?: PlaylistJson[];
  playlistSongs?: PlaylistSongJson[];
  PlaylistSong?: PlaylistSongJson[];
  comments?: CommentJson[];
  Comment?: CommentJson[];
  lyricsSuggestions?: LyricsSuggestionJson[];
  LyricsSuggestion?: LyricsSuggestionJson[];
  notifications?: NotificationJson[];
  Notification?: NotificationJson[];
  contributors?: ContributorJson[];
  Contributor?: ContributorJson[];
  playHistories?: PlayHistoryJson[];
  PlayHistory?: PlayHistoryJson[];

  radioPlaylists?: RadioPlaylistJson[];
  RadioPlaylist?: RadioPlaylistJson[];
  radioTracks?: RadioTrackJson[];
  RadioTrack?: RadioTrackJson[];
  telegrams?: TelegramJson[];
  Telegram?: TelegramJson[];

  relations?: BackupRelations;
}

interface BackupRelations {
  artistToSong?: RelationLink[];
  _ArtistToSong?: RelationLink[];
  genreToSong?: RelationLink[];
  _GenreToSong?: RelationLink[];
  albumToGenre?: RelationLink[];
  _AlbumToGenre?: RelationLink[];
  songSimilarity?: RelationLink[];
  _SongSimilarity?: RelationLink[];
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

function parseDateOrNull(
  value: string | number | Date | null | undefined
): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
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

async function findLatestBackupFile(): Promise<string | null> {
  const searchDirs = [path.join(process.cwd(), "scripts"), process.cwd()];

  for (const dir of searchDirs) {
    try {
      const files = await fs.readdir(dir);
      const matches = files.filter(
        (f) => f.startsWith("exportedEverything") && f.endsWith(".json")
      );

      if (matches.length > 0) {
        matches.sort().reverse();
        return path.join(dir, matches[0]);
      }
    } catch {}
  }

  return null;
}

async function main(): Promise<void> {
  console.log("🚀 Starting Full Database Import...\n");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

  console.log("process.env.DATABASE_URL ", process.env.DATABASE_URL);
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  // 1. Resolve Input File
  const defaultPathInScripts = path.join(
    process.cwd(),
    "scripts",
    "exportedEverything.json"
  );
  const defaultPathInRoot = path.join(process.cwd(), "exportedEverything.json");

  let inputPath = process.argv[2] ? path.resolve(process.argv[2]) : "";

  if (!inputPath) {
    if (await fileExists(defaultPathInScripts)) {
      inputPath = defaultPathInScripts;
    } else if (await fileExists(defaultPathInRoot)) {
      inputPath = defaultPathInRoot;
    } else {
      const latestFound = await findLatestBackupFile();
      if (latestFound) {
        inputPath = latestFound;
        console.log(`ℹ️ Automatically detected backup file: ${inputPath}`);
      } else {
        inputPath = defaultPathInScripts;
      }
    }
  }

  if (!(await fileExists(inputPath))) {
    console.error(`❌ Input file not found: ${inputPath}`);
    console.error(
      `Please ensure "exportedEverything.json" exists or specify path:`
    );
    console.error(
      `   npx tsx scripts/importEverything.ts [path/to/exportedEverything.json]`
    );
    process.exit(1);
  }

  console.log(`📂 Reading backup file: ${inputPath}`);
  const rawData = await fs.readFile(inputPath, "utf-8");
  console.log("rawData.le ", rawData.length);
  const payload: BackupPayload & BackupData = JSON.parse(rawData);
  console.log("payload ", payload.data?.songs?.length);
  console.log("Hallo");
  const data: BackupData = payload.data || payload;
  const relations: BackupRelations = payload.relations || data.relations || {};

  const stats: Record<
    string,
    { total: number; success: number; failed: number }
  > = {};

  const logModelProgress = (name: string, current: number, total: number) => {
    if (total > 50 && (current % 100 === 0 || current === total)) {
      process.stdout.write(`  ⏳ ${name}: ${current}/${total} processed...\r`);
    }
  };

  const importBatch = async <T>(
    modelName: string,
    items: T[] | undefined,
    processFn: (item: T) => Promise<void>
  ): Promise<void> => {
    const list = items || [];
    stats[modelName] = { total: list.length, success: 0, failed: 0 };
    if (list.length === 0) {
      console.log(`  ⏭️ ${modelName.padEnd(20)}: 0 items (Skipped)`);
      return;
    }

    for (let i = 0; i < list.length; i++) {
      try {
        await processFn(list[i]);
        stats[modelName].success++;
      } catch (err: unknown) {
        stats[modelName].failed++;
        if (stats[modelName].failed <= 3) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `\n  ⚠️ Error importing ${modelName} item [${i}]: ${message}`
          );
        }
      }
      logModelProgress(modelName, i + 1, list.length);
    }

    if (list.length > 50) {
      process.stdout.write("\n");
    }
    console.log(
      `  ✅ ${modelName.padEnd(20)}: ${stats[modelName].success} imported` +
        (stats[modelName].failed > 0
          ? `, ${stats[modelName].failed} failed`
          : "")
    );
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
        "⚠️ Could not disable FOREIGN_KEY_CHECKS; relying on ordered insertion."
      );
    }

    // --- 1. System & Taxonomies ---
    console.log("\n--- 1. Importing Taxonomies & Badges ---");
    const genres = data.genres || data.Genre;
    await importBatch("genres", genres, async (g: GenreJson) => {
      await prisma.genre.upsert({
        where: { id: g.id },
        update: {
          name: g.name,
          slug: g.slug,
          createdAt: parseDate(g.createdAt),
          updatedAt: parseDate(g.updatedAt),
        },
        create: {
          id: g.id,
          name: g.name,
          slug: g.slug,
          createdAt: parseDate(g.createdAt),
          updatedAt: parseDate(g.updatedAt),
        },
      });
    });

    const badges = data.badges || data.Badge;
    await importBatch("badges", badges, async (b: BadgeJson) => {
      await prisma.badge.upsert({
        where: { id: b.id },
        update: {
          name: b.name,
          description: b.description ?? null,
          createdAt: parseDate(b.createdAt),
          updatedAt: parseDate(b.updatedAt),
        },
        create: {
          id: b.id,
          name: b.name,
          description: b.description ?? null,
          createdAt: parseDate(b.createdAt),
          updatedAt: parseDate(b.updatedAt),
        },
      });
    });

    const verifications = data.verifications || data.Verification;
    await importBatch(
      "verifications",
      verifications,
      async (v: VerificationJson) => {
        await prisma.verification.upsert({
          where: { id: v.id },
          update: {
            identifier: v.identifier,
            value: v.value,
            expiresAt: parseDate(v.expiresAt) || new Date(),
            createdAt: parseDate(v.createdAt),
            updatedAt: parseDate(v.updatedAt),
          },
          create: {
            id: v.id,
            identifier: v.identifier,
            value: v.value,
            expiresAt: parseDate(v.expiresAt) || new Date(),
            createdAt: parseDate(v.createdAt),
            updatedAt: parseDate(v.updatedAt),
          },
        });
      }
    );

    // --- 2. Users & User Relations ---
    console.log("\n--- 2. Importing Users ---");
    const users = data.users || data.User;
    const userArtistMap = new Map<string, string>();

    await importBatch("users", users, async (u: UserJson) => {
      if (u.artistId) {
        userArtistMap.set(u.id, u.artistId);
      }
      const roleValue: Role =
        u.role === "moderator" || u.role === "administrator"
          ? (u.role as Role)
          : Role.user;

      await prisma.user.upsert({
        where: { id: u.id },
        update: {
          name: u.name,
          email: u.email,
          emailVerified: Boolean(u.emailVerified),
          image: u.image ?? null,
          bio: u.bio ?? "",
          isPrivate: Boolean(u.isPrivate),
          isBanned: Boolean(u.isBanned),
          // userIndex: u.userIndex, // Omitted to avoid Postgres sequence collisions
          userSlug: u.userSlug,
          instagramHandle: u.instagramHandle ?? null,
          role: roleValue,
          isVerified: Boolean(u.isVerified),
          isUserAnArtist: Boolean(u.isUserAnArtist),
          downloadPreference: u.downloadPreference ?? 128,
          createdAt: parseDate(u.createdAt),
          updatedAt: parseDate(u.updatedAt),
        },
        create: {
          id: u.id,
          name: u.name,
          email: u.email,
          emailVerified: Boolean(u.emailVerified),
          image: u.image ?? null,
          bio: u.bio ?? "",
          isPrivate: Boolean(u.isPrivate),
          isBanned: Boolean(u.isBanned),
          artistId: null, // Set deferred after artists exist
          // userIndex: u.userIndex, // Omitted to avoid Postgres sequence collisions
          userSlug: u.userSlug,
          instagramHandle: u.instagramHandle ?? null,
          role: roleValue,
          isVerified: Boolean(u.isVerified),
          isUserAnArtist: Boolean(u.isUserAnArtist),
          downloadPreference: u.downloadPreference ?? 128,
          createdAt: parseDate(u.createdAt),
          updatedAt: parseDate(u.updatedAt),
        },
      });
    });

    const accounts = data.accounts || data.Account;
    await importBatch("accounts", accounts, async (a: AccountJson) => {
      await prisma.account.upsert({
        where: { id: a.id },
        update: {
          accountId: a.accountId,
          providerId: a.providerId,
          userId: a.userId,
          accessToken: a.accessToken ?? null,
          refreshToken: a.refreshToken ?? null,
          idToken: a.idToken ?? null,
          accessTokenExpiresAt: parseDateOrNull(a.accessTokenExpiresAt),
          refreshTokenExpiresAt: parseDateOrNull(a.refreshTokenExpiresAt),
          scope: a.scope ?? null,
          password: a.password ?? null,
          createdAt: parseDate(a.createdAt),
          updatedAt: parseDate(a.updatedAt),
        },
        create: {
          id: a.id,
          accountId: a.accountId,
          providerId: a.providerId,
          userId: a.userId,
          accessToken: a.accessToken ?? null,
          refreshToken: a.refreshToken ?? null,
          idToken: a.idToken ?? null,
          accessTokenExpiresAt: parseDateOrNull(a.accessTokenExpiresAt),
          refreshTokenExpiresAt: parseDateOrNull(a.refreshTokenExpiresAt),
          scope: a.scope ?? null,
          password: a.password ?? null,
          createdAt: parseDate(a.createdAt),
          updatedAt: parseDate(a.updatedAt),
        },
      });
    });

    const sessions = data.sessions || data.Session;
    await importBatch("sessions", sessions, async (s: SessionJson) => {
      await prisma.session.upsert({
        where: { id: s.id },
        update: {
          expiresAt: parseDate(s.expiresAt) || new Date(),
          token: s.token,
          ipAddress: s.ipAddress ?? null,
          userAgent: s.userAgent ?? null,
          userId: s.userId,
          createdAt: parseDate(s.createdAt),
          updatedAt: parseDate(s.updatedAt),
        },
        create: {
          id: s.id,
          expiresAt: parseDate(s.expiresAt) || new Date(),
          token: s.token,
          ipAddress: s.ipAddress ?? null,
          userAgent: s.userAgent ?? null,
          userId: s.userId,
          createdAt: parseDate(s.createdAt),
          updatedAt: parseDate(s.updatedAt),
        },
      });
    });

    const userBadges = data.userBadges || data.UserBadge;
    await importBatch("userBadges", userBadges, async (ub: UserBadgeJson) => {
      await prisma.userBadge.upsert({
        where: { id: ub.id },
        update: {
          userId: ub.userId,
          badgeId: ub.badgeId,
          awardedAt: parseDate(ub.awardedAt) || new Date(),
        },
        create: {
          id: ub.id,
          userId: ub.userId,
          badgeId: ub.badgeId,
          awardedAt: parseDate(ub.awardedAt) || new Date(),
        },
      });
    });

    // --- 3. Artists & Follows ---
    console.log("\n--- 3. Importing Artists & Follows ---");
    const artists = data.artists || data.Artist;
    await importBatch("artists", artists, async (art: ArtistJson) => {
      await prisma.artist.upsert({
        where: { id: art.id },
        update: {
          name: art.name,
          nameEn: art.nameEn ?? null,
          image: art.image ?? null,
          isVerified: Boolean(art.isVerified),
          description: art.description ?? null,
          userId: art.userId ?? null,
          ig: art.ig ?? null,
          igFollowers: art.igFollowers ?? null,
          createdAt: parseDate(art.createdAt),
          updatedAt: parseDate(art.updatedAt),
        },
        create: {
          id: art.id,
          name: art.name,
          nameEn: art.nameEn ?? null,
          image: art.image ?? null,
          isVerified: Boolean(art.isVerified),
          description: art.description ?? null,
          userId: art.userId ?? null,
          ig: art.ig ?? null,
          igFollowers: art.igFollowers ?? null,
          createdAt: parseDate(art.createdAt),
          updatedAt: parseDate(art.updatedAt),
        },
      });
    });

    // Update deferred user.artistId
    if (userArtistMap.size > 0) {
      for (const [userId, artistId] of userArtistMap.entries()) {
        try {
          await prisma.user.update({
            where: { id: userId },
            data: { artistId },
          });
        } catch {}
      }
    }

    const follows = data.follows || data.Follow;
    await importBatch("follows", follows, async (f: FollowJson) => {
      await prisma.follow.upsert({
        where: { id: f.id },
        update: {
          userId: f.userId,
          artistId: f.artistId,
          createdAt: parseDate(f.createdAt),
        },
        create: {
          id: f.id,
          userId: f.userId,
          artistId: f.artistId,
          createdAt: parseDate(f.createdAt),
        },
      });
    });

    // --- 4. Albums ---
    console.log("\n--- 4. Importing Albums ---");
    const albums = data.albums || data.Album;
    await importBatch("albums", albums, async (alb: AlbumJson) => {
      await prisma.album.upsert({
        where: { id: alb.id },
        update: {
          name: alb.name,
          artistName: alb.artistName,
          artistNameEn: alb.artistNameEn,
          coverArt: alb.coverArt ?? null,
          releaseDate: alb.releaseDate ?? null,
          duration: alb.duration ?? 0,
          isActive: Boolean(alb.isActive ?? true),
          isFeatured: Boolean(alb.isFeatured ?? false),
          artistId: alb.artistId ?? null,
          userId: alb.userId,
          createdAt: parseDate(alb.createdAt),
          updatedAt: parseDate(alb.updatedAt),
        },
        create: {
          id: alb.id,
          name: alb.name,
          artistName: alb.artistName,
          artistNameEn: alb.artistNameEn,
          coverArt: alb.coverArt ?? null,
          releaseDate: alb.releaseDate ?? null,
          duration: alb.duration ?? 0,
          isActive: Boolean(alb.isActive ?? true),
          isFeatured: Boolean(alb.isFeatured ?? false),
          artistId: alb.artistId ?? null,
          userId: alb.userId,
          createdAt: parseDate(alb.createdAt),
          updatedAt: parseDate(alb.updatedAt),
        },
      });
    });

    // --- 5. Songs & Song Relations ---
    console.log("\n--- 5. Importing Songs ---");
    const songs = data.songs || data.Song;
    console.log("songs.le ", songs?.length);
    await importBatch("songs", songs, async (s: SongJson) => {
      const parsedLinks = parseJsonField(s.links);

      await prisma.song.upsert({
        where: { id: s.id },
        update: {
          slug: s.slug,
          title: s.title,
          titleEn: s.titleEn,
          artist: s.artist,
          artistEn: s.artistEn,
          albumName: s.albumName ?? null,
          coverArt: s.coverArt ?? null,
          year: s.year ?? 0,
          duration: s.duration ?? 0,
          uri: s.uri,
          filename: s.filename ?? null,
          index: s.index,
          lyrics: s.lyrics ?? null,
          syncedLyrics: s.syncedLyrics ?? null,
          playCount: s.playCount ?? 0,
          downloads: s.downloads ?? 0,
          isDisabled: Boolean(s.isDisabled),
          disabledDescription: s.disabledDescription ?? null,
          isActive: Boolean(s.isActive),
          isFeatured: Boolean(s.isFeatured),
          albumId: s.albumId ?? null,
          userId: s.userId,
          lyricsSource: s.lyricsSource ?? null,
          lyricsSourceUrl: s.lyricsSourceUrl ?? null,
          links: parsedLinks,
          ogg: s.ogg ?? null,
          createdAt: parseDate(s.createdAt),
          updatedAt: parseDate(s.updatedAt),
        },
        create: {
          id: s.id,
          slug: s.slug,
          title: s.title,
          titleEn: s.titleEn,
          artist: s.artist,
          artistEn: s.artistEn,
          albumName: s.albumName ?? null,
          coverArt: s.coverArt ?? null,
          year: s.year ?? 0,
          duration: s.duration ?? 0,
          uri: s.uri,
          filename: s.filename ?? null,
          index: s.index,
          lyrics: s.lyrics ?? null,
          syncedLyrics: s.syncedLyrics ?? null,
          playCount: s.playCount ?? 0,
          downloads: s.downloads ?? 0,
          isDisabled: Boolean(s.isDisabled),
          disabledDescription: s.disabledDescription ?? null,
          isActive: Boolean(s.isActive),
          isFeatured: Boolean(s.isFeatured),
          albumId: s.albumId ?? null,
          userId: s.userId,
          lyricsSource: s.lyricsSource ?? null,
          lyricsSourceUrl: s.lyricsSourceUrl ?? null,
          links: parsedLinks,
          ogg: s.ogg ?? null,
          createdAt: parseDate(s.createdAt),
          updatedAt: parseDate(s.updatedAt),
        },
      });

      if (s.artists && s.artists.length > 0) {
        for (const art of s.artists) {
          try {
            await prisma.artist.update({
              where: { id: art.id },
              data: {
                ...(art.fileId ? { fileId: art.fileId } : {}),
                ...(art.fileUniqueId ? { fileUniqueId: art.fileUniqueId } : {}),
              },
            });
          } catch {
            // ignore if artist not found
          }
        }
        await prisma.song.update({
          where: { id: s.id },
          data: {
            artists: {
              connect: s.artists.map((a) => ({ id: a.id })),
            },
          },
        });
      }

      if (s.telegram || s.post) {
        const tg = s.telegram;
        const pt = s.post;
        await prisma.telegram.upsert({
          where: { songId: s.id },
          update: {
            file_id_64: tg?.["64"]?.file_id ?? null,
            file_unique_id_64: tg?.["64"]?.file_unique_id ?? null,
            file_id_128: tg?.["128"]?.file_id ?? null,
            file_unique_id_128: tg?.["128"]?.file_unique_id ?? null,
            file_id_320: tg?.["320"]?.file_id ?? null,
            file_unique_id_320: tg?.["320"]?.file_unique_id ?? null,
            cover_art_file_id: tg?.coverArt?.file_id ?? null,
            cover_art_file_unique_id: tg?.coverArt?.file_unique_id ?? null,
            ogg_file_id: tg?.ogg?.file_id ?? null,
            ogg_file_unique_id: tg?.ogg?.file_unique_id ?? null,
            has_posted: pt?.has_posted ?? false,
            message_id: pt?.message_id ?? null,
            ogg_message_id: pt?.ogg_message_id ?? null,
          },
          create: {
            songId: s.id,
            file_id_64: tg?.["64"]?.file_id ?? null,
            file_unique_id_64: tg?.["64"]?.file_unique_id ?? null,
            file_id_128: tg?.["128"]?.file_id ?? null,
            file_unique_id_128: tg?.["128"]?.file_unique_id ?? null,
            file_id_320: tg?.["320"]?.file_id ?? null,
            file_unique_id_320: tg?.["320"]?.file_unique_id ?? null,
            cover_art_file_id: tg?.coverArt?.file_id ?? null,
            cover_art_file_unique_id: tg?.coverArt?.file_unique_id ?? null,
            ogg_file_id: tg?.ogg?.file_id ?? null,
            ogg_file_unique_id: tg?.ogg?.file_unique_id ?? null,
            has_posted: pt?.has_posted ?? false,
            message_id: pt?.message_id ?? null,
            ogg_message_id: pt?.ogg_message_id ?? null,
          },
        });
      }
    });

    const songCrews = data.songCrews || data.SongCrew;
    await importBatch("songCrews", songCrews, async (sc: SongCrewJson) => {
      await prisma.songCrew.upsert({
        where: { id: sc.id },
        update: {
          songId: sc.songId,
          role: sc.role,
          name: sc.name,
        },
        create: {
          id: sc.id,
          songId: sc.songId,
          role: sc.role,
          name: sc.name,
        },
      });
    });

    const contributors = data.contributors || data.Contributor;
    await importBatch(
      "contributors",
      contributors,
      async (c: ContributorJson) => {
        await prisma.contributor.upsert({
          where: { id: c.id },
          update: {
            songId: c.songId,
            userId: c.userId,
            type: c.type,
            percentage: c.percentage ?? 0,
            createdAt: parseDate(c.createdAt),
            updatedAt: parseDate(c.updatedAt),
          },
          create: {
            id: c.id,
            songId: c.songId,
            userId: c.userId,
            type: c.type,
            percentage: c.percentage ?? 0,
            createdAt: parseDate(c.createdAt),
            updatedAt: parseDate(c.updatedAt),
          },
        });
      }
    );

    const lyricsSuggestions = data.lyricsSuggestions || data.LyricsSuggestion;
    await importBatch(
      "lyricsSuggestions",
      lyricsSuggestions,
      async (ls: LyricsSuggestionJson) => {
        const statusValue: SuggestionStatus =
          ls.status === "APPROVED" || ls.status === "REJECTED"
            ? (ls.status as SuggestionStatus)
            : SuggestionStatus.PENDING;

        const typeValue: SuggestionType =
          ls.type === "SYNCED" ? SuggestionType.SYNCED : SuggestionType.LYRICS;

        await prisma.lyricsSuggestion.upsert({
          where: { id: ls.id },
          update: {
            songId: ls.songId,
            userId: ls.userId,
            lyrics: ls.lyrics ?? null,
            syncedLyrics: ls.syncedLyrics ?? null,
            status: statusValue,
            type: typeValue,
            lyricsSource: ls.lyricsSource ?? null,
            lyricsSourceUrl: ls.lyricsSourceUrl ?? null,
            createdAt: parseDate(ls.createdAt),
            updatedAt: parseDate(ls.updatedAt),
          },
          create: {
            id: ls.id,
            songId: ls.songId,
            userId: ls.userId,
            lyrics: ls.lyrics ?? null,
            syncedLyrics: ls.syncedLyrics ?? null,
            status: statusValue,
            type: typeValue,
            lyricsSource: ls.lyricsSource ?? null,
            lyricsSourceUrl: ls.lyricsSourceUrl ?? null,
            createdAt: parseDate(ls.createdAt),
            updatedAt: parseDate(ls.updatedAt),
          },
        });
      }
    );

    // --- 6. Playlists & User Activity ---
    console.log("\n--- 6. Importing Playlists & User Activity ---");
    const playlists = data.playlists || data.Playlist;
    await importBatch("playlists", playlists, async (p: PlaylistJson) => {
      await prisma.playlist.upsert({
        where: { id: p.id },
        update: {
          name: p.name,
          description: p.description ?? null,
          coverArt: p.coverArt ?? null,
          duration: p.duration ?? 0,
          isFavorite: Boolean(p.isFavorite),
          isDownload: Boolean(p.isDownload),
          isPrivate: Boolean(p.isPrivate),
          userId: p.userId,
          createdAt: parseDate(p.createdAt),
          updatedAt: parseDate(p.updatedAt),
        },
        create: {
          id: p.id,
          name: p.name,
          description: p.description ?? null,
          coverArt: p.coverArt ?? null,
          duration: p.duration ?? 0,
          isFavorite: Boolean(p.isFavorite),
          isDownload: Boolean(p.isDownload),
          isPrivate: Boolean(p.isPrivate),
          userId: p.userId,
          createdAt: parseDate(p.createdAt),
          updatedAt: parseDate(p.updatedAt),
        },
      });
    });

    const playlistSongs = data.playlistSongs || data.PlaylistSong;
    await importBatch(
      "playlistSongs",
      playlistSongs,
      async (ps: PlaylistSongJson) => {
        await prisma.playlistSong.upsert({
          where: {
            playlistId_songId: {
              playlistId: ps.playlistId,
              songId: ps.songId,
            },
          },
          update: {
            addedAt: parseDate(ps.addedAt) || new Date(),
          },
          create: {
            playlistId: ps.playlistId,
            songId: ps.songId,
            addedAt: parseDate(ps.addedAt) || new Date(),
          },
        });
      }
    );

    const comments = data.comments || data.Comment;
    const parentRepliesMap = new Map<string, string>();
    await importBatch("comments", comments, async (c: CommentJson) => {
      if (c.parentId) {
        parentRepliesMap.set(c.id, c.parentId);
      }
      await prisma.comment.upsert({
        where: { id: c.id },
        update: {
          content: c.content,
          userId: c.userId,
          userSlug: c.userSlug,
          songId: c.songId ?? null,
          albumId: c.albumId ?? null,
          postTitle: c.postTitle,
          isActive: Boolean(c.isActive),
          isDeleted: Boolean(c.isDeleted),
          createdAt: parseDate(c.createdAt),
          updatedAt: parseDate(c.updatedAt),
        },
        create: {
          id: c.id,
          content: c.content,
          userId: c.userId,
          userSlug: c.userSlug,
          songId: c.songId ?? null,
          albumId: c.albumId ?? null,
          postTitle: c.postTitle,
          isActive: Boolean(c.isActive),
          isDeleted: Boolean(c.isDeleted),
          parentId: null, // Set deferred after all comments exist
          createdAt: parseDate(c.createdAt),
          updatedAt: parseDate(c.updatedAt),
        },
      });
    });

    // Update deferred comment replies
    if (parentRepliesMap.size > 0) {
      for (const [commentId, parentId] of parentRepliesMap.entries()) {
        try {
          await prisma.comment.update({
            where: { id: commentId },
            data: { parentId },
          });
        } catch {}
      }
    }

    const notifications = data.notifications || data.Notification;
    await importBatch(
      "notifications",
      notifications,
      async (n: NotificationJson) => {
        await prisma.notification.upsert({
          where: { id: n.id },
          update: {
            userId: n.userId,
            type: n.type,
            title: n.title,
            message: n.message,
            link: n.link ?? null,
            isRead: Boolean(n.isRead),
            createdAt: parseDate(n.createdAt),
          },
          create: {
            id: n.id,
            userId: n.userId,
            type: n.type,
            title: n.title,
            message: n.message,
            link: n.link ?? null,
            isRead: Boolean(n.isRead),
            createdAt: parseDate(n.createdAt),
          },
        });
      }
    );

    const playHistories = data.playHistories || data.PlayHistory;
    await importBatch(
      "playHistories",
      playHistories,
      async (ph: PlayHistoryJson) => {
        await prisma.playHistory.upsert({
          where: { id: ph.id },
          update: {
            userId: ph.userId,
            songId: ph.songId,
            playedAt: parseDate(ph.playedAt) || new Date(),
          },
          create: {
            id: ph.id,
            userId: ph.userId,
            songId: ph.songId,
            playedAt: parseDate(ph.playedAt) || new Date(),
          },
        });
      }
    );

    // --- 7. Many-to-Many Relations ---
    console.log("\n--- 7. Importing Many-to-Many Relations ---");
    const importRelation = async (
      name: string,
      tableName: string,
      items: RelationLink[] | undefined,
      fallbackFn?: (item: RelationLink) => Promise<void>
    ): Promise<void> => {
      const list = items || [];
      if (list.length === 0) {
        console.log(`  ⏭️ ${name.padEnd(20)}: 0 links (Skipped)`);
        return;
      }

      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        try {
          await prisma.$executeRawUnsafe(
            `INSERT INTO \"${tableName}\" (\"A\", \"B\") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            item.A,
            item.B
          );
          successCount++;
        } catch {
          if (fallbackFn) {
            try {
              await fallbackFn(item);
              successCount++;
            } catch {
              errorCount++;
            }
          } else {
            errorCount++;
          }
        }
        logModelProgress(name, i + 1, list.length);
      }

      if (list.length > 50) {
        process.stdout.write("\n");
      }
      console.log(
        `  🔗 ${name.padEnd(20)}: ${successCount} links imported` +
          (errorCount > 0 ? `, ${errorCount} failed` : "")
      );
    };

    const artistToSong =
      relations.artistToSong ||
      relations._ArtistToSong ||
      data.artistToSong ||
      data._ArtistToSong;
    await importRelation(
      "ArtistToSong",
      "_ArtistToSong",
      artistToSong,
      async (rel: RelationLink) => {
        await prisma.song.update({
          where: { id: rel.B },
          data: { artists: { connect: { id: rel.A } } },
        });
      }
    );

    const genreToSong =
      relations.genreToSong ||
      relations._GenreToSong ||
      data.genreToSong ||
      data._GenreToSong;
    await importRelation(
      "GenreToSong",
      "_GenreToSong",
      genreToSong,
      async (rel: RelationLink) => {
        await prisma.song.update({
          where: { id: rel.B },
          data: { genres: { connect: { id: rel.A } } },
        });
      }
    );

    const albumToGenre =
      relations.albumToGenre ||
      relations._AlbumToGenre ||
      data.albumToGenre ||
      data._AlbumToGenre;
    await importRelation(
      "AlbumToGenre",
      "_AlbumToGenre",
      albumToGenre,
      async (rel: RelationLink) => {
        await prisma.album.update({
          where: { id: rel.A },
          data: { genres: { connect: { id: rel.B } } },
        });
      }
    );

    const songSimilarity =
      relations.songSimilarity ||
      relations._SongSimilarity ||
      data.songSimilarity ||
      data._SongSimilarity;
    await importRelation(
      "SongSimilarity",
      "_SongSimilarity",
      songSimilarity,
      async (rel: RelationLink) => {
        await prisma.song.update({
          where: { id: rel.A },
          data: { similarSongs: { connect: { id: rel.B } } },
        });
      }
    );

    console.log("\n=================================");
    console.log(`🎉 All Data Imported Successfully!`);
    console.log("=================================\n");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Critical error during database import:", message);
    process.exit(1);
  } finally {
    try {
      await prisma.$executeRawUnsafe(
        "SET session_replication_role = 'origin';"
      );
      console.log("🔓 Re-enabled foreign key checks.");
    } catch {}
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error("Unhandled error:", message);
  process.exit(1);
});
