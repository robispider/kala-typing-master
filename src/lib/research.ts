// Local, versioned B01/B02 pilot. Reuse the published browser decoder, recipe search, recorder and
// scorer; experimental captures are deliberately wrapped in their own format, never the upload API.
import snapshot from '../data/shared-candidates.json' with { type: 'json' };
import { charTypes, layoutById, type Layout } from './catalog.ts';
import { apply, FixedComposer } from './composer.ts';
import { BACKSPACE, ENTER, SPACE, vkOfCode } from './keys.ts';
import { solve, type Step } from './recipe.ts';
import { Recorder, type KeyInput, type SessionPackage } from './check/recorder.ts';
import { activeDuration, canonical, scoreCheck } from './check/scorer.ts';
import { correctGpm, speedQualifies } from './scoring.ts';

export const PROTOCOL = 'shared-physical-pilot-v1';
export const BANK = 'shared-authored-pilot-1';
export const DURATION_MS = 60_000;
export type Candidate = 'B01' | 'B02';
export type Style = 'A' | 'D';
export type Assistance = 'guided' | 'recall';
export type Role = 'practice' | 'ordinary' | 'vowel-diagnostic';
export const candidates = snapshot.candidates;
export const LIMITATIONS = [
  'single-participant-exploratory', 'browser-event-timing', 'system-input-must-be-english',
  'traditional-finger-guide-not-model-optimal-fingering', 'fingers-not-observed',
  'authored-unvalidated-bank', 'passages-repeated-across-candidates', 'learning-and-carryover',
  'targeted-vowel-text-not-natural-frequency', 'not-a-trained-speed-or-population-claim',
];

// These new authored forms are separate from both frozen search corpora and Kala's ordinary checks.
// Both candidates receive both forms. Different source forms are never pooled as independent users.
export const FORMS = {
  practice: ['আমরা বাংলা লিখি। বই পড়ি। নৌকা চলে। সৈনিক আসে। ঐক্য চাই। ঔষধ রাখি।'],
  ordinary: [
    'আজ সকালে আমরা নদীর ধারে হাঁটতে গেলাম। বাতাস ছিল নরম, আকাশ ছিল পরিষ্কার। পথের পাশে একটি ছোট দোকান খুলেছে। আমরা সেখানে বসে চা খেলাম এবং বাড়ির কথা বললাম। ফিরে এসে আমি একটি বই পড়লাম। বিকেলে সবাই মিলে বাগানে কাজ করব।',
    'বিকেলে আমরা বাড়ির পাশে একটি গাছ লাগালাম। ছোট ভাই জল নিয়ে এল, আর আমি মাটি তৈরি করলাম। কাজের পরে সবাই বারান্দায় বসে গল্প শুনলাম। দূরের মাঠে কয়েকটি পাখি দেখা গেল। রাত হলে আমরা বই গুছিয়ে রাখব এবং আগামী দিনের কাজ ঠিক করব।',
  ],
  'vowel-diagnostic': [
    'নৌকা মৌমাছি সৈনিক বৈঠক নৈশ দৈনিক গৌরব সৌরভ ঐক্য ঔষধ। নৌকায় করে সৈনিক এল। বৈঠকে ঐক্যের কথা হল। মৌমাছি ফুলে বসে। দৈনিক কাজ শেষে সৌরভ বই পড়ে।',
    'মৌসুম বৈশাখ নৌবাহিনী শৈশব দৈব সৌজন্য ভৌগোলিক বৈজ্ঞানিক ঐতিহ্য ঔদার্য। বৈশাখে নৌকা চলে। শৈশবের কথা মনে পড়ে। সৌজন্য ও ঐক্য বজায় রাখি। বৈজ্ঞানিক কাজের গৌরব আছে।',
  ],
} satisfies Record<Role, string[]>;

export function candidateLayout(label: Candidate, style: Style): Layout {
  const saved = candidates.find((c) => c.label === label);
  if (!saved) throw new Error('Unknown candidate');
  const template = layoutById(style === 'A' ? 'kala-goti' : 'kala-jhor')!;
  const layout: Layout = {
    ...template, id: `${label.toLowerCase()}-${style.toLowerCase()}`,
    name: { en: `${label} · ${style === 'A' ? 'Goti' : 'Jhor'}`, bn: `${label} · ${style === 'A' ? 'গতি' : 'ঝড়'}` },
    normal: { ...template.normal }, shift: { ...template.shift },
    // Original examples refer to original positions: never present those as candidate instructions.
    howToType: null, sourceSha256: saved.physicalMapSha256,
  };
  const occupied = new Set<string>();
  for (const [symbol, slot] of Object.entries(saved.symbols)) {
    const [key, layer] = slot.split('/');
    if (!/^[A-Z]$/.test(key) || !['base', 'shift'].includes(layer) || occupied.has(slot)) throw new Error('Invalid map');
    occupied.add(slot);
    layout[layer === 'base' ? 'normal' : 'shift'][String(key.charCodeAt(0))] = canonical(symbol);
  }
  if (occupied.size !== 52) throw new Error('Incomplete map');
  return layout;
}

export async function hashLayout(layout: Layout): Promise<string> {
  // Hash exactly the behavior used by FixedComposer, with explicit property order.
  const runtime = JSON.stringify({
    language: layout.language, contextVowels: layout.contextVowels, normal: layout.normal,
    shift: layout.shift, sequences: layout.sequences, rules: layout.rules,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(runtime));
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export function plan(sessionNumber: number): { block: number; candidate: Candidate; form: number }[] {
  const order: Candidate[] = sessionNumber % 2 ? ['B01', 'B02', 'B02', 'B01'] : ['B02', 'B01', 'B01', 'B02'];
  return order.map((candidate, block) => ({ block, candidate, form: block % 2 }));
}

export interface TrialOptions {
  candidate: Candidate; style: Style; assistance: Assistance; role: Role; block: number; form: number;
  sessionId: string; runtimeHash: string; keyboard: 'laptop-builtin' | 'external' | 'unknown';
  previousExposures: number; appVersion: string;
}
export interface Metrics {
  activeMs: number; referenceUnits: number; responseUnits: number; matches: number; distance: number;
  firstTryWords: number; words: number; backspaces: number; correctionEpisodes: number;
}
export interface TrialResult extends TrialOptions {
  ended: 'completed' | 'stopped'; completedPrompts: number; metrics: Metrics;
  hintCues: number; cueFollowed: number; cueCompared: number; comfort: number | null;
  vowelIntervals: { sign: string; ms: number }[];
  capture: Pick<SessionPackage, 'clock' | 'prompts' | 'key_events' | 'text_events' | 'boundaries' | 'integrity'> & {
    qualityFlags: string[]; deliveries: SessionPackage['collection']['deliveries'];
  };
}

/** One continuously timed role; pauses are excluded, while reading/searching inside a trial counts. */
export class Trial {
  readonly options: TrialOptions;
  readonly layout: Layout;
  readonly recorder: Recorder;
  readonly target: string;
  readonly started: number;
  readonly limit: number | null;
  composer: FixedComposer;
  pausedAt: number | null = null;
  private pauseMs = 0;
  private priorKeyAt: number | null = null;
  private cue: Step | null = null;
  private lastHintKey = '';
  private hintCues = 0;
  private cueCompared = 0;
  private cueFollowed = 0;
  private vowelIntervals: { sign: string; ms: number }[] = [];
  private result: TrialResult | null = null;
  private readonly now: () => number;
  constructor(options: TrialOptions, now: () => number = () => performance.now()) {
    this.now = now;
    this.options = { ...options, form: options.role === 'practice' ? 0 : options.form };
    this.layout = candidateLayout(options.candidate, options.style);
    this.composer = FixedComposer.create(this.layout, charTypes);
    this.target = FORMS[options.role][options.role === 'practice' ? 0 : options.form];
    this.started = now();
    this.limit = options.role === 'practice' ? null : DURATION_MS;
    this.recorder = new Recorder(this.started, () => this.recordNow());
    this.beginPrompt();
  }
  private recordNow() {
    return this.limit === null || this.pausedAt !== null ? this.now() : Math.min(this.now(), this.started + this.limit + this.pauseMs);
  }
  get done() { return this.result; }
  get typed() { return this.recorder.typed; }
  elapsed() { return Math.max(0, Math.min(this.limit ?? Infinity, (this.pausedAt ?? this.now()) - this.started - this.pauseMs)); }
  sync() { if (!this.result && this.limit !== null && this.elapsed() >= this.limit) this.finish('completed'); return this.result; }
  private beginPrompt() {
    const o = this.options;
    const shown = this.recorder.prompts.length;
    this.recorder.beginPrompt(`${BANK}:${o.role}:${o.form}`, this.target, o.role, {
      measured: o.role !== 'practice', repeatOf: shown ? shown - 1 : null,
      previouslySeen: shown > 0 || o.previousExposures > 0, version: 1,
      task: {
        kind: o.role === 'vowel-diagnostic' ? 'targeted' : o.role === 'practice' ? 'warmup' : 'natural',
        block: o.block, source_family: `${BANK}:${o.role}:${o.form}`, domain: 'new-authored-shared-layout-pilot',
        selection_version: PROTOCOL, local_exposure_count: o.previousExposures + shown,
        exposure_history: 'bounded-local-history', planned_start: 0, planned_duration: this.limit === null ? 0 : this.limit / 1000, cue: null,
      },
    });
    this.composer.reset(); this.priorKeyAt = null; this.cue = null;
  }
  nextPrompt() {
    if (this.sync() || this.pausedAt !== null || !this.reachedLastWord()) return;
    this.recorder.endPrompt('enter'); this.beginPrompt();
  }
  reachedLastWord() {
    return this.typed.trim().length > 0 && this.typed.split(' ').length >= this.target.split(' ').length;
  }
  word() {
    const index = this.typed.split(' ').length - 1;
    return { target: this.target.split(' ')[index] ?? '', typed: this.typed.split(' ').at(-1) ?? '' };
  }
  hint(): Step | null {
    if (this.done || this.pausedAt !== null || (this.options.role !== 'practice' && this.options.assistance === 'recall')) return null;
    const word = this.word();
    const steps = solve(this.composer, word.typed, word.target);
    const cue = steps === null ? (word.typed ? { vk: BACKSPACE, shift: false, text: word.typed.slice(0, -1) } : null)
      : steps[0] ?? (word.target ? { vk: this.reachedLastWord() ? ENTER : SPACE, shift: false, text: this.typed + ' ' } : null);
    this.cue = cue;
    const key = `${this.recorder.prompts.length}:${this.typed}:${this.composer.stateKey()}:${cue?.vk}:${cue?.shift}`;
    if (cue && key !== this.lastHintKey) { this.hintCues++; this.lastHintKey = key; }
    return cue;
  }
  key(input: KeyInput, shift: boolean): void {
    if (this.sync() || this.pausedAt !== null) return;
    const seq = this.recorder.key(input);
    if (input.up || !seq) return;
    const vk = vkOfCode[input.code];
    if (vk === undefined || vk === ENTER || vk === 160 || vk === 161) return;
    const repeated = this.recorder.keys.at(-1)?.repeat;
    if (repeated) this.recorder.flag('auto-repeat-seen');
    if (this.cue && !repeated) {
      this.cueCompared++;
      if (this.cue.vk === vk && this.cue.shift === shift) this.cueFollowed++;
    }
    const sign = this.composer.charOf(vk, shift);
    const time = this.recordNow();
    if (!repeated && (sign === 'ৈ' || sign === 'ৌ') && this.priorKeyAt !== null) this.vowelIntervals.push({ sign, ms: time - this.priorKeyAt });
    this.priorKeyAt = time;
    if (vk === BACKSPACE) {
      this.recorder.text(this.typed.slice(0, -1), seq, 'native-key');
      this.composer.continueAfter(this.typed);
    } else {
      const translated = this.composer.translate(vk, shift);
      if (translated.suppress || translated.output !== null) this.recorder.consumed(seq);
      if (translated.output !== null && !translated.suppress && this.typed.length < 2048) {
        this.recorder.delivered(seq, translated.backspaces, translated.output);
        this.recorder.text(apply(this.typed, translated), seq, 'kala-delivery');
      }
    }
    this.cue = null;
  }
  pause(reason: 'focus-loss' | 'button' | 'mode-change' = 'button') {
    if (this.sync() || this.pausedAt !== null) return;
    this.pausedAt = this.now(); this.recorder.pause(reason); this.priorKeyAt = null; this.cue = null;
  }
  resume() {
    if (this.done || this.pausedAt === null) return;
    this.pauseMs += this.now() - this.pausedAt; this.pausedAt = null; this.recorder.resume();
  }
  flag(value: string) { this.recorder.flag(value); }
  finish(ended: 'completed' | 'stopped'): TrialResult {
    if (this.result) return this.result;
    const o = this.options;
    const elapsed = this.elapsed();
    // The reusable recorder's internal package is scored locally, then only its capture streams are
    // exported under our experimental schema. It is not a normal bank /2 upload package.
    const p = this.recorder.finish({
      session: {
        contributor_id: 'local-only', session_id: o.sessionId, session_number: 1,
        prompt_bank_version: BANK, variant_id: `${o.role}-${o.form}`, randomization_seed: 0,
        kala_version: `${o.appVersion}-web`, build_configuration: 'Debug', os_version: 'unknown',
        keyboard_category: o.keyboard, geometry: 'unknown', started_utc: '', protocol_version: PROTOCOL,
      },
      input: {
        layout_id: this.layout.id, layout_name: this.layout.name.en, origin: 'bundled', input_family: 'fixed',
        mapping_hash: `sha256:${o.runtimeHash}`, engine_version: `${o.appVersion}/FixedComposer`, composition_only: true,
        autocorrect_enabled: false, spelling_correction_enabled: false, suggestions_enabled: false,
        spelling_marks_enabled: false, personal_rules_enabled: false,
      },
      collection: {
        notice_version: PROTOCOL, wave: PROTOCOL, category_source: 'existing-unverified-selection', geometry_source: 'unknown',
        render_geometry: 'ansi', bank_sha256: '', runtime: null, limitations: LIMITATIONS, assignment: {},
        prompt_selection_version: 'variant-selector-history-aware-1', linkage: 'local-store-lineage-unverified-person',
        modifier_convention: 'before-transition', validation_scope: 'provisional-collection-not-person-validation',
      },
      completion: ended, activeSeconds: elapsed / 1000, observedSeconds: elapsed / 1000,
    });
    const scored = scoreCheck(p, { fresh: FixedComposer.create(this.layout, charTypes), units: [] });
    const activeMs = p.prompts.reduce((n, prompt) => n + activeDuration(p, prompt.shown_ticks, prompt.end_ticks) * 1000, 0);
    this.result = {
      ...o, ended, completedPrompts: p.prompts.filter((prompt) => prompt.end_reason === 'enter').length,
      metrics: {
        activeMs, referenceUnits: scored.referenceUnits, responseUnits: scored.responseUnits,
        matches: scored.matches, distance: scored.distance, firstTryWords: scored.firstTryWords, words: scored.words,
        backspaces: scored.summary.backspace_presses, correctionEpisodes: scored.summary.correction_episodes,
      },
      hintCues: this.hintCues, cueCompared: this.cueCompared, cueFollowed: this.cueFollowed,
      vowelIntervals: this.vowelIntervals, comfort: null,
      capture: {
        clock: p.clock, prompts: p.prompts, key_events: p.key_events, text_events: p.text_events,
        boundaries: p.boundaries, integrity: p.integrity, qualityFlags: p.session.quality_flags, deliveries: p.collection.deliveries,
      },
    };
    return this.result;
  }
}

const median = (values: number[]) => {
  const sorted = values.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return !sorted.length ? null : sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
};
export function aggregate(trials: TrialResult[], candidate: Candidate, role: Exclude<Role, 'practice'>) {
  const rows = trials.filter((r) => r.candidate === candidate && r.role === role);
  if (new Set(rows.map((r) => `${r.style}:${r.assistance}`)).size > 1) throw new Error('Do not pool different styles or assistance');
  const sum = (key: keyof Metrics) => rows.reduce((n, r) => n + r.metrics[key], 0);
  const max = Math.max(sum('referenceUnits'), sum('responseUnits'));
  const ms = sum('activeMs');
  const intact = rows.length ? rows.every((r) => r.capture.integrity.text_replay_ok && r.capture.integrity.dropped_events === 0) : null;
  return {
    candidate, role, trials: rows.length, completedTrials: rows.filter((r) => r.ended === 'completed').length,
    activeSeconds: ms / 1000, attemptedUnits: sum('referenceUnits'), matches: sum('matches'),
    accuracy: intact && max ? 100 * Math.max(0, 1 - sum('distance') / max) : null,
    correctGpm: intact && speedQualifies(ms, sum('referenceUnits')) ? correctGpm(sum('matches'), ms) : null,
    firstTryWordAccuracy: intact && sum('words') ? 100 * sum('firstTryWords') / sum('words') : null,
    backspaces: sum('backspaces'), correctionEpisodes: sum('correctionEpisodes'),
    hints: rows.reduce((n, r) => n + r.hintCues, 0),
    cueFollowed: rows.reduce((n, r) => n + r.cueFollowed, 0), cueCompared: rows.reduce((n, r) => n + r.cueCompared, 0),
    vowelTiming: ['ৈ', 'ৌ'].map((sign) => {
      const values = rows.flatMap((r) => r.vowelIntervals.filter((v) => v.sign === sign).map((v) => v.ms));
      return { sign, samples: values.length, medianIncomingMs: median(values) };
    }),
    integrityOK: intact,
    flags: [...new Set(rows.flatMap((r) => r.capture.qualityFlags))],
  };
}

export interface ResearchReport {
  schema: 'kala.shared-layout-pilot/1'; protocol: string; bank: string;
  session: {
    id: string; number: number; startedUtc: string; appVersion: string; style: Style; assistance: Assistance;
    experience: string; keyboard: TrialOptions['keyboard']; fingering: string; priorReports: number;
    order: Candidate[]; completion: 'completed' | 'stopped'; storageAvailable: boolean;
    exposureBefore: Record<string, number>;
  };
  maps: { label: string; id: string; sourceSha256: string; physicalMapSha256: string; runtimeHash: string; ruleTemplateHash: string }[];
  limitations: string[]; trials: TrialResult[];
  blocks: { block: number; candidate: Candidate; comfort: number | null; notes: string }[];
}

/** Pasteable data contains denominators, raw counts and each trial, not only a winner or WPM. */
export function reportText(report: ResearchReport): string {
  const summaries = (['B01', 'B02'] as const).flatMap((candidate) =>
    (['ordinary', 'vowel-diagnostic'] as const).map((role) => aggregate(report.trials, candidate, role)));
  const trialRows = report.trials.map(({ capture, ...r }) => ({
    ...r, capture: {
      integrity: capture.integrity, qualityFlags: capture.qualityFlags,
      prompts: capture.prompts.map((p) => ({ target: p.target_text, typed: p.final_text, attemptedUnits: p.attempted_units,
        previouslySeen: p.previously_seen, repeatOf: p.repeat_of, endReason: p.end_reason })),
      physicalTransitions: capture.key_events.rows.length,
    },
  }));
  return [
    'KALA SHARED LAYOUT PHYSICAL PILOT — COPY THIS WHOLE REPORT',
    'Guided data measures assisted typing. Recall data is not proof of expert performance.',
    'Ordinary and deliberately vowel-heavy text are separate. Repeated forms and learning carryover are recorded.',
    'Accuracy/speed do not measure comfort; ratings are self-reported. No overall winner is assigned.',
    'Correct GPM is hidden below 60 active seconds or 100 attempted target units per candidate and role.',
    'Raw key/text streams are in the separate full JSON download, not in this compact copy.',
    JSON.stringify({ ...report, trials: trialRows, summaries }, null, 2),
    'END KALA SHARED LAYOUT PHYSICAL PILOT',
  ].join('\n');
}
