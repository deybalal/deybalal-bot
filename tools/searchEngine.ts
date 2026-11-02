import type { CachedSong, ParsedQuery, ScoredResult } from "./searchTypes.ts";
import {
  parseQuery,
  calculateStringSimilarity,
  extractLyricSnippet,
  normalizePersian,
} from "./searchNormalizer.ts";

/**
 * Searches the in-memory cache of songs and returns ranked ScoredResult candidates
 */
export function rankSongsInMemory(
  query: string,
  cache: CachedSong[],
  limit: number = 50
): { results: ScoredResult[]; parsed: ParsedQuery; timing: { preprocess: number; ranking: number } } {
  const t0 = performance.now();
  const parsed = parseQuery(query);
  const tPreprocess = performance.now() - t0;

  if (!parsed.raw || parsed.coreTokens.length === 0 || cache.length === 0) {
    return {
      results: [],
      parsed,
      timing: { preprocess: tPreprocess, ranking: 0 },
    };
  }

  const t1 = performance.now();

  const {
    normalized,
    normalizedNoSpaces,
    cleanPhraseNorm,
    cleanPhraseNoSpaces,
    coreTokens,
    isLatin,
    rawLower,
  } = parsed;

  const isMultiWord = coreTokens.length > 1;
  const scoredCandidates: ScoredResult[] = [];

  for (let i = 0; i < cache.length; i++) {
    const song = cache[i];

    let score = 0;
    let titleHit = false;
    let artistHit = false;
    let lyricsHit = false;
    let albumHit = false;

    // ----------------------------------------------------
    // 1. EXACT MATCHES (Top Tier)
    // ----------------------------------------------------
    const isExactTitle =
      song.normTitle === normalized ||
      song.normTitle === cleanPhraseNorm ||
      (normalizedNoSpaces.length > 2 && song.noSpaceTitle === normalizedNoSpaces) ||
      (cleanPhraseNoSpaces.length > 2 && song.noSpaceTitle === cleanPhraseNoSpaces);

    const isExactArtist =
      song.normArtist === normalized ||
      song.normArtist === cleanPhraseNorm ||
      (normalizedNoSpaces.length > 2 && song.noSpaceArtist === normalizedNoSpaces) ||
      song.allArtistsNorm === normalized;

    if (isExactTitle) {
      score += 350;
      titleHit = true;
    }

    if (isExactArtist) {
      score += 260;
      artistHit = true;
    }

    if (song.normAlbum === normalized || song.normAlbum === cleanPhraseNorm) {
      score += 160;
      albumHit = true;
    }

    // Latin Exact Matches
    if (isLatin) {
      if (song.normTitleEn === rawLower) {
        score += 320;
        titleHit = true;
      }
      if (song.allArtistsEnNorm === rawLower || song.normArtistEn === rawLower) {
        score += 260;
        artistHit = true;
      }
    }

    // ----------------------------------------------------
    // 2. PREFIX MATCHES
    // ----------------------------------------------------
    if (
      song.normTitle.startsWith(normalized) ||
      song.normTitle.startsWith(cleanPhraseNorm) ||
      (isLatin && song.normTitleEn.startsWith(rawLower))
    ) {
      score += 150;
      titleHit = true;
    }

    if (
      song.allArtistsNorm.startsWith(normalized) ||
      (isLatin && song.allArtistsEnNorm.startsWith(rawLower))
    ) {
      score += 100;
      artistHit = true;
    }

    // ----------------------------------------------------
    // 3. SUBSTRING / PHRASE MATCHES
    // ----------------------------------------------------
    if (
      song.normTitle.includes(normalized) ||
      song.normTitle.includes(cleanPhraseNorm) ||
      (normalizedNoSpaces.length > 3 && song.noSpaceTitle.includes(normalizedNoSpaces)) ||
      (isLatin && song.normTitleEn.includes(rawLower))
    ) {
      score += 110;
      titleHit = true;
    }

    if (
      song.allArtistsNorm.includes(normalized) ||
      song.allArtistsNorm.includes(cleanPhraseNorm) ||
      (normalizedNoSpaces.length > 3 && song.allArtistsNoSpace.includes(normalizedNoSpaces)) ||
      (isLatin && song.allArtistsEnNorm.includes(rawLower))
    ) {
      score += 80;
      artistHit = true;
    }

    if (song.normAlbum && song.normAlbum.includes(normalized)) {
      score += 40;
      albumHit = true;
    }

    // Full phrase in lyrics
    const phraseInLyrics =
      song.normLyrics.length > 0 &&
      (song.normLyrics.includes(normalized) ||
        (cleanPhraseNorm.length >= 4 && song.normLyrics.includes(cleanPhraseNorm)));

    if (phraseInLyrics) {
      score += 60;
      lyricsHit = true;
    }

    // ----------------------------------------------------
    // 4. PER-TOKEN ANALYSIS (Multi-word support)
    // ----------------------------------------------------
    let titleTokensCount = 0;
    let artistTokensCount = 0;
    let albumTokensCount = 0;
    let lyricsTokensCount = 0;
    let totalMatchedTokens = 0;

    for (let t = 0; t < coreTokens.length; t++) {
      const token = coreTokens[t];
      const tokenNorm = normalizePersian(token);
      const tokenNoSpace = tokenNorm.replace(/\s+/g, "");
      const tokenLower = token.toLowerCase();

      const inTitle =
        song.normTitle.includes(tokenNorm) ||
        (tokenNoSpace.length > 2 && song.noSpaceTitle.includes(tokenNoSpace)) ||
        (isLatin && song.normTitleEn.includes(tokenLower));

      const inArtist =
        song.allArtistsNorm.includes(tokenNorm) ||
        (tokenNoSpace.length > 2 && song.allArtistsNoSpace.includes(tokenNoSpace)) ||
        (isLatin && song.allArtistsEnNorm.includes(tokenLower));

      const inAlbum = song.normAlbum && song.normAlbum.includes(tokenNorm);

      const inLyrics =
        tokenNorm.length >= 3 && song.normLyrics.includes(tokenNorm);

      if (inTitle) {
        titleTokensCount++;
        totalMatchedTokens++;
        score += 45;
        titleHit = true;
      } else if (inArtist) {
        artistTokensCount++;
        totalMatchedTokens++;
        score += 35;
        artistHit = true;
      } else if (inAlbum) {
        albumTokensCount++;
        totalMatchedTokens++;
        score += 20;
        albumHit = true;
      } else if (inLyrics) {
        lyricsTokensCount++;
        totalMatchedTokens++;
        score += 15;
        lyricsHit = true;
      } else {
        // Fast Levenshtein distance check against title & artist words
        let bestSim = 0;
        const candidates = song.titleWords.concat(song.allArtistsWords);
        for (let w = 0; w < candidates.length; w++) {
          const sim = calculateStringSimilarity(tokenNorm, candidates[w]);
          if (sim > bestSim) bestSim = sim;
        }

        if (bestSim >= 0.78) {
          totalMatchedTokens += bestSim;
          score += 28 * bestSim;
          titleHit = true;
        }
      }
    }

    // ----------------------------------------------------
    // 5. COMPOSITE QUERY BONUS (Artist + Title in same query)
    // ----------------------------------------------------
    if (isMultiWord && titleTokensCount > 0 && artistTokensCount > 0) {
      // User typed both artist and song name (e.g. "کوروش اسدپور دی بلال")
      score += 220;
    }

    // ----------------------------------------------------
    // 6. TOKEN COVERAGE & PENALTIES
    // ----------------------------------------------------
    const coverage =
      coreTokens.length > 0
        ? Math.min(totalMatchedTokens / coreTokens.length, 1.0)
        : 0;

    if (coverage >= 0.99) {
      score += 90; // All meaningful query tokens matched
    } else {
      score += coverage * 45;
    }

    if (isMultiWord && coverage < 0.5) {
      score -= 75; // Heavy penalty for matching fewer than half the words
    }

    // ----------------------------------------------------
    // 7. POPULARITY TIE-BREAKER (Log-scaled)
    // ----------------------------------------------------
    if (song.playCount > 0) {
      score += Math.min(Math.log10(song.playCount + 1) * 3.5, 18);
    }

    // ----------------------------------------------------
    // 8. STRICT RELEVANCE FILTERING (Drop Irrelevant Items!)
    // ----------------------------------------------------
    // Multi-token: requires at least 2 tokens matched if 3+ tokens in query
    if (coreTokens.length >= 3 && totalMatchedTokens < 2) continue;

    // Multi-token: requires at least 50% coverage
    if (isMultiWord && coverage < 0.5) continue;

    // Lyrics only: require full phrase or >= 70% coverage
    if (!titleHit && !artistHit && !isExactTitle && !isExactArtist) {
      if (!phraseInLyrics && coverage < 0.7) continue;
    }

    // Absolute minimum threshold
    if (score < 40) continue;
    if (isMultiWord && coverage < 0.75 && score < 110) continue;

    // ----------------------------------------------------
    // 9. DETERMINE REASON & SNIPPET
    // ----------------------------------------------------
    let reason: "title" | "artist" | "lyrics" = "title";
    if (titleHit || isExactTitle) {
      reason = "title";
    } else if (artistHit || isExactArtist) {
      reason = "artist";
    } else if (lyricsHit || phraseInLyrics) {
      reason = "lyrics";
    }

    let snippet: string | undefined;
    if (reason === "lyrics" || phraseInLyrics) {
      snippet = extractLyricSnippet(song.lyrics, cleanPhraseNorm || normalized);
    }

    scoredCandidates.push({
      id: song.id,
      score,
      coverage,
      titleTokensCount,
      artistTokensCount,
      reason,
      snippet,
    });
  }

  // If there are true composite matches (matching BOTH title and artist),
  // prioritize them over songs that only matched the artist alone
  const hasComposite = scoredCandidates.some(
    (c) => c.titleTokensCount > 0 && c.artistTokensCount > 0
  );

  let filteredCandidates = scoredCandidates;
  if (hasComposite && coreTokens.length >= 3) {
    const topScore = scoredCandidates.sort((a, b) => b.score - a.score)[0]?.score || 0;
    filteredCandidates = scoredCandidates.filter(
      (c) =>
        (c.titleTokensCount > 0 && c.artistTokensCount > 0) ||
        c.score >= topScore * 0.65
    );
  }

  // Sort descending by score
  filteredCandidates.sort((a, b) => b.score - a.score);

  const tRanking = performance.now() - t1;

  return {
    results: filteredCandidates.slice(0, limit),
    parsed,
    timing: { preprocess: tPreprocess, ranking: tRanking },
  };
}
