// The practice island: prompt, composer, keyboard, hints, timer and results share one session controller.
import library from '../data/library.json';
import { FixedComposer } from '../lib/composer.ts';
import { charTypes, display, journey, layoutById, toBnDigits, unitMap, type Text } from '../lib/catalog.ts';
import { both, escapeHtml, lang, t } from '../lib/i18n.ts';
import { HandGuide } from '../lib/hands.ts';
import { BACKSPACE, ENTER, fingerName, fingerOf, positionOfVk, qwertyLabel, SHIFT_LEFT, SHIFT_RIGHT, shiftFor, SPACE, vkOfCode } from '../lib/keys.ts';
import { planStep, type Item, type Phase, type PunctuationItem, type WordsData } from '../lib/planner.ts';
import { press, solve, type Step } from '../lib/recipe.ts';
import { correctGpm, fiveCharWpm, graphemes, score, speedQualifies, words as splitWords } from '../lib/scoring.ts';
import { layoutProgress, load, mastery, save, today } from '../lib/store.ts';

const root = document.querySelector<HTMLElement>('[data-practice]')!;
const layoutId = root.dataset.layout!;
const layout = layoutById(layoutId)!;
const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const params = new URLSearchParams(location.search);
const steps = journey(layoutId);
const units = unitMap(layout.language);
const fresh = FixedComposer.create(layout, charTypes);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  title: $('pr-title'),
  bar: $('pr-bar'),
  phaseTitle: $('pr-phase-title'),
  phaseText: $('pr-phase-text'),
  card: $('pr-card'),
  credit: $('pr-credit'),
  words: $('pr-words'),
  typed: $('pr-typed'),
  chips: $('pr-chips'),
  overlay: $('pr-overlay'),
  finger: $('pr-finger'),
  kb: $('pr-kb'),
  acc: $('pr-acc'),
  speed: $('pr-speed'),
  time: $('pr-time'),
  count: $('pr-count'),
  results: $('pr-results'),
  workspace: $('pr-workspace'),
  ime: $('pr-ime'),
  hints: $<HTMLInputElement>('pr-hints'),
  showKb: $<HTMLInputElement>('pr-showkb'),
  hands: $<HTMLInputElement>('pr-hands'),
  pastel: $<HTMLInputElement>('pr-pastel'),
};
const hands = new HandGuide(el.kb, `${base}hands/`);

// ---------------------------------------------------------------- session state

interface WordResult {
  phase: string;
  gate: boolean;
  target: string;
  typed: string;
  distance: number;
  matches: number;
  refUnits: number;
  maxUnits: number;
  ms: number;
  hinted: boolean;
  corrected: boolean;
  wrong: number;
  units: string[];
}

type Mode = 'loading' | 'intro' | 'typing' | 'paused' | 'done';

let mode: Mode = 'loading';
let stepId = params.get('step') ?? '';
let phases: Phase[] = [];
let pi = 0; // phase
let ii = 0; // item
let wi = 0; // word within item
let itemWords: string[] = [];
let target = '';
let composer = fresh.clone();
let typed = '';
let recipe: Step[] | null = null;
let fullRecipe: Step[] | null = null;
let word = { hinted: false, hintShown: false, corrected: false, wrong: 0, started: 0 };
let hesitated = false;
let hesitateTimer = 0;
let latchedShift = false;
let physicalShift = false;
const results: WordResult[] = [];
const keyErrors: Record<string, number> = {};
let readRef: { author: string; work: string; start: number } | null = null;

// Active time: runs from a keystroke, pauses on blur, hidden tab or 8 s of inactivity.
const clock = {
  total: 0,
  since: 0,
  idle: 0,
  running: false,
  now() {
    return this.total + (this.running ? performance.now() - this.since : 0);
  },
  start() {
    if (!this.running) {
      this.since = performance.now();
      this.running = true;
    }
    clearTimeout(this.idle);
    this.idle = window.setTimeout(() => this.stop(), 8000);
  },
  stop() {
    if (this.running) {
      this.total += performance.now() - this.since;
      this.running = false;
    }
    clearTimeout(this.idle);
  },
};

const phase = () => phases[pi];
const item = (): Item => phase().items[ii];
const assist = () => item().assist;
const hintsWanted = () => el.hints.checked;

// ---------------------------------------------------------------- data

async function json<T>(path: string): Promise<T> {
  const response = await fetch(base + path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json() as Promise<T>;
}

async function plan(): Promise<Phase[]> {
  const read = params.get('read');
  if (read) {
    const [author, work] = read.split(':');
    const shard = await json<{ id: string; title: string; collection: string | null; sources: string[]; items: { text: string }[] }[]>(
      `data/bn/library/${author}.json`,
    );
    const entry = shard.find((w) => w.id === work) ?? shard[0];
    const authorName = library.find((a) => a.slug === author)?.author ?? '';
    const saved = layoutProgress(load(), layoutId).reading;
    const start = saved && saved.work === entry.id ? saved.item % entry.items.length : 0;
    readRef = { author, work: entry.id, start };
    const credit = { author: authorName, title: entry.title, collection: entry.collection, source: entry.sources[0] };
    const items = [...entry.items.slice(start), ...entry.items.slice(0, start)];
    stepId = 'read';
    return [{
      id: 'read',
      title: { en: entry.title, bn: entry.title },
      instructions: {
        en: 'Read, then type at your own pace. Your place in this work is remembered.',
        bn: 'পড়ুন, তারপর নিজের গতিতে লিখুন। এই রচনায় আপনার অবস্থান মনে রাখা হবে।',
      },
      items: items.map((i) => ({ text: i.text, assist: 'independent', units: [], credit })),
    }];
  }
  const p = load();
  if (!steps.some((s) => s.id === stepId)) {
    const done = new Set(layoutProgress(p, layoutId).completed);
    stepId = steps.find((s) => !done.has(s.id))?.id ?? 'words';
  }
  const data = await json<WordsData>(`data/${layout.language}/words.json`);
  const punctuation = layout.language === 'bn' ? await json<PunctuationItem[]>('data/bn/punctuation.json') : [];
  return planStep(layoutId, stepId, data, punctuation, p);
}

/** Every word of the item has a key recipe on this layout (literature may use marks a layout lacks, e.g. ॥). */
const typable = (text: string) => splitWords(text).every((w) => solve(fresh, '', w) !== null);

async function typablePlan(): Promise<Phase[]> {
  return (await plan())
    .map((phase) => ({ ...phase, items: phase.items.filter((i) => typable(i.text)) }))
    .filter((phase) => phase.items.length > 0);
}

// ---------------------------------------------------------------- rendering

const keyName = (s: { vk: number; shift: boolean }) =>
  s.vk === BACKSPACE ? '⌫' : (s.shift ? '⇧ ' : '') + qwertyLabel(s.vk);

function renderHeader() {
  const step = steps.find((s) => s.id === stepId);
  el.title.innerHTML = step ? both(step.title) : both(phase().title);
  const total = phases.reduce((n, p) => n + p.items.length, 0);
  const done = phases.slice(0, pi).reduce((n, p) => n + p.items.length, 0) + ii;
  el.bar.style.setProperty('--p', String(total ? done / total : 0));
  el.bar.setAttribute('aria-valuenow', String(Math.round((100 * done) / Math.max(1, total))));
  el.phaseTitle.innerHTML = both(phase().title);
  el.phaseText.innerHTML = both(phase().instructions);
  el.count.textContent = `${done + 1} / ${total}`;
  const credit = item()?.credit;
  el.credit.innerHTML = credit
    ? `<span>${escapeHtml(credit.author)}</span> · <cite>${escapeHtml(credit.title)}</cite>${credit.collection ? ` · ${escapeHtml(credit.collection)}` : ''}` +
      (credit.source ? ` · <a href="${escapeHtml(credit.source)}" target="_blank" rel="noopener">${t({ en: 'source', bn: 'উৎস' })}</a>` : '')
    : '';
  el.credit.hidden = !credit;
}

function renderWords() {
  const parts = itemWords.map((w, i) => {
    if (i < wi) {
      const r = results[results.length - (wi - i)];
      const ok = r && r.distance === 0;
      return `<span class="w done ${ok ? 'ok' : 'bad'}">${escapeHtml(w)}</span>`;
    }
    if (i > wi) return `<span class="w todo">${escapeHtml(w)}</span>`;
    // Current word: target graphemes, marked as the learner's text matches them.
    const tg = graphemes(target);
    const yg = graphemes(typed.normalize('NFC'));
    const marked = tg.map((g, j) => {
      const cls = j < yg.length ? (yg[j] === g ? 'hit' : 'miss') : j === yg.length ? 'next' : '';
      return `<span class="g ${cls}">${escapeHtml(g)}</span>`;
    }).join('');
    return `<span class="w now">${marked}</span>`;
  });
  el.words.innerHTML = parts.join(' ');
  el.words.querySelector('.now')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  const tg = graphemes(target);
  const yg = graphemes(typed.normalize('NFC'));
  el.typed.innerHTML = yg.length
    ? yg.map((g, j) => `<span class="${tg[j] === g ? '' : 'err'}">${escapeHtml(g)}</span>`).join('') + '<span class="caret"></span>'
    : `<span class="placeholder">${t({ en: 'Start typing…', bn: 'লেখা শুরু করুন…' })}</span><span class="caret"></span>`;
}

function hintVisible() {
  if (mode !== 'typing' || !recipe?.length) return false;
  const a = assist();
  if (a === 'demonstrate' || word.hinted) return true;
  return a === 'prompted' && hintsWanted() && (hesitated || word.wrong > 0);
}

function renderHint() {
  el.kb.querySelectorAll('.key.target, .key.target-shift').forEach((k) => k.classList.remove('target', 'target-shift'));
  const next = recipe?.[0];
  const show = hintVisible() && next;
  if (show) {
    word.hintShown = true;
    el.kb.querySelector(`.key[data-vk="${next.vk}"]`)?.classList.add('target');
    if (next.shift) el.kb.querySelector(`.key[data-vk="${shiftFor(next.vk)}"]`)?.classList.add('target-shift');
    const finger = fingerOf(next.vk);
    const shiftNote = next.shift ? t({ en: ` + ${t(fingerName[fingerOf(shiftFor(next.vk))])} on Shift`, bn: ` + শিফটে ${t(fingerName[fingerOf(shiftFor(next.vk))])}` }) : '';
    el.finger.innerHTML = `<span class="dot f-${finger}"></span><b>${escapeHtml(t(fingerName[finger]))}</b>` +
      `<kbd>${escapeHtml(keyName(next))}</kbd>${escapeHtml(shiftNote)}`;
    // The revision changes with every step, so a doubled key presses again in place.
    hands.setCue(positionOfVk[next.vk] ?? null, next.shift, `${wi}:${fullRecipe ? fullRecipe.length - recipe!.length : 0}`);
  } else {
    hands.setCue(null, false, '');
    el.finger.innerHTML = mode === 'typing' && assist() === 'independent' && !word.hinted
      ? `<span class="muted">${t({ en: 'From memory — press Tab for a hint', bn: 'মনে রেখে — সাহায্যের জন্য Tab' })}</span>`
      : mode === 'typing' && recipe?.length === 0
        ? `<span class="muted">${t({ en: 'Press Space for the next word', bn: 'পরের শব্দের জন্য স্পেস চাপুন' })}</span>`
        : '';
  }
  // Key-sequence chips: shown while demonstrating, so the learner sees the whole recipe.
  if (assist() === 'demonstrate' && fullRecipe) {
    const doneCount = recipe && typed && target.startsWith(typed.normalize('NFC')) ? fullRecipe.length - recipe.length : 0;
    el.chips.innerHTML = fullRecipe.map((s, i) => {
      const produced = i === 0 ? s.text : s.text.slice(commonPrefixLen(fullRecipe![i - 1].text, s.text));
      return `<span class="chip f-${fingerOf(s.vk)} ${i < doneCount ? 'done' : i === doneCount ? 'now' : ''}">` +
        `<kbd>${escapeHtml(keyName(s))}</kbd><span>${escapeHtml(display(produced || '·'))}</span></span>`;
    }).join('<span class="plus">+</span>') + `<span class="plus">+</span><span class="chip space"><kbd>Space</kbd></span>`;
    el.chips.hidden = false;
  } else {
    el.chips.hidden = true;
  }
}

const commonPrefixLen = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i;
};

function renderStats() {
  const scored = results.filter((r) => r.maxUnits > 0);
  const dist = scored.reduce((n, r) => n + r.distance, 0);
  const max = scored.reduce((n, r) => n + r.maxUnits, 0);
  el.acc.textContent = max ? `${Math.round(100 * Math.max(0, 1 - dist / max))}%` : '—';
  const ms = clock.now();
  const matches = results.reduce((n, r) => n + r.matches, 0);
  const gpm = correctGpm(matches, ms);
  el.speed.textContent = gpm && ms > 5000 ? String(Math.round(gpm)) : '—';
  const s = Math.floor(ms / 1000);
  el.time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function render() {
  if (mode === 'loading' || mode === 'done') return;
  renderHeader();
  renderWords();
  renderHint();
  renderStats();
  el.overlay.hidden = mode === 'typing';
  root.classList.toggle('intro', mode === 'intro');
  if (mode === 'intro') {
    el.overlay.innerHTML = `<div class="ov-card"><p class="eyebrow">${both({ en: `Part ${pi + 1} of ${phases.length}`, bn: `অংশ ${toBnDigits(pi + 1)} / ${toBnDigits(phases.length)}` })}</p>` +
      `<h3>${both(phase().title)}</h3><p>${both(phase().instructions)}</p>` +
      `<button class="btn primary" data-go>${both({ en: 'Start', bn: 'শুরু' })} <kbd>Space</kbd></button></div>`;
  } else if (mode === 'paused') {
    el.overlay.innerHTML = `<div class="ov-card"><h3>${both({ en: 'Paused', bn: 'বিরতি' })}</h3>` +
      `<p>${both({ en: 'The timer stops while you are away. Your place is kept.', bn: 'আপনি দূরে থাকলে সময় থেমে থাকে। আপনার জায়গা মনে আছে।' })}</p>` +
      `<button class="btn primary" data-go>${both({ en: 'Continue', bn: 'চালিয়ে যান' })} <kbd>Space</kbd></button></div>`;
  }
}

// ---------------------------------------------------------------- flow

function beginWord() {
  target = itemWords[wi].normalize('NFC');
  composer = fresh.clone();
  composer.reset();
  typed = '';
  fullRecipe = solve(composer, '', target);
  recipe = fullRecipe;
  word = { hinted: false, hintShown: false, corrected: false, wrong: 0, started: clock.now() };
  armHesitation();
}

function beginItem() {
  itemWords = splitWords(item().text);
  wi = 0;
  beginWord();
}

function armHesitation() {
  hesitated = false;
  clearTimeout(hesitateTimer);
  hesitateTimer = window.setTimeout(() => {
    hesitated = true;
    renderHint();
  }, 1500);
}

function submitWord() {
  if (!typed) return;
  const s = score(target, typed);
  const single = itemWords.length === 1;
  results.push({
    phase: phase().id,
    gate: !!phase().gate,
    target,
    typed,
    distance: s.distance,
    matches: s.matches,
    refUnits: s.referenceUnits,
    maxUnits: Math.max(s.referenceUnits, s.responseUnits),
    ms: clock.now() - word.started,
    hinted: word.hinted,
    corrected: word.corrected,
    wrong: word.wrong,
    units: single ? item().units : [],
  });
  flashCard(s.distance === 0 ? 'ok' : 'bad');
  wi++;
  if (wi < itemWords.length) {
    beginWord();
  } else {
    ii++;
    if (readRef) {
      const p = load();
      layoutProgress(p, layoutId).reading = { author: readRef.author, work: readRef.work, item: readRef.start + ii };
      save(p);
    }
    if (ii < phase().items.length) beginItem();
    else {
      pi++;
      ii = 0;
      if (pi >= phases.length) return finish();
      mode = 'intro';
      clock.stop();
      beginItem();
    }
  }
  render();
}

function flashCard(kind: 'ok' | 'bad') {
  el.card.classList.remove('flash-ok', 'flash-bad');
  void el.card.offsetWidth;
  el.card.classList.add(`flash-${kind}`);
}

function flashKey(vk: number, kind: 'press' | 'wrong') {
  const key = el.kb.querySelector(`.key[data-vk="${vk}"]`);
  if (!key) return;
  key.classList.remove('press', 'wrong');
  void (key as HTMLElement).offsetWidth;
  key.classList.add(kind);
}

function onKey(vk: number, shift: boolean) {
  if (mode === 'intro' || mode === 'paused') {
    if (vk === SPACE || vk === ENTER) {
      mode = 'typing';
      armHesitation();
      render();
    }
    return;
  }
  if (mode !== 'typing') return;
  clock.start();
  if (vk === SPACE) {
    flashKey(vk, 'press');
    return submitWord();
  }
  if (vk === ENTER) return;
  const before = recipe;
  if (vk === BACKSPACE) {
    if (!typed) return;
    word.corrected = true;
    typed = press(composer, typed, { vk, shift: false });
    flashKey(vk, 'press');
  } else {
    if (!composer.charOf(vk, shift)) {
      flashKey(vk, 'wrong');
      return;
    }
    typed = press(composer, typed, { vk, shift });
    recipe = solve(composer, typed, target);
    const expected = before?.[0];
    const offTrack = recipe === null || (before !== null && recipe.length > before.length - 1);
    if (offTrack && expected) {
      word.wrong++;
      const key = `${expected.vk}${expected.shift ? 's' : ''}`;
      keyErrors[key] = (keyErrors[key] ?? 0) + 1;
    }
    flashKey(vk, offTrack ? 'wrong' : 'press');
    armHesitation();
    renderWords();
    renderHint();
    renderStats();
    return;
  }
  recipe = solve(composer, typed, target);
  armHesitation();
  renderWords();
  renderHint();
  renderStats();
}

function pause() {
  if (mode !== 'typing') return;
  clock.stop();
  mode = 'paused';
  render();
}

// ---------------------------------------------------------------- results

function finish() {
  mode = 'done';
  clock.stop();
  clearTimeout(hesitateTimer);
  const p = load();
  const lp = layoutProgress(p, layoutId);
  const sum = (rs: WordResult[]) => {
    const dist = rs.reduce((n, r) => n + r.distance, 0);
    const max = rs.reduce((n, r) => n + r.maxUnits, 0);
    return max ? 100 * Math.max(0, 1 - dist / max) : 100;
  };
  const overall = sum(results);
  const gateResults = results.filter((r) => r.gate);
  const gateAccuracy = gateResults.length ? sum(gateResults) : overall;
  const ms = clock.total;
  const matches = results.reduce((n, r) => n + r.matches, 0);
  const refUnits = results.reduce((n, r) => n + r.refUnits, 0);
  const gpm = correctGpm(matches, ms);
  const wpm = fiveCharWpm(results.map((r) => r.typed).join(' '), ms);
  const qualified = speedQualifies(ms, refUnits);
  const passed = stepId === 'read' || gateAccuracy >= 90;

  // Unit evidence: independent means correct with no hint shown, no correction and no wrong key.
  for (const r of results) {
    const ok = r.distance === 0;
    for (const u of new Set(r.units)) {
      const e = (lp.units[u] ??= { seen: 0, correct: 0, independent: 0, lastAt: 0 });
      e.seen++;
      if (ok) e.correct++;
      if (ok && !r.hinted && !r.corrected && r.wrong === 0 && r.phase !== 'meet') e.independent++;
      e.lastAt = Date.now();
    }
  }
  for (const [k, n] of Object.entries(keyErrors)) lp.keyErrors[k] = (lp.keyErrors[k] ?? 0) + n;
  if (passed && stepId !== 'read' && !lp.completed.includes(stepId)) lp.completed.push(stepId);
  lp.best[stepId] = Math.max(lp.best[stepId] ?? 0, Math.round(gateAccuracy));
  p.layout = layoutId;
  p.days[today()] = (p.days[today()] ?? 0) + ms;
  p.sessions.push({ at: Date.now(), layout: layoutId, step: stepId, ms, accuracy: Math.round(gateAccuracy), gpm, wpm, qualified, units: refUnits });
  if (p.sessions.length > 500) p.sessions.splice(0, p.sessions.length - 500);
  const saved = save(p);

  const stepIndex = steps.findIndex((s) => s.id === stepId);
  const next = steps[stepIndex + 1];
  const step = steps[stepIndex];
  const newUnits = step?.kind === 'group' ? step.units : [];
  const problems = Object.entries(keyErrors).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const message: Text = stepId === 'read'
    ? { en: 'Lovely reading.', bn: 'চমৎকার পড়া।' }
    : passed
      ? gateAccuracy >= 98 ? { en: 'Beautifully done.', bn: 'অসাধারণ।' } : { en: 'Step complete.', bn: 'ধাপ সম্পূর্ণ।' }
      : { en: 'Nearly there — one more round will do it.', bn: 'প্রায় হয়ে গেছে — আরেকবার চেষ্টা করুন।' };
  const fmt = (n: number | null) => (n == null ? '—' : String(Math.round(n)));
  const stepUrl = (id: string) => `${base}practice/${layoutId}/?step=${id}`;

  el.bar.style.setProperty('--p', '1');
  el.workspace.hidden = true;
  el.results.hidden = false;
  el.results.innerHTML = `
    <div class="res-card">
      <div class="ring" style="--v:${gateAccuracy / 100}"><span>${Math.round(gateAccuracy)}<small>%</small></span></div>
      ${gateResults.length && gateResults.length < results.length ? `<p class="muted ring-note">${both({ en: `From memory · ${Math.round(overall)}% across the whole step`, bn: `মনে রেখে · পুরো ধাপে ${Math.round(overall)}%` })}</p>` : ''}
      <h2>${both(message)}</h2>
      <p class="muted">${both({ en: 'Accuracy is measured in letters (grapheme units), as Kala scores it.', bn: 'নির্ভুলতা অক্ষর-একক (গ্রাফিম) ধরে মাপা হয়, Kala যেভাবে মাপে।' })}</p>
      <dl class="res-stats">
        <div><dt>${both({ en: 'Letters / min', bn: 'অক্ষর / মিনিট' })}</dt><dd>${fmt(gpm)}</dd></div>
        <div><dt>${both({ en: '5-char WPM', bn: '৫-অক্ষর WPM' })}</dt><dd>${fmt(wpm)}</dd></div>
        <div><dt>${both({ en: 'Active time', bn: 'সক্রিয় সময়' })}</dt><dd>${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}</dd></div>
        <div><dt>${both({ en: 'Words', bn: 'শব্দ' })}</dt><dd>${results.length}</dd></div>
      </dl>
      ${qualified ? '' : `<p class="note">${both({ en: 'Speed is indicative: a reportable speed needs at least 60 seconds and 100 letters.', bn: 'গতি আনুমানিক: নির্ভরযোগ্য গতির জন্য অন্তত ৬০ সেকেন্ড ও ১০০ অক্ষর দরকার।' })}</p>`}
      ${newUnits.length ? `<div class="res-units"><h3>${both({ en: 'Keys in this step', bn: 'এই ধাপের কি' })}</h3><div>${newUnits.map((u) => {
        const m = mastery(lp.units[u]);
        return `<span class="unit m${m}" title="${escapeHtml(t(units.get(u)?.name ?? { en: u, bn: u }))}">${escapeHtml(display(units.get(u)?.text ?? u))}</span>`;
      }).join('')}</div></div>` : ''}
      ${problems.length ? `<div class="res-units"><h3>${both({ en: 'Keys to revisit', bn: 'যে কি আবার দেখবেন' })}</h3><div>${problems.map(([k, n]) => {
        const vk = parseInt(k, 10);
        const shift = k.endsWith('s');
        const ch = composer.charOf(vk, shift) ?? '';
        return `<span class="unit m1"><kbd>${escapeHtml(keyName({ vk, shift }))}</kbd> ${escapeHtml(display(ch))} <small>×${n}</small></span>`;
      }).join('')}</div></div>` : ''}
      ${saved ? '' : `<p class="note error">${both({ en: 'Progress could not be saved in this browser. Check that site storage is allowed.', bn: 'এই ব্রাউজারে অগ্রগতি সংরক্ষণ করা যায়নি। সাইট স্টোরেজ চালু আছে কি না দেখুন।' })}</p>`}
      <div class="res-actions">
        ${passed && next && stepId !== 'read' ? `<a class="btn primary" href="${stepUrl(next.id)}">${both({ en: 'Next: ', bn: 'পরের ধাপ: ' })}${both(next.title)}</a>` : ''}
        ${stepId === 'read' ? `<a class="btn primary" href="${location.href}">${both({ en: 'Keep reading', bn: 'আরও পড়ুন' })}</a>` : `<a class="btn ${passed ? '' : 'primary'}" href="${stepUrl(stepId)}">${both({ en: 'Practise again', bn: 'আবার অনুশীলন' })}</a>`}
        <a class="btn ghost" href="${base}learn/${layoutId}/">${both({ en: 'Back to the path', bn: 'পথে ফিরুন' })}</a>
      </div>
    </div>`;
  el.results.querySelector<HTMLElement>('.btn.primary')?.focus();
}

// ---------------------------------------------------------------- input

window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') {
    physicalShift = true;
    el.kb.querySelector(`.key[data-vk="${e.code === 'ShiftRight' ? SHIFT_RIGHT : SHIFT_LEFT}"]`)?.classList.add('held');
    return;
  }
  if (mode === 'done' || mode === 'loading') return;
  if (e.isComposing || e.key === 'Process' || e.keyCode === 229) {
    el.ime.hidden = false;
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
  if (e.key === 'Escape') return pause();
  if (e.key === 'Tab') {
    e.preventDefault();
    if (mode === 'typing' && recipe?.length) {
      word.hinted = true;
      renderHint();
    }
    return;
  }
  const vk = vkOfCode[e.code];
  if (vk === undefined) return;
  e.preventDefault();
  onKey(vk, e.shiftKey);
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') {
    physicalShift = false;
    el.kb.querySelectorAll('.key.held').forEach((k) => k.classList.remove('held'));
  }
});

// On-screen keys call the same composer as physical keys.
el.kb.addEventListener('pointerdown', (e) => {
  const key = (e.target as HTMLElement).closest<HTMLElement>('.key[data-vk]');
  if (!key) return;
  e.preventDefault();
  const vk = Number(key.dataset.vk);
  if (vk === SHIFT_LEFT || vk === SHIFT_RIGHT) {
    latchedShift = !latchedShift;
    el.kb.classList.toggle('latched', latchedShift);
    return;
  }
  onKey(vk, latchedShift || physicalShift);
  if (latchedShift && vk !== BACKSPACE) {
    latchedShift = false;
    el.kb.classList.remove('latched');
  }
});

el.overlay.addEventListener('click', () => onKey(SPACE, false));
window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => document.hidden && pause());
document.addEventListener('paste', (e) => e.preventDefault());
document.addEventListener('kala:lang', () => render());
el.hints.addEventListener('change', () => {
  const p = load();
  p.settings.hints = el.hints.checked;
  save(p);
  renderHint();
});
el.showKb.addEventListener('change', () => {
  const p = load();
  p.settings.keyboard = el.showKb.checked;
  save(p);
  root.classList.toggle('no-kb', !el.showKb.checked);
});
el.hands.addEventListener('change', () => {
  const p = load();
  p.settings.hands = el.hands.checked;
  save(p);
  hands.setEnabled(el.hands.checked);
  renderHint();
});
el.pastel.addEventListener('change', () => {
  const p = load();
  p.settings.pastel = el.pastel.checked;
  save(p);
  el.kb.querySelector('.kb')?.classList.toggle('fingers', el.pastel.checked);
});
$('pr-ime-close').addEventListener('click', () => (el.ime.hidden = true));
window.setInterval(() => mode === 'typing' && renderStats(), 1000);

// ---------------------------------------------------------------- start

(async () => {
  const p = load();
  el.hints.checked = p.settings.hints;
  el.showKb.checked = p.settings.keyboard;
  el.hands.checked = p.settings.hands;
  el.pastel.checked = p.settings.pastel;
  root.classList.toggle('no-kb', !p.settings.keyboard);
  el.kb.querySelector('.kb')?.classList.toggle('fingers', p.settings.pastel);
  hands.setEnabled(p.settings.hands);
  try {
    phases = await typablePlan();
  } catch (error) {
    el.overlay.innerHTML = `<div class="ov-card"><h3>${both({ en: 'Could not load the lesson', bn: 'পাঠ লোড করা যায়নি' })}</h3><p>${escapeHtml(String(error))}</p></div>`;
    return;
  }
  if (!phases.length) {
    el.overlay.innerHTML = `<div class="ov-card"><h3>${both({ en: 'Nothing to type here on this layout', bn: 'এই লেআউটে এখানে লেখার কিছু নেই' })}</h3>` +
      `<p>${both({ en: 'These excerpts use marks no keyboard layout types — curly quotes, long dashes or ॥. Please choose another work.', bn: 'এই অংশগুলোতে এমন চিহ্ন আছে যা কোনো কিবোর্ড লেআউটে লেখা যায় না — বাঁকা উদ্ধৃতি, লম্বা ড্যাশ বা ॥। অন্য একটি রচনা বেছে নিন।' })}</p>` +
      `<a class="btn" href="${base}library/">${both({ en: 'Back to the library', bn: 'পাঠাগারে ফিরুন' })}</a></div>`;
    return;
  }
  if (stepId !== 'read') history.replaceState(null, '', `?step=${stepId}`);
  mode = 'intro';
  beginItem();
  root.classList.add('ready');
  render();
  if (lang() === 'bn') document.title = `${t(phases[0].title)} · Kala`;
})();
