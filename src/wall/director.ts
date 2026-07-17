/**
 * The server-side playout director — authoritative pacing so every wall swaps
 * the paced canvas at the same instant (design D5).
 *
 * Scope discipline (design D6): pacing applies ONLY to paced canvas slots. A
 * `latest` swap on a *visual* is what the director governs; text lanes, scroll
 * logs, and anything carrying `priority:"immediate"` bypass it and broadcast at
 * once. This module is pure: it decides *whether* to swap and to *what*, given
 * the clock as an argument, so it can be unit-tested without timers.
 */

import type { Pacing } from "./types.js";

/** A candidate visual competing for a paced canvas: its id and when it arrived. */
export interface Candidate {
  id: string;
  /** Monotonic arrival time (ms). */
  at: number;
}

/** The director's state for one paced canvas (one category's canvas slot). */
export interface CanvasState {
  /** The visual currently shown, and when it was swapped in. */
  current?: { id: string; shownAt: number };
  /** Newer visuals seen since `current` was shown, oldest first. */
  pending: Candidate[];
}

export function emptyCanvas(): CanvasState {
  return { pending: [] };
}

/** A newer visual has become a candidate to show on this canvas. */
export function offerCandidate(state: CanvasState, id: string, now: number): void {
  // A reset to the same id (or the currently shown id) is not a new candidate.
  if (state.current?.id === id) return;
  if (state.pending.some((c) => c.id === id)) return;
  state.pending.push({ id, at: now });
}

/**
 * Decide the next swap for a paced canvas, or null to hold.
 *
 * Rules (spec "Latest behavior with pacing"):
 *  - minimum dwell: keep the current item at least `minDwellMs`;
 *  - freshness gate: only swap when a fresher candidate exists — if none, hold;
 *  - the swap target is the newest pending candidate (most recent wins).
 * The caller applies the returned swap and emits a `show` command to all walls.
 */
export function nextSwap(state: CanvasState, pacing: Pacing, now: number): string | null {
  if (state.pending.length === 0) return null; // nothing fresher → hold
  if (state.current) {
    const dwelled = now - state.current.shownAt;
    if (dwelled < pacing.minDwellMs) return null; // still within dwell → hold
  }
  return state.pending[state.pending.length - 1].id; // newest candidate
}

/** Record that `id` is now shown, clearing any candidate at or before it. */
export function commitSwap(state: CanvasState, id: string, now: number): void {
  state.current = { id, shownAt: now };
  state.pending = state.pending.filter((c) => c.id !== id);
}

/**
 * An immediate override (a `show` command with priority, or a direct swap) puts
 * `id` on screen right now, ignoring the remaining dwell. Returns nothing — the
 * caller broadcasts the swap.
 */
export function overrideSwap(state: CanvasState, id: string, now: number): void {
  commitSwap(state, id, now);
}
