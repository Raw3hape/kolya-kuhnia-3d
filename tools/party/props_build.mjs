// Staged Blender export + deterministic dedup/Meshopt; no dependency installs.
// node tools/party/props_build.mjs --gltf-cli /path/to/@gltf-transform/cli/bin/cli.js
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,renameSync,rmSync,statSync,statfsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i>=0?args[i+1]:null;};
const cli=value('--gltf-cli')||process.env.GLTF_TRANSFORM_CLI;
if(!cli)throw Error('Pass --gltf-cli or GLTF_TRANSFORM_CLI for an existing glTF Transform CLI. No package is installed by this build.');
const disk=statfsSync(root);if(disk.bavail*disk.bsize<40*1024**3)throw Error('Less than 40 GiB free; asset build stopped.');
const staging=mkdtempSync(path.join(tmpdir(),'kitchen-props-'));
const output=path.join(root,'web/models/party/props');
async function run(binary,argv,ms){
 await new Promise((resolve,reject)=>{
  const child=spawn(binary,argv,{cwd:root,stdio:'inherit'});let timedOut=false,force;
  process.stdout.write(JSON.stringify({ownedProcess:child.pid,binary,stop:'child exit or bounded timeout'})+'\n');
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');force=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');},15000);},ms);
  child.once('error',e=>{clearTimeout(timer);clearTimeout(force);reject(e);});
  child.once('exit',code=>{clearTimeout(timer);clearTimeout(force);code===0&&!timedOut?resolve():reject(Error(`${binary} failed: ${timedOut?'timeout':code}`));});
 });
}
try{
 const raw=path.join(staging,'library.glb'),dedup=path.join(staging,'dedup.glb'),packed=path.join(staging,'packed.glb');
 await run(value('--blender')||process.env.BLENDER||'blender',['-b','--python','tools/party/props.py','--','--out',staging],120000);
 await run(process.execPath,[cli,'dedup',raw,dedup],60000);
 await run(process.execPath,[cli,'meshopt',dedup,packed],60000);
 const bytes=readFileSync(packed);if(bytes.toString('ascii',0,4)!=='glTF')throw Error('Invalid generated GLB');
 const manifest=JSON.parse(readFileSync(path.join(staging,'manifest.json'),'utf8'));
 manifest.bytes=statSync(packed).size;manifest.compression='gltf-transform dedup + meshopt';manifest.sha256=createHash('sha256').update(bytes).digest('hex');
 const temp=path.join(output,'library.glb.new');copyFileSync(packed,temp);renameSync(temp,path.join(output,'library.glb'));
 writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 process.stdout.write(JSON.stringify({templates:manifest.templates.length,bytes:manifest.bytes,sha256:manifest.sha256})+'\n');
}finally{rmSync(staging,{recursive:true,force:true});}
