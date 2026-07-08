import type { LyricVideoState } from "../../types/types";

const userStates = new Map<number, LyricVideoState>();

export function getState(userId: number): LyricVideoState | undefined {
  return userStates.get(userId);
}

export function setState(userId: number, state: LyricVideoState): void {
  userStates.set(userId, state);
}

export function clearState(userId: number): void {
  userStates.delete(userId);
}

export function isBusy(userId: number): boolean {
  const state = userStates.get(userId);
  return state?.step === "rendering";
}
