import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { charTypes, layoutById } from '../src/lib/catalog.ts';
import { FixedComposer } from '../src/lib/composer.ts';
import { canonical } from '../src/lib/check/scorer.ts';
import { recipeFor, press } from '../src/lib/recipe.ts';
import { vkOfCode } from '../src/lib/keys.ts';
import {
  aggregate, candidateLayout, candidates, DURATION_MS, FORMS, hashLayout, plan, reportText, Trial,
  type ResearchReport, type TrialOptions, type TrialResult,
} from '../src/lib/research.ts';

test('frozen maps have exactly the intended two-slot difference; all fixed keys/rules stay inherited', async () => {
  for (const style of ['A', 'D'] as const) {
    const a = candidateLayout('B01', style), b = candidateLayout('B02', style);
    const original = layoutById(style === 'A' ? 'kala-goti' : 'kala-jhor')!;
    assert.equal(a.shift['88'], 'ৈ'); assert.equal(a.shift['87'], 'ৌ');
    assert.equal(b.shift['88'], 'ৌ'); assert.equal(b.shift['87'], 'ৈ');
    assert.deepEqual(a.normal, b.normal);
    assert.deepEqual(Object.keys(a.shift).filter((k) => a.shift[k] !== b.shift[k]).sort(), ['87', '88']);
    for (const layer of ['normal', 'shift'] as const) {
      for (const [vk, symbol] of Object.entries(original[layer])) {
        if (Number(vk) < 65 || Number(vk) > 90) assert.equal(a[layer][vk], symbol);
      }
    }
    assert.deepEqual(a.sequences, original.sequences); assert.deepEqual(a.rules, original.rules);
    assert.equal(a.contextVowels, style === 'D');
    assert.notEqual(await hashLayout(a), await hashLayout(b));
    // Browser composer uses Kala's atomic nukta letters rather than decomposed symbol labels.
    assert.equal(a.shift['67'], 'ড়'); assert.equal(a.normal['78'], 'য়');
  }
  for (const c of candidates) assert.equal(createHash('sha256').update(JSON.stringify(c.symbols)).digest('hex'), c.physicalMapSha256);
});

test('every authored word replays correctly with both candidates under both vowel grammars', () => {
  const words = new Set(Object.values(FORMS).flat().flatMap((s) => s.split(' ')));
  for (const candidate of ['B01', 'B02'] as const) for (const style of ['A', 'D'] as const) {
    const fresh = FixedComposer.create(candidateLayout(candidate, style), charTypes);
    for (const word of words) {
      const recipe = recipeFor(fresh, word);
      assert.ok(recipe, `${candidate}/${style}: ${word}`);
      const composer = fresh.clone();
      const text = recipe.reduce((out, step) => press(composer, out, step), '');
      assert.equal(text.normalize('NFC'), word.normalize('NFC'));
    }
  }
});

test('the remapped Jhor decoder preserves original recorded vowel and Backspace behavior', () => {
  const cases: { keys: string; expected: string }[] = JSON.parse(readFileSync(new URL('fixtures/KalaJhor.tests.json', import.meta.url), 'utf8'));
  const original = layoutById('kala-jhor')!;
  const eligible = cases.filter((c) => /^[a-zA-Z \b]+$/.test(c.keys));
  assert.ok(eligible.length > 500);
  for (const candidate of ['B01', 'B02'] as const) {
    const layout = candidateLayout(candidate, 'D');
    const actions = new Map<string, { vk: number; shift: boolean }>();
    for (const shifted of [false, true]) for (const [vk, symbol] of Object.entries(layout[shifted ? 'shift' : 'normal'])) {
      actions.set(symbol, { vk: Number(vk), shift: shifted });
    }
    for (const c of eligible) {
      const composer = FixedComposer.create(layout, charTypes);
      let text = '';
      for (const key of c.keys) {
        if (key === '\b') { text = press(composer, text, { vk: 8, shift: false }); continue; }
        if (key === ' ') { text = press(composer, text, { vk: 32, shift: false }); continue; }
        const vk = key.toUpperCase().charCodeAt(0), shift = key === key.toUpperCase();
        const symbol = original[shift ? 'shift' : 'normal'][String(vk)];
        const action = actions.get(symbol);
        assert.ok(action, symbol); text = press(composer, text, action);
      }
      assert.equal(canonical(text), canonical(c.expected), `${candidate}: ${c.keys}`);
    }
  }
});

test('style crossover keeps B01 fixed, gives each style both forms and reverses between sessions', () => {
  assert.deepEqual(plan(1).map((b) => b.style), ['A', 'D', 'D', 'A']);
  assert.deepEqual(plan(2).map((b) => b.style), ['D', 'A', 'A', 'D']);
  for (const n of [1, 2]) for (const style of ['A', 'D']) {
    assert.ok(plan(n).every((b) => b.candidate === 'B01'));
    assert.deepEqual(plan(n).filter((b) => b.style === style).map((b) => b.form).sort(), [0, 1]);
  }
  const goti = candidateLayout('B01', 'A'), jhor = candidateLayout('B01', 'D');
  assert.deepEqual(goti.normal, jhor.normal); assert.deepEqual(goti.shift, jhor.shift);
  assert.notEqual(goti.contextVowels, jhor.contextVowels);
});

const options: TrialOptions = {
  candidate: 'B01', style: 'A', assistance: 'guided', role: 'ordinary', block: 0, form: 0,
  sessionId: 'test', runtimeHash: 'test-map', keyboard: 'external', previousExposures: 0, appVersion: 'test',
};
function fixture(extra: Partial<TrialOptions> = {}) {
  let time = 0;
  const trial = new Trial({ ...options, ...extra }, () => time);
  const key = (vk: number, shift = false) => {
    const code = Object.keys(vkOfCode).find((code) => vkOfCode[code] === vk)!;
    if (shift) trial.key({ code: 'ShiftLeft', keyCode: 16, up: false, caps: false, timeStamp: time }, true);
    trial.key({ code, keyCode: vk, up: false, caps: false, timeStamp: time }, shift);
    trial.key({ code, keyCode: vk, up: true, caps: false, timeStamp: time }, shift);
    if (shift) trial.key({ code: 'ShiftLeft', keyCode: 16, up: true, caps: false, timeStamp: time }, false);
  };
  return { trial, key, at: (ms: number) => { time = ms; } };
}

test('late timer wakeups clamp to the planned deadline; pauses count neither time nor keys', () => {
  const f = fixture();
  f.at(1000); f.key(74);
  f.at(10_000); f.trial.pause('focus-loss');
  const before = f.trial.recorder.keys.length;
  f.at(20_000); f.key(74); assert.equal(f.trial.recorder.keys.length, before);
  f.at(30_000); f.trial.resume();
  f.at(100_000); f.key(74);
  const result = f.trial.done!;
  assert.ok(result); assert.equal(result.ended, 'completed'); assert.equal(result.metrics.activeMs, DURATION_MS);
  assert.equal(f.trial.recorder.keys.length, before);
  assert.equal(result.capture.prompts[0].end_ticks, 80_000_000);
  assert.equal(result.capture.integrity.text_replay_ok, true);
});

test('recipe guidance recovers mistakes; repeated renders do not inflate cue counts', () => {
  const f = fixture();
  const cue = f.trial.hint()!; assert.ok(cue);
  f.trial.hint(); f.trial.hint();
  f.key(74); // wrong first key for আজ
  assert.equal(f.trial.hint()!.vk, 8);
  f.key(8);
  assert.equal(f.trial.hint()!.vk, cue.vk);
  f.key(cue.vk, cue.shift);
  f.at(5000); const result = f.trial.finish('stopped');
  assert.equal(result.hintCues, 3);
  assert.equal(result.metrics.backspaces, 1);
  assert.equal(result.capture.integrity.text_replay_ok, true);
});

test('recall has no measured hints; practice can be guided but is excluded from aggregates', () => {
  const recall = fixture({ assistance: 'recall' }); assert.equal(recall.trial.hint(), null);
  recall.at(1000); recall.key(74); const measured = recall.trial.finish('stopped');
  const practice = fixture({ role: 'practice', assistance: 'recall', form: 1 }); assert.ok(practice.trial.hint());
  assert.equal(practice.trial.options.form, 0);
  practice.at(100000); const warmup = practice.trial.finish('stopped');
  const group = aggregate([measured, warmup], 'B01', 'ordinary');
  assert.equal(group.activeSeconds, 1); assert.equal(group.trials, 1); assert.equal(group.correctGpm, null);
  assert.throws(() => aggregate([measured, { ...measured, assistance: 'guided' }], 'B01', 'ordinary'));
  assert.equal(aggregate([], 'B02', 'ordinary').accuracy, null);
  assert.equal(aggregate([], 'B02', 'ordinary').integrityOK, null);
});

test('vowel timing does not bridge a pause and raw composition/Backspace replay stays valid', () => {
  const f = fixture({ role: 'vowel-diagnostic' });
  f.at(100); f.key(74);
  f.at(200); f.key(87, true);
  f.at(300); f.trial.pause(); f.at(10000); f.trial.resume();
  f.at(10100); f.key(88, true);
  f.at(10500); const result = f.trial.finish('stopped');
  assert.deepEqual(result.vowelIntervals, [{ sign: 'ৌ', ms: 100 }]);
  assert.ok(result.capture.integrity.text_replay_ok);
});

test('copy report preserves exact maps, partial status, raw denominators and prompt responses', () => {
  const f = fixture(); f.at(1000); f.key(74); f.at(2000); const result = f.trial.finish('stopped');
  const report: ResearchReport = {
    schema: 'kala.b01-style-pilot/2', protocol: 'test', bank: 'test',
    session: { id: 'test', number: 1, startedUtc: '', appVersion: 'test', candidate: 'B01', previousStyleExperience: 'neither', assistance: 'guided', experience: 'new',
      keyboard: 'external', fingering: 'usual', priorReports: 0, order: ['A', 'D', 'D', 'A'],
      completion: 'stopped', storageAvailable: false, exposureBefore: {} },
    maps: (['A', 'D'] as const).map((style) => ({ ...candidates[0], style, runtimeHash: 'test', ruleTemplateHash: 'test' })),
    limitations: ['test'], trials: [result], blocks: [], preference: 'unsure',
  };
  const text = reportText(report);
  const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  assert.equal(parsed.session.completion, 'stopped'); assert.equal(parsed.maps[0].id, 'shared-76c9b9dbfc689d0b');
  assert.equal(parsed.trials[0].capture.prompts[0].typed, 'ক');
  assert.equal(parsed.summaries[0].attemptedUnits, 1); assert.equal(parsed.summaries[0].correctGpm, null);
  assert.equal(parsed.summaries[2].accuracy, null);
  assert.equal(parsed.session.candidate, 'B01'); assert.equal(parsed.preference, 'unsure');
  assert.equal(parsed.summaries[0].style, 'A'); assert.equal(parsed.summaries[2].style, 'D');
});

test('a complete eight-role run replays, keeps both text types separate and qualifies sufficient samples', () => {
  const results: TrialResult[] = [];
  for (const block of plan(1)) for (const role of ['ordinary', 'vowel-diagnostic'] as const) {
    const f = fixture({ candidate: 'B01', style: block.style, block: block.block, form: block.form, role });
    const fresh = FixedComposer.create(f.trial.layout, charTypes);
    let time = 0;
    const words = f.trial.target.split(' ');
    words.forEach((word, wi) => {
      const recipe = recipeFor(fresh, word)!;
      for (const action of recipe) { time += 20; f.at(time); f.key(action.vk, action.shift); }
      if (wi < words.length - 1) { time += 20; f.at(time); f.key(32); }
    });
    assert.equal(canonical(f.trial.typed), canonical(f.trial.target));
    f.at(DURATION_MS + 500); f.trial.sync();
    assert.ok(f.trial.done?.capture.integrity.text_replay_ok);
    results.push(f.trial.done!);
  }
  assert.equal(results.length, 8);
  for (const style of ['A', 'D'] as const) for (const role of ['ordinary', 'vowel-diagnostic'] as const) {
    const group = aggregate(results, 'B01', role, style);
    assert.equal(group.completedTrials, 2); assert.equal(group.activeSeconds, 120);
    assert.equal(group.accuracy, 100); assert.ok(group.correctGpm! > 0); assert.equal(group.integrityOK, true);
  }
  assert.throws(() => aggregate(results, 'B01', 'ordinary'), /Do not pool/);
  const broken = structuredClone(results[0]); broken.capture.integrity.dropped_events = 1;
  const invalid = aggregate([broken], 'B01', 'ordinary');
  assert.equal(invalid.integrityOK, false); assert.equal(invalid.correctGpm, null); assert.equal(invalid.accuracy, null);
});
