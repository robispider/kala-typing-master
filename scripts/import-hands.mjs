// Imports Kala's rendered hand library (Rigged hand by Elena FF, CC BY-SA 4.0) for the practice keyboard.
//
//   node scripts/import-hands.mjs [path-to-kala-checkout]
//
// Kala ships Brotli planes that browsers cannot inflate without a library. Each payload is verified
// against Kala's manifest, decoded, and re-packed with zlib (DecompressionStream 'deflate'): one file
// for the home planes and one per pose. Only ANSI bindings are kept; the web keyboard is ANSI.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, deflateSync } from 'node:zlib';

export function importHands(kala, root) {
  const source = join(kala, 'kala', 'Resources', 'Learning', 'Hands');
  const out = join(root, 'public', 'hands');
  const manifestBytes = readFileSync(join(source, 'hands.json'));
  const m = JSON.parse(manifestBytes.toString('utf8').replace(/^﻿/, ''));
  if (m.schemaVersion !== 1 || !m.complete) throw new Error('hands.json: unsupported schema');

  const decode = (name, length) => {
    const encoded = readFileSync(join(source, name));
    const identity = m.files[name];
    if (!identity || encoded.length !== identity.bytes || createHash('sha256').update(encoded).digest('hex') !== identity.sha256.toLowerCase())
      throw new Error(`hands: identity mismatch for ${name}`);
    const raw = brotliDecompressSync(encoded);
    if (raw.length !== length) throw new Error(`hands: ${name} decoded to ${raw.length} bytes, expected ${length}`);
    return raw;
  };
  const patchBytes = (p) => (p[2] - p[0]) * (p[3] - p[1]) * 3;

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  let bytes = 0;
  const emit = (name, raw) => {
    const packed = deflateSync(raw, { level: 9 });
    writeFileSync(join(out, name), packed);
    bytes += packed.length;
  };

  emit('base.bin', decode(m.baseFile, m.baseBytes));

  const bindings = {};
  for (const b of m.bindings.filter((b) => b.geometry === 'ansi'))
    bindings[b.position] = { pose: b.pose, finger: b.finger, left: b.left };
  const used = new Set(Object.values(bindings).map((b) => b.pose));

  const poses = {};
  for (const pose of m.poses.filter((p) => used.has(p.id))) {
    const parts = pose.frames.filter((f) => f.file).map((f) => decode(f.file, patchBytes(f.patch)));
    if (parts.length) emit(`${pose.id}.bin`, Buffer.concat(parts));
    poses[pose.id] = {
      finger: pose.finger,
      crop: pose.crop,
      frames: pose.frames.map((f) => ({ patch: f.file ? f.patch : null, offset: f.offset.map((v) => Math.round(v * 1000) / 1000) })),
    };
  }

  const manifest = {
    schema: 1,
    sourceSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    width: m.width,
    height: m.height,
    rectangle: m.rectangle,
    mirrorSum: m.mirrorSum,
    palette: m.palette,
    homeCrop: m.homeCrop,
    poses,
    bindings,
  };
  writeFileSync(join(out, 'hands.json'), JSON.stringify(manifest));
  bytes += readFileSync(join(out, 'hands.json')).length;

  const licenses = join(root, 'public', 'licenses');
  mkdirSync(licenses, { recursive: true });
  copyFileSync(join(source, 'NOTICE.txt'), join(licenses, 'Elena-FF-Rigged-Hand.txt'));
  return { poses: used.size, bindings: Object.keys(bindings).length, bytes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const kala = resolve(process.argv[2] ?? process.env.KALA_SRC ?? join(root, '..', 'kala'));
  const result = importHands(kala, root);
  console.log(`Hands: ${result.poses} poses, ${result.bindings} ANSI keys, ${(result.bytes / 1024).toFixed(0)} KiB from ${kala}`);
}
