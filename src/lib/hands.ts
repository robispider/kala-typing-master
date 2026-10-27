// Kala's rendered hand guide over the practice keyboard (port of LearnHandAssets/LearnHandGuide).
// Offline frames are rebuilt from palette, alpha and finger-mask planes; nothing is modelled at runtime.
// Hand artwork: "Rigged hand" by Elena FF, CC BY-SA 4.0 — see public/licenses/Elena-FF-Rigged-Hand.txt.

interface FrameData {
  patch: number[] | null;
  offset: [number, number];
}
interface Manifest {
  width: number;
  height: number;
  rectangle: [number, number, number, number];
  mirrorSum: number;
  palette: string;
  homeCrop: number[];
  poses: Record<string, { finger: string; crop: number[]; frames: FrameData[] }>;
  bindings: Record<string, { pose: string; finger: string; left: boolean }>;
}
interface Frame {
  image: ImageBitmap;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Pair {
  left: Frame[];
  right: Frame[];
  leftModifier: boolean;
  rightModifier: boolean;
}

// Kala's diagram: 1500 wide, 15-unit keyboard with 14px padding and 6px gaps, 84 units per row.
const PAD = 14;
const PITCH = (1500 - 2 * PAD + 6) / 15;
const ROW = 84;
const DIAGRAM_HEIGHT = 760;
const TICK = 42;

// Richer versions of the key pastels keep the moving finger distinguishable (Kala Palette.HandFinger).
const tint: Record<string, [number, number, number]> = {
  LeftLittle: [0xa2, 0x68, 0xcf],
  LeftRing: [0xd9, 0x6c, 0x9a],
  LeftMiddle: [0xe3, 0x8a, 0x50],
  LeftIndex: [0xc6, 0xa3, 0x31],
  RightIndex: [0x71, 0xa7, 0x4b],
  RightMiddle: [0x39, 0xa9, 0x9d],
  RightRing: [0x55, 0x9c, 0xd3],
  RightLittle: [0x7c, 0x80, 0xd0],
  LeftThumb: [0xb3, 0x94, 0x59],
  RightThumb: [0xb8, 0x7b, 0x71],
};
const digits = ['index', 'middle', 'ring', 'pinky', 'thumb'];

// Shift reaches/holds before the primary finger presses; neither hand loops while waiting.
const frameAt = (ms: number, modifier: boolean, reduced: boolean) =>
  modifier
    ? reduced ? 5 : Math.min(5, Math.floor(Math.max(0, ms) / TICK) * 2)
    : reduced || ms >= 252 ? 4 : Math.min(5, Math.floor(Math.max(0, ms) / TICK));
const returnFrame = (ms: number, modifier: boolean, start: number) =>
  Math.max(0, start - Math.floor(Math.max(0, ms - (modifier ? TICK : 0)) / TICK) * 2);
const pulseFrame = (ms: number, modifier: boolean) => (modifier ? 5 : ms >= TICK && ms < 2 * TICK ? 5 : 4);

async function inflate(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`hands: ${url} ${response.status}`);
  const stream = response.body.pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

class Assets {
  private constructor(
    readonly m: Manifest,
    private readonly url: string,
    private readonly source: Uint8Array,
    private readonly palette: Uint8Array,
  ) {}

  static async load(url: string) {
    const response = await fetch(`${url}hands.json`);
    if (!response.ok) throw new Error(`hands: manifest ${response.status}`);
    const m = (await response.json()) as Manifest;
    const source = await inflate(`${url}base.bin`);
    if (source.length !== m.width * m.height * 7) throw new Error('hands: base planes');
    const palette = Uint8Array.from(atob(m.palette), (c) => c.charCodeAt(0));
    return new Assets(m, url, source, palette);
  }

  /** Frames for one hand: a bound key's pose tinted on the moving finger, or the home pose. */
  async prepare(binding: { pose: string; finger: string } | null, left: boolean): Promise<Frame[]> {
    const { m, source, palette } = this;
    const W = m.width, H = m.height, pixels = W * H;
    const pose = binding ? m.poses[binding.pose] : null;
    const finger = pose ? digits.indexOf(pose.finger) : -1;
    const color = binding ? tint[binding.finger] : null;
    const frames = pose?.frames ?? [{ patch: null, offset: [0, 0] as [number, number] }];
    const packed = pose && frames.some((f) => f.patch) ? await inflate(`${this.url}${binding!.pose}.bin`) : null;
    const [rx0, ry0, rw0, rh0] = m.rectangle;
    const scaleX = rw0 / W, scaleY = rh0 / H;
    const result: Frame[] = [];
    let cursor = 0;
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      // Every pose starts with the identical home pixels: give that frame the home crop and origin.
      const home = !pose || (i === 0 && !frame.patch && Math.abs(frame.offset[0]) < 0.05 && Math.abs(frame.offset[1]) < 0.05);
      const crop = home ? m.homeCrop : pose!.crop;
      const p = frame.patch ?? [0, 0, 0, 0];
      const pw = p[2] - p[0], pp = pw * (p[3] - p[1]);
      const patch = frame.patch && packed ? packed.subarray(cursor, (cursor += pp * 3)) : null;
      const inPatch = (sx: number, sy: number) =>
        patch && sy >= p[1] && sy < p[3] && sx >= p[0] && sx < p[2] ? (sy - p[1]) * pw + sx - p[0] : -1;
      const alphaAt = (sx: number, sy: number) => {
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) return 0;
        const pi = inPatch(sx, sy);
        return source[pixels + sy * W + sx] ^ (pi >= 0 ? patch![pp + pi] : 0);
      };
      const width = crop[2] - crop[0], height = crop[3] - crop[1];
      const image = new ImageData(width, height);
      const out = image.data;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const sx = crop[0] + x, sy = crop[1] + y, index = sy * W + sx;
          const pi = inPatch(sx, sy);
          const shade = source[index] ^ (pi >= 0 ? patch![pi] : 0);
          const alpha = source[pixels + index] ^ (pi >= 0 ? patch![pp + pi] : 0);
          let r = palette[shade * 3], g = palette[shade * 3 + 1], b = palette[shade * 3 + 2];
          const amount = finger < 0 || !color ? 0 : (source[(finger + 2) * pixels + index] ^ (pi >= 0 ? patch![pp * 2 + pi] : 0)) / 255;
          if (amount > 0) {
            const light = Math.min(1.12, Math.max(0.45, (r * 0.2126 + g * 0.7152 + b * 0.0722) / 180));
            r = r * (1 - amount) + color![0] * light * amount;
            g = g * (1 - amount) + color![1] * light * amount;
            b = b * (1 - amount) + color![2] * light * amount;
          }
          // A fine, soft grey silhouette around the hand.
          let edge = alpha;
          if (alpha < 255)
            edge = Math.max(edge, alphaAt(sx - 1, sy), alphaAt(sx + 1, sy), alphaAt(sx, sy - 1), alphaAt(sx, sy + 1));
          const outline = Math.floor(edge * 0.65 * (1 - alpha / 255));
          const total = alpha + outline;
          const d = ((left ? width - 1 - x : x) + y * width) * 4;
          if (total === 0) continue;
          out[d] = (Math.min(255, Math.max(0, r)) * alpha + 169 * outline) / total;
          out[d + 1] = (Math.min(255, Math.max(0, g)) * alpha + 154 * outline) / total;
          out[d + 2] = (Math.min(255, Math.max(0, b)) * alpha + 144 * outline) / total;
          out[d + 3] = total;
        }
      }
      let x = rx0 + crop[0] * scaleX + (home ? 0 : frame.offset[0]);
      const y = ry0 + crop[1] * scaleY + (home ? 0 : frame.offset[1]);
      const w = width * scaleX, h = height * scaleY;
      if (left) x = m.mirrorSum - x - w;
      result.push({ image: await createImageBitmap(image), x, y, w, h });
    }
    return result;
  }
}

/** Opposite-hand Shift, as Kala: a left-hand key holds right Shift and vice versa; the thumb never shifts. */
const shiftPosition = (finger: string) =>
  finger.endsWith('Thumb') ? null : finger.startsWith('Left') ? 'RTSH' : 'LFSH';

export class HandGuide {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private assets: Promise<Assets> | null = null;
  private failed = false;
  private enabled = false;
  private cache = new Map<string, Promise<Frame[]>>();
  private published: Pair | null = null;
  private returning: { pair: Pair; left: number; right: number } | null = null;
  private held: { left: Frame; right: Frame } | null = null;
  private mode: 'play' | 'pulse' = 'play';
  private reduced = true;
  private start = 0;
  private frame = 0;
  private request = 0;
  private cue: { key: string; position: string | null; revision: string; at: number } | null = null;
  private map = { ox: 0, oy: 0, sx: 0, sy: 0 };
  /** 0–100; Kala's default leaves the keys readable under the hands. */
  transparency = 25;

  constructor(private readonly host: HTMLElement, private readonly url: string) {
    this.canvas.className = 'hands-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    new ResizeObserver(() => this.enabled && this.layout()).observe(host);
  }

  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    this.host.classList.toggle('hands', on);
    if (on) {
      this.host.append(this.canvas);
      this.layout();
    } else {
      this.canvas.remove();
      this.host.style.paddingBottom = '';
      this.reset();
    }
  }

  /** The key the learner should press next (Kala position id), or null for both hands at home. */
  setCue(position: string | null, shift: boolean, revision: string) {
    if (!this.enabled || this.failed) return;
    const key = `${position}|${shift}`;
    const now = performance.now();
    const previous = this.cue;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (previous?.key === key) {
      // Same key again (a doubled letter): one short press, without moving the hands.
      if (revision !== previous.revision && this.published && !this.held && !reduce && position) {
        this.mode = 'pulse';
        this.start = now;
        this.animate();
      }
      previous.revision = revision;
      return;
    }
    const rapid = !!previous?.position && !!position && now - previous.at < 180;
    this.cue = { key, position, revision, at: now };
    if (this.published && !this.held && !rapid && !reduce && !this.reduced && previous?.position && position) {
      // The previous finger returns home while the next pose is prepared.
      const elapsed = now - this.start;
      this.returning = {
        pair: this.published,
        left: Math.min(this.published.left.length - 1, this.index(this.published.leftModifier, elapsed)),
        right: Math.min(this.published.right.length - 1, this.index(this.published.rightModifier, elapsed)),
      };
      this.published = null;
      this.start = now;
    } else if (this.published || this.returning) {
      this.held = this.displayed(now);
      this.published = this.returning = null;
    }
    // First display, rapid typing and reduced motion show the settled pose.
    const reduced = reduce || rapid || !previous;
    const request = ++this.request;
    this.prepare(position, shift)
      .then(async (pair) => {
        if (request !== this.request) return;
        if (this.returning) await new Promise((done) => setTimeout(done, Math.max(0, 168 - (performance.now() - this.start))));
        if (request !== this.request) return;
        this.returning = null;
        this.held = null;
        this.published = pair;
        this.mode = 'play';
        this.reduced = reduced;
        this.start = performance.now();
        this.animate();
      })
      .catch((error) => {
        // Without frames the keyboard stays visible on its own.
        console.warn(error);
        this.failed = true;
        this.reset();
      });
    this.animate();
  }

  private reset() {
    this.request++;
    this.published = this.returning = this.held = null;
    this.cue = null;
    this.draw();
  }

  private prepare(position: string | null, shift: boolean): Promise<Pair> {
    this.assets ??= Assets.load(this.url);
    return this.assets.then(async (assets) => {
      const primary = position ? assets.m.bindings[position] ?? null : null;
      const opposite = primary && shift ? shiftPosition(primary.finger) : null;
      const modifier = opposite ? assets.m.bindings[opposite] : null;
      const leftBinding = primary?.left ? primary : modifier?.left ? modifier : null;
      const rightBinding = primary && !primary.left ? primary : modifier && !modifier.left ? modifier : null;
      const [left, right] = await Promise.all([this.hand(assets, leftBinding, true), this.hand(assets, rightBinding, false)]);
      return { left, right, leftModifier: !!modifier?.left, rightModifier: !!modifier && !modifier.left };
    });
  }

  private hand(assets: Assets, binding: { pose: string; finger: string } | null, left: boolean) {
    const key = binding ? `${binding.pose}|${binding.finger}|${left}` : `home|${left}`;
    let frames = this.cache.get(key);
    if (frames) {
      this.cache.delete(key);
    } else {
      frames = assets.prepare(binding, left);
      frames.catch(() => this.cache.delete(key));
    }
    this.cache.set(key, frames);
    // A handful of poses is enough for a word; older ones are rebuilt on demand.
    while (this.cache.size > 10) {
      const [oldest, evicted] = this.cache.entries().next().value!;
      this.cache.delete(oldest);
      evicted.then((list) => list.forEach((f) => !this.inUse(f) && f.image.close())).catch(() => {});
    }
    return frames;
  }

  private inUse(f: Frame) {
    const lists = [this.published, this.returning?.pair].flatMap((p) => (p ? [p.left, p.right] : []));
    return lists.some((list) => list.includes(f)) || this.held?.left === f || this.held?.right === f;
  }

  private index(modifier: boolean, elapsed: number) {
    return this.mode === 'pulse' ? pulseFrame(elapsed, modifier) : frameAt(elapsed, modifier, this.reduced);
  }

  private displayed(now: number): { left: Frame; right: Frame } | null {
    const elapsed = now - this.start;
    if (this.returning) {
      const { pair, left, right } = this.returning;
      const at = Math.min(elapsed, 168);
      return {
        left: pair.left[Math.min(pair.left.length - 1, returnFrame(at, pair.leftModifier, left))],
        right: pair.right[Math.min(pair.right.length - 1, returnFrame(at, pair.rightModifier, right))],
      };
    }
    if (this.published) {
      const p = this.published;
      return {
        left: p.left[Math.min(p.left.length - 1, this.index(p.leftModifier, elapsed))],
        right: p.right[Math.min(p.right.length - 1, this.index(p.rightModifier, elapsed))],
      };
    }
    return this.held;
  }

  private animate() {
    if (this.frame) return;
    const step = () => {
      this.frame = 0;
      this.draw();
      const elapsed = performance.now() - this.start;
      const busy = this.returning ? elapsed < 168 : this.published && (this.mode === 'pulse' ? elapsed < 126 : !this.reduced && elapsed < 252);
      if (busy) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  /** Map Kala's diagram onto the rendered keys: Backquote and Backspace span the width, Space gives the row pitch. */
  private layout() {
    const keyboard = this.host.querySelector<HTMLElement>('.kb');
    const first = this.host.querySelector('.key[data-vk="192"]')?.getBoundingClientRect();
    const last = this.host.querySelector('.key[data-vk="8"]')?.getBoundingClientRect();
    const space = this.host.querySelector('.key[data-vk="32"]')?.getBoundingClientRect();
    if (!keyboard || !first || !last || !space || !first.width) return;
    const box = this.host.getBoundingClientRect();
    const sx = (last.right - first.left) / (15 * PITCH - 6);
    const sy = (space.top - first.top) / (4 * ROW);
    const ox = first.left - box.left, oy = first.top - box.top;
    const height = Math.ceil(oy + (DIAGRAM_HEIGHT - PAD) * sy);
    this.host.style.paddingBottom = `${Math.max(0, height - keyboard.offsetHeight)}px`;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${box.width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.width = Math.round(box.width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.map = { ox, oy, sx, sy };
    this.draw();
  }

  private draw() {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    const shown = this.enabled && this.transparency < 100 ? this.displayed(performance.now()) : null;
    if (!shown) return;
    const { ox, oy, sx, sy } = this.map;
    ctx.globalAlpha = 1 - this.transparency / 100;
    ctx.imageSmoothingQuality = 'high';
    for (const f of [shown.left, shown.right])
      ctx.drawImage(f.image, ox + (f.x - PAD) * sx, oy + (f.y - PAD) * sy, f.w * sx, f.h * sy);
  }
}
