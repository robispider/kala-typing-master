// The typing skill check protocol, ported from Kala (kala/Learning/Study): TypingCheckController,
// StudySchedule, VariantSelector (continuous bank) and ResearchPromptSequence. Same constants and
// selection order, so a web check follows the desktop pilot's tasks and timing.

export const PROTOCOL = '2026.10-bhe-pilot-r3'; // StudyCollection.Protocol
export const SCHEDULE_VERSION = 'bhe-task-schedule-2'; // StudySchedule.Version
export const METHODOLOGY_VERSION = 'capture-v5-keyboard-step-ready'; // StudyRecorder.MethodologyVersion
export const TOTAL_SECONDS = 260;

/** LearningService.StableHash: 32-bit FNV-1a over UTF-16 code units, masked to a non-negative int. */
export function stableHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h & 0x7fffffff;
}

export type Stage = 'warmup' | 'natural-1' | 'coverage' | 'natural-2' | 'anchor-repeat';
export type TaskKind = 'ready' | 'warmup' | 'natural' | 'targeted' | 'physical-probe' | 'anchor';

const stageAt = (active: number): Stage =>
  active < 20 ? 'warmup' : active < 100 ? 'natural-1' : active < 180 ? 'coverage' : active < 240 ? 'natural-2' : 'anchor-repeat';

// All positions belong to the shared main block; physical geometry is still recorded separately.
export const CUES = [['AC01', 'AC07'], ['AD04', 'AC04', 'SPCE'], ['SHFT', 'AC07', 'AC08'], ['SHFT', 'AC04', 'AC03'], ['AC04', 'AC04'], ['SPCE', 'AC07', 'SPCE']];

export interface Timing {
  kind: TaskKind;
  block: number;
  start: number;
  duration: number;
}

/** StudySchedule.At: the timed task for an active time, with eight counterbalanced coverage orders. */
export function scheduleAt(active: number, seed: number): Timing {
  if (active < 20) return { kind: 'warmup', block: 0, start: 0, duration: 20 };
  if (active < 100) return { kind: 'natural', block: 0, start: 20, duration: 80 };
  if (active < 180) {
    const block = Math.min(3, Math.max(0, Math.floor((active - 100) / 20)));
    let value = (block + ((seed >>> 0) % 4)) % 4;
    if (((seed >>> 0) & 4) !== 0) value = 3 - value;
    return { kind: value < 2 ? 'targeted' : 'physical-probe', block, start: 100 + 20 * block, duration: 20 };
  }
  return active < 240 ? { kind: 'natural', block: 0, start: 180, duration: 60 } : { kind: 'anchor', block: 0, start: 240, duration: 20 };
}

export const cueFor = (seed: number, block: number) => CUES[((seed >>> 0) + block) % CUES.length];

export type CheckState = 'ready' | 'running' | 'paused' | 'result' | 'discarded';

/** TypingCheckController: pauses never spend the 260-second typing window. */
export class CheckController {
  private started = 0;
  private active = 0;
  private stepOverrun = 0;
  state: CheckState = 'ready';
  stage: Stage = 'warmup';
  completion: 'completed' | 'stopped' | 'interrupted' = 'completed';

  private readonly seconds: () => number;

  constructor(seconds: () => number) {
    this.seconds = seconds;
  }

  private get elapsed() {
    return this.active + (this.state === 'running' ? this.seconds() - this.started : 0);
  }
  get activeSeconds() {
    return Math.min(TOTAL_SECONDS, Math.max(0, this.elapsed));
  }
  get activeSecondsObserved() {
    return this.elapsed + this.stepOverrun;
  }

  start() {
    if (this.state !== 'ready') throw new Error('The check has already started.');
    this.started = this.seconds();
    this.state = 'running';
  }

  tick() {
    if (this.state !== 'running' || this.activeSeconds < TOTAL_SECONDS) return false;
    this.stop('completed');
    return true;
  }

  advance() {
    if (this.state !== 'running') return false;
    if (this.tick()) return false;
    this.stage = stageAt(this.activeSeconds);
    return true;
  }

  pause() {
    if (this.state !== 'running') return;
    this.active = this.elapsed;
    this.state = 'paused';
  }

  pauseAtStepBoundary(boundary: number) {
    if (this.state !== 'running' || !Number.isFinite(boundary) || boundary < this.active || boundary >= TOTAL_SECONDS || this.elapsed < boundary)
      throw new Error('No completed step to pause.');
    // Timer delivery lateness is kept as observed time; it never consumes the next task's allocation.
    this.stepOverrun += this.elapsed - boundary;
    this.active = boundary;
    this.stage = stageAt(boundary);
    this.state = 'paused';
  }

  resume() {
    if (this.state !== 'paused') return;
    this.started = this.seconds();
    this.state = 'running';
  }

  stop(completion: 'completed' | 'stopped' | 'interrupted' = 'stopped') {
    if (this.state !== 'ready' && this.state !== 'running' && this.state !== 'paused') return;
    this.active = this.elapsed;
    this.completion = completion;
    this.state = 'result';
  }

  discard() {
    this.active = this.activeSeconds;
    this.state = 'discarded';
  }
}

// ---------------------------------------------------------------- prompt bank

export interface BankPrompt {
  id: string;
  version: number;
  text: string;
  passage: { id: string; order: number } | null;
  family: string | null;
  author: string | null;
  title: string | null;
}

export interface BankVariant {
  id: string;
  layout_hash: string;
  stages: Record<string, string[]>;
}

export interface Bank {
  schema: string;
  version: string;
  protocol_version: string;
  bank_sha256: string;
  anchors: string[];
  prompts: BankPrompt[];
  variants: BankVariant[];
}

export interface SelectedVariant {
  variant: BankVariant;
  anchor: BankPrompt;
  stages: Record<string, BankPrompt[]>;
}

const byBoolThenHash = (seen: Set<string>, seed: number) => (a: BankPrompt, b: BankPrompt) =>
  Number(seen.has(a.id)) - Number(seen.has(b.id)) || stableHash(`${a.id}:${seed}`) - stableHash(`${b.id}:${seed}`);

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** VariantSelector.Select for the continuous bank (prompts/4): rotate by contributor, prefer unseen passages. */
export function selectVariant(bank: Bank, layoutHash: string, contributor: string, session: number, seen: Set<string>): SelectedVariant {
  const variants = bank.variants.filter((v) => v.layout_hash === layoutHash).sort((a, b) => ordinal(a.id, b.id));
  if (variants.length === 0) throw new Error('No validated prompts for this layout.');
  const seed = stableHash(`${contributor}:${session}`);
  const offset = (stableHash(contributor) + Math.max(0, session - 1)) % variants.length;
  const ordered = [...variants.slice(offset), ...variants.slice(0, offset)];
  const seenCount = (v: BankVariant) => ['natural-1', 'natural-2'].filter((s) => v.stages[s].some((id) => seen.has(id))).length;
  // Stable: the first variant with the fewest seen natural passages.
  const chosen = ordered.reduce((best, v) => (seenCount(v) < seenCount(best) ? v : best));
  const source = new Map(bank.prompts.map((p) => [p.id, p]));
  const stages: Record<string, BankPrompt[]> = {};
  for (const [stage, ids] of Object.entries(chosen.stages)) {
    const prompts = ids.map((id) => source.get(id)!);
    stages[stage] = stage === 'natural-1' || stage === 'natural-2' ? prompts : prompts.sort(byBoolThenHash(seen, seed));
  }
  return { variant: chosen, anchor: source.get(chosen.stages['natural-1'][0])!, stages };
}

/** ResearchPromptSequence: preserves passage order; exhausting a passage records an explicit repeat. */
export class PromptSequence {
  private readonly positions = new Map<string, number>();
  private readonly firstOrders = new Map<string, number>();
  private previousStage = '';
  private anchorOrder: number | null = null;

  private readonly variant: SelectedVariant;
  private readonly seen: Set<string>;

  constructor(variant: SelectedVariant, seen: Set<string>) {
    this.variant = variant;
    this.seen = seen;
  }

  next(stage: Stage, order: number): { prompt: BankPrompt; repeatOf: number | null; previouslySeen: boolean } {
    let prompt: BankPrompt;
    if (stage === 'anchor-repeat') prompt = this.variant.anchor;
    else {
      const list = this.variant.stages[stage];
      const index = this.positions.get(stage) ?? 0;
      prompt = list[index % list.length];
      this.positions.set(stage, index + 1);
    }
    const repeatOf = stage === 'anchor-repeat' ? this.anchorOrder : (this.firstOrders.get(prompt.id) ?? null);
    if (stage === 'natural-1' && this.previousStage !== stage) this.anchorOrder = order;
    this.previousStage = stage;
    const previouslySeen = this.seen.has(prompt.id) || this.firstOrders.has(prompt.id);
    if (!this.firstOrders.has(prompt.id)) this.firstOrders.set(prompt.id, order);
    return { prompt, repeatOf, previouslySeen };
  }
}
