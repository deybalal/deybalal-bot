import type {
  Song as PrismaSong,
  Artist as PrismaArtist,
} from "@prisma/client";

export interface TelegramFile {
  songId: string;
  type: string;
  quality: string;
  fileId: string;
  file_id: string;
  fileUniqueId: string;
  file_unique_id: string;
  uploadedAt?: number | Date;
}

export interface SongLinkItem {
  url: string;
  size: string;
  bytes: number;
}

export interface SongLinks {
  "64"?: SongLinkItem;
  "128"?: SongLinkItem;
  "320"?: SongLinkItem;
  [key: string]: SongLinkItem | undefined;
}

export interface Song
  extends Omit<PrismaSong, "links" | "createdAt" | "updatedAt"> {
  artists?: any;
  songIndex?: number;
  links?: SongLinks | null;
  createdAt?: number | Date;
  updatedAt?: number | Date;
  telegram?: any;
}

export interface TelegramSongWithFiles extends Song {
  telegram: {
    coverArt: TelegramFile | null;
    ogg: TelegramFile | null;
    "64": TelegramFile | null;
    "128": TelegramFile | null;
    "320": TelegramFile | null;
    message_id?: number | null;
    ogg_message_id?: number | null;
    has_posted?: boolean;
    createdAt?: number | Date;
    updatedAt?: number | Date;
  };
}

export interface Artist extends Omit<PrismaArtist, "createdAt" | "updatedAt"> {
  followers?: number;
  telegramFileId?: string | null;
  telegramFileUniqueId?: string | null;
  createdAt?: number | Date;
  updatedAt?: number | Date;
  telegram?: any;
}

export interface SearchResult {
  song: Song;
  reason: "title" | "artist" | "lyrics";
  snippet?: string;
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export type LyricVideoState = {
  songId: string;
  images: string[];
  jobDir: string;
  startMs?: number;
  endMs?: number;
  progressMessageId?: number;
  step: "waiting_images" | "waiting_range" | "rendering" | "waiting_resolution";
  resolution?: VideoResolution;
};

export type VideoResolution = "big" | "small";

export interface VideoJob {
  userId: number;
  chatId: number;

  songId: string;

  title: string;

  resolve: () => void;
  reject: (err: Error) => void;
}
