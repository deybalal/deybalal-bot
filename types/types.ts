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

export interface Song {
  id: string;
  slug: string;
  title: string;
  titleEn?: string | null;
  artist: string;
  artistEn?: string | null;
  artists?: any;
  albumName?: string | null;
  coverArt?: string | null;
  year: number;
  duration: number;
  uri: string;
  filename?: string | null;
  songIndex?: number;
  index?: number;
  lyrics?: string | null;
  syncedLyrics?: string | null;
  playCount: number;
  downloads?: number;
  isDisabled: boolean | number;
  disabledDescription?: string | null;
  isActive: boolean | number;
  isFeatured: boolean | number;
  albumId?: string | null;
  userId?: string;
  lyricsSource?: string | null;
  lyricsSourceUrl?: string | null;
  ogg?: string | null;
  links?: any;
  createdAt?: number | Date;
  updatedAt?: number | Date;
}

export interface TelegramSongWithFiles extends Song {
  telegram: {
    coverArt: TelegramFile | null;
    ogg: TelegramFile | null;
    "64": TelegramFile | null;
    "128": TelegramFile | null;
    "320": TelegramFile | null;
  };
}

export interface Artist {
  id: string;
  name: string;
  nameEn?: string | null;
  image?: string | null;
  isVerified?: boolean | number;
  ig?: string | null;
  description?: string | null;
  followers?: number;
  telegramFileId?: string | null;
  telegramFileUniqueId?: string | null;
  fileId?: string | null;
  fileUniqueId?: string | null;
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
