export type StoryLyricsType = "synced" | "simple";

export interface StoryVideoState {
  songId: string;
  jobDir: string;
  images: string[];
  step:
    | "waiting_source"
    | "waiting_images"
    | "waiting_resolution"
    | "rendering";
  startMs: number;
  endMs: number;
  lyricsType: StoryLyricsType;
  resolution?: "big" | "small";
  progressMessageId?: number;
}

const storyStates = new Map<number, StoryVideoState>();

export function getStoryState(userId: number): StoryVideoState | undefined {
  return storyStates.get(userId);
}

export function setStoryState(userId: number, state: StoryVideoState): void {
  storyStates.set(userId, state);
}

export function clearStoryState(userId: number): void {
  storyStates.delete(userId);
}

export function isStoryBusy(userId: number): boolean {
  const state = storyStates.get(userId);
  return state?.step === "rendering";
}
