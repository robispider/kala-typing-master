// Physical key identity for the typing check. The desktop hook records the Windows virtual key, the
// set-1 scan code and the extended flag; a browser reports KeyboardEvent.code, which names the same
// physical position. Virtual keys assume the US system layout (Kala types the Bangla itself).

export interface PhysicalKey {
  vk: number;
  sc: number;
  ext: 0 | 1;
}

const table: Record<string, [number, number, 0 | 1]> = {
  Escape: [0x1b, 0x01, 0], Backquote: [0xc0, 0x29, 0], Minus: [0xbd, 0x0c, 0], Equal: [0xbb, 0x0d, 0],
  Backspace: [0x08, 0x0e, 0], Tab: [0x09, 0x0f, 0], BracketLeft: [0xdb, 0x1a, 0], BracketRight: [0xdd, 0x1b, 0],
  Enter: [0x0d, 0x1c, 0], ControlLeft: [0xa2, 0x1d, 0], Semicolon: [0xba, 0x27, 0], Quote: [0xde, 0x28, 0],
  ShiftLeft: [0xa0, 0x2a, 0], Backslash: [0xdc, 0x2b, 0], Comma: [0xbc, 0x33, 0], Period: [0xbe, 0x34, 0],
  Slash: [0xbf, 0x35, 0], ShiftRight: [0xa1, 0x36, 0], NumpadMultiply: [0x6a, 0x37, 0], AltLeft: [0xa4, 0x38, 0],
  Space: [0x20, 0x39, 0], CapsLock: [0x14, 0x3a, 0], NumLock: [0x90, 0x45, 0], ScrollLock: [0x91, 0x46, 0],
  Numpad7: [0x67, 0x47, 0], Numpad8: [0x68, 0x48, 0], Numpad9: [0x69, 0x49, 0], NumpadSubtract: [0x6d, 0x4a, 0],
  Numpad4: [0x64, 0x4b, 0], Numpad5: [0x65, 0x4c, 0], Numpad6: [0x66, 0x4d, 0], NumpadAdd: [0x6b, 0x4e, 0],
  Numpad1: [0x61, 0x4f, 0], Numpad2: [0x62, 0x50, 0], Numpad3: [0x63, 0x51, 0], Numpad0: [0x60, 0x52, 0],
  NumpadDecimal: [0x6e, 0x53, 0], IntlBackslash: [0xe2, 0x56, 0], F11: [0x7a, 0x57, 0], F12: [0x7b, 0x58, 0],
  NumpadEnter: [0x0d, 0x1c, 1], ControlRight: [0xa3, 0x1d, 1], NumpadDivide: [0x6f, 0x35, 1], AltRight: [0xa5, 0x38, 1],
  Home: [0x24, 0x47, 1], ArrowUp: [0x26, 0x48, 1], PageUp: [0x21, 0x49, 1], ArrowLeft: [0x25, 0x4b, 1],
  ArrowRight: [0x27, 0x4d, 1], End: [0x23, 0x4f, 1], ArrowDown: [0x28, 0x50, 1], PageDown: [0x22, 0x51, 1],
  Insert: [0x2d, 0x52, 1], Delete: [0x2e, 0x53, 1], MetaLeft: [0x5b, 0x5b, 1], MetaRight: [0x5c, 0x5c, 1],
  ContextMenu: [0x5d, 0x5d, 1],
};
'1234567890'.split('').forEach((d, i) => (table[`Digit${d}`] = [d.charCodeAt(0), 0x02 + i, 0]));
'QWERTYUIOP'.split('').forEach((c, i) => (table[`Key${c}`] = [c.charCodeAt(0), 0x10 + i, 0]));
'ASDFGHJKL'.split('').forEach((c, i) => (table[`Key${c}`] = [c.charCodeAt(0), 0x1e + i, 0]));
'ZXCVBNM'.split('').forEach((c, i) => (table[`Key${c}`] = [c.charCodeAt(0), 0x2c + i, 0]));
for (let f = 1; f <= 10; f++) table[`F${f}`] = [0x6f + f, 0x3a + f, 0];

/** The physical identity of a browser key event; unknown codes keep their key code with scan code 0. */
export function physicalKey(code: string, keyCode: number): PhysicalKey {
  const known = table[code];
  if (known) return { vk: known[0], sc: known[1], ext: known[2] };
  return { vk: Math.min(255, Math.max(0, keyCode | 0)), sc: 0, ext: 0 };
}

const NUMBER_ROW = ['AE01', 'AE02', 'AE03', 'AE04', 'AE05', 'AE06', 'AE07', 'AE08', 'AE09', 'AE10', 'AE11', 'AE12'];
const TOP_ROW = ['AD01', 'AD02', 'AD03', 'AD04', 'AD05', 'AD06', 'AD07', 'AD08', 'AD09', 'AD10', 'AD11', 'AD12'];
const HOME_ROW = ['AC01', 'AC02', 'AC03', 'AC04', 'AC05', 'AC06', 'AC07', 'AC08', 'AC09', 'AC10', 'AC11'];
const BOTTOM_ROW = ['AB01', 'AB02', 'AB03', 'AB04', 'AB05', 'AB06', 'AB07', 'AB08', 'AB09', 'AB10'];
const FUNCTION_ROW = ['FK01', 'FK02', 'FK03', 'FK04', 'FK05', 'FK06', 'FK07', 'FK08', 'FK09', 'FK10'];
const EXTENDED: Record<number, string> = {
  0x36: 'RSHF', 0x1c: 'KPEN', 0x1d: 'RCTL', 0x35: 'KPDV', 0x38: 'RALT', 0x47: 'HOME', 0x48: 'UP', 0x49: 'PGUP',
  0x4b: 'LEFT', 0x4d: 'RGHT', 0x4f: 'END', 0x50: 'DOWN', 0x51: 'PGDN', 0x52: 'INS', 0x53: 'DELE', 0x5b: 'LWIN',
  0x5c: 'RWIN', 0x5d: 'MENU',
};
const SINGLE: Record<number, string> = {
  0x01: 'ESC', 0x29: 'TLDE', 0x0e: 'BKSP', 0x0f: 'TAB', 0x1c: 'RTRN', 0x1d: 'LCTL', 0x2a: 'LSHF', 0x36: 'RSHF',
  0x37: 'KPMU', 0x38: 'LALT', 0x39: 'SPCE', 0x3a: 'CAPS', 0x45: 'NMLK', 0x46: 'SCLK', 0x47: 'KP7', 0x48: 'KP8',
  0x49: 'KP9', 0x4a: 'KPSU', 0x4b: 'KP4', 0x4c: 'KP5', 0x4d: 'KP6', 0x4e: 'KPAD', 0x4f: 'KP1', 0x50: 'KP2',
  0x51: 'KP3', 0x52: 'KP0', 0x53: 'KPDL', 0x56: 'LSGT', 0x57: 'FK11', 0x58: 'FK12',
};

/** ScanCodePositions.Position: the geometry position id for a scan code, or null when unknown. */
export function positionOf(sc: number, ext: boolean, geometry = 'unknown'): string | null {
  if (ext) return EXTENDED[sc] ?? null;
  if (sc >= 0x02 && sc <= 0x0d) return NUMBER_ROW[sc - 0x02];
  if (sc >= 0x10 && sc <= 0x1b) return TOP_ROW[sc - 0x10];
  if (sc >= 0x1e && sc <= 0x28) return HOME_ROW[sc - 0x1e];
  if (sc >= 0x2c && sc <= 0x35) return BOTTOM_ROW[sc - 0x2c];
  if (sc >= 0x3b && sc <= 0x44) return FUNCTION_ROW[sc - 0x3b];
  if (sc === 0x2b) return geometry === 'iso' ? 'AC12' : 'BKSL';
  return SINGLE[sc] ?? null;
}

/** Modifier bits held before a transition, as StudyTap records them. */
export const MOD = { lshift: 1, rshift: 2, lctrl: 4, rctrl: 8, lalt: 16, ralt: 32, win: 64, caps: 128 } as const;

export function modifiersOf(down: Set<string>, caps: boolean): number {
  return (down.has('ShiftLeft') ? MOD.lshift : 0) | (down.has('ShiftRight') ? MOD.rshift : 0) |
    (down.has('ControlLeft') ? MOD.lctrl : 0) | (down.has('ControlRight') ? MOD.rctrl : 0) |
    (down.has('AltLeft') ? MOD.lalt : 0) | (down.has('AltRight') ? MOD.ralt : 0) |
    (down.has('MetaLeft') || down.has('MetaRight') ? MOD.win : 0) | (caps ? MOD.caps : 0);
}
