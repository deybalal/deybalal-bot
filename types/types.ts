export type Song = {
  id: string;
  slug: string;
  title: string;
  titleEn?: string | null;
  artist: string;
  artistEn?: string | null;
  artists: {
    id: string;
    name: string;
    nameEn: string;
    fileId?: string;
    uniqueFileId?: string;
  }[];
  albumName?: string | null;
  coverArt: string;
  year: number;
  duration: number;
  uri: string;
  filename: string;
  songIndex: number;
  lyrics?: string | null;
  syncedLyrics?: string | null;
  playCount: number;
  downloads: number;
  isDisabled: boolean;
  disabledDescription?: string | null;
  isActive: boolean;
  isFeatured: boolean;
  albumId?: string | null;
  userId?: string | null;
  lyricsSource?: string | null;
  lyricsSourceUrl?: string | null;
  ogg: string;
  tempFilename?: string | null;
  link64?: string | null;
  bytes64?: number | null;
  link128?: string | null;
  bytes128?: number | null;
  link320?: string | null;
  bytes320?: number | null;
  createdAt: number;
  updatedAt: number;
};

export type TelegramFile = {
  songId: string;
  type: string;
  quality?: string | null;
  fileId?: string | null;
  fileUniqueId?: string | null;
  uploadedAt?: number | null;
};

export type TelegramSongWithFiles = Song & {
  telegram: {
    coverArt: TelegramFile | null;
    ogg: TelegramFile | null;
    "64": TelegramFile | null;
    "128": TelegramFile | null;
    "320": TelegramFile | null;
  };
};

export type Artist = {
  id: string;
  name: string;
  nameEn?: string | null;
  slug: string;
  description?: string | null;
  image?: string | null;
  createdAt: number;
  updatedAt: number;
  telegram?: {
    fileId: string;
    fileUniqueId: string;
  };
};
