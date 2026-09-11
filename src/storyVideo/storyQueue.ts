export interface StoryJob {
  userId: number;
  chatId: number;
  songId: string;
  title: string;
  execute: () => Promise<void>;
  resolve: () => void;
  reject: (err: Error) => void;
}

const storyQueue: StoryJob[] = [];
let isProcessingStory = false;

/**
 * Enqueues a Story Video job and processes it using the story execution pipeline.
 * Completely independent of the legacy lyricVideo queue!
 */
export async function enqueueStory(job: StoryJob): Promise<number> {
  storyQueue.push(job);
  const position = storyQueue.length;

  if (!isProcessingStory) {
    void processStoryQueue();
  }

  return position;
}

async function processStoryQueue(): Promise<void> {
  if (isProcessingStory) return;
  isProcessingStory = true;

  try {
    while (storyQueue.length > 0) {
      const job = storyQueue.shift()!;
      try {
        await job.execute();
        job.resolve();
      } catch (err) {
        job.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  } finally {
    isProcessingStory = false;
  }
}

export function removeFromStoryQueue(userId: number): boolean {
  const idx = storyQueue.findIndex((job) => job.userId === userId);
  if (idx === -1) return false;
  storyQueue.splice(idx, 1);
  return true;
}

export function isStoryQueued(userId: number): boolean {
  return storyQueue.some((job) => job.userId === userId);
}

export function getStoryQueueLength(): number {
  return storyQueue.length;
}
