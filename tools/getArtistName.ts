import type { Artist } from "../types/types";
import { readFile } from "fs/promises";

export async function getArtistById(artistId: string): Promise<Artist | null> {
  const raw = await readFile("./data/artists.json", "utf-8");
  const artists = JSON.parse(raw) as Artist[];
  return artists.find((artist) => artist.id === artistId) || null;
}
