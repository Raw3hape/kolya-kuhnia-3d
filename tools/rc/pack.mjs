// Bounded glTF Transform packing. Explicit outputs are staged, never published.
// GLTF_TRANSFORM_CLI=/existing/cli.js node tools/rc/pack.mjs --input path/garage.glb --output path/garage.packed.glb
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,renameSync,rmSync,mkdtempSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{input:{type:'string'},output:{type:'string'},cli:{type:'string'}}});
const cli=values.cli||process.env.GLTF_TRANSFORM_CLI;if(!cli)throw Error('Set GLTF_TRANSFORM_CLI to an existing glTF Transform CLI.');
const input=path.resolve(values.input||'tools/rc/.staging/garage.glb'),output=path.resolve(values.output||'web/models/rc/garage.glb');
if(input===output)throw Error('Packing must use a distinct output path.');
const sourceManifest=path.join(path.dirname(input),'manifest.json'),manifestPath=values.output?output.replace(/\.glb$/i,'.manifest.json'):path.join(path.dirname(output),'manifest.json');
const manifest=JSON.parse(readFileSync(sourceManifest));mkdirSync(path.dirname(output),{recursive:true});
const scratch=mkdtempSync(path.join(path.dirname(output),'.rc-pack-'));
try{
 const dedup=path.join(scratch,'dedup.glb'),packed=path.join(scratch,'packed.glb');
 for(const args of [['dedup',input,dedup],['meshopt',dedup,packed,'--level','medium']]){
  const result=spawnSync(process.execPath,[cli,...args],{stdio:'inherit',timeout:120000,killSignal:'SIGTERM'});
  if(result.error||result.status!==0)throw result.error||Error('RC asset packing failed: '+result.status);
 }
 const bytes=readFileSync(packed);manifest.bytes=bytes.length;manifest.sha256=createHash('sha256').update(bytes).digest('hex');manifest.asset=path.basename(output);manifest.compression='glTF Transform dedup + Meshopt';
 const stagedManifest=path.join(scratch,'manifest.json');writeFileSync(stagedManifest,JSON.stringify(manifest,null,2)+'\n');
 renameSync(packed,output);renameSync(stagedManifest,manifestPath);
 console.log(JSON.stringify({output,manifest:manifestPath,bytes:manifest.bytes,sha256:manifest.sha256}));
 if(!values.input&&!values.output){rmSync(input,{force:true});rmSync(sourceManifest,{force:true});try{rmSync(path.dirname(input));}catch{/* Preserve any source not owned by this packing operation. */}}
}finally{rmSync(scratch,{recursive:true,force:true});}
