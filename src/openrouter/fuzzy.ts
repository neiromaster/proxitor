import type { OpenRouterModel } from './types.js';

// Scoring weights — tuned to mirror fzf/fzy intuition: a compact run of
// consecutive matches aligned to a word boundary beats a scattered interior
// subsequence. Relative ordering (not the absolute numbers) is what matters.
const SCORE_MATCH = 16;
const BONUS_BOUNDARY = 7;
const BONUS_CONSECUTIVE = 10;
const PENALTY_GAP = 1; // per skipped character between two matched positions

const DELIMITERS = new Set(['/', '-', '_', '.', ' ']);
const NINF = Number.NEGATIVE_INFINITY;

function newRow(length: number): number[] {
  return Array.from({ length }, () => NINF);
}

function isBoundary(target: string, index: number): boolean {
  return index === 0 || DELIMITERS.has(target[index - 1] ?? '');
}

/**
 * Best score for carrying the first `i` query chars forward into a match placed
 * at target index `j` — i.e. the strongest preceding run plus gap/penalty math.
 * Does not include the score for the char placed at `j` itself.
 */
function bestLink(prev: number[], i: number, j: number): number {
  let best = NINF;
  for (let k = i - 1; k < j; k++) {
    const base = prev[k] ?? NINF;
    if (base === NINF) continue;
    const gap = j - k - 1;
    const consecutive = gap === 0 ? BONUS_CONSECUTIVE : 0;
    const score = base - gap * PENALTY_GAP + consecutive;
    if (score > best) best = score;
  }
  return best;
}

/** One DP row: best scores matching q[0..i] with q[i] placed in target `t`. */
function computeRow(t: string, q: string, i: number, prev: number[]): number[] {
  const curr = newRow(t.length);
  const qi = q[i] ?? '';
  const maxJ = t.length - (q.length - i - 1); // leave room for remaining chars
  for (let j = i; j < maxJ; j++) {
    if (t[j] !== qi) continue;
    const placed = SCORE_MATCH + (isBoundary(t, j) ? BONUS_BOUNDARY : 0);
    if (i === 0) {
      curr[j] = placed;
      continue;
    }
    const link = bestLink(prev, i, j);
    curr[j] = link === NINF ? NINF : link + placed;
  }
  return curr;
}

function rowMax(row: number[]): number {
  let best = NINF;
  for (let j = 0; j < row.length; j++) {
    const value = row[j] ?? NINF;
    if (value > best) best = value;
  }
  return best;
}

/**
 * Score `query` against `target` using fuzzy subsequence matching.
 *
 * Returns `null` when `query` is not a subsequence of `target`
 * (case-insensitive). Otherwise returns a non-negative score where higher
 * numbers indicate a better — more compact, boundary-aligned — match.
 *
 * A forward Smith-Waterman-style DP maximizes over every valid subsequence
 * alignment, so the best run of consecutive/boundary matches always wins.
 */
export function fuzzyScore(target: string, query: string): number | null {
  const t = target.toLowerCase();
  const q = query.toLowerCase();
  const m = q.length;
  const n = t.length;
  if (m === 0) return 0;
  if (m > n) return null;

  let prev = newRow(n);
  for (let i = 0; i < m; i++) {
    prev = computeRow(t, q, i, prev);
  }

  const best = rowMax(prev);
  return best === NINF ? null : best;
}

/**
 * Rank models by fuzzy relevance to `query`, best match first.
 *
 * Models that do not contain `query` as a subsequence of `${id} ${name}` are
 * dropped. An empty query returns every model in its original order. Generic in
 * `T` so callers keep their full element type (the full `OpenRouterModel` at
 * the call sites, a two-field literal in tests).
 */
export function rankModels<T extends Pick<OpenRouterModel, 'id' | 'name'>>(
  models: T[],
  query: string,
): T[] {
  const q = query.trim();
  if (!q) return models;

  return models
    .map(model => ({ model, score: fuzzyScore(`${model.id} ${model.name}`, q) }))
    .filter((entry): entry is { model: T; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.model);
}
