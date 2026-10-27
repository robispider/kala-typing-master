// Learner progress, kept only in this browser (localStorage). No account, no server.
// Saves report failure visibly; a JSON backup can be downloaded and restored.

export const STORE_KEY = 'kala-learn:v1';
export const SCHEMA = 1;

export interface UnitEvidence {
  seen: number; // attempts at words containing the unit
  correct: number; // correct, any assistance
  independent: number; // correct with no hint and no correction
  lastAt: number;
}

export interface SessionRecord {
  at: number;
  layout: string;
  step: string;
  ms: number;
  accuracy: number;
  gpm: number | null;
  wpm: number | null;
  qualified: boolean;
  units: number;
}

export interface LayoutProgress {
  completed: string[]; // journey step ids
  best: Record<string, number>; // step id -> best accuracy
  units: Record<string, UnitEvidence>;
  keyErrors: Record<string, number>; // vk (with "s" suffix for Shift) -> wrong presses where this key was expected
  reading?: { author: string; work: string; item: number };
}

export interface Progress {
  schema: number;
  scorer: string;
  createdAt: number;
  layout: string | null;
  lang: 'en' | 'bn';
  settings: { hints: boolean; keyboard: boolean; theme: 'auto' | 'light' | 'dark' };
  layouts: Record<string, LayoutProgress>;
  sessions: SessionRecord[];
  days: Record<string, number>; // yyyy-mm-dd -> active ms
}

const fresh = (): Progress => ({
  schema: SCHEMA,
  scorer: 'kala-grapheme-v1',
  createdAt: Date.now(),
  layout: null,
  lang: 'en',
  settings: { hints: true, keyboard: true, theme: 'auto' },
  layouts: {},
  sessions: [],
  days: {},
});

let cache: Progress | null = null;
type Listener = (error: string | null) => void;
const listeners = new Set<Listener>();
export const onSave = (fn: Listener) => listeners.add(fn);

function upgrade(raw: unknown): Progress {
  const base = fresh();
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Partial<Progress>;
  if (p.schema !== SCHEMA) return base;
  return { ...base, ...p, settings: { ...base.settings, ...p.settings } };
}

export function load(): Progress {
  if (cache) return cache;
  try {
    cache = upgrade(JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null'));
  } catch {
    cache = fresh();
  }
  return cache;
}

export function save(p: Progress = load()) {
  cache = p;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
    listeners.forEach((fn) => fn(null));
    return true;
  } catch (e) {
    listeners.forEach((fn) => fn(e instanceof Error ? e.message : String(e)));
    return false;
  }
}

export function layoutProgress(p: Progress, layout: string): LayoutProgress {
  return (p.layouts[layout] ??= { completed: [], best: {}, units: {}, keyErrors: {} });
}

export const today = () => new Date().toLocaleDateString('en-CA');

export function streak(p: Progress): number {
  let n = 0;
  const d = new Date();
  if (!p.days[today()]) d.setDate(d.getDate() - 1);
  while (p.days[d.toLocaleDateString('en-CA')]) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** 0 new, 1 practising, 2 confident, 3 mastered. */
export function mastery(e: UnitEvidence | undefined): 0 | 1 | 2 | 3 {
  if (!e || e.seen === 0) return 0;
  const ratio = e.correct / e.seen;
  if (e.independent >= 4 && ratio >= 0.9) return 3;
  if (e.independent >= 2 && ratio >= 0.75) return 2;
  return 1;
}

export function exportBackup(): string {
  return JSON.stringify({ app: 'kala-learn-web', exportedAt: new Date().toISOString(), progress: load() }, null, 2);
}

export function importBackup(json: string): Progress {
  const data = JSON.parse(json);
  if (data?.app !== 'kala-learn-web' || data.progress?.schema !== SCHEMA) {
    throw new Error('This file is not a Kala Learn backup for this version.');
  }
  const p = upgrade(data.progress);
  save(p);
  return p;
}

export function resetAll() {
  cache = fresh();
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* storage unavailable: the in-memory reset still applies */
  }
  return cache;
}
