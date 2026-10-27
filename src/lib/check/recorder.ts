// The check's in-memory recording, a port of Kala's StudyRecorder/StudyTextRecorder for the browser.
// It writes the desktop session package (kala.typing-check.session/2) field for field. Nothing here is
// stored or sent: the page keeps it in memory until the person chooses Send.

import { graphemes } from '../scoring.ts';
import { physicalKey, positionOf, modifiersOf } from './physical.ts';
import type { TaskKind } from './protocol.ts';

export const SCHEMA = 'kala.typing-check.session/2';
export const CLOCK_FREQUENCY = 1_000_000; // ticks are microseconds of the page's monotonic clock
export const MAX_KEYS = 16384;
export const MAX_TEXT_EVENTS = 10000;
const MAX_DELIVERIES = 10000;
const MAX_PROBE_ATTEMPTS = 2000;

export type KeyRow = [number, number, number, number, 0 | 1, 0 | 1, 0 | 1, string | null, number, 0 | 1, number];

export interface Task {
  kind: TaskKind;
  block: number;
  source_family: string;
  domain: string;
  selection_version: string;
  local_exposure_count: number | null;
  exposure_history: 'unknown' | 'bounded-local-history';
  planned_start: number;
  planned_duration: number;
  cue: string[] | null;
}

export interface Prompt {
  prompt_id: string;
  prompt_version: number;
  target_text: string;
  stage: string;
  order: number;
  measured: boolean;
  shown_ticks: number;
  repeat_of: number | null;
  previously_seen: boolean;
  task: Task;
  first_key_ticks: number | null;
  end_ticks: number;
  end_reason: 'enter' | 'timeout' | 'stop' | 'layout-change';
  final_text: string;
  final_text_nfc: string;
  attempted_units: number;
  segmenter: string;
  unicode_version: string;
}

export interface TextEvent {
  seq: number;
  t: number;
  op: 'insert' | 'delete' | 'replace' | 'selection';
  start: number;
  end: number;
  removed: string;
  inserted: string;
  sel_before: [number, number];
  sel_after: [number, number];
  source: 'kala-delivery' | 'native-key' | 'undo' | 'mouse' | 'unknown';
  correction: null;
  key_seq: number | null;
  link: 'exact' | 'inferred' | 'unknown';
}

export interface Boundary {
  seq: number;
  t: number;
  kind: string;
  reason: string | null;
  prompt_order: number | null;
}

export interface Delivery {
  seq: number;
  t: number;
  key_seq: number | null;
  delete_count: number;
  inserted: string;
}

export interface ProbeAttempt {
  prompt_order: number;
  attempt: number;
  key_seqs: number[];
  correct: boolean;
  completed: boolean;
}

export interface Summary {
  wpm5: number | null;
  correct_gpm: number | null;
  accuracy: number | null;
  first_try_accuracy: number | null;
  correction_episodes: number;
  backspace_presses: number;
  anchor_first_wpm5: number | null;
  anchor_repeat_wpm5: number | null;
  scorer: string;
}

export interface SessionPackage {
  schema: string;
  session: {
    contributor_id: string;
    session_id: string;
    session_number: number;
    prompt_bank_version: string;
    variant_id: string;
    randomization_seed: number;
    kala_version: string;
    build_configuration: 'Debug' | 'Release';
    os_version: string;
    keyboard_category: 'laptop-builtin' | 'external' | 'unknown';
    geometry: 'ansi' | 'iso' | 'unknown';
    started_utc: string;
    protocol_version: string;
    completion: 'completed' | 'stopped' | 'interrupted';
    active_seconds: number;
    quality_flags: string[];
  };
  input: {
    layout_id: string;
    layout_name: string;
    origin: 'bundled';
    input_family: 'fixed';
    mapping_hash: string;
    engine_version: string;
    composition_only: true;
    autocorrect_enabled: false;
    spelling_correction_enabled: false;
    suggestions_enabled: false;
    spelling_marks_enabled: false;
    personal_rules_enabled: false;
  };
  clock: { frequency: number; origin_ticks: number };
  prompts: Prompt[];
  key_events: { columns: string[]; rows: KeyRow[] };
  text_events: TextEvent[];
  boundaries: Boundary[];
  summary: Summary | null;
  integrity: { text_replay_ok: boolean; injected_events_seen: number; dropped_events: number };
  collection: Collection;
}

export interface Collection {
  notice_version: string;
  wave: string;
  category_source: 'unknown' | 'existing-unverified-selection';
  geometry_source: 'unknown' | 'existing-unverified-selection';
  render_geometry: 'ansi' | 'iso';
  bank_sha256: string;
  runtime: null;
  engine_events: never[];
  deliveries: Delivery[];
  probes: ProbeAttempt[];
  limitations: string[];
  active_seconds_observed: number;
  assignment: Record<string, string[]>;
  prompt_selection_version: 'variant-selector-history-aware-1';
  linkage: 'local-store-lineage-unverified-person';
  modifier_convention: 'before-transition';
  validation_scope: 'provisional-collection-not-person-validation';
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
const isBoundary = (text: string, offset: number) =>
  offset >= 0 && offset <= text.length && !(offset > 0 && offset < text.length && isHigh(text.charCodeAt(offset - 1)) && isLow(text.charCodeAt(offset)));

/** StudyTextRecorder: exact UTF-16 differences, never splitting a surrogate pair. */
class TextDiff {
  text = '';
  private start = 0;
  private length = 0;
  reset() {
    this.text = '';
    this.start = this.length = 0;
  }
  observe(seq: number, t: number, text: string, selStart: number, selLength: number): TextEvent | null {
    const old = this.text;
    if (text === old && selStart === this.start && selLength === this.length) return null;
    let prefix = 0;
    while (prefix < text.length && prefix < old.length && text[prefix] === old[prefix]) prefix++;
    let suffix = 0;
    while (suffix < text.length - prefix && suffix < old.length - prefix && text[text.length - 1 - suffix] === old[old.length - 1 - suffix]) suffix++;
    while (!isBoundary(old, prefix) || !isBoundary(text, prefix)) prefix--;
    while (!isBoundary(old, old.length - suffix) || !isBoundary(text, text.length - suffix)) suffix--;
    const removed = old.slice(prefix, old.length - suffix);
    const inserted = text.slice(prefix, text.length - suffix);
    const op = text === old ? 'selection' : removed.length === 0 ? 'insert' : inserted.length === 0 ? 'delete' : 'replace';
    const row: TextEvent = {
      seq, t, op, start: prefix, end: old.length - suffix, removed, inserted,
      sel_before: [this.start, this.length], sel_after: [selStart, selLength],
      source: 'unknown', correction: null, key_seq: null, link: 'unknown',
    };
    this.text = text;
    this.start = selStart;
    this.length = selLength;
    return row;
  }
}

/** StudyTextRecorder.Replay: the text events rebuild every prompt's final text from an empty box. */
export function replay(prompts: Prompt[], events: TextEvent[], boundaries: Boundary[]): boolean {
  const shownRows = boundaries.filter((b) => b.kind === 'prompt-shown');
  const endedRows = boundaries.filter((b) => b.kind === 'prompt-ended');
  if (shownRows.length !== prompts.length || endedRows.length !== prompts.length) return false;
  let index = 0;
  let lastEnd = -1;
  for (const prompt of prompts) {
    const shown = shownRows.find((b) => b.prompt_order === prompt.order);
    const ended = endedRows.find((b) => b.prompt_order === prompt.order);
    if (!shown || !ended || shown.seq <= lastEnd || ended.seq <= shown.seq) return false;
    lastEnd = ended.seq;
    let text = '';
    while (index < events.length && events[index].seq < ended.seq) {
      const e = events[index++];
      if (e.seq <= shown.seq) return false;
      if (e.start < 0 || e.end < e.start || e.end > text.length || text.slice(e.start, e.end) !== e.removed) return false;
      if (e.sel_before[0] < 0 || e.sel_before[1] < 0 || e.sel_before[0] + e.sel_before[1] > text.length) return false;
      if (e.op === 'selection') {
        if (e.removed.length !== 0 || e.inserted.length !== 0) return false;
      } else text = text.slice(0, e.start) + e.inserted + text.slice(e.end);
      if (e.sel_after[0] < 0 || e.sel_after[1] < 0 || e.sel_after[0] + e.sel_after[1] > text.length) return false;
    }
    if (text !== prompt.final_text) return false;
  }
  return index === events.length;
}

const matchesCue = (cue: string, position: string | null) => cue === position || (cue === 'SHFT' && (position === 'LSHF' || position === 'RSHF'));

interface RawKey {
  seq: number;
  t: number;
  code: string;
  vk: number;
  sc: number;
  ext: 0 | 1;
  up: boolean;
  repeat: boolean;
  mods: number;
  consumed: boolean;
  hookMs: number;
}

export interface KeyInput {
  code: string;
  keyCode: number;
  up: boolean;
  caps: boolean;
  timeStamp: number;
}

/** One check's recording. Times come from the page clock (performance.now()) when each event is handled. */
export class Recorder {
  private seq = 0;
  private lastT = 0;
  private armed = true;
  private finished = false;
  private readonly down = new Set<string>();
  private readonly diff = new TextDiff();
  readonly keys: RawKey[] = [];
  readonly textEvents: TextEvent[] = [];
  readonly boundaries: Boundary[] = [];
  readonly prompts: Prompt[] = [];
  readonly deliveries: Delivery[] = [];
  readonly probes: ProbeAttempt[] = [];
  private readonly flags = new Set<string>();
  private prompt: Prompt | null = null;
  private probeKeys: number[] = [];
  private probePositions: (string | null)[] = [];
  private dropped = 0;

  private readonly originMs: number;
  private readonly now: () => number;

  constructor(originMs: number, now: () => number = () => performance.now()) {
    this.originMs = originMs;
    this.now = now;
    this.boundary('start');
  }

  get originTicks() {
    return Math.round(this.originMs * 1000);
  }
  get isArmed() {
    return this.armed && !this.finished;
  }
  get probeActive() {
    return this.prompt?.task.kind === 'physical-probe';
  }
  get currentPrompt() {
    return this.prompt;
  }
  get captureFailed() {
    return this.dropped > 0;
  }

  /** One clock for all streams, never running backwards (the package requires a global order). */
  private ticks() {
    this.lastT = Math.max(this.lastT, Math.round((this.now() - this.originMs) * 1000));
    return this.lastT;
  }

  flag(flag: string) {
    this.flags.add(flag);
  }

  boundary(kind: string, reason: string | null = null) {
    this.boundaries.push({ seq: ++this.seq, t: this.ticks(), kind, reason, prompt_order: this.prompt?.order ?? null });
  }

  beginPrompt(id: string, target: string, stage: string, options: { measured: boolean; repeatOf: number | null; previouslySeen: boolean; version: number; task: Task }) {
    if (this.prompt) throw new Error('Finish the current prompt first.');
    this.diff.reset();
    this.probeKeys = [];
    this.probePositions = [];
    this.prompt = {
      prompt_id: id, prompt_version: options.version, target_text: target, stage, order: this.prompts.length,
      measured: options.measured, shown_ticks: 0, repeat_of: options.repeatOf, previously_seen: options.previouslySeen,
      task: options.task, first_key_ticks: null, end_ticks: 0, end_reason: 'enter', final_text: '', final_text_nfc: '',
      attempted_units: 0, segmenter: 'dotnet-8', unicode_version: '15.0',
    };
    this.prompts.push(this.prompt);
    this.boundary('prompt-shown');
    this.prompt.shown_ticks = this.boundaries[this.boundaries.length - 1].t;
  }

  endPrompt(reason: Prompt['end_reason']) {
    const prompt = this.prompt;
    if (!prompt) return;
    if (this.probeActive && this.probeKeys.length > 0) {
      this.addProbe(prompt, this.probeKeys, false, false);
      this.probeKeys = [];
      this.probePositions = [];
    }
    prompt.final_text = this.diff.text;
    prompt.final_text_nfc = prompt.final_text.normalize('NFC');
    prompt.attempted_units = Math.min(graphemes(prompt.target_text).length, graphemes(prompt.final_text).length);
    this.boundary('prompt-ended');
    prompt.end_ticks = this.boundaries[this.boundaries.length - 1].t;
    prompt.end_reason = reason;
    this.prompt = null;
  }

  pause(reason: 'focus-loss' | 'button' | 'mode-change' | 'step-transition') {
    if (!this.armed || this.finished) return;
    this.armed = false;
    this.down.clear();
    this.boundary('pause', reason);
    if (reason === 'focus-loss' || reason === 'mode-change') this.flag(reason);
  }

  resume() {
    if (this.armed || this.finished) return;
    this.armed = true;
    this.boundary('resume');
  }

  /** Records one physical transition; returns its sequence number, or 0 when capture is not armed. */
  key(input: KeyInput): number {
    if (!this.isArmed) return 0;
    if (this.keys.length >= MAX_KEYS) {
      this.dropped++;
      return 0;
    }
    const { vk, sc, ext } = physicalKey(input.code, input.keyCode);
    const mods = modifiersOf(this.down, input.caps);
    const repeat = !input.up && this.down.has(input.code);
    if (input.up) this.down.delete(input.code);
    else this.down.add(input.code);
    const row: RawKey = {
      seq: ++this.seq, t: this.ticks(), code: input.code, vk, sc, ext, up: input.up, repeat, mods, consumed: false,
      hookMs: Math.max(0, Math.floor(input.timeStamp)),
    };
    this.keys.push(row);
    const prompt = this.prompt;
    if (prompt && !row.up && prompt.first_key_ticks === null && row.t >= prompt.shown_ticks) prompt.first_key_ticks = row.t;
    const cue = prompt?.task.kind === 'physical-probe' ? prompt.task.cue : null;
    if (prompt && cue && !row.up && !row.repeat) {
      this.probeKeys.push(row.seq);
      this.probePositions.push(positionOf(sc, ext === 1));
      if (this.probeKeys.length === cue.length) {
        this.addProbe(prompt, this.probeKeys, this.probePositions.every((p, i) => matchesCue(cue[i], p)), true);
        this.probeKeys = [];
        this.probePositions = [];
      }
    }
    return row.seq;
  }

  /** Kala translated this key (the composer took it), as StudyTap.MarkConsumed. */
  consumed(seq: number) {
    const row = this.keys.find((k) => k.seq === seq);
    if (row) row.consumed = true;
  }

  private addProbe(prompt: Prompt, keySeqs: number[], correct: boolean, completed: boolean) {
    if (this.probes.length >= MAX_PROBE_ATTEMPTS) {
      this.dropped++;
      return;
    }
    const attempt = this.probes.filter((p) => p.prompt_order === prompt.order).length + 1;
    this.probes.push({ prompt_order: prompt.order, attempt, key_seqs: [...keySeqs], correct, completed });
  }

  /** The composer's delivery for a key: what it deleted and inserted, before the box shows it. */
  delivered(keySeq: number, deleteCount: number, inserted: string) {
    if (!this.isArmed || !this.prompt) return;
    if (this.deliveries.length >= MAX_DELIVERIES) {
      this.dropped++;
      return;
    }
    this.deliveries.push({ seq: ++this.seq, t: this.ticks(), key_seq: keySeq || null, delete_count: deleteCount, inserted });
  }

  /** The box's new text after a key. The caret always sits at the end. */
  text(text: string, keySeq: number, source: TextEvent['source']) {
    if (!this.isArmed || !this.prompt) return;
    if (this.textEvents.length >= MAX_TEXT_EVENTS) {
      this.flag('events-dropped');
      this.dropped++;
      return;
    }
    const row = this.diff.observe(this.seq + 1, 0, text, text.length, 0);
    if (!row) return;
    row.seq = ++this.seq;
    row.t = this.ticks();
    row.source = source;
    row.key_seq = keySeq || null;
    row.link = keySeq ? 'exact' : 'unknown';
    this.textEvents.push(row);
  }

  get typed() {
    return this.diff.text;
  }

  /** The key rows, with the desktop recorder's position rule for the unknown-geometry 0x2B key. */
  private rows(geometry: string): KeyRow[] {
    return this.keys.map((k) => [
      k.seq, k.t, k.vk, k.sc, k.ext, k.up ? 1 : 0, k.repeat ? 1 : 0,
      geometry === 'unknown' && k.sc === 0x2b && k.ext === 0 ? null : positionOf(k.sc, k.ext === 1, geometry),
      k.mods, k.consumed ? 1 : 0, k.hookMs,
    ]);
  }

  private activePromptSeconds(prompt: Prompt) {
    let active = prompt.end_ticks - prompt.shown_ticks;
    let paused: number | null = null;
    for (const b of this.boundaries) {
      if (b.kind === 'pause') paused = b.t;
      else if (b.kind === 'resume' && paused !== null) {
        active -= Math.max(0, Math.min(prompt.end_ticks, b.t) - Math.max(prompt.shown_ticks, paused));
        paused = null;
      }
    }
    if (paused !== null) active -= Math.max(0, prompt.end_ticks - Math.max(prompt.shown_ticks, paused));
    return active / CLOCK_FREQUENCY;
  }

  private checkKeyIntegrity() {
    const down = new Map<string, number>();
    let previous: RawKey | null = null;
    for (const key of this.keys) {
      const last = previous;
      if (last && this.boundaries.some((b) => b.seq > last.seq && b.seq < key.seq && (b.kind === 'pause' || b.kind === 'prompt-shown' || b.kind === 'layout-change'))) {
        down.clear();
        previous = null;
      }
      if (!key.up && !key.repeat) down.set(key.code, key.seq);
      else if (key.up) down.delete(key.code);
      if (previous) {
        const tickSeconds = (key.t - previous.t) / CLOCK_FREQUENCY;
        const hookSeconds = (key.hookMs - previous.hookMs) / 1000;
        if (Math.abs(tickSeconds - hookSeconds) > 0.25) this.flag('clock-jump');
        if (tickSeconds > 30) this.flag('idle-over-30s');
      }
      previous = key;
    }
    // Ending while a key is held is explained by stop/timeout; unexplained missing releases within a trial aren't.
    for (const [code, seq] of down)
      if (this.keys.some((k) => k.seq > seq && !k.up && !k.repeat && k.code === code)) this.flag('events-dropped');
  }

  finish(base: {
    session: Omit<SessionPackage['session'], 'completion' | 'active_seconds' | 'quality_flags'>;
    input: SessionPackage['input'];
    collection: Omit<Collection, 'deliveries' | 'probes' | 'engine_events' | 'active_seconds_observed'>;
    completion: 'completed' | 'stopped' | 'interrupted';
    activeSeconds: number;
    observedSeconds: number;
  }): SessionPackage {
    this.endPrompt(base.completion === 'completed' ? 'timeout' : base.completion === 'interrupted' && this.flags.has('layout-change') ? 'layout-change' : 'stop');
    this.armed = false;
    this.boundary(base.completion === 'completed' ? 'timeout' : 'stop');
    this.finished = true;
    const replayOk = replay(this.prompts, this.textEvents, this.boundaries);
    if (!replayOk) this.flag('text-replay-mismatch');
    if (!this.keys.some((k) => !k.up) && this.textEvents.some((e) => e.inserted.length > 0)) this.flag('physical-events-missing');
    if (this.textEvents.some((e) => e.inserted.length > 0 && e.key_seq === null)) this.flag('physical-events-missing');
    if (this.dropped > 0) this.flag('events-dropped');
    this.checkKeyIntegrity();
    for (const prompt of this.prompts.filter((p) => p.measured))
      if (prompt.final_text.length === 0 && this.activePromptSeconds(prompt) > 30) this.flag('idle-over-30s');
    if (this.prompts.some((p) => /[a-zA-Z]/.test(p.final_text))) this.flag('roman-output-detected');
    return {
      schema: SCHEMA,
      session: {
        ...base.session,
        completion: base.completion,
        active_seconds: Math.min(260, Math.max(0, base.activeSeconds)),
        quality_flags: [...this.flags].sort(),
      },
      input: base.input,
      clock: { frequency: CLOCK_FREQUENCY, origin_ticks: this.originTicks },
      prompts: this.prompts,
      key_events: { columns: ['seq', 't', 'vk', 'sc', 'ext', 'up', 'rep', 'pos', 'mods', 'consumed', 'hook_ms'], rows: this.rows(base.session.geometry) },
      text_events: this.textEvents,
      boundaries: this.boundaries,
      summary: null,
      integrity: { text_replay_ok: replayOk, injected_events_seen: 0, dropped_events: this.dropped },
      collection: {
        ...base.collection,
        engine_events: [],
        deliveries: this.deliveries,
        probes: this.probes,
        active_seconds_observed: base.observedSeconds,
      },
    };
  }
}
