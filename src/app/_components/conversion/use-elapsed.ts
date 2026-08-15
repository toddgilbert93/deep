"use client";

import { useSyncExternalStore } from "react";

/**
 * A shared one-second ticker exposed through `useSyncExternalStore` so
 * elapsed-time displays stay hydration-safe (no `Date.now()` during render)
 * and lint-clean (no `setState` inside effects).
 */
let nowMs = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    nowMs = Date.now();
    timer = setInterval(() => {
      nowMs = Date.now();
      for (const entry of listeners) entry();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function subscribeIdle(): () => void {
  return () => undefined;
}

function getSnapshot(): number {
  return nowMs;
}

function getServerSnapshot(): number {
  return 0;
}

/**
 * Milliseconds elapsed between `startedAt` and `finishedAt` (or now while the
 * job is still running). Returns `null` before the job has started.
 */
export function useElapsed(startedAt: number | null, finishedAt: number | null): number | null {
  const ticking = startedAt !== null && finishedAt === null;
  const now = useSyncExternalStore(ticking ? subscribe : subscribeIdle, getSnapshot, getServerSnapshot);
  if (startedAt === null) return null;
  const end = finishedAt ?? now;
  return Math.max(0, end - startedAt);
}

export function formatElapsed(ms: number | null): string {
  if (ms === null) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
