import * as fs from "fs/promises";
import * as path from "path";
import { prisma } from "../src/db";

function getTimestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(
    d.getHours()
  )}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

export async function exportSongsToJson(): Promise<string> {
  const songs = await prisma.song.findMany({
    orderBy: { index: "asc" },
    include: {
      telegram: true,
      artists: true,
    },
  });

  const output = songs.map(
    (song: {
      telegram: any;
      id: any;
      slug: any;
      title: any;
      titleEn: any;
      artist: any;
      artistEn: any;
      artists: any[];
      albumName: any;
      coverArt: any;
      year: any;
      duration: any;
      uri: any;
      filename: any;
      index: any;
      lyrics: any;
      syncedLyrics: any;
      playCount: any;
      isDisabled: any;
      disabledDescription: any;
      isActive: any;
      isFeatured: any;
      albumId: any;
      userId: any;
      lyricsSource: any;
      lyricsSourceUrl: any;
      links: any;
      ogg: any;
    }) => {
      const tg = song.telegram;

      return {
        id: song.id,
        slug: song.slug,
        title: song.title,
        titleEn: song.titleEn,
        artist: song.artist,
        artistEn: song.artistEn,
        artists: song.artists.map((a) => ({
          id: a.id,
          name: a.name,
          nameEn: a.nameEn,
          fileId: a.fileId,
          fileUniqueId: a.fileUniqueId,
        })),
        albumName: song.albumName,
        coverArt: song.coverArt,
        year: song.year,
        duration: song.duration,
        uri: song.uri,
        filename: song.filename,
        index: song.index,
        lyrics: song.lyrics,
        syncedLyrics: song.syncedLyrics,
        playCount: song.playCount,
        downloads: 0,
        isDisabled: song.isDisabled,
        disabledDescription: song.disabledDescription,
        isActive: song.isActive,
        isFeatured: song.isFeatured,
        albumId: song.albumId,
        userId: song.userId,
        lyricsSource: song.lyricsSource,
        lyricsSourceUrl: song.lyricsSourceUrl,
        links: song.links,
        ogg: song.ogg,
        telegram: {
          coverArt: tg?.cover_art_file_id
            ? {
                file_id: tg.cover_art_file_id,
                file_unique_id: tg.cover_art_file_unique_id || "",
              }
            : null,
          "64": tg?.file_id_64
            ? {
                file_id: tg.file_id_64,
                file_unique_id: tg.file_unique_id_64 || "",
              }
            : null,
          "128": tg?.file_id_128
            ? {
                file_id: tg.file_id_128,
                file_unique_id: tg.file_unique_id_128 || "",
              }
            : null,
          "320": tg?.file_id_320
            ? {
                file_id: tg.file_id_320,
                file_unique_id: tg.file_unique_id_320 || "",
              }
            : null,
          ogg:
            tg?.file_id_ogg || tg?.ogg_file_id
              ? {
                  file_id: (tg.file_id_ogg || tg.ogg_file_id)!,
                  file_unique_id:
                    tg.file_unique_id_ogg || tg.ogg_file_unique_id || "",
                }
              : null,
        },
        post: {
          has_posted: tg?.has_posted ?? false,
          message_id: tg?.message_id ?? null,
          ogg_message_id: tg?.ogg_message_id ?? null,
        },
      };
    }
  );

  const exportDir = path.resolve(process.cwd(), "data");
  await fs.mkdir(exportDir, { recursive: true });

  const filename = `songs-export-${getTimestamp()}.json`;
  const filePath = path.join(exportDir, filename);

  await fs.writeFile(filePath, JSON.stringify(output, null, 2), "utf8");

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
