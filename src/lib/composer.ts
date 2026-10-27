// A browser port of Kala's FixedLayoutManager (kala/Keyboard/FixedLayoutManager.cs).
// Same priorities: Space/Enter reset, pass-through rules, suppression rules, longest sequence match,
// style D context vowels with run pairing. Strings are UTF-16 like .NET, so lengths and backspace
// counts match the desktop decoder.

import { ENTER, SPACE } from './keys.ts';

export interface CharTypes {
  consonants: string[];
  vowels: string[];
  matras: string[];
  halant: string;
  digits: string[];
  punctuation: string[];
  other: string[];
}

export interface LayoutRule {
  pattern: string;
  action: string;
}

export interface FixedLayout {
  id: string;
  language: string;
  contextVowels: boolean;
  normal: Record<string, string>;
  shift: Record<string, string>;
  sequences: Record<string, string>;
  rules: LayoutRule[];
}

export interface Translation {
  output: string | null;
  backspaces: number;
  suppress: boolean;
}

const VOWEL_OF_SIGN: Record<string, string> = {
  'া': 'আ', 'ি': 'ই', 'ী': 'ঈ', 'ু': 'উ', 'ূ': 'ঊ', 'ৃ': 'ঋ', 'ে': 'এ', 'ৈ': 'ঐ', 'ো': 'ও', 'ৌ': 'ঔ',
};

const NO_OUTPUT: Translation = { output: null, backspaces: 0, suppress: false };
const emit = (output: string, backspaces = 0): Translation => ({ output, backspaces, suppress: false });

type CharClass = 'none' | 'consonant' | 'vowel' | 'matra' | 'halant' | 'digit' | 'punctuation' | 'other';

/** Shared, immutable lookups for one layout. */
class LayoutTables {
  readonly sortedSequences: [string, string][];
  readonly classOf: (s: string) => CharClass;
  readonly passThrough: Set<string>;
  readonly suppress: string[][];
  readonly consonants: Set<string>;
  readonly layout: FixedLayout;

  constructor(layout: FixedLayout, types: CharTypes) {
    this.layout = layout;
    this.sortedSequences = Object.entries(layout.sequences).sort((a, b) => b[0].length - a[0].length);
    const sets: [CharClass, Set<string>][] = [
      ['consonant', new Set(types.consonants)],
      ['vowel', new Set(types.vowels)],
      ['matra', new Set(types.matras)],
      ['halant', new Set([types.halant])],
      ['digit', new Set(types.digits)],
      ['punctuation', new Set(types.punctuation)],
      ['other', new Set(types.other)],
    ];
    this.consonants = sets[0][1];
    this.classOf = (s) => sets.find(([, set]) => set.has(s))?.[0] ?? 'none';
    this.passThrough = new Set(layout.rules.filter((r) => r.action === 'pass_through').map((r) => r.pattern));
    this.suppress = layout.rules.filter((r) => r.action === 'suppress_input').map((r) => r.pattern.split('+'));
  }
}

export class FixedComposer {
  private buffer = '';
  private runSign: string | null = null;
  private runPresses = 0;
  private keptContext: string | null = null;
  /** The decoder rule that produced the last result, as in IStudyCompositionState.StudyRuleId. */
  rule = 'reset';

  private readonly t: LayoutTables;

  private constructor(tables: LayoutTables) {
    this.t = tables;
  }

  static create(layout: FixedLayout, types: CharTypes) {
    return new FixedComposer(new LayoutTables(layout, types));
  }

  get layout() {
    return this.t.layout;
  }

  clone(): FixedComposer {
    const c = new FixedComposer(this.t);
    c.buffer = this.buffer;
    c.runSign = this.runSign;
    c.runPresses = this.runPresses;
    c.keptContext = this.keptContext;
    c.rule = this.rule;
    return c;
  }

  /** Identity of the composition state, for search de-duplication. */
  stateKey() {
    return `${this.buffer}\u0001${this.runSign ?? ''}\u0001${this.runPresses}\u0001${this.keptContext ?? ''}`;
  }

  reset() {
    this.rule = 'reset';
    this.buffer = '';
    this.runSign = null;
    this.keptContext = null;
  }

  /** Native Backspace: the composer restarts, remembering the last kept unit for context vowels. */
  continueAfter(keptText: string) {
    this.reset();
    if (keptText) this.keptContext = keptText.slice(-1);
  }

  /** The character a key produces before composition, or undefined when unmapped. */
  charOf(vk: number, shift: boolean): string | undefined {
    const layer = shift ? this.t.layout.shift : this.t.layout.normal;
    return layer[String(vk)] || undefined;
  }

  translate(vk: number, shift: boolean): Translation {
    if (vk === SPACE) {
      this.reset();
      this.rule = 'space';
      return emit(' ');
    }
    if (vk === ENTER) {
      this.reset();
      this.rule = 'enter';
      return emit('\n');
    }
    const input = shift ? this.t.layout.shift[String(vk)] : this.t.layout.normal[String(vk)];
    if (!input) {
      this.rule = 'unmapped';
      return NO_OUTPUT;
    }
    if (this.t.layout.contextVowels && input in VOWEL_OF_SIGN) return this.typeContextVowel(input, VOWEL_OF_SIGN[input]);
    this.runSign = null;
    return this.processBuffer(input);
  }

  private typeContextVowel(sign: string, vowel: string): Translation {
    if (this.runSign === sign) {
      // Rewrite the run: (presses % 2) signs, then presses / 2 independent vowels.
      const previous = Math.floor((this.runPresses + 1) / 2);
      this.runPresses++;
      const run = (this.runPresses % 2 === 1 ? sign : '') + vowel.repeat(Math.floor(this.runPresses / 2));
      this.buffer = this.buffer.slice(0, Math.max(0, this.buffer.length - previous)) + run;
      this.rule = 'context-vowel-repeat';
      return emit(run, previous);
    }
    this.runSign = null;
    const before = this.buffer.length > 0 ? this.buffer.slice(-1) : this.keptContext;
    if (before === null || !this.t.consonants.has(before)) {
      const independent = this.processBuffer(vowel);
      if (independent.output === vowel && independent.backspaces === 0) this.rule = 'context-independent-vowel';
      return independent;
    }
    const result = this.processBuffer(sign);
    if (result.output === sign && result.backspaces === 0) {
      this.runSign = sign;
      this.runPresses = 1;
      this.rule = 'context-dependent-vowel';
    }
    return result;
  }

  private processBuffer(input: string): Translation {
    const t = this.t;
    if (t.passThrough.has(t.classOf(input))) {
      this.reset();
      this.rule = 'pass-through';
      return emit(input);
    }
    // Suppression is checked before the buffer changes. Patterns compare one UTF-16 unit per part, as in .NET.
    const potential = this.buffer + input;
    for (const parts of t.suppress) {
      if (potential.length < parts.length) continue;
      const tail = potential.slice(potential.length - parts.length);
      if (parts.every((part, i) => t.classOf(tail[i]) === part)) {
        this.rule = parts.join('+');
        return { output: null, backspaces: 0, suppress: true };
      }
    }
    this.buffer += input;
    for (const [key, value] of t.sortedSequences) {
      if (this.buffer.endsWith(key)) {
        this.buffer = value;
        this.rule = key;
        return emit(value, key.length - 1);
      }
    }
    this.rule = 'literal';
    return emit(input);
  }
}

/** Applies a translation to editor text, as the desktop app's backspace-and-insert delivery does. */
export function apply(text: string, result: Translation): string {
  if (result.suppress || result.output === null) return text;
  return text.slice(0, Math.max(0, text.length - result.backspaces)) + result.output;
}
