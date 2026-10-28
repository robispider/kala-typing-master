import pkg from '../../package.json';
import { charTypes, layoutById, type Text } from '../lib/catalog.ts';
import { FixedComposer } from '../lib/composer.ts';
import { both, escapeHtml, t } from '../lib/i18n.ts';
import { keyboardHtml } from '../lib/keyboard.ts';
import { fingerName, fingerOf, qwertyLabel, shiftFor } from '../lib/keys.ts';
import { recipeFor } from '../lib/recipe.ts';
import { graphemes } from '../lib/scoring.ts';
import {
  aggregate, BANK, candidateLayout, candidates, FORMS, hashLayout, LIMITATIONS, plan, PROTOCOL,
  reportText, Trial, type Assistance, type ResearchReport, type Role, type TrialResult,
} from '../lib/research.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const say = (id: string, en: string, bn: string) => { $(id).innerHTML = both({ en, bn }); };
const select = (id: string) => $<HTMLSelectElement>(id).value;
const field = $('rs-input');
const HISTORY_KEY = 'kala-b01-style-research:v2';
const LAST_REPORT_KEY = 'kala-b01-style-research:last-report:v2';
interface History { counts: Record<string, number>; exposures: Record<string, number>; reports: number }
let storageAvailable = true;
let history: History = { counts: {}, exposures: {}, reports: 0 };
try {
  const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? 'null');
  if (saved && typeof saved === 'object' && saved.counts && saved.exposures && Number.isSafeInteger(saved.reports)) history = saved;
  const previous = localStorage.getItem(LAST_REPORT_KEY) ?? localStorage.getItem('kala-shared-research:last-report:v1');
  if (previous) { $('rs-previous').hidden = false; $<HTMLTextAreaElement>('rs-previous-text').value = previous; }
} catch { storageAvailable = false; }
const storeHistory = () => {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { storageAvailable = false; }
};
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

let report: ResearchReport | null = null;
let trial: Trial | null = null;
let blockIndex = 0;
let sequence = plan(1);
let currentRole: Role = 'practice';
let between: 'vowels' | 'block' | null = null;
let busy = false;
let closed = false;
let noteSaved = false;
let readyAction: (() => void) | null = null;
let advancingPrompt = false;
const held = new Set<string>();
const recorded = new Set<string>();
const hashes: Record<string, string> = {};
let lastTimeLabel = '';

const exposureKey = (role: Role, form: number) => `${BANK}:${role}:${role === 'practice' ? 0 : form}`;

async function prepare(event: SubmitEvent) {
  event.preventDefault();
  if (busy) return;
  busy = true; $<HTMLButtonElement>('rs-prepare').disabled = true;
  say('rs-setup-status', 'Checking B01 with both typing styles…', 'B01-তে দুই টাইপিং শৈলী যাচাই হচ্ছে…');
  try {
    const assistance = select('rs-assistance') as Assistance;
    // Give the busy message a paint before the bounded, decoder-replayed recipe validation.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    for (const style of ['A', 'D'] as const) {
      const layout = candidateLayout('B01', style);
      hashes[style] = await hashLayout(layout);
      const fresh = FixedComposer.create(layout, charTypes);
      for (const role of Object.values(FORMS)) {
        for (const text of role) for (const word of text.split(' ')) {
          if (!recipeFor(fresh, word)) throw new Error(`No valid typing recipe: B01/${style} ${word}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    const group = assistance;
    const number = count(history.counts[group]) + 1;
    sequence = plan(number);
    report = {
      schema: 'kala.b01-style-pilot/2', protocol: PROTOCOL, bank: BANK,
      session: {
        id: crypto.randomUUID(), number, startedUtc: new Date().toISOString(), appVersion: pkg.version,
        candidate: 'B01', assistance, previousStyleExperience: select('rs-style-experience'), experience: select('rs-experience'), keyboard: select('rs-keyboard') as ResearchReport['session']['keyboard'],
        fingering: select('rs-fingering'), priorReports: count(history.reports), order: sequence.map((b) => b.style),
        completion: 'stopped', storageAvailable, exposureBefore: { ...history.exposures },
      },
      maps: (['A', 'D'] as const).map((style) => {
        const c = candidates.find((c) => c.label === 'B01')!;
        return { label: c.label, id: c.id, style, sourceSha256: c.sourceSha256, physicalMapSha256: c.physicalMapSha256,
          runtimeHash: hashes[style], ruleTemplateHash: layoutById(style === 'A' ? 'kala-goti' : 'kala-jhor')!.sourceSha256 };
      }),
      limitations: [...LIMITATIONS, ...(assistance === 'guided' ? ['next-key-guidance-during-measurement'] : [])],
      trials: [], blocks: [], preference: 'unsure',
    };
    history.counts[group] = number;
    storeHistory();
    blockIndex = 0; closed = false;
    $('rs-setup').hidden = true; $('rs-work').hidden = false;
    afterRelease(() => startTrial('practice'));
  } catch (error) {
    say('rs-setup-status', `The test could not start: ${String(error)}`, `পরীক্ষা শুরু করা যায়নি: ${String(error)}`);
  } finally {
    busy = false; $<HTMLButtonElement>('rs-prepare').disabled = false;
  }
}

function afterRelease(action: () => void) {
  if (held.size) {
    readyAction = action;
    say('rs-status', 'Release all keys to continue.', 'চালিয়ে যেতে সব কি ছেড়ে দিন।');
  } else action();
}

function startTrial(role: Role) {
  if (!report || closed) return;
  const block = sequence[blockIndex];
  const exposure = exposureKey(role, block.form);
  trial = new Trial({
    candidate: 'B01', style: block.style, assistance: report.session.assistance,
    role, block: block.block, form: block.form, sessionId: report.session.id, runtimeHash: hashes[block.style],
    keyboard: report.session.keyboard, previousExposures: count(history.exposures[exposure]), appVersion: pkg.version,
  });
  // Count exposure when text is shown, including abandoned and practice displays.
  history.exposures[exposure] = count(history.exposures[exposure]) + 1; storeHistory();
  currentRole = role; between = null; recorded.clear(); advancingPrompt = false; lastTimeLabel = '';
  $('rs-typing').hidden = false; $('rs-between').hidden = true;
  $('rs-kb').innerHTML = keyboardHtml(trial.layout);
  const useGuidance = role === 'practice' || report.session.assistance === 'guided';
  $('rs-kb').hidden = !useGuidance;
  $('rs-measure').hidden = role !== 'practice';
  say('rs-heading', `Block ${blockIndex + 1} of 4 · B01 · ${block.style === 'A' ? 'Goti' : 'Jhor'}`,
    `পর্ব ${blockIndex + 1}/4 · B01 · ${block.style === 'A' ? 'গতি' : 'ঝড়'}`);
  $('rs-rule').hidden = role !== 'practice';
  const rule = block.style === 'A'
    ? { en: 'Goti: for a full vowel, press hasant (S) then its vowel key. The same positions are used in every block.', bn: 'গতি: পূর্ণ স্বরবর্ণের জন্য আগে হসন্ত (S), তারপর স্বর-কী চাপুন। সব পর্বে কি-এর অবস্থান একই।' }
    : { en: 'Jhor: the vowel key gives a full vowel at word start and a sign after a consonant. Press it twice after a consonant for a full vowel.', bn: 'ঝড়: শব্দের শুরুতে স্বর-কী পূর্ণ স্বরবর্ণ দেয়; ব্যঞ্জনের পরে কার। ব্যঞ্জনের পরে পূর্ণ স্বরবর্ণ চাইলে স্বর-কী দুবার চাপুন।' };
  const example = recipeFor(FixedComposer.create(trial.layout, charTypes), 'বই')!;
  const keys = example.map((a) => `${a.shift ? 'Shift+' : ''}${qwertyLabel(a.vk)}`).join(' → ');
  $('rs-rule').innerHTML = `${both(rule)} <strong>বই: ${escapeHtml(keys)}</strong>`;
  say('rs-role', role === 'practice' ? 'Practice · not measured' : role === 'ordinary' ? 'Ordinary text · 1 minute' : 'Vowel diagnostic · 1 minute',
    role === 'practice' ? 'অনুশীলন · মাপের বাইরে' : role === 'ordinary' ? 'সাধারণ লেখা · ১ মিনিট' : 'স্বরচিহ্ন যাচাই · ১ মিনিট');
  renderTyping(); field.focus(); tick();
}

function renderTyping() {
  if (!trial || trial.done) return;
  const want = graphemes(trial.target.normalize('NFC'));
  const got = graphemes(trial.typed.normalize('NFC'));
  $('rs-prompt').innerHTML = want.map((g, i) => `<span class="${i >= got.length ? 'todo' : g === got[i] || (i === got.length - 1 && g.startsWith(got[i])) ? 'hit' : 'miss'}">${escapeHtml(g)}</span>`).join('');
  $('rs-typed').textContent = trial.typed || t({ en: 'Your typing appears here.', bn: 'আপনার লেখা এখানে দেখা যাবে।' });
  $('rs-kb').querySelectorAll('.target, .target-shift').forEach((key) => key.classList.remove('target', 'target-shift'));
  const cue = trial.hint();
  if (cue) {
    $('rs-kb').querySelector(`[data-vk="${cue.vk}"]`)?.classList.add('target');
    if (cue.shift) $('rs-kb').querySelector(`[data-vk="${shiftFor(cue.vk)}"]`)?.classList.add('target-shift');
    const finger = fingerName[fingerOf(cue.vk)];
    say('rs-cue', `Next: ${cue.shift ? 'Shift + ' : ''}${qwertyLabel(cue.vk)} · ${finger.en}`,
      `পরের কি: ${cue.shift ? 'Shift + ' : ''}${qwertyLabel(cue.vk)} · ${finger.bn}`);
  } else if (trial.reachedLastWord()) say('rs-cue', 'Press Enter to start this text again; the minute continues.', 'Enter চাপলে লেখাটি আবার শুরু হবে; একই মিনিট চলবে।');
  else say('rs-cue', trial.pausedAt !== null ? 'Paused. Use Pause / resume to continue.' : 'Memory test: no key cues.',
    trial.pausedAt !== null ? 'বিরতি চলছে। চালু করতে বিরতি / চালু চাপুন।' : 'মনে রেখে লেখার পরীক্ষা: কি দেখানো হবে না।');
}

function keepTrial(result: TrialResult) {
  if (!report || report.trials.includes(result)) return;
  report.trials.push(result);
  const extra = result.capture.prompts.length - 1;
  const key = exposureKey(result.role, result.form);
  history.exposures[key] = count(history.exposures[key]) + extra;
  storeHistory();
}

function endRole(result: TrialResult) {
  keepTrial(result); between = currentRole === 'ordinary' ? 'vowels' : 'block';
  $('rs-typing').hidden = true; $('rs-between').hidden = false;
  $('rs-rating').hidden = between !== 'block'; noteSaved = false;
  $<HTMLSelectElement>('rs-comfort').value = ''; $<HTMLTextAreaElement>('rs-notes').value = '';
  if (between === 'vowels') {
    say('rs-between-title', 'Ordinary text finished. Take a break.', 'সাধারণ লেখার মাপ শেষ। একটু বিরতি নিন।');
    say('rs-between-text', 'Next is a separate minute of vowel and context exercises: full vowels, signs and repeated vowel keys. These scores stay separate from ordinary text.',
      'এবার পূর্ণ স্বরবর্ণ, কার ও একই স্বর-কী বারবার চাপার নিয়মে আলাদা এক মিনিট। এর ফল সাধারণ লেখার সঙ্গে মেশানো হবে না।');
  } else {
    say('rs-between-title', `Block ${blockIndex + 1} finished.`, `পর্ব ${blockIndex + 1} শেষ।`);
    say('rs-between-text', blockIndex === 3 ? 'Add a comfort rating, then finish and copy your report.' : 'Add a comfort rating. The next block starts with guided practice for its typing style. B01 positions stay fixed.',
      blockIndex === 3 ? 'স্বাচ্ছন্দ্যের মতামত দিয়ে শেষ করুন, তারপর প্রতিবেদন কপি করুন।' : 'স্বাচ্ছন্দ্যের মতামত দিন। পরের পর্বে শৈলীর নিয়মে অনুশীলন করতে পারবেন। B01-এর অবস্থান একই থাকবে।');
  }
  say('rs-status', 'Not timed. Continue when ready.', 'এখন সময় মাপা হচ্ছে না। প্রস্তুত হলে চালিয়ে যান।');
  $<HTMLButtonElement>('rs-next').focus();
}

function saveRating() {
  if (!report || between !== 'block' || noteSaved) return;
  const value = select('rs-comfort');
  const comfort = value ? Number(value) : null;
  report.blocks.push({ block: blockIndex, candidate: 'B01', style: sequence[blockIndex].style, comfort, notes: $<HTMLTextAreaElement>('rs-notes').value });
  for (const r of report.trials.filter((r) => r.block === blockIndex && r.role !== 'practice')) r.comfort = comfort;
  noteSaved = true;
}

function tick() {
  if (!trial || closed || between) return;
  if (trial.sync()) { endRole(trial.done!); return; }
  const paused = trial.pausedAt !== null;
  const label = `${paused}:${currentRole}:${Math.ceil((trial.limit ?? 0) / 1000 - trial.elapsed() / 1000)}`;
  if (label === lastTimeLabel) return;
  lastTimeLabel = label;
  if (paused) say('rs-status', 'Paused · time is excluded.', 'বিরতি · এই সময় মাপের বাইরে।');
  else if (currentRole === 'practice') say('rs-status', 'Practice as long as you need. Begin the measured minute when ready.', 'যতক্ষণ দরকার অনুশীলন করুন। প্রস্তুত হলে মাপের মিনিট শুরু করুন।');
  else say('rs-status', `${Math.max(0, Math.ceil((trial.limit! - trial.elapsed()) / 1000))} seconds remaining · ${report?.session.assistance === 'guided' ? 'guided' : 'from memory'}`,
    `আর ${Math.max(0, Math.ceil((trial.limit! - trial.elapsed()) / 1000))} সেকেন্ড · ${report?.session.assistance === 'guided' ? 'সাহায্য নিয়ে' : 'মনে রেখে'}`);
}

function pause(reason: 'focus-loss' | 'button' | 'mode-change') {
  if (!trial || closed || between || trial.done) return;
  trial.pause(reason); renderTyping(); tick();
}

function finish(completion: 'completed' | 'stopped') {
  if (!report || closed) return;
  readyAction = null; saveRating();
  if (trial && !trial.done) keepTrial(trial.finish('stopped'));
  report.session.completion = completion;
  report.session.storageAvailable = storageAvailable;
  history.reports = count(history.reports) + 1; storeHistory();
  closed = true;
  let text = reportText(report);
  try { localStorage.setItem(LAST_REPORT_KEY, text); } catch {
    storageAvailable = false; report.session.storageAvailable = false; text = reportText(report);
  }
  $('rs-work').hidden = true; $('rs-result').hidden = false;
  $<HTMLTextAreaElement>('rs-report').value = text;
  const fmt = (n: number | null) => n === null ? '—' : n.toFixed(1);
  const rows = (['A', 'D'] as const).flatMap((style) => (['ordinary', 'vowel-diagnostic'] as const).map((role) => {
    const a = aggregate(report!.trials, 'B01', role, style);
    const name: Text = role === 'ordinary' ? { en: 'Ordinary', bn: 'সাধারণ' } : { en: 'Vowel diagnostic', bn: 'স্বরচিহ্ন যাচাই' };
    return `<tr><td>${style === 'A' ? 'Goti' : 'Jhor'}</td><td>${both(name)}</td><td>${fmt(a.activeSeconds)}</td><td>${fmt(a.accuracy)}</td><td>${fmt(a.correctGpm)}</td><td>${a.backspaces}</td></tr>`;
  }));
  const headers: Text[] = [{ en: 'B01 style', bn: 'B01-এর শৈলী' }, { en: 'Text', bn: 'লেখা' }, { en: 'Active seconds', bn: 'সক্রিয় সেকেন্ড' },
    { en: 'Accuracy %', bn: 'নির্ভুলতা %' }, { en: 'Correct GPM', bn: 'সঠিক একক/মিনিট' }, { en: 'Backspaces', bn: 'Backspace' }];
  $('rs-summary').innerHTML = `<p>${both(completion === 'completed' ? { en: 'All four blocks complete.', bn: 'চারটি পর্ব শেষ।' } : { en: 'Stopped early. Missing blocks are not zero scores.', bn: 'আগে থেমেছেন। বাকি পর্বের মাপ শূন্য নয়, অনুপস্থিত।' })}</p>
    <table><thead><tr>${headers.map((h) => `<th>${both(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>
    <p class="tiny">${both({ en: '— means no sample or too little data for speed (60 seconds and 100 attempted units required). Guided speed is assisted performance. Download the full JSON before leaving for original events.', bn: '— মানে নমুনা নেই বা গতি দেখানোর মতো তথ্য কম (৬০ সেকেন্ড ও ১০০টি চেষ্টা করা একক দরকার)। সাহায্য নিয়ে গতি আলাদা মাপ। মূল রেকর্ড চাইলে পাতা ছাড়ার আগে সম্পূর্ণ JSON নামান।' })}</p>`;
  $('rs-copy').focus();
}

$('rs-form').addEventListener('submit', (event) => void prepare(event as SubmitEvent));
$('rs-measure').addEventListener('click', () => afterRelease(() => {
  if (trial && !trial.done && currentRole === 'practice') { keepTrial(trial.finish('stopped')); startTrial('ordinary'); }
}));
$('rs-next').addEventListener('click', () => afterRelease(() => {
  if (between === 'vowels') startTrial('vowel-diagnostic');
  else if (between === 'block') { saveRating(); if (blockIndex === 3) finish('completed'); else { blockIndex++; startTrial('practice'); } }
}));
for (const id of ['rs-pause', 'rs-stop']) $(id).addEventListener('pointerdown', (e) => e.preventDefault());
$('rs-pause').addEventListener('click', () => afterRelease(() => {
  if (!trial || trial.done || between) return;
  if (trial.pausedAt === null) pause('button');
  else { trial.resume(); $('rs-ime').hidden = true; field.focus(); renderTyping(); tick(); }
}));
$('rs-stop').addEventListener('click', () => finish('stopped'));

window.addEventListener('keydown', (event) => {
  held.add(event.code);
  if (!trial || closed || between || document.activeElement !== field || trial.done) return;
  if (!event.isTrusted) { trial.flag('synthetic-key-rejected'); return; }
  if (event.isComposing || event.keyCode === 229 || event.key === 'Process') {
    event.preventDefault(); trial.flag('external-ime-detected'); pause('mode-change'); $('rs-ime').hidden = false; return;
  }
  if (event.key === 'Tab' || event.ctrlKey || event.metaKey || event.altKey) { pause('focus-loss'); return; }
  event.preventDefault();
  if (event.key === 'Escape') { pause('button'); return; }
  if (trial.pausedAt !== null) return;
  recorded.add(event.code);
  trial.key({ code: event.code, keyCode: event.keyCode, up: false, caps: event.getModifierState('CapsLock'), timeStamp: event.timeStamp }, event.shiftKey);
  if (trial.recorder.captureFailed) { finish('stopped'); say('rs-copy-status', 'The capture limit was reached. Keep this partial report and start a new session.', 'রেকর্ডের সীমা পূর্ণ হয়েছে। এই অসমাপ্ত প্রতিবেদন রেখে নতুন পরীক্ষা শুরু করুন।'); return; }
  if (event.key === 'Enter' && !event.repeat && trial.reachedLastWord()) advancingPrompt = true;
  renderTyping(); tick();
});
window.addEventListener('keyup', (event) => {
  held.delete(event.code);
  if (recorded.delete(event.code) && trial && !closed && !trial.done) {
    trial.key({ code: event.code, keyCode: event.keyCode, up: true, caps: event.getModifierState('CapsLock'), timeStamp: event.timeStamp }, event.shiftKey);
  }
  if (!held.size && advancingPrompt && trial && !trial.done && !closed) { advancingPrompt = false; trial.nextPrompt(); renderTyping(); }
  if (!held.size && readyAction) { const action = readyAction; readyAction = null; action(); }
});
window.addEventListener('blur', () => { held.clear(); recorded.clear(); readyAction = null; pause('focus-loss'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause('focus-loss'); });
field.addEventListener('blur', () => pause('focus-loss'));
field.addEventListener('paste', (e) => { e.preventDefault(); trial?.flag('paste-rejected'); });
field.addEventListener('drop', (e) => { e.preventDefault(); trial?.flag('drop-rejected'); });
field.addEventListener('compositionstart', () => { pause('mode-change'); $('rs-ime').hidden = false; });
window.addEventListener('beforeunload', (e) => { if (report && !closed) e.preventDefault(); });
document.addEventListener('kala:lang', () => { if (trial && !closed && !between) { lastTimeLabel = ''; renderTyping(); tick(); } });
window.setInterval(tick, 100);

$('rs-copy').addEventListener('click', async () => {
  const box = $<HTMLTextAreaElement>('rs-report');
  try { await navigator.clipboard.writeText(box.value); say('rs-copy-status', 'Copied. Paste the whole report into your conversation.', 'কপি হয়েছে। পুরো প্রতিবেদন আলাপে পেস্ট করুন।'); }
  catch { box.focus(); box.select(); say('rs-copy-status', 'Report selected. Press Ctrl+C to copy it.', 'প্রতিবেদন নির্বাচন করা হয়েছে। Ctrl+C দিয়ে কপি করুন।'); }
});
$('rs-download').addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `kala-b01-style-pilot-${report.session.id}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('rs-preference').addEventListener('change', () => {
  if (!report || !closed) return;
  report.preference = select('rs-preference') as ResearchReport['preference'];
  const text = reportText(report);
  $<HTMLTextAreaElement>('rs-report').value = text;
  try { localStorage.setItem(LAST_REPORT_KEY, text); } catch { report.session.storageAvailable = false; }
  say('rs-copy-status', 'Preference updated. Copy the report again to include it.', 'পছন্দ যোগ হয়েছে। পছন্দসহ প্রতিবেদন আবার কপি করুন।');
});
