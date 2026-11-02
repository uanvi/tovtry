import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Usage: node scripts/convert-png-to-avif.mjs <folder> [quality=75]
// Converts PNG files directly inside the folder; originals are never removed.
const folder = path.resolve(process.argv[2] || '.');
const quality = Number(process.argv[3] || 75);
if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
  throw new Error('Quality must be an integer between 1 and 100.');
}
const names = (await readdir(folder, { withFileTypes: true }))
  .filter(entry => entry.isFile() && /\.png$/i.test(entry.name))
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (!names.length) throw new Error(`No PNG files found in ${folder}`);

// Two images at a time, with limited encoder threads to control memory usage.
sharp.concurrency(2);
let cursor = 0;
let completed = 0;
let converted = 0;
let skipped = 0;
let failures = 0;
let inputBytes = 0;
let outputBytes = 0;
const mib = bytes => (bytes / 1024 ** 2).toFixed(2);
console.log(`PNG -> AVIF: ${names.length} files, quality ${quality}, original dimensions.`);
console.log(folder);

async function worker() {
  while (cursor < names.length) {
    const name = names[cursor++];
    const source = path.join(folder, name);
    const target = path.join(folder, name.replace(/\.png$/i, '.avif'));
    try {
      const sourceSize = (await stat(source)).size;
      let existing;
      try { existing = await readFile(target); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      let size;
      if (existing) {
        // Do not silently skip an incomplete or invalid previous output.
        await sharp(existing).stats();
        size = existing.length;
        skipped++;
      } else {
        const data = await sharp(source)
          .avif({ quality, effort: 5, chromaSubsampling: '4:4:4' })
          .toBuffer();
        await writeFile(target, data, { flag: 'wx' });
        size = data.length;
        converted++;
      }
      inputBytes += sourceSize;
      outputBytes += size;
      console.log(`[${++completed}/${names.length}] ${name} -> ${path.basename(target)} (${mib(size)} MiB)${existing ? ' [already exists]' : ''}`);
    } catch (error) {
      failures++;
      console.error(`[${++completed}/${names.length}] FAILED ${name}: ${error.message}`);
    }
  }
}

await Promise.all([worker(), worker()]);
console.log(`Converted: ${converted}; existing: ${skipped}; failed: ${failures}.`);
if (inputBytes) {
  console.log(`PNG: ${mib(inputBytes)} MiB; AVIF: ${mib(outputBytes)} MiB; saved ${(100 * (1 - outputBytes / inputBytes)).toFixed(1)}%.`);
}
if (failures) process.exitCode = 1;
