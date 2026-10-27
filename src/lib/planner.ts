// Session planning: which items a learner types in each journey step.
// Groups follow the teaching path (meet the new keys → path modules → guided words → recall),
// mirroring the course's scaffolding levels: demonstrate, prompted, independent.

import { journey, layoutById, learnedUnits, paths, unitMap, type Module, type Text, type Unit } from './catalog.ts';
import type { Progress } from './store.ts';
import { layoutProgress, mastery } from './store.ts';

export type Assist = 'demonstrate' | 'prompted' | 'independent';

export interface Item {
  text: string;
  assist: Assist;
  units: string[];
  credit?: { author: string; title: string; collection: string | null; source?: string };
}

export interface Phase {
  id: string;
  title: Text;
  instructions: Text;
  items: Item[];
  module?: Module;
  gate?: boolean; // accuracy here decides whether the step is complete
}

export interface WordsData {
  units: string[];
  words: [string, number[]][];
  sentences: string[];
  passages: string[];
}

export interface PunctuationItem {
  text: string;
  tag: string;
}

/** Deterministic shuffle so a refreshed page plans the same session within a day. */
function shuffled<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const seedOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function pick<T>(list: T[], n: number, seed: number): T[] {
  if (list.length === 0) return [];
  const out: T[] = [];
  let round = 0;
  while (out.length < n) out.push(...shuffled(list, seed + round++).slice(0, n - out.length));
  return out;
}

interface PoolWord {
  text: string;
  units: string[];
}

function pool(data: WordsData, allowed: Set<string>): PoolWord[] {
  return data.words
    .map(([text, idx]) => ({ text, units: idx.map((i) => data.units[i]) }))
    .filter((w) => w.units.length > 0 && w.units.every((u) => allowed.has(u)));
}

/**
 * Short drills from learned units when real words are still scarce (early steps): letter runs for
 * English, consonant + sign syllables for Bangla. Every drill uses at least one new unit.
 */
function drills(learned: Set<string>, fresh: string[], byId: Map<string, Unit>, n: number, seed: number): PoolWord[] {
  const known = [...learned].map((id) => byId.get(id)).filter((u): u is Unit => !!u);
  const bases = known.filter((u) => u.category === 'letter' || u.category === 'consonant' || u.category === 'vowel');
  const signs = known.filter((u) => u.category === 'vowel-sign' || u.category === 'sign');
  const out: PoolWord[] = [];
  let s = seed;
  const rnd = (k: number) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s % k;
  };
  for (let i = 0; i < n * 4 && out.length < n && bases.length; i++) {
    const parts: Unit[] = [];
    const length = 2 + rnd(3);
    for (let j = 0; j < length; j++) {
      const base = bases[rnd(bases.length)];
      if (j > 0 && base.category === 'vowel') continue; // independent vowels start a word
      parts.push(base);
      if (signs.length && base.category === 'consonant' && rnd(2)) parts.push(signs[rnd(signs.length)]);
    }
    if (parts.length < 2 || !parts.some((u) => fresh.includes(u.id))) continue;
    out.push({ text: parts.map((u) => u.text).join(''), units: [...new Set(parts.map((u) => u.id))] });
  }
  return out;
}

export function planStep(
  layoutId: string,
  stepId: string,
  data: WordsData,
  punctuation: PunctuationItem[],
  progress: Progress,
): Phase[] {
  const layout = layoutById(layoutId)!;
  const path = paths[layoutId];
  const step = journey(layoutId).find((s) => s.id === stepId)!;
  const byId = unitMap(layout.language);
  const seed = seedOf(`${layoutId}:${stepId}:${new Date().toDateString()}`);
  const evidence = layoutProgress(progress, layoutId).units;

  if (step.kind === 'orientation') {
    const examples = layout.howToType?.examples?.map((e) => e.text) ??
      (layout.language === 'en' ? ['fj', 'jf', 'dk', 'sl', 'fjdk', 'jfkd'] : path.modules.flatMap((m) => m.demonstrations).slice(0, 4));
    return [{
      id: 'orientation',
      title: { en: 'How this layout types', bn: 'এই লেআউটে কীভাবে লিখবেন' },
      instructions: {
        en: 'Watch the highlighted key and press it. Each word shows its key sequence. Press Space after each word.',
        bn: 'আলোকিত কি দেখে চাপুন। প্রতিটি শব্দের নিচে কি-ক্রম দেখানো আছে। প্রতিটি শব্দের পরে স্পেস চাপুন।',
      },
      items: examples.map((text) => ({ text, assist: 'demonstrate', units: [] })),
    }];
  }

  if (step.kind === 'group') {
    const k = Number(stepId.slice(1));
    const learned = learnedUnits(layoutId, k);
    const fresh = path.groups[k - 1];
    const real = pool(data, learned);
    const realWithNew = real.filter((w) => w.units.some((u) => fresh.includes(u)));
    const extra = realWithNew.length < 8 ? drills(learned, fresh, byId, 12, seed + 3) : [];
    const words = [...real, ...extra];
    const withNew = [...realWithNew, ...extra];
    const consonant = [...learned].map((u) => byId.get(u)).find((u) => u?.category === 'consonant')?.text ?? 'ক';
    const meet: Item[] = [];
    for (const id of fresh) {
      const unit = byId.get(id);
      if (!unit) continue;
      const shortest = withNew.filter((w) => w.units.includes(id)).sort((a, b) => a.text.length - b.text.length);
      if (unit.category === 'vowel-sign' || unit.category === 'sign') meet.push({ text: consonant + unit.text, assist: 'demonstrate', units: [id] });
      else if (id !== 'hasanta' && unit.category !== 'punctuation') meet.push({ text: unit.text, assist: 'demonstrate', units: [id] });
      const example = shortest[0] ?? shortest[1];
      if (example) meet.push({ text: example.text, assist: 'demonstrate', units: example.units });
      else if (unit.category === 'punctuation') meet.push({ text: unit.text, assist: 'demonstrate', units: [id] });
    }
    const phases: Phase[] = [{
      id: 'meet',
      title: { en: 'Meet the new keys', bn: 'নতুন কি-গুলোর সাথে পরিচয়' },
      instructions: {
        en: 'Each new letter is shown with the finger and key that type it. Follow the highlight.',
        bn: 'প্রতিটি নতুন অক্ষরের কি ও আঙুল দেখানো আছে। আলো অনুসরণ করুন।',
      },
      items: meet,
    }];
    for (const module of path.modules) {
      const ready = module.targetUnits.every((u) => learned.has(u)) && module.targetUnits.some((u) => fresh.includes(u));
      if (!ready) continue;
      const tag = module.id.startsWith('punctuation.') ? module.id.slice('punctuation.'.length) : null;
      const practice = tag ? pick(punctuation.filter((p) => p.tag === tag), 3, seed).map((p) => p.text) : [];
      phases.push({
        id: `module:${module.id}`,
        title: module.title,
        instructions: module.instructions,
        module,
        items: [
          ...module.demonstrations.map((text) => ({ text, assist: 'demonstrate' as const, units: module.targetUnits })),
          ...practice.map((text) => ({ text, assist: 'prompted' as const, units: module.targetUnits })),
        ],
      });
    }
    const weight = (w: PoolWord) =>
      w.units.reduce((s, u) => s + (fresh.includes(u) ? 3 : mastery(evidence[u]) < 2 ? 2 : 1), 0) / w.units.length;
    const recallPool = words.length >= 6 ? words : [...words, ...withNew];
    const weighted = recallPool.flatMap((w) => Array(Math.round(weight(w))).fill(w) as PoolWord[]);
    phases.push(
      {
        id: 'guided',
        title: { en: 'Words with the new keys', bn: 'নতুন কি দিয়ে শব্দ' },
        instructions: {
          en: 'The key lights up if you pause. Press Space after each word.',
          bn: 'থেমে গেলে কি আলোকিত হবে। প্রতিটি শব্দের পরে স্পেস চাপুন।',
        },
        items: pick(withNew.length ? withNew : words, 8, seed + 1).map((w) => ({ text: w.text, assist: 'prompted', units: w.units })),
      },
      {
        id: 'recall',
        title: { en: 'From memory', bn: 'মনে রেখে' },
        instructions: {
          en: 'No highlights now. Press Tab if you need a hint. 90% accuracy completes this step.',
          bn: 'এখন কোনো আলো নেই। সাহায্য লাগলে Tab চাপুন। ৯০% নির্ভুলতায় ধাপটি সম্পূর্ণ হবে।',
        },
        items: pick(weighted, 12, seed + 2).map((w) => ({ text: w.text, assist: 'independent', units: w.units })),
        gate: true,
      },
    );
    return phases.filter((p) => p.items.length > 0);
  }

  const all = learnedUnits(layoutId, path.groups.length);
  const words = pool(data, all);
  if (step.kind === 'words') {
    return [{
      id: 'words',
      title: step.title,
      instructions: { en: 'Common words from memory. Press Tab for a hint.', bn: 'প্রচলিত শব্দ মনে রেখে লিখুন। সাহায্যের জন্য Tab চাপুন।' },
      items: pick(words.length ? words : pool(data, new Set(data.units)), 30, seed).map((w) => ({ text: w.text, assist: 'independent', units: w.units })),
      gate: true,
    }];
  }
  if (step.kind === 'sentences') {
    return [{
      id: 'sentences',
      title: step.title,
      instructions: { en: 'Type each sentence, including its punctuation.', bn: 'বিরামচিহ্নসহ প্রতিটি বাক্য লিখুন।' },
      items: pick(data.sentences, 8, seed).map((text) => ({ text, assist: 'independent', units: [] })),
      gate: true,
    }];
  }
  return [{
    id: 'passages',
    title: step.title,
    instructions: { en: 'A longer passage. Speed counts after a minute and 100 letters.', bn: 'একটি দীর্ঘ অনুচ্ছেদ। এক মিনিট ও ১০০ অক্ষরের পরে গতি গণনা হয়।' },
    items: pick(data.passages, 1, seed).map((text) => ({ text, assist: 'independent', units: [] })),
    gate: true,
  }];
}
