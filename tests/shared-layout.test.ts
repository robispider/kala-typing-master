import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { charTypes, layoutById, paths } from '../src/lib/catalog.ts';
import { FixedComposer } from '../src/lib/composer.ts';
import { candidateLayout } from '../src/lib/research.ts';
import { press, recipeFor } from '../src/lib/recipe.ts';
import { layoutProgress, upgradeProgress } from '../src/lib/store.ts';

test('the ordinary courses use the exact published separate positions and native vowel entry', () => {
  const goti = layoutById('kala-goti')!, jhor = layoutById('kala-jhor')!;
  for (const [layout, style] of [[goti, 'A'], [jhor, 'D']] as const) {
    const published = JSON.parse(readFileSync(new URL(`./fixtures/OriginalKala${style === 'A' ? 'Goti' : 'Jhor'}.json`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(layout.arrangementId, style === 'A' ? 'A-18fe73cb912ae3f1' : 'D-e4a6be48881da590');
    assert.equal(layout.publication, 'kala-separate-publication-v1');
    assert.deepEqual(layout.normal, published.layers.normal);
    assert.deepEqual(layout.shift, published.layers.shift);
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
  assert.notDeepEqual(goti.normal, jhor.normal);
  assert.notDeepEqual(goti.shift, jhor.shift);
  assert.equal(goti.contextVowels, false); assert.equal(jhor.contextVowels, true);
  const keysFor = (id: string) => recipeFor(FixedComposer.create(layoutById(id)!, charTypes), 'আমি')!.map(s => String.fromCharCode(s.vk)).join(' ');
  assert.equal(keysFor('kala-goti'), 'K F X C');
  assert.equal(keysFor('kala-jhor'), 'F X L');
});

test('the new typing-check bank has eight forms bound to each current Bangla map', () => {
  const bank = JSON.parse(readFileSync(new URL('../public/data/bn/check.json', import.meta.url), 'utf8'));
  assert.equal(bank.version, '1.4.2');
  for (const id of ['kala-goti', 'kala-jhor', 'unijoy']) {
    assert.equal(bank.variants.filter((v: { layout_hash: string }) => v.layout_hash === layoutById(id)!.sourceSha256).length, 8);
  }
});

const originalGoti = '14742dd1776033ca4ad93d17239e4cd40e65132b229ae896e8c797c9e3ad6e5a';
const b01Goti = 'ae31f8c64a689dba1e7afdd2d000e8733b8f48cfcd9928b94fbb396ba2fe0d51';
const evidence = (hash?: string) => ({... (hash ? {mappingHash: hash} : {}), completed: ['g1'], best: {g1: 99}, units: {'c-ka': {seen: 5, correct: 5, independent: 5, lastAt: 7}}, keyErrors: {'65': 4}, reading: {author: 'a00', work: 'work', item: 3}});
for (const id of ['kala-goti', 'kala-jhor']) for (const scenario of ['original', 'b01', 'both', 'empty'] as const) {
  const originalHash = id === 'kala-goti' ? originalGoti : 'c8f9eb5d2d32756c858878dfd6f1c701e970a1250ab53755ff34fcae0f2adbe1';
  const sharedHash = id === 'kala-goti' ? b01Goti : 'b2ee62d0f8dc9e2ed6a46d26c5e440ce2443fb61a7094b554345ecc301129ae6';
  test(`progress upgrade and backup reload preserve ${id}/${scenario} history without cross-map mixing`, () => {
    const raw = {schema: 1, layout: id, settings: {hands: false}, days: {'2026-10-28': 1000},
      sessions: [{layout: id, at: 1}],
      layouts: scenario === 'empty' ? {} : {[id]: evidence(scenario === 'original' ? undefined : sharedHash), unijoy: evidence()},
      layoutHistory: scenario === 'both' ? {[`${id}:${originalHash}`]: evidence(originalHash)} : {},
    };
    const before = structuredClone(raw);
    const p = upgradeProgress(raw);
    const current = layoutProgress(p, id);
    assert.deepEqual(current.completed, scenario === 'original' || scenario === 'both' ? ['g1'] : []);
    assert.deepEqual(current.keyErrors, scenario === 'original' || scenario === 'both' ? {'65': 4} : {});
    if (scenario === 'b01' || scenario === 'both') assert.deepEqual(p.layoutHistory![`${id}:${sharedHash}`].completed, ['g1']);
    assert.equal(current.mappingHash, layoutById(id)!.sourceSha256);
    assert.equal(p.settings.hands, false); assert.deepEqual(p.days, raw.days);
    assert.deepEqual(raw, before);
    assert.deepEqual(upgradeProgress(structuredClone(p)), p);
    assert.deepEqual(upgradeProgress(JSON.parse(JSON.stringify(p))), p);
    assert.equal(p.sessions.length, 1);
  });
}
