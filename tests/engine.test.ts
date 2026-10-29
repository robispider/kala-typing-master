// Conformance checks against Kala's own fixtures: the decoder replay cases from kala.BaselineTests
// and the scoring cases from kala.LearningTests/ScoringTests.cs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { apply, FixedComposer, type CharTypes, type FixedLayout } from '../src/lib/composer.ts';
import { recipeFor, solve } from '../src/lib/recipe.ts';
import { accuracy, correctGpm, fiveCharWpm, graphemes, score, speedQualifies } from '../src/lib/scoring.ts';

const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const layouts: (FixedLayout & { howToType?: { examples?: { text: string; keys: string }[] } })[] = json('../src/data/layouts.json');
const types: CharTypes = json('../src/data/chartypes.json');
const layout = (id: string) => layouts.find((l) => l.id === id)!;

// KalaJhor.tests.json keys: lowercase = key, uppercase = Shift + key, US symbols, " " Space, "\b" Backspace.
const SHIFTED_DIGITS = ')!@#$%^&*(';
const SYMBOLS: Record<string, [number, boolean]> = {
  ';': [186, false], ':': [186, true], '=': [187, false], '+': [187, true], ',': [188, false], '<': [188, true],
  '-': [189, false], _: [189, true], '.': [190, false], '>': [190, true], '/': [191, false], '?': [191, true],
  '`': [192, false], '~': [192, true], '[': [219, false], '{': [219, true], '\\': [220, false], '|': [220, true],
  ']': [221, false], '}': [221, true], "'": [222, false], '"': [222, true], ' ': [32, false], '\b': [8, false],
};
function pressOf(c: string): [number, boolean] {
  if (c >= 'a' && c <= 'z') return [c.toUpperCase().charCodeAt(0), false];
  if (c >= 'A' && c <= 'Z') return [c.charCodeAt(0), true];
  if (c >= '0' && c <= '9') return [c.charCodeAt(0), false];
  if (SHIFTED_DIGITS.includes(c)) return [48 + SHIFTED_DIGITS.indexOf(c), true];
  return SYMBOLS[c];
}

function typeKeys(composer: FixedComposer, presses: [number, boolean][]) {
  let text = '';
  for (const [vk, shift] of presses) {
    if (vk === 8) {
      text = text.slice(0, -1);
      composer.continueAfter(text);
      continue;
    }
    const result = composer.translate(vk, shift);
    assert.ok(result.backspaces <= text.length);
    text = apply(text, result);
  }
  return text.normalize('NFC');
}

test('Kala Jhor: every recorded decoder case types the same text', () => {
  const cases: { keys: string; expected: string; note: string }[] = json('./fixtures/KalaJhor.tests.json');
  const failures = cases.filter((c) => {
    const composer = FixedComposer.create(layout('kala-jhor'), types);
    return typeKeys(composer, [...c.keys].map(pressOf)) !== c.expected.normalize('NFC');
  });
  assert.equal(failures.length, 0, failures.slice(0, 10).map((f) => `${f.note} [${f.keys}]`).join('; '));
  assert.ok(cases.length > 900);
});

test('UniJoy: recorded decoder cases', () => {
  const cases: { keys: number[]; expected: string }[] = json('./fixtures/UniJoy.tests.json');
  for (const c of cases) {
    const composer = FixedComposer.create(layout('unijoy'), types);
    assert.equal(typeKeys(composer, c.keys.map((k) => [k, false])), c.expected);
  }
});

test('Kala Goti: the layout’s own worked examples', () => {
  const goti = layout('kala-goti');
  for (const example of goti.howToType!.examples!) {
    const presses = example.keys.split(' ').map((k): [number, boolean] =>
      k.startsWith('Shift+') ? [k.charCodeAt(6), true] : [k.charCodeAt(0), false]);
    assert.equal(typeKeys(FixedComposer.create(goti, types), presses), example.text);
  }
});

test('recipes replay to the target and match authored examples', () => {
  for (const l of layouts.filter((l) => l.language === 'bn')) {
    const fresh = FixedComposer.create(l, types);
    for (const word of ['আমি', 'বই', 'তিনিই', 'ক্ষমা', 'কৃষক', 'এবং', 'সূর্য', 'বাংলাদেশ', 'বল।']) {
      const steps = recipeFor(fresh, word);
      assert.ok(steps, `${l.id}: no recipe for ${word}`);
      assert.equal(steps!.at(-1)!.text, word);
    }
  }
  const goti = layout('kala-goti');
  const steps = recipeFor(FixedComposer.create(goti, types), 'আমি')!;
  assert.deepEqual(steps.map((s) => String.fromCharCode(s.vk)), ['K', 'F', 'X', 'C']);
});

test('scoring: worked checks from 05-ASSESSMENT', () => {
  const cases: [string, string, number, number, number][] = [
    ['cat', 'cat', 0, 3, 100],
    ['cat', 'cut', 1, 2, 66.67],
    ['cat', 'ca', 1, 2, 66.67],
    ['cat', 'cats', 1, 3, 75],
  ];
  for (const [reference, response, distance, matches, acc] of cases) {
    const s = score(reference, response);
    assert.equal(s.distance, distance);
    assert.equal(s.matches, matches);
    assert.ok(Math.abs(accuracy(s) - acc) < 0.01);
  }
});

test('scoring: .NET 8 grapheme units, NFC and joiners', () => {
  assert.deepEqual(graphemes('ক্ষ'), ['ক্', 'ষ']);
  assert.deepEqual(graphemes('কি'), ['কি']);
  assert.notEqual(score('র‍্যাব', 'র্যাব').distance, 0);
  assert.equal(accuracy(score('য়', 'য়')), 100);
});

test('speed metrics and qualification', () => {
  assert.equal(correctGpm(10, 30000), 20);
  assert.equal(correctGpm(10, 0), null);
  assert.equal(fiveCharWpm('hello world', 60000), 2);
  assert.equal(speedQualifies(30000, 10), false);
  assert.equal(speedQualifies(60000, 100), true);
});

test('recipes cover the practice vocabulary and recover from mistakes', () => {
  const words: { words: [string, number[]][] } = json('../public/data/bn/words.json');
  const sample = words.words.filter((_, i) => i % 40 === 0).map(([w]) => w);
  for (const l of layouts.filter((l) => l.language === 'bn')) {
    const fresh = FixedComposer.create(l, types);
    const missing = sample.filter((w) => recipeFor(fresh, w)?.at(-1)?.text !== w);
    assert.ok(missing.length === 0, `${l.id}: ${missing.length}/${sample.length} without recipe: ${missing.slice(0, 8).join(' ')}`);
  }
  // A wrong letter is fixed with Backspace first.
  const goti = FixedComposer.create(layout('kala-goti'), types);
  const composer = goti.clone();
  const text = apply('', composer.translate(76, false)); // ব instead of ম
  const steps = solve(composer, text, 'মা')!;
  assert.equal(steps[0].vk, 8);
  assert.equal(steps.at(-1)!.text, 'মা');
});

test('recipes: characters no key produces are rejected at once', () => {
  const goti = FixedComposer.create(layout('kala-goti'), types);
  const start = performance.now();
  for (const word of ['কথা—', '‘আমি’', 'চল্‌', 'ভাই॥']) assert.equal(recipeFor(goti, word), null);
  assert.ok(performance.now() - start < 50);
});

test('planner: every key step has guided and recall practice, all typable', async () => {
  const { planStep } = await import('../src/lib/planner.ts');
  const { paths } = await import('../src/lib/catalog.ts');
  const progress = { schema: 1, layouts: {}, sessions: [], days: {}, settings: {} } as never;
  for (const l of layouts) {
    const data = json(`../public/data/${l.language}/words.json`);
    const punctuation = l.language === 'bn' ? json('../public/data/bn/punctuation.json') : [];
    const fresh = FixedComposer.create(l, types);
    for (let g = 1; g <= paths[l.id].groups.length; g++) {
      const phases = planStep(l.id, `g${g}`, data, punctuation, progress);
      const ids = phases.map((p: { id: string }) => p.id);
      assert.ok(ids.includes('guided') && ids.includes('recall'), `${l.id} g${g}: ${ids.join(',')}`);
      for (const p of phases) for (const item of p.items) {
        for (const w of item.text.split(' ')) assert.ok(recipeFor(fresh, w), `${l.id} g${g} ${p.id}: cannot type ${w}`);
      }
    }
  }
});
