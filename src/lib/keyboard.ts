// Keyboard markup shared by static pages and the practice app. Legends come from the layout;
// colours from the finger that presses each key.
import { ansiRows, homeBumps, type KeyCap } from './keys.ts';
import { display } from './catalog.ts';
import { escapeHtml } from './i18n.ts';

export interface KeyboardLayer {
  normal: Record<string, string>;
  shift: Record<string, string>;
}

const legend = (ch: string | undefined) => (ch && ch !== ' ' ? escapeHtml(display(ch)) : '');

function keyHtml(k: KeyCap, layer: KeyboardLayer, interactive: boolean) {
  const style = `--w:${k.width}`;
  if (k.kind === 'blank') return `<span class="key blank" style="${style}" aria-hidden="true"></span>`;
  const tag = interactive ? 'button type="button"' : 'span';
  const close = interactive ? 'button' : 'span';
  const attrs = `class="key k-${k.kind} f-${k.finger}${homeBumps.has(k.vk) ? ' bump' : ''}" data-vk="${k.vk}" style="${style}"`;
  if (k.kind !== 'char') {
    const label = k.kind === 'space' ? '' : escapeHtml(k.label);
    const aria = k.kind === 'space' ? 'Space' : k.label;
    return `<${tag} ${attrs} aria-label="${aria}"><span class="mod">${label}</span></${close}>`;
  }
  const lower = layer.normal[String(k.vk)];
  const upper = layer.shift[String(k.vk)];
  const showUpper = upper && upper !== lower && upper.toLowerCase() !== lower;
  return `<${tag} ${attrs} aria-label="${escapeHtml(lower ?? k.label)}">` +
    `<span class="qw">${escapeHtml(k.label)}</span>` +
    (showUpper ? `<span class="up">${legend(upper)}</span>` : '') +
    `<span class="lo">${legend(lower)}</span></${close}>`;
}

export function keyboardHtml(layer: KeyboardLayer, options: { interactive?: boolean } = {}) {
  const rows = ansiRows
    .map((row) => `<div class="kb-row">${row.map((k) => keyHtml(k, layer, !!options.interactive)).join('')}</div>`)
    .join('');
  return `<div class="kb" role="${options.interactive ? 'group' : 'img'}" aria-label="Keyboard">${rows}</div>`;
}
