// Interface language. Static pages render both languages and CSS shows one; scripts call t().
import { load, save } from './store.ts';
import type { Lang, Text } from './catalog.ts';

export const lang = (): Lang => (document.documentElement.dataset.lang as Lang) ?? 'en';

export const t = (text: Text | string | null | undefined): string =>
  text == null ? '' : typeof text === 'string' ? text : text[lang()] || text.en;

export function setLang(next: Lang) {
  document.documentElement.dataset.lang = next;
  document.documentElement.lang = next;
  const p = load();
  p.lang = next;
  save(p);
  document.dispatchEvent(new CustomEvent('kala:lang', { detail: next }));
}

export function setTheme(theme: 'auto' | 'light' | 'dark') {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const p = load();
  p.settings.theme = theme;
  save(p);
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Both languages as markup, for HTML built in scripts. */
export const both = (text: Text) =>
  `<span data-l="en">${escapeHtml(text.en)}</span><span data-l="bn">${escapeHtml(text.bn || text.en)}</span>`;
