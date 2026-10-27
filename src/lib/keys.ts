// Physical keyboard geometry (ANSI), finger assignments and browser key codes.
// Kala layouts are keyed by Windows virtual-key codes; the browser reports physical KeyboardEvent.code.
// Both physical and on-screen keys resolve to the same VK and reach the same composer.

export type Finger = 'lp' | 'lr' | 'lm' | 'li' | 'ri' | 'rm' | 'rr' | 'rp' | 'th';

export interface KeyCap {
  vk: number;
  code: string;
  label: string; // QWERTY engraving, shown small
  width: number; // in key units
  finger: Finger;
  kind: 'char' | 'space' | 'shift' | 'backspace' | 'enter' | 'tab' | 'caps' | 'blank';
}

export const BACKSPACE = 8;
export const ENTER = 13;
export const SPACE = 32;
export const SHIFT_LEFT = 160;
export const SHIFT_RIGHT = 161;

const codeOfVk: Record<number, string> = {
  8: 'Backspace', 9: 'Tab', 13: 'Enter', 20: 'CapsLock', 32: 'Space', 160: 'ShiftLeft', 161: 'ShiftRight',
  186: 'Semicolon', 187: 'Equal', 188: 'Comma', 189: 'Minus', 190: 'Period', 191: 'Slash', 192: 'Backquote',
  219: 'BracketLeft', 220: 'Backslash', 221: 'BracketRight', 222: 'Quote', 226: 'IntlBackslash',
};
for (let d = 0; d <= 9; d++) codeOfVk[48 + d] = `Digit${d}`;
for (let c = 65; c <= 90; c++) codeOfVk[c] = `Key${String.fromCharCode(c)}`;

export const vkOfCode: Record<string, number> = Object.fromEntries(
  Object.entries(codeOfVk).map(([vk, code]) => [code, Number(vk)]),
);
vkOfCode.ShiftRight = SHIFT_RIGHT;
vkOfCode.NumpadEnter = ENTER;

const fingerOfVk: Record<number, Finger> = {};
const assign = (finger: Finger, vks: number[]) => vks.forEach((vk) => (fingerOfVk[vk] = finger));
assign('lp', [192, 49, 81, 65, 90, 9, 20, SHIFT_LEFT, 226]);
assign('lr', [50, 87, 83, 88]);
assign('lm', [51, 69, 68, 67]);
assign('li', [52, 53, 82, 84, 70, 71, 86, 66]);
assign('ri', [54, 55, 89, 85, 72, 74, 78, 77]);
assign('rm', [56, 73, 75, 188]);
assign('rr', [57, 79, 76, 190]);
assign('rp', [48, 189, 187, 80, 219, 221, 220, 186, 222, 191, ENTER, SHIFT_RIGHT, BACKSPACE]);
assign('th', [SPACE]);

export const fingerOf = (vk: number): Finger => fingerOfVk[vk] ?? 'th';
export const isLeftHand = (vk: number) => fingerOf(vk).startsWith('l');
/** Opposite-hand Shift: a left-hand character uses right Shift and vice versa. */
export const shiftFor = (vk: number) => (isLeftHand(vk) ? SHIFT_RIGHT : SHIFT_LEFT);

export const fingerName: Record<Finger, { en: string; bn: string }> = {
  lp: { en: 'Left little finger', bn: 'বাঁ কনিষ্ঠা' },
  lr: { en: 'Left ring finger', bn: 'বাঁ অনামিকা' },
  lm: { en: 'Left middle finger', bn: 'বাঁ মধ্যমা' },
  li: { en: 'Left index finger', bn: 'বাঁ তর্জনী' },
  ri: { en: 'Right index finger', bn: 'ডান তর্জনী' },
  rm: { en: 'Right middle finger', bn: 'ডান মধ্যমা' },
  rr: { en: 'Right ring finger', bn: 'ডান অনামিকা' },
  rp: { en: 'Right little finger', bn: 'ডান কনিষ্ঠা' },
  th: { en: 'Thumb', bn: 'বৃদ্ধাঙ্গুল' },
};

const cap = (vk: number, label: string, width = 1, kind: KeyCap['kind'] = 'char'): KeyCap => ({
  vk, code: codeOfVk[vk] ?? '', label, width, finger: fingerOf(vk), kind,
});
const chars = (vks: number[], labels: string) => vks.map((vk, i) => cap(vk, labels[i]));

export const ansiRows: KeyCap[][] = [
  [...chars([192, 49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 189, 187], '`1234567890-='), cap(BACKSPACE, '⌫', 2, 'backspace')],
  [cap(9, 'Tab', 1.5, 'tab'), ...chars([81, 87, 69, 82, 84, 89, 85, 73, 79, 80, 219, 221], 'QWERTYUIOP[]'), cap(220, '\\', 1.5)],
  [cap(20, 'Caps', 1.75, 'caps'), ...chars([65, 83, 68, 70, 71, 72, 74, 75, 76, 186, 222], "ASDFGHJKL;'"), cap(ENTER, 'Enter', 2.25, 'enter')],
  [cap(SHIFT_LEFT, 'Shift', 2.25, 'shift'), ...chars([90, 88, 67, 86, 66, 78, 77, 188, 190, 191], 'ZXCVBNM,./'), cap(SHIFT_RIGHT, 'Shift', 2.75, 'shift')],
  [cap(0, '', 3.75, 'blank'), cap(SPACE, '', 6.25, 'space'), cap(0, '', 5, 'blank')],
];

export const qwertyLabel = (vk: number): string => {
  for (const row of ansiRows) for (const k of row) if (k.vk === vk) return k.kind === 'space' ? 'Space' : k.label;
  return '';
};

/** Home keys carry tactile bumps. */
export const homeBumps = new Set([70, 74]);
