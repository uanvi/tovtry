import { readFile, writeFile } from 'node:fs/promises';
const template = await readFile(new URL('./templates/field-notes.html', import.meta.url), 'utf8');
const image = await readFile(new URL('../assets/visit/sunrise-800.webp', import.meta.url));
const output = template.replace('__LANDSCAPE_DATA__', `data:image/webp;base64,${image.toString('base64')}`);
await writeFile(new URL('../assets/field-notes.html', import.meta.url), output);
console.log(`Standalone field notes prepared: ${Math.round(Buffer.byteLength(output) / 1024)} KB`);
