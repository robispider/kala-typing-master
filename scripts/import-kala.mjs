// Imports Kala learning packs and layouts into compact web data.
//
//   node scripts/import-kala.mjs [path-to-kala-checkout]
//
// The Kala checkout defaults to ../kala (or KALA_SRC). Generated files are committed, so the
// GitHub Pages build does not need the Kala repository. Re-run after a pack or layout update.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kala = resolve(process.argv[2] ?? process.env.KALA_SRC ?? join(root, '..', 'kala'));
const app = join(kala, 'kala');
const literature = join(app, 'learning-packs', 'kala.bn-literature', '1.1.0');
const english = join(app, 'learning-packs', 'kala.en-touch', '1.0.0');

const srcData = join(root, 'src', 'data');
const pubData = join(root, 'public', 'data');

const read = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
  return readFileSync(path).length;
};

// ---- Verify the pack against its manifest before using anything from it.
function verifyPack(dir) {
  const manifest = read(join(dir, 'manifest.json'));
  for (const file of manifest.files) {
    const actual = sha256(join(dir, file.path));
    if (actual !== file.sha256) throw new Error(`${manifest.id}@${manifest.version}: hash mismatch for ${file.path}`);
  }
  return manifest;
}
const bnManifest = verifyPack(literature);
const enManifest = verifyPack(english);

// ---- Languages: units with names, categories and the comparison policy.
const unitsOf = (language) =>
  language.units.map((u) => ({ id: u.id, text: u.text, category: u.category, name: u.name }));
const bnLanguage = read(join(literature, 'language.json'));
const enLanguage = read(join(english, 'language.json'));

// ---- Layouts. Bangla layouts are Kala's native fixed layouts; QWERTY comes from the English pack.
const nativeLayouts = [
  { id: 'kala-goti', file: 'KalaGoti.json', path: 'KalaGoti.json' },
  { id: 'kala-jhor', file: 'KalaJhor.json', path: 'KalaJhor.json' },
  { id: 'unijoy', file: 'UniJoy.json', path: 'UniJoy.json' },
];

function nativeLayout({ id, file }) {
  const path = join(app, 'layout', 'bn', file);
  const layout = read(path);
  const about = layout.about ?? {};
  const typingRule = about.style?.typingRule?.id ?? 'hasant-sign';
  return {
    id,
    language: 'bn',
    name: about.name ?? { en: layout.name, bn: layout.name },
    tagline: about.tagline ?? null,
    meaning: about.meaning ?? null,
    family: about.family ?? null,
    style: about.style ? { code: about.style.code, name: about.style.name, rule: typingRule } : null,
    howToType: about.howToType ?? null,
    contextVowels: typingRule === 'context-vowel',
    normal: layout.layers.normal,
    shift: layout.layers.shift,
    sequences: layout.combinations?.sequences ?? {},
    rules: layout.rules ?? [],
    sourceSha256: sha256(path),
  };
}

function qwertyLayout() {
  const path = join(english, 'layouts', 'qwerty.learning.json');
  const layout = read(path);
  const vkByPosition = {
    AE: [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 189, 187],
    AD: [81, 87, 69, 82, 84, 89, 85, 73, 79, 80, 219, 221],
    AC: [65, 83, 68, 70, 71, 72, 74, 75, 76, 186, 222],
    AB: [90, 88, 67, 86, 66, 78, 77, 188, 190, 191],
  };
  const normal = { 32: ' ' };
  const shift = { 32: ' ' };
  for (const action of layout.actions) {
    const [, position] = action.positionId.split(':');
    const vk = vkByPosition[position.slice(0, 2)]?.[Number(position.slice(2)) - 1];
    if (vk === undefined) continue;
    (action.modifiers.includes('shift') ? shift : normal)[vk] = action.label;
  }
  return {
    id: 'qwerty',
    language: 'en',
    name: layout.name,
    tagline: { en: 'Classic English touch typing on the keyboard you already have.', bn: 'আপনার চেনা কিবোর্ডে ইংরেজি টাচ টাইপিং।' },
    meaning: null,
    family: null,
    style: null,
    howToType: null,
    contextVowels: false,
    normal,
    shift,
    sequences: {},
    rules: [],
    introductionGroups: layout.curriculumHints.introductionGroups,
    sourceSha256: sha256(path),
  };
}

const layouts = [...nativeLayouts.map(nativeLayout), qwertyLayout()];

// ---- Teaching paths: unit groups in introduction order, plus micro-lessons ("modules").
const paths = {};
for (const { id, path } of nativeLayouts) {
  const tp = read(join(literature, 'teaching-paths', path));
  paths[id] = {
    id: tp.id,
    version: tp.version,
    review: tp.review,
    groups: tp.groups.map((g) => g.units),
    modules: tp.modules.map((m) => ({
      id: m.id,
      rule: m.rule,
      prerequisiteUnits: m.prerequisiteUnits,
      targetUnits: m.targetUnits,
      demonstrations: m.demonstrations,
      title: m.title,
      instructions: m.instructions,
    })),
  };
}
const qwerty = layouts.find((l) => l.id === 'qwerty');
const enUnitIds = new Set(enLanguage.units.map((u) => u.id));
paths.qwerty = {
  id: 'kala.en.path.qwerty',
  version: enManifest.version,
  review: 'curriculum-hints',
  groups: [
    ...qwerty.introductionGroups,
    ['period', 'comma', 'apostrophe'],
    ['u-a', 'u-i', 'u-t', 'u-s', 'question', 'exclamation'].filter((u) => enUnitIds.has(u)),
  ],
  modules: [],
};
delete qwerty.introductionGroups;

// ---- The course: objectives and lessons, as authored (bilingual titles and instructions).
const courseOf = (path) => {
  const c = read(path);
  return {
    id: c.id,
    version: c.version,
    objectives: c.objectives.map((o) => ({ id: o.id, stage: o.stage, lessonIds: o.lessonIds, required: o.required })),
    lessons: c.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      instructions: l.instructions,
      taskType: l.taskType,
      kinds: l.selector?.kinds ?? [],
      assistance: l.assistance ?? 'independent',
      scaffolding: l.scaffolding?.levels ?? [],
      opportunities: l.duration?.opportunities ?? null,
    })),
  };
};

// ---- Alphabet character classes, used by the fixed-layout composer.
const alphabet = read(join(app, 'layout', 'bn', 'Alphabet.json'));
const charTypes = {
  consonants: alphabet.consonants,
  vowels: alphabet.vowels,
  matras: alphabet.matras,
  halant: alphabet.halant,
  digits: alphabet.digits,
  punctuation: alphabet.punctuation,
  other: alphabet.other,
};

// ---- Practice items. Only the "train" split is published; check/assessment partitions stay out.
function compactWords(file, unitIds) {
  const index = new Map(unitIds.map((id, i) => [id, i]));
  const items = read(file).items;
  const words = [];
  const sentences = [];
  const passages = [];
  for (const item of items) {
    if (item.kind === 'word') words.push([item.text, item.unitIds.map((u) => index.get(u)).filter((i) => i !== undefined)]);
    else if (item.kind === 'sentence') sentences.push(item.text);
    else passages.push(item.text);
  }
  return { words, sentences, passages };
}

const bnUnitIds = bnLanguage.units.map((u) => u.id);
const enUnitIdsList = enLanguage.units.map((u) => u.id);

rmSync(pubData, { recursive: true, force: true });
const sizes = {};
const bnCore = compactWords(join(literature, 'resources', 'train.json'), bnUnitIds);
sizes['bn/words.json'] = write(join(pubData, 'bn', 'words.json'), { units: bnUnitIds, ...bnCore });
const enCore = compactWords(join(english, 'resources', 'train.json'), enUnitIdsList);
sizes['en/words.json'] = write(join(pubData, 'en', 'words.json'), { units: enUnitIdsList, ...enCore });

const punctuation = read(join(literature, 'resources', 'punctuation.json')).items.map((i) => ({
  text: i.text,
  tag: i.tags.find((t) => t !== 'authored' && t !== 'punctuation'),
}));
sizes['bn/punctuation.json'] = write(join(pubData, 'bn', 'punctuation.json'), punctuation);

// ---- Literature library: practice excerpts grouped by work and author, with source credits.
const contentIndex = read(join(literature, 'content-index.json'));
const works = new Map(contentIndex.works.map((w) => [w.id, w]));
const familyToWork = new Map();
for (const shard of contentIndex.shards) {
  for (const item of read(join(literature, shard)).items) familyToWork.set(item.familyId, item.parentIds?.[0]);
}
// Some authors are spelled two ways in the source catalog; group them by their spelling without spaces.
const authorKey = (name) => name.replace('জীবনানন্দ দাস', 'জীবনানন্দ দাশ').replace(/\s+/g, '');
const authorName = new Map();
const byAuthor = new Map();
for (const file of ['literature-train-000.json', 'literature-train-001.json']) {
  for (const item of read(join(literature, 'resources', file)).items) {
    if (item.kind === 'word') continue;
    const work = works.get(familyToWork.get(item.contentFamilyId));
    if (!work) continue;
    const author = authorKey(work.author);
    if (!authorName.has(author)) authorName.set(author, work.author.replace('জীবনানন্দ দাস', 'জীবনানন্দ দাশ'));
    if (!byAuthor.has(author)) byAuthor.set(author, new Map());
    const authorWorks = byAuthor.get(author);
    if (!authorWorks.has(work.id)) authorWorks.set(work.id, { work, items: [] });
    authorWorks.get(work.id).items.push({ kind: item.kind, text: item.text, edition: item.tags.includes('typing-edition') });
  }
}
const library = [];
let authorNumber = 0;
const excerptCount = (works) => [...works.values()].reduce((n, e) => n + e.items.length, 0);
for (const [key, authorWorks] of [...byAuthor].sort((a, b) => excerptCount(b[1]) - excerptCount(a[1]))) {
  const author = authorName.get(key);
  const slug = `a${String(authorNumber++).padStart(2, '0')}`;
  const entries = [...authorWorks.values()].sort((a, b) => a.work.title.localeCompare(b.work.title, 'bn'));
  sizes[`bn/library/${slug}.json`] = write(join(pubData, 'bn', 'library', `${slug}.json`), entries.map(({ work, items }) => ({
    id: work.id,
    title: work.title,
    collection: work.collection ?? null,
    genre: work.genre,
    sources: work.sourceUrls ?? [],
    items,
  })));
  library.push({
    slug,
    author,
    works: entries.length,
    excerpts: entries.reduce((n, e) => n + e.items.length, 0),
    genres: [...new Set(entries.map((e) => e.work.genre))],
    sample: entries.slice(0, 4).map((e) => e.work.title),
  });
}

// ---- Licences and notices travel with the derived content.
const licenses = join(root, 'public', 'licenses');
mkdirSync(licenses, { recursive: true });
copyFileSync(join(app, 'NOTICE-KALA-LAYOUTS.txt'), join(licenses, 'NOTICE-KALA-LAYOUTS.txt'));
copyFileSync(join(literature, 'LICENSE.txt'), join(licenses, 'kala.bn-literature-LICENSE.txt'));
copyFileSync(join(literature, 'LICENSE-CORE.txt'), join(licenses, 'kala.bn-core-LICENSE.txt'));
copyFileSync(join(english, 'LICENSE.txt'), join(licenses, 'kala.en-touch-LICENSE.txt'));

// ---- Build-time catalog (bundled into pages; small).
mkdirSync(srcData, { recursive: true });
write(join(srcData, 'layouts.json'), layouts);
write(join(srcData, 'paths.json'), paths);
write(join(srcData, 'units.json'), { bn: unitsOf(bnLanguage), en: unitsOf(enLanguage) });
write(join(srcData, 'courses.json'), {
  bn: courseOf(join(literature, 'courses', 'core.json')),
  en: courseOf(join(english, 'courses', 'touch.json')),
});
write(join(srcData, 'chartypes.json'), charTypes);
write(join(srcData, 'library.json'), library);
write(join(srcData, 'source.json'), {
  importedAt: new Date().toISOString().slice(0, 10),
  packs: [
    { id: bnManifest.id, version: bnManifest.version, name: bnManifest.name, description: bnManifest.description, provenance: bnManifest.provenance },
    { id: enManifest.id, version: enManifest.version, name: enManifest.name, description: enManifest.description },
  ],
  comparison: bnLanguage.comparison,
  sizes,
});

console.log(`Imported from ${kala}`);
console.log(`  ${layouts.length} layouts, ${Object.keys(paths).length} teaching paths, ${library.length} authors`);
for (const [file, bytes] of Object.entries(sizes)) console.log(`  public/data/${file}  ${(bytes / 1024).toFixed(1)} KiB`);
