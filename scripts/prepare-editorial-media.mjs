import sharp from 'sharp';
import { mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2).filter(arg=>arg!=='--traces-only');
const originals=path.resolve(args[0]||path.join(root,'img','documentary'));
const visit=path.resolve(args[1]||path.join(root,'img','Generated Image November 02, 2026 - 12_55PM (1).jpg'));
const sourceFiles=await readdir(originals);
await mkdir(path.join(root,'assets','traces'),{recursive:true});
await mkdir(path.join(root,'assets','visit'),{recursive:true});
for(const name of ['tovtry','limestone','fossils']){
  const candidates=sourceFiles.filter(file=>new RegExp(`^${name}\\.(png|jpe?g|webp|avif)$`,'i').test(file));
  if(candidates.length!==1)throw new Error(`Expected one source for ${name}; found: ${candidates.join(', ')}`);
  for(const width of [800,1600]){
    const result=await sharp(path.join(originals,candidates[0])).rotate().resize({width,withoutEnlargement:true}).webp({quality:84,effort:5}).toFile(path.join(root,'assets','traces',`${name}-${width}.webp`));
    console.log(`${name}-${width}: ${result.width}×${result.height}, ${Math.round(result.size/1024)} KB`);
  }
}
for(const width of process.argv.includes('--traces-only')?[]:[800,1600]){
  const result=await sharp(visit).rotate().resize({width,withoutEnlargement:true}).webp({quality:82,effort:5}).toFile(path.join(root,'assets','visit',`sunrise-${width}.webp`));
  console.log(`sunrise-${width}: ${result.width}×${result.height}, ${Math.round(result.size/1024)} KB`);
}
