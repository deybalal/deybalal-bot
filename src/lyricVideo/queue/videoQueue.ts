import type { VideoJob } from "../../../types/types";
import { executeRendering } from "../handler";

const queue: VideoJob[] = [];
let processing = false;

export async function enqueue(job: VideoJob): Promise<number> {
  queue.push(job);
  const position = queue.length;

  if (!processing) {
    void processQueue();
  }

  return position;
}

async function processQueue() {
  if (processing) return;
  processing = true;

  try {
    while (queue.length > 0) {
      const job = queue.shift()!;

      try {
        await executeRendering(job.chatId, job.userId);
        job.resolve();
      } catch (err) {
        job.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  } finally {
    processing = false;
  }
}

export function removeFromQueue(userId: number): boolean {
  const idx = queue.findIndex((job) => job.userId === userId);
  if (idx === -1) return false;
  queue.splice(idx, 1);
  return true;
}

export function isQueued(userId: number): boolean {
  return queue.some((job) => job.userId === userId);
}

export function getQueueLength(): number {
  return queue.length;
}
