// Optional research sharing for the typing check, following Kala's research API (plans/typing-study/03-API.md):
// GET /config, POST /sessions (gzip, contributor proof, Idempotency-Key), DELETE /contributors/{id}.
// Before Send nothing leaves the page. Only a consented package enters the outbox, which lives in this
// browser and is removed once the server confirms it.

import type { SessionPackage } from './recorder.ts';

export const ENDPOINT = (import.meta.env.PUBLIC_RESEARCH_ENDPOINT as string | undefined) ?? 'https://118.179.221.116:9002/v1';
export const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const KEY = 'kala-learn:research:v1';
const RETRY_MINUTES = [1, 5, 30, 120, 720];
const MAX_ATTEMPTS = 10;
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

export interface Contributor {
  contributor_id: string;
  deletion_secret: string;
  created_utc: string;
  session_count: number;
  last_keyboard_category: string | null;
}

export interface HistoryRow {
  session_id: string;
  date: string;
  layout_id: string;
  wpm5: number | null;
  accuracy: number | null;
  correction_episodes: number;
  shared: boolean;
  protocol: string;
  bank_version: string;
}

export type UploadState = 'pending' | 'sent' | 'stopped' | 'version-wait' | 'destination-changed';

interface OutboxItem {
  session_id: string;
  destination: string;
  gzip: string; // base64
  queued_utc: string;
  attempts: number;
  next_attempt: number;
  state: UploadState;
  last_status: number | null;
}

interface Receipt {
  session_id: string;
  receipt_id: string;
  sent_utc: string;
}

interface ResearchData {
  contributor: Contributor;
  history: HistoryRow[];
  seen: string[];
  exposures: Record<string, number>;
  outbox: OutboxItem[];
  receipts: Receipt[];
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));
const freshContributor = (): Contributor => ({
  contributor_id: `c_${randomHex(16)}`,
  deletion_secret: randomHex(32),
  created_utc: new Date().toISOString(),
  session_count: 0,
  last_keyboard_category: null,
});

function read(): ResearchData {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ResearchData> | null;
    if (data?.contributor && /^c_[0-9a-f]{32}$/.test(data.contributor.contributor_id) && /^[0-9a-f]{64}$/.test(data.contributor.deletion_secret))
      return { history: [], seen: [], exposures: {}, outbox: [], receipts: [], ...data, contributor: data.contributor };
  } catch {
    /* unreadable store: start over below */
  }
  // The identity must stay the same from here on, so it is saved as soon as it exists.
  const created: ResearchData = { contributor: freshContributor(), history: [], seen: [], exposures: {}, outbox: [], receipts: [] };
  try {
    write(created);
  } catch {
    /* storage unavailable: this page keeps working with an unsaved identity */
  }
  return created;
}

function write(data: ResearchData) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export const contributor = () => read().contributor;
export const seen = () => new Set(read().seen);
export const exposureCount = (id: string): number | null => (read().exposures[id] ?? 0) > 0 ? read().exposures[id] : null;
export const history = () => read().history;

/** Starts a numbered session for this contributor (ResearchStore.NextSession). */
export function nextSession(keyboard: string): Contributor {
  const data = read();
  data.contributor = { ...data.contributor, session_count: data.contributor.session_count + 1, last_keyboard_category: keyboard };
  write(data);
  return data.contributor;
}

/** Numbers only, plus which prompts were shown (ResearchStore.KeepResult). Raw recordings are never kept here. */
export function keepResult(p: SessionPackage, shared: boolean) {
  const data = read();
  const firstResult = !data.history.some((h) => h.session_id === p.session.session_id);
  const row: HistoryRow = {
    session_id: p.session.session_id, date: p.session.started_utc, layout_id: p.input.layout_id,
    wpm5: p.summary?.wpm5 ?? null, accuracy: p.summary?.accuracy ?? null, correction_episodes: p.summary?.correction_episodes ?? 0,
    shared, protocol: p.session.protocol_version, bank_version: p.session.prompt_bank_version,
  };
  data.history = [...data.history.filter((h) => h.session_id !== row.session_id), row].slice(-1000);
  const measured = p.prompts.filter((x) => x.measured).map((x) => x.prompt_id);
  data.seen = [...new Set([...data.seen, ...measured])].slice(-500);
  if (firstResult) {
    for (const id of measured) data.exposures[id] = Math.min(1_000_000, (data.exposures[id] ?? 0) + 1);
    data.exposures = Object.fromEntries(Object.entries(data.exposures).slice(-500));
  }
  write(data);
}

export async function gzip(p: SessionPackage): Promise<Uint8Array> {
  const plain = new TextEncoder().encode(JSON.stringify(p));
  if (plain.length > MAX_PACKAGE_BYTES) throw new Error('Research package exceeds its limit.');
  const stream = new Blob([plain]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  if (bytes.length > MAX_PACKAGE_BYTES) throw new Error('Research package exceeds its limit.');
  return bytes;
}

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function proof(secret: string) {
  const bytes = Uint8Array.from(secret.match(/../g)!.map((h) => parseInt(h, 16)));
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

export interface ServiceConfig {
  accepting: boolean;
  schemas: string[];
  protocols: string[];
  maxPackageBytes: number;
  policy: string;
}

/** GET /config, read without contributor headers or recording content. Null when it cannot be read. */
export async function serviceConfig(): Promise<ServiceConfig | null> {
  try {
    const response = await fetchWithTimeout(`${ENDPOINT}/config`, { method: 'GET' }, 5000);
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > 4096) return null;
    const root = JSON.parse(text);
    if (typeof root.accepting !== 'boolean' || !Array.isArray(root.schemas) || !Array.isArray(root.protocols)) return null;
    const max = Number(root.max_package_bytes);
    return max > 0 ? { accepting: root.accepting, schemas: root.schemas.map(String), protocols: root.protocols.map(String), maxPackageBytes: max, policy: typeof root.protocol_policy === 'string' ? root.protocol_policy : 'allowlist' } : null;
  } catch {
    return null;
  }
}

const validLabel = (v: string) => /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(v);
export const supports = (c: ServiceConfig, schema: string, protocol: string) =>
  validLabel(protocol) && c.schemas.includes(schema) && (c.policy === 'metadata' || c.protocols.includes(protocol));

/** Queues one consented package for upload to the current destination. */
export async function enqueue(p: SessionPackage) {
  const bytes = await gzip(p);
  const data = read();
  if (p.session.contributor_id !== data.contributor.contributor_id) throw new Error('Contributor changed.');
  data.outbox = data.outbox.filter((o) => o.session_id !== p.session.session_id);
  data.outbox.push({
    session_id: p.session.session_id, destination: ENDPOINT, gzip: toBase64(bytes), queued_utc: new Date().toISOString(),
    attempts: 0, next_attempt: 0, state: 'pending', last_status: null,
  });
  write(data);
  const history = data.history.find((h) => h.session_id === p.session.session_id);
  if (history) {
    history.shared = true;
    write(data);
  }
}

export function uploadState(sessionId: string): UploadState | 'removed' {
  const data = read();
  if (data.receipts.some((r) => r.session_id === sessionId)) return 'sent';
  const item = data.outbox.find((o) => o.session_id === sessionId);
  return item ? item.state : 'removed';
}

let running: Promise<void> | null = null;

/** Sends every due outbox item once. Safe to call repeatedly; one run at a time. */
export function runDue(): Promise<void> {
  return (running ??= sendDue().finally(() => (running = null)));
}

async function sendDue() {
  for (const queued of read().outbox) {
    if (queued.state !== 'pending' || queued.next_attempt > Date.now()) continue;
    if (queued.destination !== ENDPOINT) {
      update(queued.session_id, { state: 'destination-changed' });
      continue;
    }
    const identity = read().contributor;
    let status = 503;
    let retryAfter: number | null = null;
    try {
      const response = await fetchWithTimeout(`${ENDPOINT}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'Idempotency-Key': queued.session_id,
          'X-Kala-Contributor': identity.contributor_id,
          'X-Kala-Contributor-Proof': await proof(identity.deletion_secret),
        },
        body: fromBase64(queued.gzip),
      }, 30000);
      status = response.status;
      const after = Number(response.headers.get('Retry-After'));
      if (Number.isFinite(after) && after > 0) retryAfter = after * 1000;
      if (status === 200 || status === 201) {
        const body = await response.json();
        if (body.session_id !== queued.session_id) status = 503;
        else {
          const data = read();
          data.outbox = data.outbox.filter((o) => o.session_id !== queued.session_id);
          data.receipts = [...data.receipts.filter((r) => r.session_id !== queued.session_id), { session_id: queued.session_id, receipt_id: String(body.receipt_id), sent_utc: String(body.received_utc) }].slice(-1000);
          write(data);
          continue;
        }
      }
    } catch {
      status = 503; // offline, blocked or timed out: temporary
    }
    const attempts = queued.attempts + 1;
    const expired = attempts >= MAX_ATTEMPTS || Date.now() - Date.parse(queued.queued_utc) > MAX_AGE_MS;
    if ([400, 403, 409, 410, 413].includes(status) || (status !== 422 && expired))
      update(queued.session_id, { state: 'stopped', attempts, last_status: status });
    else if (status === 422) update(queued.session_id, { state: 'version-wait', attempts, last_status: status });
    else {
      const minutes = attempts <= RETRY_MINUTES.length ? RETRY_MINUTES[attempts - 1] : 1440;
      update(queued.session_id, { attempts, last_status: status, next_attempt: Date.now() + (retryAfter ?? minutes * 60000) });
    }
  }
}

function update(sessionId: string, change: Partial<OutboxItem>) {
  const data = read();
  data.outbox = data.outbox.map((o) => (o.session_id === sessionId ? { ...o, ...change } : o));
  write(data);
}

export const counts = () => {
  const data = read();
  return { pending: data.outbox.length, receipts: data.receipts.length, history: data.history.length };
};

export function removePending() {
  const data = read();
  data.outbox = [];
  write(data);
}

export function clearHistory() {
  const data = read();
  data.history = [];
  data.seen = [];
  data.exposures = {};
  write(data);
}

/** DELETE /contributors/{id}: asks the server to remove every shared check of this contributor number. */
export async function requestDeletion(): Promise<number> {
  const data = read();
  const identity = data.contributor;
  data.outbox = [];
  write(data);
  try {
    const response = await fetchWithTimeout(`${ENDPOINT}/contributors/${identity.contributor_id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Kala-Contributor': identity.contributor_id,
        'X-Kala-Contributor-Proof': await proof(identity.deletion_secret),
      },
      body: JSON.stringify({ deletion_secret: identity.deletion_secret }),
    }, 30000);
    return response.status;
  } catch {
    return 0;
  }
}

export function freshIdentity() {
  const data = read();
  data.contributor = freshContributor();
  data.outbox = [];
  write(data);
}
