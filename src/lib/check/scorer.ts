// The check's result, a port of Kala's SkillCheckScorer. It reads only the finished package, so the
// local result and the research summary are the same numbers.

import type { FixedComposer } from '../composer.ts';
import { recipeFor } from '../recipe.ts';
import { correctGpm, fiveCharWpm, graphemes, score, SCORER_VERSION, speedQualifies, words } from '../scoring.ts';
import type { KeyRow, SessionPackage, Summary } from './recorder.ts';

export interface UnitEvidence {
  unit: string;
  correct: boolean;
  family: string;
}

export interface SlowKey {
  position: string;
  medianSeconds: number;
  samples: number;
}

export interface CheckResult {
  summary: Summary;
  speedQualifies: boolean;
  referenceUnits: number;
  responseUnits: number;
  matches: number;
  distance: number;
  words: number;
  firstTryWords: number;
  evidence: UnitEvidence[];
  problemUnits: string[];
  slowKeys: SlowKey[];
  activeSeconds: number;
}

/** BanglaText.Canonicalize: NFC, then Kala's atomic ড় ঢ় য়. */
export const canonical = (text: string) =>
  text.normalize('NFC').replaceAll('ড়', 'ড়').replaceAll('ঢ়', 'ঢ়').replaceAll('য়', 'য়');

export interface Binding {
  fresh: FixedComposer;
  units: { id: string; text: string }[];
}

/** LayoutBinding.Units: greedy longest-match layout units, or null when a character has no unit. */
function unitsOf(binding: Binding, text: string): string[] | null {
  const sorted = binding.units.map((u) => ({ id: u.id, text: canonical(u.text) })).filter((u) => u.text.length > 0).sort((a, b) => b.text.length - a.text.length);
  text = canonical(text);
  const list: string[] = [];
  for (let i = 0; i < text.length; ) {
    const unit = sorted.find((u) => text.startsWith(u.text, i));
    if (!unit) return null;
    list.push(unit.id);
    i += unit.text.length;
  }
  return list;
}

function matchingReferenceUnits(reference: string[], response: string[]): Set<number> {
  let n = reference.length;
  let m = response.length;
  const cost = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      cost[i][j] = Math.min(cost[i - 1][j - 1] + (reference[i - 1] === response[j - 1] ? 0 : 1), Math.min(cost[i - 1][j], cost[i][j - 1]) + 1);
  const matched = new Set<number>();
  while (n > 0 && m > 0) {
    if (cost[n][m] === cost[n - 1][m - 1] + (reference[n - 1] === response[m - 1] ? 0 : 1)) {
      if (reference[n - 1] === response[m - 1]) matched.add(n - 1);
      n--;
      m--;
    } else if (cost[n][m] === cost[n - 1][m] + 1) n--;
    else m--;
  }
  return matched;
}

/** Active seconds between two ticks, excluding recorded pauses. */
export function activeDuration(p: SessionPackage, start: number, end: number): number {
  let active = end - start;
  let paused: number | null = null;
  for (const b of [...p.boundaries].sort((a, c) => a.seq - c.seq)) {
    if (b.kind === 'pause') paused = b.t;
    if (b.kind === 'resume' && paused !== null) {
      active -= Math.max(0, Math.min(end, b.t) - Math.max(start, paused));
      paused = null;
    }
  }
  if (paused !== null) active -= Math.max(0, end - Math.max(start, paused));
  return Math.max(0, active) / p.clock.frequency;
}

function measuredKeys(p: SessionPackage): KeyRow[] {
  const ranges = p.prompts.filter((x) => x.measured).map((x) => ({
    start: p.boundaries.find((b) => b.kind === 'prompt-shown' && b.prompt_order === x.order)!.seq,
    end: p.boundaries.find((b) => b.kind === 'prompt-ended' && b.prompt_order === x.order)!.seq,
  }));
  return p.key_events.rows.filter((k) => ranges.some((r) => k[0] > r.start && k[0] < r.end));
}

function slowKeys(p: SessionPackage): SlowKey[] {
  const samples = new Map<string, number[]>();
  let previous: KeyRow | null = null;
  for (const key of measuredKeys(p)) {
    if (key[5] !== 0) continue;
    const position = key[7];
    if (position === null || !(position.startsWith('A') || position === 'SPCE')) continue;
    const prior = previous;
    if (prior && prior[7] !== 'SPCE' && position !== 'SPCE' &&
      !p.boundaries.some((b) => b.seq > prior[0] && b.seq < key[0] && (b.kind === 'prompt-shown' || b.kind === 'pause' || b.kind === 'layout-change'))) {
      const seconds = (key[1] - prior[1]) / p.clock.frequency;
      if (seconds > 0 && seconds <= 30) {
        if (!samples.has(position)) samples.set(position, []);
        samples.get(position)!.push(seconds);
      }
    }
    previous = key;
  }
  return [...samples].filter(([, list]) => list.length >= 5).map(([position, list]) => {
    list.sort((a, b) => a - b);
    const mid = Math.floor(list.length / 2);
    return { position, medianSeconds: list.length % 2 === 0 ? (list[mid - 1] + list[mid]) / 2 : list[mid], samples: list.length };
  }).sort((a, b) => b.medianSeconds - a.medianSeconds || (a.position < b.position ? -1 : 1)).slice(0, 3);
}

export function scoreCheck(p: SessionPackage, binding: Binding): CheckResult {
  let reference = 0, response = 0, matches = 0, distance = 0, wordCount = 0, first = 0, episodes = 0;
  const evidence: UnitEvidence[] = [];
  const responses: string[] = [];
  const plans = new Map<string, boolean>();
  const typeable = (word: string) => {
    if (!plans.has(word)) plans.set(word, recipeFor(binding.fresh, word) !== null);
    return plans.get(word)!;
  };
  for (const prompt of p.prompts.filter((x) => x.measured)) {
    const targetUnits = graphemes(prompt.target_text.normalize('NFC'));
    const attempted = prompt.end_reason === 'enter' ? prompt.target_text : targetUnits.slice(0, prompt.attempted_units).join('');
    const s = score(attempted, prompt.final_text);
    reference += s.referenceUnits;
    response += s.responseUnits;
    matches += s.matches;
    distance += s.distance;
    responses.push(prompt.final_text);
    const targetWords = words(attempted);
    const typedWords = words(prompt.final_text);
    const shown = p.boundaries.find((b) => b.kind === 'prompt-shown' && b.prompt_order === prompt.order)!;
    const ended = p.boundaries.find((b) => b.kind === 'prompt-ended' && b.prompt_order === prompt.order)!;
    const firstAttempts = new Map<number, string>();
    const edited = new Set<number>();
    let text = '';
    let editing = false;
    for (const e of p.text_events.filter((x) => x.seq > shown.seq && x.seq < ended.seq).sort((a, b) => a.seq - b.seq)) {
      if (e.op === 'selection') continue;
      const edit = e.removed.length > 0 && (e.source === 'native-key' || e.source === 'undo' || e.source === 'mouse');
      if (edit) {
        const wordIndex = text.slice(0, Math.min(e.start, text.length)).split(' ').length - 1;
        const lastWordIndex = text.slice(0, Math.min(e.end, text.length)).split(' ').length - 1;
        const current = text.split(' ');
        for (let index = wordIndex; index <= lastWordIndex; index++) {
          edited.add(index);
          if (!firstAttempts.has(index)) firstAttempts.set(index, index < current.length ? current[index] : '');
        }
        if (!editing) episodes++;
      }
      editing = edit;
      text = text.slice(0, e.start) + e.inserted + text.slice(e.end);
      const complete = text.split(' ');
      for (let i = 0; i + 1 < complete.length; i++) if (!firstAttempts.has(i)) firstAttempts.set(i, complete[i]);
    }
    targetWords.forEach((target, i) => {
      const attempt = firstAttempts.get(i) ?? (i < typedWords.length ? typedWords[i] : '');
      const correct = !edited.has(i) && score(target, attempt).distance === 0;
      wordCount++;
      if (correct) first++;
      if (!typeable(target)) return;
      // A missed cluster does not grant first-try success to its component layout units.
      const clusters = graphemes(target.normalize('NFC'));
      const aligned = matchingReferenceUnits(clusters, graphemes(attempt.normalize('NFC')));
      const units = unitsOf(binding, target) ?? [];
      const byId = new Map(binding.units.map((u) => [u.id, canonical(u.text)]));
      let offset = 0;
      const outcomes = new Map<string, boolean>();
      for (const unit of units) {
        let boundary = 0;
        let index = 0;
        for (; index < clusters.length; index++) {
          boundary += clusters[index].length;
          if (offset < boundary) break;
        }
        outcomes.set(unit, (outcomes.get(unit) ?? true) && aligned.has(index));
        offset += byId.get(unit)!.length;
      }
      for (const [unit, ok] of outcomes) evidence.push({ unit, correct: ok, family: `${prompt.prompt_id}:${i}` });
    });
  }
  const elapsedSeconds = p.prompts.filter((x) => x.measured).reduce((n, x) => n + activeDuration(p, x.shown_ticks, x.end_ticks), 0);
  const ms = elapsedSeconds * 1000;
  const qualifies = speedQualifies(ms, reference);
  const backspaces = measuredKeys(p).filter((k) => k[2] === 8 && k[5] === 0).length;
  const accuracy = reference + response === 0 ? null : 100 * Math.max(0, 1 - distance / Math.max(reference, response));
  const anchor = (stage: string) => {
    const prompt = p.prompts.find((x) => x.stage === stage);
    if (!prompt) return null;
    return fiveCharWpm(prompt.final_text, activeDuration(p, prompt.shown_ticks, prompt.end_ticks) * 1000);
  };
  const summary: Summary = {
    wpm5: qualifies ? fiveCharWpm(responses.join(' '), ms) : null,
    correct_gpm: qualifies ? correctGpm(matches, ms) : null,
    accuracy,
    first_try_accuracy: wordCount === 0 ? null : (100 * first) / wordCount,
    correction_episodes: episodes,
    backspace_presses: backspaces,
    anchor_first_wpm5: anchor('natural-1'),
    anchor_repeat_wpm5: anchor('anchor-repeat'),
    scorer: SCORER_VERSION,
  };
  const groups = new Map<string, UnitEvidence[]>();
  for (const e of evidence) groups.set(e.unit, [...(groups.get(e.unit) ?? []), e]);
  const problemUnits = [...groups].map(([unit, list]) => {
    const tries = list.length;
    const correct = list.filter((e) => e.correct).length;
    return { unit, tries, correct, missRate: tries ? (tries - correct) / tries : 0 };
  }).filter((g) => g.tries >= 10 && g.tries - g.correct >= 2 && g.correct < g.tries * 0.95)
    .sort((a, b) => b.missRate - a.missRate || (a.unit < b.unit ? -1 : 1)).slice(0, 3).map((g) => g.unit);
  return {
    summary, speedQualifies: qualifies, referenceUnits: reference, responseUnits: response, matches, distance,
    words: wordCount, firstTryWords: first, evidence, problemUnits, slowKeys: slowKeys(p), activeSeconds: p.session.active_seconds,
  };
}

