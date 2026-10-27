// The course catalog: layouts, teaching paths and units imported from Kala's packs (scripts/import-kala.mjs).

import layoutsJson from '../data/layouts.json' with { type: 'json' };
import pathsJson from '../data/paths.json' with { type: 'json' };
import unitsJson from '../data/units.json' with { type: 'json' };
import coursesJson from '../data/courses.json' with { type: 'json' };
import charTypesJson from '../data/chartypes.json' with { type: 'json' };
import type { CharTypes, FixedLayout } from './composer.ts';

export type Lang = 'en' | 'bn';
export type Text = { en: string; bn: string };

export interface Layout extends FixedLayout {
  name: Text;
  tagline: Text | null;
  meaning: string | null;
  family: string | null;
  style: { code: string; name: Text; rule: string } | null;
  howToType: { en: string[]; bn: string[]; examples?: { text: string; keys: string; presses: string }[] } | null;
  sourceSha256: string;
}

export interface Module {
  id: string;
  rule: string;
  prerequisiteUnits: string[];
  targetUnits: string[];
  demonstrations: string[];
  title: Text;
  instructions: Text;
}

export interface TeachingPath {
  id: string;
  version: string;
  review: string;
  groups: string[][];
  modules: Module[];
}

export interface Unit {
  id: string;
  text: string;
  category: string;
  name: Text;
}

export interface Lesson {
  id: string;
  title: Text;
  instructions: Text;
  taskType: string;
  kinds: string[];
  assistance: string;
  scaffolding: string[];
  opportunities: number | null;
}

export const layouts = layoutsJson as unknown as Layout[];
export const paths = pathsJson as unknown as Record<string, TeachingPath>;
export const units = unitsJson as unknown as Record<string, Unit[]>;
export const courses = coursesJson as unknown as Record<string, { id: string; version: string; lessons: Lesson[] }>;
export const charTypes = charTypesJson as CharTypes;

export const layoutById = (id: string) => layouts.find((l) => l.id === id);
export const unitMap = (language: string) => new Map(units[language].map((u) => [u.id, u]));

/** A step on a layout's journey. Groups come from the teaching path; the rest from the course objectives. */
export interface JourneyStep {
  id: string; // "orientation", "g1".."gN", "words", "sentences", "passages"
  kind: 'orientation' | 'group' | 'words' | 'sentences' | 'passages';
  index: number;
  title: Text;
  subtitle: Text;
  units: string[];
}

const lessonTitle = (language: string, id: string): Text =>
  courses[language].lessons.find((l) => l.id === id)?.title ?? { en: id, bn: id };

export function journey(layoutId: string): JourneyStep[] {
  const layout = layoutById(layoutId)!;
  const path = paths[layoutId];
  const byId = unitMap(layout.language);
  const steps: JourneyStep[] = [
    {
      id: 'orientation',
      kind: 'orientation',
      index: 0,
      title: lessonTitle(layout.language, 'orientation'),
      subtitle: { en: 'How this layout types', bn: 'এই লেআউটে কীভাবে লিখবেন' },
      units: [],
    },
  ];
  path.groups.forEach((group, i) => {
    const glyphs = group.map((u) => display(byId.get(u)?.text ?? u)).join('  ');
    steps.push({
      id: `g${i + 1}`,
      kind: 'group',
      index: steps.length,
      title: { en: `Keys ${i + 1}`, bn: `কি ${toBnDigits(i + 1)}` },
      subtitle: { en: glyphs, bn: glyphs },
      units: group,
    });
  });
  for (const kind of ['words', 'sentences', 'passages'] as const) {
    steps.push({
      id: kind,
      kind,
      index: steps.length,
      title: lessonTitle(layout.language, kind),
      subtitle: {
        words: { en: 'Common words, no hints', bn: 'প্রচলিত শব্দ, সাহায্য ছাড়া' },
        sentences: { en: 'Whole sentences with punctuation', bn: 'বিরামচিহ্নসহ পূর্ণ বাক্য' },
        passages: { en: 'Literature at your own pace', bn: 'নিজের গতিতে সাহিত্য' },
      }[kind],
      units: [],
    });
  }
  return steps;
}

/** Units introduced up to and including group `upTo` (1-based). */
export function learnedUnits(layoutId: string, upTo: number): Set<string> {
  return new Set(paths[layoutId].groups.slice(0, upTo).flat());
}

/** Combining marks are shown on a dotted circle so they are visible on their own. */
export const display = (text: string) => (/^\p{M}/u.test(text) ? `◌${text}` : text);

export const toBnDigits = (n: number | string) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);
