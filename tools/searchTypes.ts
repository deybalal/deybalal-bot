export interface CachedArtist {
  id: string;
  name: string;
  nameEn?: string | null;
}

export interface CachedSong {
  id: string;
  title: string;
  titleEn: string;
  artist: string;
  artistEn: string;
  albumName: string | null;
  lyrics: string | null;
  playCount: number;
  index: number;
  artists: CachedArtist[];

  // Precomputed normalized fields
  normTitle: string;
  normTitleEn: string;
  noSpaceTitle: string;
  titleWords: string[];

  normArtist: string;
  normArtistEn: string;
  noSpaceArtist: string;
  artistWords: string[];

  allArtistsNorm: string;
  allArtistsEnNorm: string;
  allArtistsNoSpace: string;
  allArtistsWords: string[];

  normAlbum: string;
  albumWords: string[];

  // Cleaned plain-text lyrics snippet index
  normLyrics: string;
}

export interface ParsedQuery {
  raw: string;
  normalized: string;
  normalizedNoSpaces: string;
  cleanPhrase: string;
  cleanPhraseNorm: string;
  cleanPhraseNoSpaces: string;
  allTokens: string[];
  coreTokens: string[];
  isLatin: boolean;
  rawLower: string;
}

export interface ScoredResult {
  id: string;
  score: number;
  coverage: number;
  reason: "title" | "artist" | "lyrics";
  titleTokensCount: number;
  artistTokensCount: number;
  snippet?: string;
}
