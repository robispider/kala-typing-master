import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { charTypes, layoutById, paths } from '../src/lib/catalog.ts';
import { FixedComposer } from '../src/lib/composer.ts';
import { candidateLayout } from '../src/lib/research.ts';
import { press, recipeFor } from '../src/lib/recipe.ts';
import { layoutProgress, upgradeProgress } from '../src/lib/store.ts';

test('the ordinary Goti and Jhor courses use published B01 positions and distinct vowel entry', () => {
  const goti = layoutById('kala-goti')!, jhor = layoutById('kala-jhor')!;
  for (const [layout, style] of [[goti, 'A'], [jhor, 'D']] as const) {
    const published = candidateLayout('B01', style);
    assert.equal(layout.arrangementId, 'shared-76c9b9dbfc689d0b');
    assert.equal(layout.publication, 'kala-shared-publication-v1');
    assert.deepEqual(layout.normal, published.normal);
    assert.deepEqual(layout.shift, published.shift);
    assert.equal((paths[layout.id] as { layoutHash?: string }).layoutHash, layout.sourceSha256);
    for (const example of layout.howToType!.examples!) {
      const composer = FixedComposer.create(layout, charTypes);
      let text = '';
      for (const key of example.keys.split(' ')) text = press(composer, text, {
        vk: key.at(-1)!.charCodeAt(0), shift: key.startsWith('Shift+'),
      });
      assert.equal(text.normalize('NFC'), example.text.normalize('NFC'));
    }
  }
  assert.deepEqual(goti.normal, jhor.normal);
  assert.deepEqual(goti.shift, jhor.shift);
  assert.equal(goti.contextVowels, false); assert.equal(jhor.contextVowels, true);
  const keysFor = (id: string) => recipeFor(FixedComposer.create(layoutById(id)!, charTypes), 'আমি')!.map(s => String.fromCharCode(s.vk)).join(' ');
  assert.equal(keysFor('kala-goti'), 'S D O A');
  assert.equal(keysFor('kala-jhor'), 'D O A');
});

test('the new typing-check bank has eight forms bound to each current Bangla map', () => {
  const bank = JSON.parse(readFileSync(new URL('../public/data/bn/check.json', import.meta.url), 'utf8'));
  assert.equal(bank.version, '1.4.1');
  for (const id of ['kala-goti', 'kala-jhor', 'unijoy']) {
    assert.equal(bank.variants.filter((v: { layout_hash: string }) => v.layout_hash === layoutById(id)!.sourceSha256).length, 8);
  }
});

test('old positional progress is archived without losing sessions, settings, reading or other layouts', () => {
  const old = {
    completed: ['g1', 'orientation'], best: { g1: 99 },
    units: { 'c-ka': { seen: 5, correct: 5, independent: 5, lastAt: 7 } },
    keyErrors: { '65': 4 }, reading: { author: 'a00', work: 'work', item: 3 },
  };
  const raw = {
    schema: 1, layout: 'kala-goti', settings: { hands: false },
    layouts: { 'kala-goti': structuredClone(old), 'kala-jhor': structuredClone(old), unijoy: structuredClone(old), qwerty: structuredClone(old) },
    sessions: [{ layout: 'kala-goti', at: 1 }], days: { '2026-10-28': 1000 },
  };
  const p = upgradeProgress(raw);
  for (const id of ['kala-goti', 'kala-jhor']) {
    const current = layoutProgress(p, id);
    assert.deepEqual(current.completed, []); assert.deepEqual(current.units, {}); assert.deepEqual(current.keyErrors, {});
    assert.deepEqual(current.reading, old.reading);
    assert.equal(current.mappingHash, layoutById(id)!.sourceSha256);
    const previous = Object.values(p.layoutHistory!).find(v => v.mappingHash !== current.mappingHash && v.completed.length > 0);
    assert.ok(previous); assert.deepEqual(previous.units, old.units);
  }
  assert.equal(Object.keys(p.layoutHistory!).length, 2);
  assert.equal(p.sessions.length, 1);
  assert.equal(p.sessions[0].mappingHash, '14742dd1776033ca4ad93d17239e4cd40e65132b229ae896e8c797c9e3ad6e5a');
  assert.equal(p.settings.hands, false); assert.equal(p.layout, 'kala-goti');
  assert.deepEqual(p.days, raw.days); assert.deepEqual(p.layouts.unijoy, old); assert.deepEqual(p.layouts.qwerty, old);
  p.layouts['kala-goti'].completed.push('g1');
  assert.deepEqual(upgradeProgress(structuredClone(p)), p); // backup restore/reload is idempotent
});
