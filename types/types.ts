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
  has_posted: number;
  message_id?: number | null;
  ogg_message_id?: number | null;
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

export type ExportedSong = {
  links: any;
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
  post: {
    has_posted: boolean;
    message_id?: number | null;
    ogg_message_id?: number | null;
  };
  albumName?: string | null;
  coverArt: string;
  year: number;
  duration: number;
  uri: string;
  filename: string;
  index: number;
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

  telegram?: {
    "320": {
      file_id: string;
      file_unique_id: string;
    };
    "128": {
      file_id: string;
      file_unique_id: string;
    };
    "64": {
      file_id: string;
      file_unique_id: string;
    };
    coverArt: {
      file_id: string;
      file_unique_id: string;
    };
    ogg: {
      file_id: string;
      file_unique_id: string;
    };
  };
};

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

export interface Artist {
  id: string;

  name: string;
  nameEn?: string;

  image?: string;

  isVerified: boolean;

  ig?: string;
  description?: string;

  followers: number;

  telegram?: {
    fileId: string;
    fileUniqueId: string;
  };
}

export interface VideoJob {
  userId: number;
  chatId: number;

  songId: string;

  title: string;

  resolve: () => void;
  reject: (err: Error) => void;
}
