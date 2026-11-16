// Bounded deterministic asset build. Requires existing Blender and glTF Transform.
// GLTF_TRANSFORM_CLI=/path/to/cli.js node tools/party/interactive_build.mjs
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=path.join(root,'web/models/party/interactive');
const cli=process.env.GLTF_TRANSFORM_CLI;if(!cli)throw Error('Set GLTF_TRANSFORM_CLI to an existing glTF Transform CLI.');
mkdirSync(out,{recursive:true});const stage=mkdtempSync(path.join(out,'.stage-'));
async function run(binary,args){const child=spawn(binary,args,{cwd:root,stdio:'inherit'});let hung=false;const stop=setTimeout(()=>{hung=true;child.kill('SIGTERM');},120000);const force=setTimeout(()=>{if(hung&&child.exitCode===null)child.kill('SIGKILL');},130000);try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>code===0?resolve():reject(Error(binary+' failed '+(signal||code))));});}finally{clearTimeout(stop);clearTimeout(force);}}
try{
 await run('uv',['run','--with','pillow','python','tools/party/make_interactive_textures.py']);
 await run(process.env.BLENDER_BIN||'blender',['-b','--python','tools/party/build_interactive.blender.py','--','--stage',stage]);
 await run(process.execPath,[cli,'dedup',path.join(stage,'library.raw.glb'),path.join(stage,'library.dedup.glb')]);
 await run(process.execPath,[cli,'webp',path.join(stage,'library.dedup.glb'),path.join(stage,'library.textures.glb'),'--quality','90','--effort','80']);
 await run(process.execPath,[cli,'meshopt',path.join(stage,'library.textures.glb'),path.join(stage,'library.glb')]);
 const manifest=JSON.parse(readFileSync(path.join(stage,'manifest.json')));manifest.bytes=statSync(path.join(stage,'library.glb')).size;manifest.compression='dedup + Meshopt + WebP';
 renameSync(path.join(stage,'library.glb'),path.join(out,'library.glb'));writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({bytes:manifest.bytes,triangles:manifest.triangles,meshes:manifest.meshes}));
}finally{rmSync(stage,{recursive:true,force:true});for(const name of ['lager-label.jpg','cardboard.png','carrier-print.png','brushed-metal.png'])rmSync(path.join(out,'textures',name),{force:true});try{rmSync(path.join(out,'textures'),{recursive:false});}catch{/* Only remove our four generated source maps. */}}
