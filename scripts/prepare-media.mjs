import { readdir, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = path.resolve(process.argv[2] || path.join(root, 'img'));
const names = (await readdir(input)).filter(name => /^frame_\d{3}\.jpg$/i.test(name)).sort();
if (names.length !== 50 || names.some((name, i) => name !== `frame_${String(i + 1).padStart(3, '0')}.jpg`)) {
  throw new Error('Expected 50 sequential images: frame_001.jpg … frame_050.jpg');
}
for (const [variant, width, quality] of [['desktop', 1280, 70], ['mobile', 800, 76]]) {
  const destination = path.join(root, 'assets', 'frames', variant);
  await mkdir(destination, { recursive: true });
  let bytes = 0;
  // Limit encoder concurrency and peak memory on a laptop.
  for (let start = 0; start < names.length; start += 4) {
    await Promise.all(names.slice(start, start + 4).map(async name => {
      const output = path.join(destination, name.replace('.jpg', '.webp'));
      await sharp(path.join(input, name)).rotate().resize({ width, withoutEnlargement: true }).webp({ quality, effort: 5 }).toFile(output);
      bytes += (await stat(output)).size;
    }));
  }
  console.log(`${variant}: ${names.length} frames, ${(bytes / 1e6).toFixed(2)} MB`);
}
