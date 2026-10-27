// The typing skill check page: setup, ready word, timed steps, physical-key tasks, result and optional
// research sharing. Follows Kala's TypingCheckForm step for step; see src/lib/check/ for the ports.
import pkg from '../../package.json';
import { apply, FixedComposer } from '../lib/composer.ts';
import { charTypes, display, layoutById, toBnDigits, unitMap, type Text } from '../lib/catalog.ts';
import { both, escapeHtml, t } from '../lib/i18n.ts';
import { ansiRows, BACKSPACE, ENTER, positionOfVk, qwertyLabel, vkOfCode } from '../lib/keys.ts';
import { recipeFor } from '../lib/recipe.ts';
import { graphemes, words as splitWords } from '../lib/scoring.ts';
import { layoutProgress, load, save, today } from '../lib/store.ts';
import { positionOf, physicalKey } from '../lib/check/physical.ts';
import {
  CheckController, cueFor, PROTOCOL, PromptSequence, scheduleAt, SCHEDULE_VERSION, selectVariant, stableHash, TOTAL_SECONDS,
  type Bank, type SelectedVariant,
} from '../lib/check/protocol.ts';
import { Recorder, SCHEMA, type SessionPackage, type Task } from '../lib/check/recorder.ts';
import * as research from '../lib/check/research.ts';
import { canonical, scoreCheck, type CheckResult } from '../lib/check/scorer.ts';
import { S } from '../lib/check/strings.ts';

const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
// The package names layouts by Kala's own keys (the layout file names).
const KALA_KEY: Record<string, string> = { 'kala-goti': 'KalaGoti', 'kala-jhor': 'KalaJhor', unijoy: 'UniJoy' };
const WEB_VERSION = `${pkg.version}-web`;
const LIMITATIONS = [
  'browser-client', 'browser-event-timing', 'system-layout-assumed-us', 'runtime-unavailable', 'engine-events-unavailable',
  'literary-bank-pilot', 'source-family-review-pending', 'observed-pilot-pending', 'physical-geometry-unverified',
  'common-block-cues-assumed', 'native-review-pending',
];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  setup: $('ck-setup'), next: $<HTMLButtonElement>('ck-next'), setupStatus: $('ck-setup-status'), touch: $('ck-touch'),
  work: $('ck-work'), layoutName: $('ck-layout-name'), status: $('ck-status'), bar: $('ck-bar'),
  start: $<HTMLButtonElement>('ck-start'), pause: $<HTMLButtonElement>('ck-pause'), stop: $<HTMLButtonElement>('ck-stop'),
  step: $('ck-step'), stepText: $('ck-step-text'), credit: $('ck-credit'), prompt: $('ck-prompt'),
  probe: $('ck-probe'), probeTask: $('ck-probe-task'), block: $('ck-block'), probeFeedback: $('ck-probe-feedback'),
  hint: $('ck-hint'), ime: $('ck-ime'), result: $('ck-result'),
  share: $('ck-share'), shareText: $('ck-share-text'), shareStatus: $('ck-share-status'),
  preview: $<HTMLButtonElement>('ck-preview'), dont: $<HTMLButtonElement>('ck-dont'), send: $<HTMLButtonElement>('ck-send'),
  thanks: $('ck-thanks'), thanksText: $('ck-thanks-text'),
  counts: $('ck-counts'), researchStatus: $('ck-research-status'),
  dialog: $<HTMLDialogElement>('ck-dialog'), dialogHead: $('ck-dialog-head'), dialogBody: $('ck-dialog-body'),
};

/** Fills {0}, {1}… in both languages; numbers use Bangla digits in the Bangla text. */
const fmt = (text: Text, ...args: (string | number | Text)[]): Text => {
  const fill = (s: string, l: 'en' | 'bn') => s.replace(/\{(\d)\}/g, (_, i) => {
    const a = args[Number(i)];
    return typeof a === 'object' ? a[l] : l === 'bn' ? toBnDigits(a) : String(a);
  });
  return { en: fill(text.en, 'en'), bn: fill(text.bn, 'bn') };
};
const say = (node: HTMLElement, text: Text) => {
  const html = both(text);
  if (node.innerHTML !== html) node.innerHTML = html;
};
const num = (value: number | null): Text => {
  if (value === null || !Number.isFinite(value)) return S.notEnough;
  const s = (Math.round(value * 10) / 10).toFixed(1);
  return { en: s, bn: toBnDigits(s) };
};

// ---------------------------------------------------------------- session state

const seconds = () => performance.now() / 1000;
let protocol = new CheckController(seconds);
let recorder: Recorder | null = null;
let bank: Bank | null = null;
let variant: SelectedVariant | null = null;
let sequence: PromptSequence | null = null;
let layoutId = '';
let composer: FixedComposer | null = null;
let fresh: FixedComposer | null = null;
let keyboard: 'laptop-builtin' | 'external' | 'unknown' = 'unknown';
let identity: research.Contributor | null = null;
let seed = 0;
let seenIds = new Set<string>();
let exposures = new Map<string, number | null>();
let startedUtc = '';
let readyWord = '';
let readyAt = 0;
let stepEnd = 0;
let betweenSteps = false;
let stepKeyboardReady = false;
let stepStartRequested = false;
let startRequested = false;
let resumeRequested = false;
let startedNoticeUntil = 0;
let lastRemaining = -1;
let pausedAt = 0;
let longPauseShown = false;
let finishing = false;
let pkgReady: SessionPackage | null = null;
let result: CheckResult | null = null;
let sentId: string | null = null;
let timer = 0;
const held = new Set<string>(); // physical keys down right now, recorded or not
const allReleased = () => held.size === 0;

// Probe view state (StudyProbeView)
let cue: string[] = [];
let probeNext = 0;
let probeAttempts = 0;
let probeAttemptCorrect = true;
let probeLast: { position: string | null; expected: string; correct: boolean } | null = null;
let probeLastAttemptCorrect = false;
let probeActive = false;
const probeDown = new Set<string>();

// ---------------------------------------------------------------- setup

function selectedLayout() {
  return document.querySelector<HTMLInputElement>('input[name="ck-layout"]:checked')?.value ?? 'kala-goti';
}

function initSetup() {
  const saved = load().layout;
  const choice = saved ? document.querySelector<HTMLInputElement>(`input[name="ck-layout"][value="${saved}"]`) : null;
  if (choice) choice.checked = true;
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) el.touch.hidden = false;
  renderCounts();
  void research.runDue().then(renderCounts);
}

async function prepare() {
  el.next.disabled = true;
  say(el.setupStatus, S.preparing);
  try {
    layoutId = selectedLayout();
    const layout = layoutById(layoutId)!;
    keyboard = (document.querySelector<HTMLInputElement>('input[name="ck-keyboard"]:checked')?.value ?? 'unknown') as typeof keyboard;
    bank ??= (await (await fetch(`${base}data/bn/check.json`)).json()) as Bank;
    if (!bank.variants.some((v) => v.layout_hash === layout.sourceSha256)) {
      say(el.setupStatus, S.noForm);
      return;
    }
    identity = research.nextSession(keyboard);
    seed = stableHash(`${identity.contributor_id}:${identity.session_count}`);
    seenIds = research.seen();
    exposures = new Map(bank.prompts.map((p) => [p.id, research.exposureCount(p.id)]));
    variant = selectVariant(bank, layout.sourceSha256, identity.contributor_id, identity.session_count, seenIds);
    sequence = new PromptSequence(variant, seenIds);
    fresh = FixedComposer.create(layout, charTypes);
    composer = fresh.clone();
    protocol = new CheckController(seconds);
    recorder = new Recorder(performance.now());
    startedUtc = new Date().toISOString().slice(0, 16) + 'Z';
    readyAt = seconds();
    readyWord = variant.anchor.text.split(' ')[0];
    recorder.beginPrompt('ready', readyWord, 'ready', {
      measured: false, repeatOf: null, previouslySeen: false, version: 1,
      task: task('ready', 0, 'ready', 'setup', null, 'unknown', 0, 0, null),
    });
    el.setup.hidden = true;
    el.work.hidden = false;
    say(el.layoutName, layout.name);
    say(el.status, S.title);
    el.credit.hidden = true;
    renderPrompt(readyWord, '');
    say(el.hint, S.ready);
    el.start.disabled = true;
    el.start.hidden = false;
    timer = window.setInterval(tick, 100);
    window.scrollTo({ top: 0 });
  } catch {
    say(el.setupStatus, S.unavailable);
  } finally {
    el.next.disabled = false;
  }
}

const task = (kind: Task['kind'], block: number, family: string, domain: string, exposure: number | null,
  history: Task['exposure_history'], start: number, duration: number, cueKeys: string[] | null): Task => ({
  kind, block, source_family: family, domain, selection_version: SCHEDULE_VERSION, local_exposure_count: exposure,
  exposure_history: history, planned_start: start, planned_duration: duration, cue: cueKeys,
});

// ---------------------------------------------------------------- prompt rendering

/** The typed text over the target: matching clusters green, wrong ones red, the rest muted, caret at the end. */
function renderPrompt(target: string, typed: string) {
  const want = graphemes(canonical(target));
  const got = graphemes(canonical(typed));
  let html = '';
  for (let i = 0; i < Math.max(want.length, got.length); i++) {
    if (i === got.length) html += '<span class="caret" id="ck-caret"></span>';
    if (i < got.length) {
      const pending = i === got.length - 1 && i < want.length && want[i].startsWith(got[i]);
      const cls = got[i] === want[i] || pending ? 'ok' : 'bad';
      html += `<span class="${cls}">${escapeHtml(i < want.length && cls === 'ok' ? want[i] : got[i])}</span>`;
    } else html += `<span class="todo">${escapeHtml(want[i])}</span>`;
  }
  if (got.length >= want.length) html += '<span class="caret" id="ck-caret"></span>';
  el.prompt.innerHTML = html;
  const caret = document.getElementById('ck-caret');
  if (caret) {
    const box = el.prompt.getBoundingClientRect();
    const c = caret.getBoundingClientRect();
    if (c.bottom > box.bottom - 4 || c.top < box.top) el.prompt.scrollTop += c.top - box.top - box.height / 3;
  }
}

function credit(prompt: { author: string | null; title: string | null }) {
  el.credit.hidden = !prompt.author;
  if (prompt.author) el.credit.textContent = `${prompt.author} · ${prompt.title ?? ''}`;
}

// ---------------------------------------------------------------- physical-key tasks

const keyName = (position: string): Text => {
  if (position === 'SHFT' || position === 'LSHF' || position === 'RSHF') return { en: 'Shift', bn: 'Shift' };
  if (position === 'SPCE') return { en: 'Space', bn: 'Space' };
  const vk = Object.entries(positionOfVk).find(([, p]) => p === position)?.[0];
  const label = vk ? qwertyLabel(Number(vk)) : '';
  return label ? { en: label, bn: label } : S.probeOtherKey;
};
const cueMatches = (c: string, position: string | null) => c === position || (c === 'SHFT' && (position === 'LSHF' || position === 'RSHF'));

function renderBlock() {
  const rows = ansiRows.slice(1, 4).map((row) => row.filter((k) => k.kind === 'char' && k.vk !== 220).map((k) => ({ id: positionOfVk[k.vk], label: k.label, w: 1 })));
  rows[0].unshift({ id: '', label: '', w: 1.5 });
  rows[1].unshift({ id: '', label: '', w: 1.75 });
  rows[2].unshift({ id: 'LSHF', label: '⇧', w: 2.25 });
  rows[2].push({ id: 'RSHF', label: '⇧', w: 2.75 });
  rows.push([{ id: '', label: '', w: 3.75 }, { id: 'SPCE', label: 'Space', w: 6.25 }]);
  el.block.innerHTML = rows.map((row) => `<div class="row">${row.map((k) => {
    if (!k.id) return `<span class="gap" style="--w:${k.w}"></span>`;
    const order = cue.map((c, i) => (cueMatches(c, k.id) ? i + 1 : 0)).filter(Boolean).join(',');
    const classes = ['k'];
    if (order) classes.push('cue');
    if (probeActive && cue.length && cueMatches(cue[probeNext], k.id)) classes.push('next');
    if (probeActive && probeLast?.position === k.id) classes.push(probeLast.correct ? 'good' : 'wrong');
    if (probeDown.has(k.id)) classes.push('down');
    return `<span class="${classes.join(' ')}" style="--w:${k.w}">${escapeHtml(k.label)}${order ? `<sup>${order}</sup>` : ''}</span>`;
  }).join('')}</div>`).join('');
}

function setCue(keys: string[]) {
  cue = keys;
  probeNext = probeAttempts = 0;
  probeLast = null;
  probeAttemptCorrect = true;
  probeDown.clear();
  probeActive = false;
}

function observeProbeKey(code: string, keyCode: number, up: boolean, repeat: boolean) {
  if (!probeActive || cue.length === 0) return;
  const { sc, ext } = physicalKey(code, keyCode);
  const position = positionOf(sc, ext === 1) ?? 'unknown';
  if (up) {
    probeDown.delete(position);
    return;
  }
  probeDown.add(position);
  if (repeat) return;
  const expected = cue[probeNext];
  const correct = cueMatches(expected, position);
  probeLast = { position, expected, correct };
  probeAttemptCorrect &&= correct;
  if (++probeNext === cue.length) {
    probeAttempts++;
    probeLastAttemptCorrect = probeAttemptCorrect;
    probeNext = 0;
    probeAttemptCorrect = true;
  }
}

function renderProbe() {
  if (el.probe.hidden || cue.length === 0) return;
  const sequenceText: Text = { en: cue.map((c) => keyName(c).en).join(' → '), bn: cue.map((c) => keyName(c).bn).join(' → ') };
  const running = protocol.state === 'running';
  say(el.probeTask, running
    ? fmt(S.probeRunning, sequenceText, Math.ceil(Math.max(0, stepEnd - protocol.activeSeconds)))
    : fmt(betweenSteps ? S.probePreview : S.probePausedTask, sequenceText));
  if (!probeActive) say(el.probeFeedback, betweenSteps ? S.probeWaiting : S.probePaused);
  else {
    const next = fmt(S.probeNext, keyName(cue[probeNext]), probeAttempts);
    const received = probeLast === null ? S.probeListening
      : probeNext === 0 ? (probeLastAttemptCorrect ? S.probeSequenceCorrect : S.probeSequenceWrong)
        : probeLast.correct ? fmt(S.probeReceived, keyName(probeLast.position ?? '')) : fmt(S.probeWrong, keyName(probeLast.position ?? ''), keyName(probeLast.expected));
    say(el.probeFeedback, { en: `${received.en} ${next.en}`, bn: `${received.bn} ${next.bn}` });
  }
  renderBlock();
}

// ---------------------------------------------------------------- protocol steps

function startCheck() {
  if (!recorder || protocol.state !== 'ready' || el.start.disabled) return;
  if (!allReleased()) {
    if (!startRequested) recorder.pause('button');
    startRequested = true;
    say(el.hint, S.releaseKeys);
    return;
  }
  if (startRequested) {
    recorder.resume();
    startRequested = false;
  }
  if (!recorder.keys.some((k) => !k.up && k.consumed && k.vk >= 0x30 && k.vk <= 0x5a)) recorder.flag('physical-events-missing');
  recorder.endPrompt('enter');
  recorder.boundary('ready-check-passed');
  protocol.start();
  el.start.hidden = true;
  el.pause.hidden = el.stop.hidden = false;
  showPrompt();
  showStartedNotice();
}

/** Protocol r5: Enter ends a part only once its last word has been started. */
function reachedLastWord(text: string, target: string) {
  const count = target.split('\n').reduce((n, line) => n + splitWords(line).length, 0);
  if (count === 0) return text.length > 0;
  const typed = text.split(' ');
  return typed.length > count || (typed.length === count && typed[count - 1].length > 0);
}

let currentTarget = '';

function showPrompt() {
  if (!recorder || !sequence) return;
  const stage = protocol.stage;
  const trial = sequence.next(stage, recorder.prompts.length);
  const prompt = trial.prompt;
  const timing = scheduleAt(protocol.activeSeconds, seed);
  stepEnd = timing.start + timing.duration;
  const probe = timing.kind === 'physical-probe';
  // Unknown physical geometry stays unknown; the cue is a named shared-position profile only.
  const cueKeys = probe ? cueFor(seed, timing.block) : null;
  composer = fresh!.clone();
  currentTarget = probe ? '' : prompt.text;
  el.probe.hidden = !probe;
  el.prompt.hidden = probe;
  if (probe) setCue(cueKeys!);
  else renderPrompt(prompt.text, '');
  el.prompt.scrollTop = 0;
  if (probe) el.credit.hidden = true;
  else credit(prompt);
  say(el.hint, probe ? S.probeInstructions : prompt.passage ? (trial.repeatOf !== null && stage !== 'anchor-repeat' ? S.passageRepeatHint : S.passageHint) : S.typingHint);
  recorder.beginPrompt(probe ? `probe-${timing.block}` : prompt.id, probe ? '' : prompt.text, stage, {
    measured: timing.kind !== 'warmup' && timing.kind !== 'physical-probe',
    repeatOf: probe ? null : trial.repeatOf,
    previouslySeen: !probe && trial.previouslySeen,
    version: prompt.version,
    task: task(timing.kind, timing.block,
      probe ? 'physical-cue-common-v1' : prompt.family ?? `unreviewed:${prompt.id}`,
      probe ? 'physical-probe-common-block' : prompt.family === null ? 'authored-calibration' : 'literary',
      probe ? null : exposures.get(prompt.id) ?? null, 'bounded-local-history', timing.start, timing.duration, cueKeys),
  });
  probeActive = probe && protocol.state === 'running';
  renderProbe();
}

function nextPrompt() {
  if (waitForNextStep()) return;
  recorder?.endPrompt('enter');
  if (!protocol.advance()) return void finish('completed');
  showPrompt();
}

function showStartedNotice() {
  startedNoticeUntil = seconds() + 2;
  lastRemaining = -1;
  say(el.status, S.stepStarted);
}

/** At a timed step boundary: end the part, pause capture, and preview the next task until a fresh Enter. */
function waitForNextStep(): boolean {
  if (!recorder || protocol.state !== 'running' || stepEnd <= 0 || stepEnd >= TOTAL_SECONDS || protocol.activeSeconds < stepEnd) return false;
  protocol.pauseAtStepBoundary(stepEnd);
  recorder.pause('step-transition');
  recorder.endPrompt('timeout');
  betweenSteps = true;
  resumeRequested = false;
  stepKeyboardReady = allReleased();
  pausedAt = seconds();
  longPauseShown = false;
  showPrompt(); // the preview sits inside the recorded pause, so reading time is excluded
  el.pause.hidden = true;
  el.start.hidden = false;
  el.start.disabled = false;
  say(el.start, S.beginNextStep);
  say(el.stepText, S.stepReady);
  el.step.hidden = false;
  say(el.status, S.stepPausedTitle);
  window.scrollTo({ top: 0 });
  return true;
}

function requestStepByEnter() {
  // A new Enter confirms only after all keys were seen released during this pause.
  if (!betweenSteps || !stepKeyboardReady || stepStartRequested) return;
  stepKeyboardReady = false;
  beginNextStep();
}

function beginNextStep() {
  if (!betweenSteps || !recorder || protocol.state !== 'paused') return;
  if (!allReleased()) {
    stepStartRequested = true;
    say(el.stepText, S.releaseKeys);
    say(el.status, S.releaseKeys);
    return;
  }
  stepStartRequested = false;
  betweenSteps = false;
  el.step.hidden = true;
  protocol.resume();
  recorder.resume();
  probeActive = recorder.probeActive;
  el.start.hidden = true;
  say(el.start, S.start);
  el.pause.hidden = false;
  say(el.pause, S.pause);
  showStartedNotice();
  renderProbe();
}

function pauseCheck(reason: 'focus-loss' | 'button' | 'mode-change') {
  if (waitForNextStep()) return;
  if (protocol.state !== 'running' || !recorder) return;
  protocol.pause();
  recorder.pause(reason);
  composer?.reset();
  probeActive = false;
  pausedAt = seconds();
  longPauseShown = false;
  say(el.pause, S.resume);
  say(el.hint, S.paused);
  renderProbe();
}

function resumeCheck() {
  if (betweenSteps) return; // a continued letter or click is never consent to begin another task
  if (protocol.state !== 'paused' || !recorder) return;
  if (!allReleased()) {
    resumeRequested = true;
    say(el.hint, S.releaseKeys);
    return;
  }
  resumeRequested = false;
  protocol.resume();
  recorder.resume();
  probeActive = recorder.probeActive;
  say(el.pause, S.pause);
  say(el.hint, probeActive ? S.probeInstructions : ['natural-1', 'natural-2', 'anchor-repeat'].includes(protocol.stage) ? S.passageHint : S.typingHint);
  renderProbe();
}

function afterRelease() {
  if (!allReleased()) return;
  if (stepStartRequested) beginNextStep();
  else if (startRequested) startCheck();
  else if (resumeRequested) resumeCheck();
  else if (betweenSteps) stepKeyboardReady = true;
}

function tick() {
  if (finishing || !recorder) return;
  afterRelease();
  if (recorder.captureFailed) return void finish('interrupted');
  if ((protocol.state === 'paused' || betweenSteps) && !longPauseShown && seconds() - pausedAt >= 600) {
    longPauseShown = true;
    say(el.hint, S.longPause);
  }
  if (protocol.state === 'ready') {
    if (startRequested) return;
    const typed = recorder.typed;
    say(el.hint, !el.start.disabled && !recorder.keys.some((k) => !k.up && k.consumed && k.vk >= 0x30 && k.vk <= 0x5a) ? S.readyNoPhysical
        : typed.length === 0 && seconds() - readyAt > 20 ? S.readyHint : S.ready);
    return;
  }
  if (protocol.state !== 'running') return;
  if (waitForNextStep()) return;
  if (protocol.tick()) return void finish('completed');
  if (probeActive) renderProbe();
  el.bar.style.setProperty('--p', String(protocol.activeSeconds / TOTAL_SECONDS));
  el.bar.setAttribute('aria-valuenow', String(Math.round((protocol.activeSeconds / TOTAL_SECONDS) * 100)));
  if (seconds() < startedNoticeUntil) return;
  const bucket = Math.floor(protocol.activeSeconds / 30);
  if (bucket === lastRemaining) return;
  lastRemaining = bucket;
  const remaining = Math.ceil((TOTAL_SECONDS - protocol.activeSeconds) / 60);
  say(el.status, remaining <= 1 ? S.almostDone : fmt(S.aboutRemaining, remaining));
}

// ---------------------------------------------------------------- typing

function type(vk: number, shift: boolean, seq: number) {
  if (!recorder || !composer) return;
  const typed = recorder.typed;
  let next = typed;
  if (vk === BACKSPACE) {
    if (!typed) return;
    next = typed.slice(0, -1);
    composer.continueAfter(next);
    recorder.text(next, seq, 'native-key');
  } else {
    const result = composer.translate(vk, shift);
    if (result.suppress) recorder.consumed(seq);
    if (result.suppress || result.output === null) return;
    if (typed.length - result.backspaces + result.output.length > 2048) return;
    recorder.consumed(seq);
    recorder.delivered(seq, result.backspaces, result.output);
    next = apply(typed, result);
    recorder.text(next, seq, 'kala-delivery');
  }
  if (protocol.state === 'ready') {
    el.start.disabled = next.replace(/ +$/, '') !== readyWord;
    renderPrompt(readyWord, next);
    if (!el.start.disabled && next.endsWith(' ')) setTimeout(startCheck);
  } else renderPrompt(currentTarget, next);
}

const isButton = (target: EventTarget | null) => target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement || target instanceof HTMLInputElement;

window.addEventListener('keydown', (e) => {
  if (!recorder || finishing || protocol.state === 'result' || protocol.state === 'discarded') return;
  if (e.isComposing || e.key === 'Process' || e.keyCode === 229) {
    say(el.ime, S.ime);
    el.ime.hidden = false;
    return;
  }
  held.add(e.code);
  if (betweenSteps) {
    if (e.key === 'Tab') return;
    if (e.key === 'Enter' && isButton(e.target) && e.target === el.stop) return;
    e.preventDefault();
    if (e.key === 'Enter' && !e.repeat) requestStepByEnter();
    return;
  }
  if (protocol.state === 'paused') {
    if (e.key === 'Tab' || (e.key === 'Enter' && isButton(e.target))) return;
    e.preventDefault();
    resumeCheck();
    return;
  }
  if (protocol.state === 'running' && waitForNextStep()) {
    e.preventDefault();
    return;
  }
  const seq = recorder.key({ code: e.code, keyCode: e.keyCode, up: false, caps: e.getModifierState('CapsLock'), timeStamp: e.timeStamp });
  if (protocol.state === 'running' && recorder.probeActive) {
    // Every recorded press counts toward the key task, as in the recorder; none reaches the text.
    if (e.key !== 'Tab') e.preventDefault();
    observeProbeKey(e.code, e.keyCode, false, e.repeat);
    renderProbe();
    return;
  }
  if (e.key === 'Tab' || (e.key === 'Enter' && isButton(e.target))) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return; // browser shortcuts pass through, as native keys do
  e.preventDefault();
  if (e.key === 'Escape') return pauseCheck('button');
  if (e.key === 'Enter') {
    if (protocol.state === 'ready') startCheck();
    else if (protocol.state === 'running' && reachedLastWord(recorder.typed, currentTarget)) nextPrompt();
    return;
  }
  const vk = vkOfCode[e.code];
  if (vk === undefined || vk === ENTER) return;
  type(vk, e.shiftKey, seq);
});

window.addEventListener('keyup', (e) => {
  held.delete(e.code);
  if (!recorder || finishing) return;
  recorder.key({ code: e.code, keyCode: e.keyCode, up: true, caps: e.getModifierState('CapsLock'), timeStamp: e.timeStamp });
  if (recorder.probeActive && probeActive) {
    observeProbeKey(e.code, e.keyCode, true, false);
    renderProbe();
  }
  afterRelease();
});

window.addEventListener('blur', () => {
  held.clear();
  if (!recorder || finishing) return;
  if (protocol.state === 'running') pauseCheck('focus-loss');
  else if (protocol.state === 'ready') recorder.pause('focus-loss');
});
window.addEventListener('focus', () => {
  if (recorder && protocol.state === 'ready' && !startRequested) recorder.resume();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && recorder && protocol.state === 'running') pauseCheck('focus-loss');
});
document.addEventListener('paste', (e) => {
  e.preventDefault();
  if (protocol.state === 'ready' || protocol.state === 'running') recorder?.flag('paste-attempted');
});
window.addEventListener('beforeunload', (e) => {
  if (recorder && !finishing && (protocol.state === 'ready' || protocol.state === 'running' || protocol.state === 'paused')) e.preventDefault();
});

// A clicked button gives focus back, so Enter and Space keep typing instead of pressing it again.
const unfocus = () => (document.activeElement as HTMLElement | null)?.blur();
el.next.addEventListener('click', () => void prepare());
el.start.addEventListener('click', () => {
  unfocus();
  if (betweenSteps) beginNextStep();
  else startCheck();
});
el.pause.addEventListener('click', () => {
  unfocus();
  if (protocol.state === 'paused') resumeCheck();
  else pauseCheck('button');
});
el.stop.addEventListener('click', () => {
  stepStartRequested = false; // a pending Enter/mouse start must not run behind the Stop confirmation
  if (confirm(t(S.confirmStop))) void finish('stopped');
});
el.prompt.addEventListener('pointerdown', () => protocol.state === 'paused' && !betweenSteps && resumeCheck());

// ---------------------------------------------------------------- result

async function finish(completion: 'completed' | 'stopped' | 'interrupted') {
  if (finishing || !recorder || !variant || !identity || !bank) return;
  finishing = true;
  clearInterval(timer);
  if (protocol.state !== 'result') protocol.stop(completion);
  recorder.pause('button');
  el.work.hidden = true;
  say(el.result, S.scoring);
  el.result.hidden = false;
  const layout = layoutById(layoutId)!;
  const p = recorder.finish({
    session: {
      contributor_id: identity.contributor_id,
      session_id: `s_${[...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')}`,
      session_number: identity.session_count,
      prompt_bank_version: bank.version,
      variant_id: variant.variant.id,
      randomization_seed: seed,
      kala_version: WEB_VERSION,
      build_configuration: import.meta.env.DEV ? 'Debug' : 'Release',
      os_version: 'unknown',
      keyboard_category: keyboard,
      geometry: 'unknown',
      started_utc: startedUtc,
      protocol_version: PROTOCOL,
    },
    input: {
      layout_id: KALA_KEY[layoutId] ?? layoutId,
      layout_name: layout.name.en,
      origin: 'bundled',
      input_family: 'fixed',
      mapping_hash: `sha256:${layout.sourceSha256}`,
      engine_version: `kala-learn-web-${pkg.version}/FixedComposer`,
      composition_only: true,
      autocorrect_enabled: false,
      spelling_correction_enabled: false,
      suggestions_enabled: false,
      spelling_marks_enabled: false,
      personal_rules_enabled: false,
    },
    collection: {
      notice_version: 'bhe-sharing-1-web',
      wave: 'bhe-web-pilot-1',
      category_source: keyboard === 'unknown' ? 'unknown' : 'existing-unverified-selection',
      geometry_source: 'unknown',
      render_geometry: 'ansi',
      bank_sha256: bank.bank_sha256,
      runtime: null,
      limitations: LIMITATIONS,
      assignment: Object.fromEntries(Object.entries(variant.stages).map(([stage, prompts]) => [stage, prompts.map((x) => x.id)])),
      prompt_selection_version: 'variant-selector-history-aware-1',
      linkage: 'local-store-lineage-unverified-person',
      modifier_convention: 'before-transition',
      validation_scope: 'provisional-collection-not-person-validation',
    },
    completion: protocol.completion,
    activeSeconds: protocol.activeSeconds,
    observedSeconds: protocol.activeSecondsObserved,
  });
  result = scoreCheck(p, { fresh: fresh!, units: [...unitMap('bn').values()] });
  p.summary = result.summary;
  pkgReady = p;
  let saved = true;
  try {
    research.keepResult(p, false);
  } catch {
    saved = false;
  }
  saved = commitToLearn(result) && saved;
  const previous = research.history().filter((h) => h.layout_id === p.input.layout_id && h.session_id !== p.session.session_id && h.protocol === PROTOCOL && h.bank_version === bank!.version).slice(-5);
  renderResult(p, result, previous, saved);
  finishing = false;
  recorder = null;
}

/** Adds the check's per-unit evidence and a session to Learn progress (SkillCheckScorer.Commit). */
function commitToLearn(r: CheckResult) {
  const progress = load();
  const lp = layoutProgress(progress, layoutId);
  const now = Date.now();
  for (const e of r.evidence) {
    const u = (lp.units[e.unit] ??= { seen: 0, correct: 0, independent: 0, lastAt: 0 });
    u.seen++;
    if (e.correct) {
      u.correct++;
      u.independent++;
    }
    u.lastAt = now;
  }
  const ms = r.activeSeconds * 1000;
  progress.sessions.push({
    at: now, layout: layoutId, step: 'skill-check', ms, accuracy: r.summary.accuracy ?? 0,
    gpm: r.summary.correct_gpm, wpm: r.summary.wpm5, qualified: r.speedQualifies, units: r.referenceUnits,
  });
  progress.days[today()] = (progress.days[today()] ?? 0) + ms;
  return save(progress);
}

function unitKeys(unitId: string): string {
  const unit = unitMap('bn').get(unitId);
  if (!unit || !fresh) return '';
  const steps = recipeFor(fresh, unit.text);
  return steps ? steps.map((s) => (s.shift ? `Shift+${qwertyLabel(s.vk)}` : qwertyLabel(s.vk))).join(' ') : '';
}

function renderResult(p: SessionPackage, r: CheckResult, previous: research.HistoryRow[], saved: boolean) {
  const s = r.summary;
  const layout = layoutById(layoutId)!;
  const tile = (label: Text, value: Text, sub?: Text) =>
    `<div class="card tile"><span class="muted small">${both(label)}</span><b>${both(value)}</b>${sub ? `<span class="muted small">${both(sub)}</span>` : ''}</div>`;
  const pct = (v: number | null): Text => (v === null ? S.notEnough : { en: `${num(v).en}%`, bn: `${num(v).bn}%` });
  const problems = r.problemUnits.map((u) => `${display(unitMap('bn').get(u)?.text ?? u)} ${unitKeys(u)}`.trim());
  const slow = r.slowKeys.map((k) => ({ en: `${keyName(k.position).en} ${num(k.medianSeconds).en}`, bn: `${keyName(k.position).bn} ${num(k.medianSeconds).bn}` }));
  const join = (list: Text[]): Text => (list.length ? { en: list.map((x) => x.en).join(', '), bn: list.map((x) => x.bn).join(', ') } : S.notEnough);
  // Inside a sentence a missing number is a dash; a tile says why it is missing.
  const inline = (v: number | null): Text => (v === null ? { en: '—', bn: '—' } : num(v));
  const label = (name: Text, value: Text): Text => ({ en: `${name.en}: ${value.en}`, bn: `${name.bn}: ${value.bn}` });
  el.result.innerHTML = `
    <p class="eyebrow">${both(S.title)}</p>
    <h1>${both(S.result)}</h1>
    <p class="muted">${both(p.session.completion === 'completed' ? S.snapshot : S.stoppedSnapshot)}</p>
    <div class="tiles">
      ${tile(S.speedSample, num(s.wpm5), s.correct_gpm === null ? undefined : fmt({ en: '{0} correct letters/min', bn: '{0} সঠিক অক্ষর/মিনিট' }, num(s.correct_gpm)))}
      ${tile(S.accuracySample, pct(s.accuracy))}
      ${tile(S.firstTrySample, pct(s.first_try_accuracy))}
      ${tile(S.correctionsSample, { en: String(s.correction_episodes), bn: toBnDigits(s.correction_episodes) }, fmt({ en: '{0} Backspace presses', bn: '{0} বার Backspace' }, s.backspace_presses))}
    </div>
    <ul>
      <li>${both(s.wpm5 === null ? label(S.speedSample, S.notEnough) : fmt(S.speed, num(s.wpm5), num(s.correct_gpm)))}</li>
      <li>${both(fmt(S.corrections, s.correction_episodes, s.backspace_presses))}</li>
      <li>${both(fmt(S.problems, problems.length ? { en: problems.join(', '), bn: problems.join(', ') } : S.notEnough))}</li>
      <li>${both(fmt(S.slow, join(slow)))}</li>
      <li>${both(fmt(S.comparison, inline(s.anchor_first_wpm5), inline(s.anchor_repeat_wpm5)))}</li>
      <li>${both(previous.length ? fmt(S.recentHistory, join(previous.map((h) => inline(h.wpm5)))) : S.noHistory)}</li>
    </ul>
    <p class="muted small">${both(saved ? fmt(S.added, layout.name) : S.saveFailed)}</p>
    <div class="ck-actions">
      ${r.problemUnits.length ? `<a class="btn" href="${base}learn/${layoutId}/">${both(S.practise)}</a>` : ''}
    </div>`;
  const shareable = p.integrity.text_replay_ok && p.integrity.dropped_events === 0 &&
    !p.session.quality_flags.some((f) => ['physical-events-missing', 'onscreen-keyboard-used', 'roman-output-detected', 'layout-change'].includes(f));
  el.share.hidden = false;
  el.send.disabled = true;
  say(el.shareText, shareable ? S.collectionNotice : S.notShareable);
  el.shareStatus.hidden = !shareable;
  if (shareable) void refreshSharing();
  el.preview.focus();
}

async function refreshSharing(): Promise<boolean> {
  const p = pkgReady;
  if (!p) return false;
  el.send.disabled = true;
  say(el.shareStatus, S.checkingService);
  const config = await research.serviceConfig();
  if (pkgReady !== p) return false;
  let message: Text;
  if (config && !config.accepting) message = S.collectionClosed;
  else if (config && !research.supports(config, SCHEMA, p.session.protocol_version)) message = S.serviceIncompatible;
  else if (config && (await research.gzip(p).then((g) => g.length > config.maxPackageBytes, () => true))) message = S.packageTooLarge;
  else message = config ? S.serviceAvailable : S.serviceOffline;
  say(el.shareStatus, message);
  el.send.disabled = !(message === S.serviceAvailable || message === S.serviceOffline);
  return !el.send.disabled;
}

el.preview.addEventListener('click', () => {
  const p = pkgReady;
  if (!p) return;
  const shown = { ...p, key_events: { ...p.key_events, rows: p.key_events.rows.slice(0, 20) } };
  say(el.dialogHead, fmt(S.previewHeader, p.key_events.rows.length));
  el.dialogBody.textContent = JSON.stringify(shown, null, 2);
  el.dialog.showModal();
});

function showThanks(text: Text) {
  el.share.hidden = true;
  el.thanks.hidden = false;
  say(el.thanksText, text);
}

el.dont.addEventListener('click', () => {
  pkgReady = null;
  showThanks(S.discarded);
});

el.send.addEventListener('click', async () => {
  const p = pkgReady;
  if (!p || el.send.disabled) return;
  el.send.disabled = el.dont.disabled = true;
  try {
    // Recheck on a deliberate Send so a study closed since the result is not queued.
    if (!(await refreshSharing())) return;
    el.send.disabled = true;
    await research.enqueue(p);
    sentId = p.session.session_id;
    pkgReady = null;
    showThanks(S.queued);
    await research.runDue();
    showUploadState();
  } catch {
    say(el.shareStatus, S.sendFailed);
    el.send.disabled = false;
  } finally {
    el.dont.disabled = false;
    renderCounts();
  }
});

function showUploadState() {
  if (!sentId) return;
  const state = research.uploadState(sentId);
  say(el.thanksText, { sent: S.sent, stopped: S.uploadStopped, 'version-wait': S.updateNeeded, 'destination-changed': S.destinationChanged, removed: S.discarded, pending: S.pending }[state]);
}

// ---------------------------------------------------------------- research controls

function renderCounts() {
  const c = research.counts();
  say(el.counts, fmt(S.researchCounts, c.pending, c.receipts));
}

$('ck-remove-pending').addEventListener('click', () => {
  research.removePending();
  renderCounts();
  say(el.researchStatus, S.done);
});
$('ck-remove-history').addEventListener('click', () => {
  research.clearHistory();
  say(el.researchStatus, S.done);
});
$('ck-withdraw').addEventListener('click', async () => {
  if (!confirm(t(S.confirmWithdraw))) return;
  const status = await research.requestDeletion();
  renderCounts();
  say(el.researchStatus, status === 202 ? S.withdrawn : S.withdrawFailed);
});
$('ck-fresh').addEventListener('click', () => {
  if (!confirm(t(S.confirmFresh))) return;
  research.freshIdentity();
  renderCounts();
  say(el.researchStatus, S.done);
});

document.addEventListener('kala:lang', () => {
  if (protocol.state === 'running' || betweenSteps) renderProbe();
});
initSetup();
