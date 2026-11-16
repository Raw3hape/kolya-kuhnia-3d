// Pinned self-hosted physics. --check is offline; --write only fetches two files.
import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';
const root=new URL('../../web/vendor/cannon-es-0.20.0/',import.meta.url),mode=process.argv[2]||'--check',sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));if(manifest.version!=='0.20.0'||manifest.license!=='MIT')throw Error('physics version/license changed');
if(!['--check','--write'].includes(mode))throw Error('Use --check or --write');
for(const f of manifest.files){let data;if(mode==='--write'){const source=f.file==='cannon-es.js'?'dist/cannon-es.js':'LICENSE';const response=await fetch(`https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/${source}`,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('physics fetch '+response.status);data=Buffer.from(await response.arrayBuffer());}else data=await readFile(new URL(f.file,root));if(data.length!==f.bytes||sha(data)!==f.sha256)throw Error('physics integrity mismatch '+f.file);if(mode==='--write')await writeFile(new URL(f.file,root),data);}
console.log(JSON.stringify({physics:'cannon-es',version:manifest.version,license:manifest.license,files:manifest.files.length,integrity:true}));
