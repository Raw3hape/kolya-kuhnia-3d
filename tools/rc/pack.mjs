// Existing glTF Transform CLI, bounded foreground packing, no package installation.
// GLTF_TRANSFORM_CLI=/path/to/@gltf-transform/cli/bin/cli.js node tools/rc/pack.mjs
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import{createHash}from'node:crypto';
const cli=process.env.GLTF_TRANSFORM_CLI;if(!cli)throw Error('Set GLTF_TRANSFORM_CLI to the existing glTF Transform CLI');
const raw='tools/rc/.staging/garage.glb',mid='tools/rc/.staging/garage.dedup.glb',out='tools/rc/.staging/garage.packed.glb',published='web/models/rc/garage.glb';
try{for(const args of [['dedup',raw,mid],['meshopt',mid,out,'--level','medium']]){const r=spawnSync(process.execPath,[cli,...args],{stdio:'inherit',timeout:120000});if(r.error||r.status!==0)throw r.error||Error('packing failed');}const data=readFileSync(out),m=JSON.parse(readFileSync('tools/rc/.staging/manifest.json'));renameSync(out,published);m.bytes=data.length;m.sha256=createHash('sha256').update(data).digest('hex');m.compression='glTF Transform dedup + Meshopt';writeFileSync('web/models/rc/manifest.json',JSON.stringify(m,null,2)+'\n');console.log(JSON.stringify({bytes:m.bytes,sha256:m.sha256}));}finally{rmSync(mid,{force:true});rmSync(out,{force:true});rmSync(raw,{force:true});rmSync('tools/rc/.staging/manifest.json',{force:true});rmSync('tools/rc/.staging',{recursive:true,force:true});}
