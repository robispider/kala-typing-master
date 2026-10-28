// Snapshot only the two frozen shared symbol maps. No search scores or corpus text are imported.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(process.argv[2] ?? resolve(root, '../kala-layout'));
const ids = ['shared-76c9b9dbfc689d0b', 'shared-7083b1ebfa5aa3a7'];
const candidates = ids.map((id, i) => {
  const sourcePath = `results/shared-top10-comparison-v1/layouts/${id}.json`;
  const bytes = readFileSync(resolve(sourceRoot, sourcePath));
  const original = JSON.parse(bytes.toString('utf8'));
  if (original.id !== id || Object.keys(original.layout).length !== 52) throw new Error('Unexpected candidate snapshot');
  const symbols = Object.fromEntries(Object.entries(original.layout).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return {
    label: i === 0 ? 'B01' : 'B02', id, sourcePath,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    physicalMapSha256: createHash('sha256').update(JSON.stringify(symbols)).digest('hex'), symbols,
  };
});
writeFileSync(resolve(root, 'src/data/shared-candidates.json'), JSON.stringify({
  version: 'shared-candidate-snapshot-1', sourceRepository: 'kala-layout', candidates,
}, null, 2) + '\n');
console.log('Imported B01/B02 symbol maps from the frozen comparison.');
