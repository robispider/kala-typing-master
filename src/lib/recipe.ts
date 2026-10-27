// Key recipes: the shortest key sequence that types a target from the current state.
// Found by replaying candidate keys through the composer itself (as KalaLayoutSources validates
// recipes against the real decoder), so contextual vowels and sequences are always taught correctly.

import { apply, type FixedComposer } from './composer.ts';
import { BACKSPACE, SPACE } from './keys.ts';

export interface KeyAction {
  vk: number;
  shift: boolean;
}

export interface Step extends KeyAction {
  /** Text after this press. */
  text: string;
}

const commonPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

/** All keys that produce something on this layout, normal layer first (fewer modifiers preferred). */
export function actionsOf(composer: FixedComposer): KeyAction[] {
  const actions: KeyAction[] = [];
  for (const shift of [false, true]) {
    const layer = shift ? composer.layout.shift : composer.layout.normal;
    for (const [vk, ch] of Object.entries(layer)) {
      if (ch && Number(vk) !== SPACE) actions.push({ vk: Number(vk), shift });
    }
  }
  return actions;
}

/** Backspace in the practice field deletes one code unit and restarts composition after the kept text. */
export function press(composer: FixedComposer, text: string, action: KeyAction): string {
  if (action.vk === BACKSPACE) {
    const kept = text.slice(0, -1);
    composer.continueAfter(kept);
    return kept;
  }
  return apply(text, composer.translate(action.vk, action.shift));
}

const BEAM = 200;

const VOWEL_OF_SIGN: Record<string, string> = {
  'া': 'আ', 'ি': 'ই', 'ী': 'ঈ', 'ু': 'উ', 'ূ': 'ঊ', 'ৃ': 'ঋ', 'ে': 'এ', 'ৈ': 'ঐ', 'ো': 'ও', 'ৌ': 'ঔ',
};
const producibleCache = new WeakMap<object, Set<string>>();

/**
 * Keys worth trying for this target: those producing one of its characters, the parts of sequences
 * (and, for context vowels, the signs) that produce one, hasant, and Backspace when the text has gone wrong.
 */
function relevantActions(composer: FixedComposer, target: string, text: string): KeyAction[] {
  const layout = composer.layout;
  const wanted = new Set(target);
  for (const ch of [...Object.values(layout.normal), ...Object.values(layout.shift)]) {
    if (ch && [...ch.normalize('NFC')].every((c) => wanted.has(c))) wanted.add(ch);
  }
  for (const [keys, out] of Object.entries(layout.sequences)) if ([...out].some((c) => wanted.has(c))) for (const c of keys) wanted.add(c);
  if (layout.contextVowels) for (const [sign, vowel] of Object.entries(VOWEL_OF_SIGN)) if (wanted.has(vowel)) wanted.add(sign);
  wanted.add('্');
  const actions = actionsOf(composer).filter((a) => {
    const ch = composer.charOf(a.vk, a.shift) ?? '';
    return wanted.has(ch) || [...ch].some((c) => wanted.has(c));
  });
  if (text.length > 0) actions.push({ vk: BACKSPACE, shift: false });
  return actions;
}

/** Code points a layout can produce: its keys, its sequence outputs and (style D) independent vowels. */
function producibleOf(composer: FixedComposer): Set<string> {
  const layout = composer.layout;
  let set = producibleCache.get(layout);
  if (!set) {
    const all = [...Object.values(layout.normal), ...Object.values(layout.shift), ...Object.values(layout.sequences)];
    if (layout.contextVowels) all.push(...Object.values(VOWEL_OF_SIGN));
    set = new Set(all.flatMap((s) => [...s, ...s.normalize('NFC')]));
    producibleCache.set(layout, set);
  }
  return set;
}

interface Node {
  composer: FixedComposer;
  text: string;
  steps: Step[];
}

/**
 * Breadth-first search for the fewest presses turning `text` into `target`. Includes Backspace,
 * so a learner who went wrong is shown how to recover. Returns null when the layout cannot type it.
 */
export function solve(start: FixedComposer, text: string, reference: string, maxNodes = 40000): Step[] | null {
  // Layouts emit precomposed য়/ড়/ঢ়, which NFC decomposes; compare in NFC on both sides, as the scorer does.
  const target = reference.normalize('NFC');
  if (text.normalize('NFC') === target) return [];
  const producible = producibleOf(start);
  for (const ch of target) if (!producible.has(ch)) return null;
  const actions = relevantActions(start, target, text);
  const seen = new Set<string>([`${text}\u0002${start.stateKey()}`]);
  let frontier: Node[] = [{ composer: start.clone(), text, steps: [] }];
  const maxDepth = target.length * 3 + text.length + 4;
  let explored = 0;
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      for (const action of actions) {
        if (action.vk === BACKSPACE && node.text.length === 0) continue;
        const composer = node.composer.clone();
        const out = press(composer, node.text, action);
        // Keep only states that stay close to the target: at most one unit past the shared prefix
        // (a hasant or sign that a following key rewrites), or a learner's own mistakes being removed.
        const norm = out.normalize('NFC');
        const shared = commonPrefix(norm, target);
        const before = node.text.normalize('NFC');
        if (norm.length - shared > Math.max(1, before.length - commonPrefix(before, target))) continue;
        const key = `${out}\u0002${composer.stateKey()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const steps = [...node.steps, { ...action, text: out }];
        if (norm === target) return steps;
        next.push({ composer, text: out, steps });
        if (++explored > maxNodes) return null;
      }
    }
    // Prefer states that already share more of the target; keep a bounded beam.
    next.sort((a, b) => commonPrefix(b.text.normalize('NFC'), target) - commonPrefix(a.text.normalize('NFC'), target));
    frontier = next.slice(0, BEAM);
  }
  return null;
}

/** Recipe for a word typed from a fresh composer (after Space). */
export function recipeFor(fresh: FixedComposer, word: string): Step[] | null {
  const composer = fresh.clone();
  composer.reset();
  return solve(composer, '', word);
}
