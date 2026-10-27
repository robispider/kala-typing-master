// Typing skill check: protocol, recorder and scorer against Kala's desktop contract. A whole check is
// simulated with the real prompt bank and composer on a fake clock. Set CHECK_PACKAGE_OUT to a folder to
// also write the gzip package, for posting to Kala's mock research server (tools/typing-study-server).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { apply, FixedComposer, type CharTypes, type FixedLayout } from '../src/lib/composer.ts';
import { recipeFor } from '../src/lib/recipe.ts';
import { words } from '../src/lib/scoring.ts';
import {
  CheckController, cueFor, PROTOCOL, PromptSequence, scheduleAt, SCHEDULE_VERSION, selectVariant, stableHash, type Bank,
} from '../src/lib/check/protocol.ts';
import { physicalKey, positionOf } from '../src/lib/check/physical.ts';
import { Recorder, replay, type SessionPackage, type Task } from '../src/lib/check/recorder.ts';
import { scoreCheck } from '../src/lib/check/scorer.ts';

const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const bank: Bank = json('../public/data/bn/check.json');
const layouts: (FixedLayout & { sourceSha256: string; name: { en: string } })[] = json('../src/data/layouts.json');
const types: CharTypes = json('../src/data/chartypes.json');
const units: { id: string; text: string }[] = json('../src/data/units.json').bn;

test('stable hash is FNV-1a over UTF-16 units, masked like LearningService.StableHash', () => {
  assert.equal(stableHash(''), 2166136261 & 0x7fffffff);
  assert.equal(stableHash('a'), 0xe40c292c & 0x7fffffff);
  assert.equal(stableHash('foobar'), 0xbf9cf968 & 0x7fffffff);
});

test('schedule: eight counterbalanced orders of two targeted and two physical blocks', () => {
  const orders = new Set<string>();
  for (let seed = 0; seed < 8; seed++) {
    const kinds = [100, 120, 140, 160].map((t) => scheduleAt(t, seed).kind);
    assert.equal(kinds.filter((k) => k === 'targeted').length, 2);
    orders.add(kinds.join());
  }
  assert.equal(orders.size, 4); // seeds 4–7 reverse seeds 0–3, which repeats the rotation set
  assert.deepEqual([0, 19.9, 20, 99, 180, 239, 240].map((t) => scheduleAt(t, 0).kind), ['warmup', 'warmup', 'natural', 'natural', 'natural', 'natural', 'anchor']);
});

test('the bank has validated forms for every web Bangla layout, with an ordered first passage', () => {
  for (const id of ['kala-goti', 'kala-jhor', 'unijoy']) {
    const layout = layouts.find((l) => l.id === id)!;
    const v = selectVariant(bank, layout.sourceSha256, `c_${'0'.repeat(32)}`, 1, new Set());
    assert.ok(v.anchor.passage && v.anchor.passage.order === 0, id);
    assert.deepEqual(v.stages['natural-1'].map((p) => p.passage!.order), v.stages['natural-1'].map((_, i) => i));
  }
});

test('physical keys map to the desktop scan codes and positions', () => {
  assert.deepEqual(physicalKey('KeyJ', 74), { vk: 0x4a, sc: 0x24, ext: 0 });
  assert.equal(positionOf(0x24, false), 'AC07');
  assert.equal(positionOf(physicalKey('ShiftRight', 16).sc, false), 'RSHF');
  assert.equal(positionOf(physicalKey('Space', 32).sc, false), 'SPCE');
  assert.equal(positionOf(physicalKey('KeyR', 82).sc, false), 'AD04');
});

/** Plays a whole check the way src/scripts/check.ts drives it, on a fake clock. */
function simulate(layoutId: string, mistakeEvery: number) {
  const layout = layouts.find((l) => l.id === layoutId)!;
  const fresh = FixedComposer.create(layout, types);
  const contributor = `c_${'ab'.repeat(16)}`;
  const session = 3;
  const seed = stableHash(`${contributor}:${session}`);
  const variant = selectVariant(bank, layout.sourceSha256, contributor, session, new Set());
  const sequence = new PromptSequence(variant, new Set());
  let clock = 1000; // seconds
  const ctrl = new CheckController(() => clock);
  const rec = new Recorder(clock * 1000, () => clock * 1000);
  let composer = fresh.clone();
  let stepEnd = 0;
  let target = '';
  let presses = 0;

  const codeOf = (vk: number) =>
    vk === 32 ? 'Space' : vk === 8 ? 'Backspace' : vk === 13 ? 'Enter' : vk >= 65 && vk <= 90 ? `Key${String.fromCharCode(vk)}` : vk >= 48 && vk <= 57 ? `Digit${vk - 48}`
      : ({ 186: 'Semicolon', 187: 'Equal', 188: 'Comma', 189: 'Minus', 190: 'Period', 191: 'Slash', 192: 'Backquote', 219: 'BracketLeft', 220: 'Backslash', 221: 'BracketRight', 222: 'Quote' } as Record<number, string>)[vk];
  const transition = (code: string, up: boolean, dt: number) => {
    clock += dt;
    return rec.key({ code, keyCode: 0, up, caps: false, timeStamp: clock * 1000 });
  };
  const press = (vk: number, shift: boolean) => {
    presses++;
    if (shift) transition('ShiftLeft', false, 0.05);
    const seq = transition(codeOf(vk), false, 0.12);
    const typed = rec.typed;
    if (vk === 8) {
      if (typed) {
        const next = typed.slice(0, -1);
        composer.continueAfter(next);
        rec.text(next, seq, 'native-key');
      }
    } else if (vk !== 13) {
      const r = composer.translate(vk, shift);
      if (r.suppress) rec.consumed(seq);
      if (!r.suppress && r.output !== null) {
        rec.consumed(seq);
        rec.delivered(seq, r.backspaces, r.output);
        rec.text(apply(typed, r), seq, 'kala-delivery');
      }
    }
    transition(codeOf(vk), true, 0.06);
    if (shift) transition('ShiftLeft', true, 0.02);
  };
  const task = (kind: Task['kind'], block: number, family: string, domain: string, start: number, duration: number, cue: string[] | null): Task => ({
    kind, block, source_family: family, domain, selection_version: SCHEDULE_VERSION, local_exposure_count: null,
    exposure_history: kind === 'ready' ? 'unknown' : 'bounded-local-history', planned_start: start, planned_duration: duration, cue,
  });
  const showPrompt = () => {
    const trial = sequence.next(ctrl.stage, rec.prompts.length);
    const timing = scheduleAt(ctrl.activeSeconds, seed);
    stepEnd = timing.start + timing.duration;
    const probe = timing.kind === 'physical-probe';
    composer = fresh.clone();
    target = probe ? '' : trial.prompt.text;
    rec.beginPrompt(probe ? `probe-${timing.block}` : trial.prompt.id, target, ctrl.stage, {
      measured: timing.kind !== 'warmup' && !probe, repeatOf: probe ? null : trial.repeatOf, previouslySeen: !probe && trial.previouslySeen,
      version: trial.prompt.version,
      task: task(timing.kind, timing.block, probe ? 'physical-cue-common-v1' : trial.prompt.family ?? `unreviewed:${trial.prompt.id}`,
        probe ? 'physical-probe-common-block' : trial.prompt.family === null ? 'authored-calibration' : 'literary', timing.start, timing.duration,
        probe ? cueFor(seed, timing.block) : null),
    });
  };
  const typeWords = (text: string) => {
    for (const [i, word] of words(text).entries()) {
      if (i > 0) press(32, false);
      const steps = recipeFor(fresh, word) ?? [];
      for (const s of steps) {
        if (presses % mistakeEvery === mistakeEvery - 1) {
          press(81, false); // a wrong key, then fixed with Backspace
          press(8, false);
        }
        press(s.vk, s.shift);
        if (ctrl.state === 'running' && ctrl.activeSeconds >= stepEnd) return false;
      }
    }
    return true;
  };

  // Ready word, then Space starts the check.
  const readyWord = variant.anchor.text.split(' ')[0];
  rec.beginPrompt('ready', readyWord, 'ready', { measured: false, repeatOf: null, previouslySeen: false, version: 1, task: task('ready', 0, 'ready', 'setup', 0, 0, null) });
  typeWords(readyWord);
  press(32, false);
  rec.endPrompt('enter');
  rec.boundary('ready-check-passed');
  ctrl.start();
  showPrompt();

  while (ctrl.state === 'running') {
    if (stepEnd < 260 && ctrl.activeSeconds >= stepEnd) {
      ctrl.pauseAtStepBoundary(stepEnd);
      rec.pause('step-transition');
      rec.endPrompt('timeout');
      showPrompt();
      clock += 2; // reading the preview is excluded
      ctrl.resume();
      rec.resume();
      continue;
    }
    if (ctrl.tick()) break;
    const prompt = rec.currentPrompt!;
    if (prompt.task.kind === 'physical-probe') {
      for (const c of prompt.task.cue!) {
        const code = c === 'SHFT' ? 'ShiftRight' : c === 'SPCE' ? 'Space' : ({ AC01: 'KeyA', AC03: 'KeyD', AC04: 'KeyF', AC07: 'KeyJ', AC08: 'KeyK', AD04: 'KeyR' } as Record<string, string>)[c];
        transition(code, false, 0.25);
        transition(code, true, 0.08);
      }
      continue;
    }
    if (typeWords(target)) {
      transition('Enter', false, 0.1);
      transition('Enter', true, 0.05);
      rec.endPrompt('enter');
      if (!ctrl.advance()) break;
      showPrompt();
    }
  }
  if (ctrl.state !== 'result') ctrl.stop('completed');
  rec.pause('button');
  const p: SessionPackage = rec.finish({
    session: {
      contributor_id: contributor, session_id: `s_${'0123456789abcdef'.repeat(2)}`, session_number: session, prompt_bank_version: bank.version,
      variant_id: variant.variant.id, randomization_seed: seed, kala_version: '0.1.0-web', build_configuration: 'Debug', os_version: 'unknown',
      keyboard_category: 'external', geometry: 'unknown', started_utc: '2026-10-28T09:12Z', protocol_version: PROTOCOL,
    },
    input: {
      layout_id: 'KalaGoti', layout_name: layout.name.en, origin: 'bundled', input_family: 'fixed', mapping_hash: `sha256:${layout.sourceSha256}`,
      engine_version: 'kala-learn-web-0.1.0/FixedComposer', composition_only: true, autocorrect_enabled: false, spelling_correction_enabled: false,
      suggestions_enabled: false, spelling_marks_enabled: false, personal_rules_enabled: false,
    },
    collection: {
      notice_version: 'bhe-sharing-1-web', wave: 'bhe-web-pilot-1', category_source: 'existing-unverified-selection', geometry_source: 'unknown',
      render_geometry: 'ansi', bank_sha256: bank.bank_sha256, runtime: null, limitations: ['browser-client', 'runtime-unavailable'],
      assignment: Object.fromEntries(Object.entries(variant.stages).map(([s, list]) => [s, list.map((x) => x.id)])),
      prompt_selection_version: 'variant-selector-history-aware-1', linkage: 'local-store-lineage-unverified-person',
      modifier_convention: 'before-transition', validation_scope: 'provisional-collection-not-person-validation',
    },
    completion: ctrl.completion, activeSeconds: ctrl.activeSeconds, observedSeconds: ctrl.activeSecondsObserved,
  });
  const result = scoreCheck(p, { fresh, units });
  p.summary = result.summary;
  return { p, result };
}

test('a full simulated check records a consistent package and a result', () => {
  const { p, result } = simulate('kala-goti', 41);
  assert.equal(p.session.completion, 'completed');
  assert.equal(p.session.active_seconds, 260);
  assert.ok(replay(p.prompts, p.text_events, p.boundaries), 'text replay');
  assert.ok(p.integrity.text_replay_ok);
  assert.deepEqual(p.session.quality_flags, []);
  assert.deepEqual([...new Set(p.prompts.map((x) => x.stage))], ['ready', 'warmup', 'natural-1', 'coverage', 'natural-2', 'anchor-repeat']);
  assert.deepEqual(p.prompts.map((x) => x.order), p.prompts.map((_, i) => i));
  // Eight timed steps after the ready word: a step-transition pause at 20, 100, 120, 140, 160, 180 and 240 s.
  assert.equal(p.boundaries.filter((b) => b.kind === 'pause' && b.reason === 'step-transition').length, 7);
  const probes = p.prompts.filter((x) => x.task.kind === 'physical-probe');
  assert.equal(probes.length, 2);
  assert.ok(p.collection.probes.filter((a) => a.completed && a.correct).length > 10);
  // One global, gap-free order with time never running backwards.
  const all = [...p.key_events.rows.map((r) => [r[0], r[1]]), ...p.text_events.map((e) => [e.seq, e.t]), ...p.boundaries.map((b) => [b.seq, b.t]),
    ...p.collection.deliveries.map((d) => [d.seq, d.t])].sort((a, b) => a[0] - b[0]);
  all.forEach(([seq], i) => assert.equal(seq, i + 1));
  for (let i = 1; i < all.length; i++) assert.ok(all[i][1] >= all[i - 1][1]);
  const anchor = p.prompts.find((x) => x.stage === 'anchor-repeat')!;
  assert.equal(anchor.repeat_of, p.prompts.find((x) => x.stage === 'natural-1')!.order);
  // The result: speed qualifies, typed text was right apart from the corrected slips.
  assert.ok(result.speedQualifies);
  assert.ok(result.summary.wpm5! > 5 && result.summary.wpm5! < 120, String(result.summary.wpm5));
  assert.ok(result.summary.accuracy! > 95, String(result.summary.accuracy));
  assert.ok(result.summary.correction_episodes > 0);
  assert.ok(result.summary.backspace_presses >= result.summary.correction_episodes);
  assert.ok(result.summary.first_try_accuracy! < 100);
  assert.ok(result.slowKeys.length > 0);

  const out = process.env.CHECK_PACKAGE_OUT;
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, `${p.session.session_id}.json.gz`), gzipSync(JSON.stringify(p)));
  }
});
