// Text scoring, a port of kala/Learning/TextScoring.cs (scorer "kala-grapheme-v1", segmenter "dotnet-8").
//
// Units are .NET 8 default extended grapheme clusters. .NET 8 implements Unicode 15.0 segmentation,
// which has no Indic conjunct rule (GB9c): ক্ষ is two units, ক্ + ষ. Browsers' Intl.Segmenter uses a newer
// Unicode and returns one unit, so it is deliberately not used here.

export const SCORER_VERSION = 'kala-grapheme-v1';
export const SEGMENTER_VERSION = 'dotnet-8';

const EXTEND = /[\p{M}‌‍\u{E0020}-\u{E007F}\u{1F3FB}-\u{1F3FF}]/u;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const REGIONAL = /\p{Regional_Indicator}/u;

/** Extended grapheme clusters as .NET 8 segments them (the subset of rules relevant to typing text). */
export function graphemes(text: string): string[] {
  const units: string[] = [];
  let regionalRun = 0;
  for (const cp of text) {
    const last = units.length ? units[units.length - 1] : null;
    let join = false;
    if (last !== null) {
      if (last.endsWith('\r') && cp === '\n') join = true; // GB3
      else if (last.endsWith('\r') || last.endsWith('\n') || cp === '\r' || cp === '\n') join = false; // GB4/5
      else if (EXTEND.test(cp)) join = true; // GB9, GB9a
      else if (last.endsWith('‍') && PICTOGRAPHIC.test(cp) && PICTOGRAPHIC.test(last)) join = true; // GB11
      else if (REGIONAL.test(cp) && regionalRun % 2 === 1) join = true; // GB12/13
    }
    regionalRun = REGIONAL.test(cp) ? regionalRun + 1 : 0;
    if (join && last !== null) units[units.length - 1] = last + cp;
    else units.push(cp);
  }
  return units;
}

export interface TextScore {
  referenceUnits: number;
  responseUnits: number;
  distance: number;
  matches: number;
}

/** Unit Levenshtein distance; ties prefer the alignment with the most equal units. */
export function align(r: string[], t: string[]): { distance: number; matches: number } {
  const n = r.length;
  const m = t.length;
  let cost = Array.from({ length: m + 1 }, (_, j) => j);
  let match = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const c2 = new Array<number>(m + 1);
    const m2 = new Array<number>(m + 1);
    c2[0] = i;
    m2[0] = 0;
    for (let j = 1; j <= m; j++) {
      const equal = r[i - 1] === t[j - 1];
      let bc = cost[j - 1] + (equal ? 0 : 1);
      let bm = match[j - 1] + (equal ? 1 : 0);
      const consider = (c: number, mm: number) => {
        if (c < bc || (c === bc && mm > bm)) {
          bc = c;
          bm = mm;
        }
      };
      consider(cost[j] + 1, match[j]);
      consider(c2[j - 1] + 1, m2[j - 1]);
      c2[j] = bc;
      m2[j] = bm;
    }
    cost = c2;
    match = m2;
  }
  return { distance: cost[m], matches: match[m] };
}

export function score(reference: string, response: string): TextScore {
  const r = graphemes(reference.normalize('NFC'));
  const t = graphemes(response.normalize('NFC'));
  const { distance, matches } = align(r, t);
  return { referenceUnits: r.length, responseUnits: t.length, distance, matches };
}

export const accuracy = (s: TextScore) => {
  const max = Math.max(s.referenceUnits, s.responseUnits);
  return max === 0 ? 100 : 100 * Math.max(0, 1 - s.distance / max);
};

/** Correct grapheme units per minute. */
export const correctGpm = (matches: number, ms: number) => (ms > 0 ? matches / (ms / 60000) : null);

/** Labelled "5-character WPM": max(0, scalars − 1) / (5 · minutes). */
export const fiveCharWpm = (response: string, ms: number) =>
  ms > 0 ? Math.max(0, [...response].length - 1) / (5 * (ms / 60000)) : null;

/** Speed is reportable only with at least 60 seconds and 100 target units. */
export const speedQualifies = (ms: number, referenceUnits: number) => ms >= 60000 && referenceUnits >= 100;

/** Splits a reference into the words a learner submits with Space. */
export const words = (text: string) => text.split(/[ \n\t]+/).filter(Boolean);
