/** Independent final release QA. Prepared only: execution needs explicit --run and release receipts.
 * PLAYWRIGHT_MODULE=playwright QA_COMMIT=<sha> QA_DEPLOYMENT=<deployment> node final-animated-qa.mjs --run
 * One Chrome stack. Gallery closes before <=11 capacity pages; those close before two fresh mobile contexts.
 * No installs, app-source changes, mocked transport, forced poses or synthesized authority packets.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
if(!process.argv.includes('--run')){
  console.log('Prepared harness; browser is not started. Set QA_COMMIT, QA_DEPLOYMENT, PLAYWRIGHT_MODULE and pass --run after START.');
  process.exit(0);
}
if(!process.env.QA_COMMIT||!process.env.QA_DEPLOYMENT)throw Error('Exact QA_COMMIT and QA_DEPLOYMENT are required.');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.QA_URL||'https://kolya-kuhnia-3d.vercel.app/';
const output=path.resolve(process.env.QA_OUTPUT||'output/independent-qa/ux/final-animated');
fs.mkdirSync(output,{recursive:true});
const start=Date.now(),report={target:base,source:process.env.QA_COMMIT,deployment:process.env.QA_DEPLOYMENT,
  startedAt:new Date().toISOString(),checks:[],pageErrors:[],consoleErrors:[],resources:[],cleanup:false};
let browser,canon=[],timedOut=false;
const allPages=new Set(),captures=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const stamp=()=>Date.now()-start;
function save(){fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));}
function check(name,pass,details){report.checks.push({name,status:pass?'PASS':'FAIL',atMs:stamp(),details});save();console.log(JSON.stringify({check:name,status:pass?'PASS':'FAIL'}));}
function resource(stage){report.resources.push({stage,atMs:stamp(),nodePid:process.pid,nodeRss:process.memoryUsage().rss,
  machineFree:os.freemem(),machineTotal:os.totalmem(),ownedPages:[...allPages].filter(p=>!p.isClosed()).length});save();console.log(JSON.stringify({stage,ownedPages:report.resources.at(-1).ownedPages,freeMiB:Math.round(os.freemem()/1024**2)}));}
function probe(){
  // Observability only: does not alter scene objects, authority, poses or transport.
  window.__independentQA={
    fingerprint(root){
      let hash=2166136261,meshes=0,vertices=0;
      const mix=n=>{hash^=Math.round(n*100000);hash=Math.imul(hash,16777619)>>>0;};
      const walk=node=>{
        if(['avatar_gear','reload_magazine_in_hand'].includes(node.name))return;
        if(node.isMesh&&node.geometry){meshes++;for(const key of ['position','color']){const a=node.geometry.getAttribute(key);if(a){if(key==='position')vertices+=a.count;for(const n of a.array)mix(n);}}}
        for(const child of node.children)walk(child);
      };
      const rig=root.getObjectByName('avatar_rig');if(rig)walk(rig);
      return{hash:hash.toString(16),meshes,vertices};
    },
    articulation(root){
      return ['avatar_head','left_elbow','right_elbow','left_knee','right_knee'].map(name=>{
        const node=root.getObjectByName(name);let meshes=0,vertices=0;
        node?.traverse(o=>{if(o.isMesh&&o.geometry?.getAttribute('position')){meshes++;vertices+=o.geometry.getAttribute('position').count;}});
        return{name,group:!!node?.isGroup,parent:node?.parent?.name,meshes,vertices,
          quaternion:node?.quaternion.toArray(),position:node?.position.toArray()};
      });
    },
    actorFrame(actorId,roster){
      const k=window.__kitchen,s=k.multiplayer.client.state,p=s?.players.find(p=>p.id===actorId);
      const root=p&&k.scene.children.find(o=>o.userData.networkAvatar&&o.name==='player_'+roster[p.avatar].id);
      const joint=name=>root?.getObjectByName(name)?.quaternion.toArray();
      const muzzle=root?.getObjectByName('avatar_muzzle');let forward=null;
      if(muzzle){root.updateMatrixWorld(true);forward=root.position.clone().set(0,0,-1).transformDirection(muzzle.matrixWorld).toArray();}
      const yaw=p?.lookYaw??p?.yaw,pitch=p?.pitch;
      const expected=Number.isFinite(yaw)&&Number.isFinite(pitch)?[-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)]:null;
      const barrelError=forward&&expected?Math.acos(Math.max(-1,Math.min(1,forward.reduce((sum,v,i)=>sum+v*expected[i],0)))):null;
      return{at:performance.now(),roomTime:s?.time,seq:s?.seq,
        canonical:p?{id:p.id,avatar:p.avatar,y:p.y,yaw:p.yaw,lookYaw:p.lookYaw,pitch:p.pitch,aiming:p.aiming,weapon:p.weapon,action:p.action,verticalSpeed:p.verticalSpeed}:null,
        render:root?{name:root.name,y:root.position.y,head:joint('avatar_head'),leftElbow:joint('left_elbow'),rightElbow:joint('right_elbow'),leftKnee:joint('left_knee'),rightKnee:joint('right_knee'),gear:root.getObjectByName('avatar_gear')?.children.filter(o=>o.visible).map(o=>o.name),barrelForward:forward,expectedForward:expected,barrelErrorRad:barrelError}:null};
    },
  };
}
async function context(options={}){
  const c=await browser.newContext({viewport:{width:640,height:360},deviceScaleFactor:1,locale:'ru-RU',...options});
  await c.addInitScript(probe);
  await c.addInitScript(()=>{try{localStorage.setItem('kitchen-ui-v1',JSON.stringify({quality:'eco'}));}catch{/* about:blank has no storage origin. */}});
  return c;
}
async function page(c,label,url){
  const p=await c.newPage();allPages.add(p);p.setDefaultTimeout(12000);
  p.on('pageerror',e=>{const old=report.pageErrors.find(x=>x.label===label&&x.message===e.message);if(old)old.count++;else report.pageErrors.push({label,message:e.message,stack:e.stack,count:1,atMs:stamp()});});
  p.on('console',m=>{if(m.type()==='error'&&report.consoleErrors.length<30)report.consoleErrors.push({label,text:m.text().slice(0,800),atMs:stamp()});});
  await p.goto(url,{waitUntil:'domcontentloaded',timeout:90000});return p;
}
async function screenshot(p,name){const file=path.join(output,name+'.png');await p.screenshot({path:file});captures.push(file);}
async function dismissCoach(p){if(await p.locator('#kmp-lobby').evaluate(e=>e.open))return;const b=p.getByRole('button',{name:'Понятно',exact:true});if(await b.isVisible())await b.click();}
async function connected(p,allowFull=false){
  await p.waitForFunction(full=>{const c=window.__kitchen?.multiplayer?.client;return c&&(c.connected||full&&c.status==='full');},allowFull,{timeout:90000});
  return p.evaluate(()=>({status:__kitchen.multiplayer.client.status,id:__kitchen.multiplayer.client.id,role:__kitchen.multiplayer.client.role}));
}
async function walkReady(p){await p.waitForFunction(()=>__kitchen.walk.active&&!__kitchen.multiplayer.applying,null,{timeout:90000});}
async function menu(p){if(!(await p.locator('#kmp-lobby').evaluate(e=>e.open)))await p.locator('#kmp-launch').click();}
async function closeMenu(p){if(await p.locator('#kmp-lobby').evaluate(e=>e.open))await p.getByRole('button',{name:'Закрыть',exact:true}).click();}
async function leave(p){await menu(p);await p.getByRole('button',{name:'Выйти из комнаты',exact:true}).click();}
async function create(p,name){
  await p.locator('#kmp-launch').waitFor({state:'visible',timeout:45000});await dismissCoach(p);
  await p.locator('#kmp-launch').click();await p.locator('#kmp-name').fill(name);
  const begin=Date.now();await p.locator('.kmp-form button[type=submit]').click();await connected(p);await walkReady(p);
  report.checks.push({name:'native host creation',status:'PASS',details:{ms:Date.now()-begin}});await closeMenu(p);await dismissCoach(p);
  return p.evaluate(()=>__kitchen.multiplayer.client.inviteUrl);
}
async function join(p,name,{allowFull=false,waitWalk=true}={}){
  await p.locator('#kmp-name').waitFor({state:'visible',timeout:45000});await p.locator('#kmp-name').fill(name);
  await p.locator('.kmp-form button[type=submit]').click();const s=await connected(p,allowFull);
  if(s.status!=='full'&&waitWalk)await walkReady(p);await dismissCoach(p);return s;
}
async function self(p){return p.evaluate(()=>{const c=__kitchen.multiplayer.client;return c.self?{id:c.id,name:c.self.name,avatar:c.self.avatar,score:c.self.score,role:c.role}:null;});}
async function converge(pages,count,timeout=30000){
  await Promise.all(pages.map(p=>p.waitForFunction(n=>__kitchen.multiplayer.client.connected&&__kitchen.multiplayer.client.state.players.length===n&&__kitchen.scene.children.filter(o=>o.userData.networkAvatar).length===n-1,count,{timeout})));
}
async function observers(pages,name){
  const states=await Promise.all(pages.map(p=>p.evaluate(roster=>{
    const k=__kitchen,c=k.multiplayer.client,players=c.state.players.map(({id,name,avatar,score})=>({id,name,avatar,score}));
    const roots=k.scene.children.filter(o=>o.userData.networkAvatar);
    return{selfId:c.id,connected:c.connected,quality:k.pipe.quality,renderCalls:k.renderer.info.render.calls,players,
      models:roots.map(root=>{const slot=roster.findIndex(x=>'player_'+x.id===root.name);return{name:root.name,uuid:root.uuid,slot,visible:root.visible,
        fingerprint:__independentQA.fingerprint(root),joints:__independentQA.articulation(root)};})};
  },canon)));
  const keys=states[0].players.map(p=>p.id+':'+p.avatar).sort().join('|');
  const bad=states.map((s,index)=>({index,errors:[
    !s.connected&&'disconnected',s.players.length!==10&&'not-ten',new Set(s.players.map(p=>p.id)).size!==10&&'duplicate-id',
    new Set(s.players.map(p=>p.avatar)).size!==10&&'duplicate-slot',s.players.map(p=>p.id+':'+p.avatar).sort().join('|')!==keys&&'different-canon',
    s.models.length!==9&&'not-nine-real-roots',s.quality!=='eco'&&'quality-not-eco',s.renderCalls<=0&&'no-render-calls',
    s.players.filter(p=>p.id!==s.selfId).some(p=>{const model=s.models.find(m=>m.name==='player_'+canon[p.avatar].id);return !model||model.slot!==p.avatar||model.fingerprint.hash!==canon[p.avatar].fingerprint.hash||model.joints.some(j=>!j.group||j.meshes<1||j.vertices<1||j.quaternion.some(v=>!Number.isFinite(v)));})&&'model-canon-or-articulation-mismatch',
  ].filter(Boolean)})).filter(x=>x.errors.length);
  check(name,bad.length===0,{bad,states});return states;
}
async function collectActor(observers,actorId,ms=1500){return Promise.all(observers.map(p=>p.evaluate(({actorId,roster,ms})=>new Promise(resolve=>{
  const frames=[],timer=setInterval(()=>frames.push(__independentQA.actorFrame(actorId,roster)),50);
  setTimeout(()=>{clearInterval(timer);resolve(frames);},ms);
}),{actorId,roster:canon,ms})));}
function qDistance(a,b){return a&&b?Math.min(Math.hypot(...a.map((x,i)=>x-b[i])),Math.hypot(...a.map((x,i)=>x+b[i]))):0;}
async function gallery(){
  resource('before-gallery');const c=await context({viewport:{width:1440,height:1080}}),p=await page(c,'gallery',new URL('characters.html',base).href);
  await p.waitForFunction(()=>window.__avatarGallery?.models?.length===10,null,{timeout:45000});
  canon=await p.evaluate(()=>__avatarGallery.models.map(m=>({id:m.avatar.definition.id,slot:m.avatar.slot,name:m.avatar.root.name,
    fingerprint:__independentQA.fingerprint(m.avatar.root),joints:__independentQA.articulation(m.avatar.root)})));
  check('gallery static ten articulated canonical models',canon.length===10&&new Set(canon.map(x=>x.name)).size===10&&canon.every(x=>x.joints.every(j=>j.group&&j.meshes>0&&j.vertices>0)),canon);
  await screenshot(p,'gallery-static');await p.locator('#preview-mode').selectOption('walk');await pause(200);
  const one=await p.evaluate(()=>({playing:__avatarGallery.playing,pose:__avatarGallery.models[0].avatar.animation}));await pause(300);
  const two=await p.evaluate(()=>({playing:__avatarGallery.playing,pose:__avatarGallery.models[0].avatar.animation}));
  check('gallery native play animates real joints',one.playing&&two.playing&&JSON.stringify(one.pose.joints)!==JSON.stringify(two.pose.joints),{one,two});
  await screenshot(p,'gallery-playing');await p.locator('#preview-play').click();const paused=await p.evaluate(()=>({playing:__avatarGallery.playing,joints:__avatarGallery.models[0].avatar.animation.joints}));await pause(250);
  check('gallery native pause stops pose',!paused.playing&&await p.evaluate(j=>JSON.stringify(j)===JSON.stringify(__avatarGallery.models[0].avatar.animation.joints),paused.joints),paused);
  await p.locator('#preview-play').click();await p.evaluate(()=>addEventListener('pagehide',()=>sessionStorage.setItem('__qaGalleryPagehide',JSON.stringify({canvas:document.querySelectorAll('#gallery canvas').length,playing:__avatarGallery.playing})),{once:true}));
  await p.goto('about:blank');await p.goBack({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__avatarGallery?.models?.length===10);
  const life=await p.evaluate(()=>({before:JSON.parse(sessionStorage.getItem('__qaGalleryPagehide')),canvas:document.querySelectorAll('#gallery canvas').length,models:__avatarGallery.models.length}));
  check('gallery pagehide disposes and back restores one renderer',life.before?.canvas===0&&life.before?.playing===false&&life.canvas===1&&life.models===10,life);
  await c.close();resource('after-gallery-close');
}
async function capacity(){
  const c=await context(),pages=[],host=await page(c,'capacity-host',base);pages.push(host);const invite=await create(host,'Final QA Host');
  for(let n=1;n<10;n++){const p=await page(c,'capacity-'+n,invite);pages.push(p);await join(p,'Final QA '+n);await host.waitForFunction(n=>__kitchen.multiplayer.client.state.players.length===n,n+1);resource('capacity-'+(n+1));}
  await converge(pages,10);await observers(pages,'ten observers match identities slots geometry and articulated joints');
  const cadence=await Promise.all(pages.map(p=>p.evaluate(()=>new Promise(resolve=>{
    const c=__kitchen.multiplayer.client,times=[],seq=[],begin=performance.now(),off=c.subscribe(e=>{if(e.type==='snapshot'){times.push(performance.now());seq.push(e.snapshot.seq);}});
    setTimeout(()=>{off();const ms=performance.now()-begin;resolve({count:times.length,ms,hz:times.length*1000/ms,firstSeq:seq[0],lastSeq:seq.at(-1),maxGap:times.slice(1).reduce((m,t,i)=>Math.max(m,t-times[i]),0),connected:c.connected});},10000);
  }))));
  check('all ten receive approximately twenty snapshots per second for ten seconds',cadence.every(s=>s.connected&&s.hz>=18&&s.hz<=22),cadence);
  const actor=pages[1],actorId=(await self(actor)).id,watchers=pages.filter(p=>p!==actor);await closeMenu(actor);await actor.keyboard.press('3');await pause(500);
  const jumpCapture=collectActor(watchers,actorId,1600);await pause(150);await actor.keyboard.press('Space');const jumps=await jumpCapture;
  const jumpSummary=jumps.map(frames=>({canonicalMax:Math.max(...frames.map(f=>f.canonical?.y||0)),renderMax:Math.max(...frames.map(f=>f.render?.y||0)),kneeDelta:Math.max(...frames.map(f=>qDistance(f.render?.leftKnee,frames[0]?.render?.leftKnee)))}));
  check('native jump reaches canonical and rendered knees in every other observer',jumpSummary.every(x=>x.canonicalMax>.1&&x.renderMax>.1&&x.kneeDelta>.03),{summary:jumpSummary,frames:jumps});
  // Native RMB drag changes look without firing. Release RMB and settle back to hip before comparing.
  for(const [label,dy,sign]of[['up',-100,1],['down',170,-1]]){
    const beforePitch=await actor.evaluate(()=>__kitchen.multiplayer.client.self.pitch);let pathUsed='RMB drag then release';
    await actor.mouse.move(330,185);await actor.mouse.down({button:'right'});
    await actor.mouse.move(330,185+dy,{steps:10});await actor.mouse.up({button:'right'});await pause(900);
    let actual=await actor.evaluate(()=>({pitch:__kitchen.multiplayer.client.self.pitch,aiming:__kitchen.multiplayer.client.self.aiming}));
    if(actual.pitch*sign<=.12||Math.abs(actual.pitch-beforePitch)<.1){
      pathUsed+='; native LMB correction';
      for(let attempt=0;attempt<2&&(actual.pitch*sign<=.12||Math.abs(actual.pitch-beforePitch)<.1);attempt++){
        const delta=Math.max(-170,Math.min(165,-(sign*.3-actual.pitch)/.0042));
        await actor.mouse.move(330,185);await actor.mouse.down({button:'left'});await actor.mouse.move(330,185+delta,{steps:10});await actor.mouse.up({button:'left'});await pause(900);
        actual=await actor.evaluate(()=>({pitch:__kitchen.multiplayer.client.self.pitch,aiming:__kitchen.multiplayer.client.self.aiming}));
      }
    }
    const settled=await Promise.all(watchers.map(p=>p.evaluate(({id,roster})=>__independentQA.actorFrame(id,roster),{id:actorId,roster:canon})));
    check('native hip look '+label+' real remote barrel matches canonical yaw pitch',Math.abs(actual.pitch-beforePitch)>.1&&settled.every(f=>f.canonical?.weapon==='rifle'&&(f.canonical.aiming||0)<.02&&f.canonical.pitch*sign>.12&&f.render?.barrelErrorRad!==null&&f.render?.barrelErrorRad<.06),{pathUsed,beforePitch,actual,observers:settled});
  }
  const adsCapture=collectActor(watchers,actorId,1800);await pause(200);await actor.mouse.move(330,180);await actor.mouse.down({button:'right'});await pause(1000);await actor.mouse.up({button:'right'});const ads=await adsCapture;
  const adsSummary=ads.map(frames=>({maxAim:Math.max(...frames.map(f=>f.canonical?.aiming||0)),weapons:[...new Set(frames.map(f=>f.canonical?.weapon))],elbowDelta:Math.max(...frames.map(f=>qDistance(f.render?.rightElbow,frames[0]?.render?.rightElbow))),settledBarrelErrors:frames.filter(f=>(f.canonical?.aiming||0)>.98).slice(-4).map(f=>f.render?.barrelErrorRad)}));
  check('native ADS reaches canonical rendered arms and barrel in every other observer',adsSummary.every(x=>x.maxAim>.5&&x.weapons.includes('rifle')&&x.elbowDelta>.03&&x.settledBarrelErrors.length&&x.settledBarrelErrors.every(v=>v!==null&&v<.06)),{summary:adsSummary,frames:ads});
  await screenshot(host,'capacity-ten-host');
  const extra=await page(c,'capacity-eleventh',invite);await join(extra,'Final QA Eleventh',{allowFull:true,waitWalk:false});
  const rejection=await extra.evaluate(()=>({status:__kitchen.multiplayer.client.status,message:document.querySelector('.kmp-status').textContent}));
  check('eleventh full game page is rejected while host stays at ten',rejection.status==='full'&&/10/.test(rejection.message)&&await host.evaluate(()=>__kitchen.multiplayer.client.state.players.length===10),rejection);
  // Meaningful natural slot reuse; no dropped snapshots, synthetic transport or twelfth page.
  const A=actor,B=pages[2],oldA=await self(A),oldB=await self(B);await leave(A);await host.waitForFunction(()=>__kitchen.multiplayer.client.state.players.length===9);await pause(500);
  await extra.goto(invite,{waitUntil:'domcontentloaded'});await join(extra,'Final QA Slot C');const C=await self(extra);
  check('fresh C naturally occupies A released avatar slot',C.id!==oldA.id&&C.avatar===oldA.avatar,{A:oldA,C});
  await leave(B);await host.waitForFunction(()=>__kitchen.multiplayer.client.state.players.length===9);
  await A.goto(invite,{waitUntil:'domcontentloaded'});await join(A,'Resume name attempt');const resumed=await self(A);
  check('A resumes same identity using B freed slot while C retains A old appearance',resumed.id===oldA.id&&resumed.name===oldA.name&&resumed.score===oldA.score&&resumed.avatar===oldB.avatar&&resumed.avatar!==oldA.avatar,{oldA,oldB,C,resumed});
  const active=pages.filter(p=>p!==B).concat(extra);await converge(active,10);await observers(active,'every observer actual geometry matches canon after meaningful slot reuse');
  await B.close();await leave(host);await Promise.all(active.filter(p=>p!==host).map(p=>p.waitForFunction(()=>__kitchen.multiplayer.client.status==='closed'&&!__kitchen.multiplayer.active,null,{timeout:15000})));await pause(5000);
  const stopped=await Promise.all(active.map(p=>p.evaluate(()=>({status:__kitchen.multiplayer.client.status,active:__kitchen.multiplayer.active,roots:__kitchen.scene.children.filter(o=>o.userData.networkAvatar).length}))));
  check('host stop clears all active peers and articulated avatars without lifecycle exceptions',stopped.every(s=>!s.active&&s.roots===0),stopped);
  await c.close();resource('after-all-capacity-pages-close');
}
async function mobile(){
  const hc=await context({viewport:{width:1280,height:800}}),host=await page(hc,'mobile-host',base),invite=await create(host,'Final Mobile Host');
  const gc=await context({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),guest=await page(gc,'mobile-guest',invite);
  await guest.locator('#kmp-name').waitFor({state:'visible',timeout:45000});await guest.locator('#kmp-name').fill('Final Mobile Guest');await guest.locator('.kmp-form button[type=submit]').tap();
  const early=await guest.evaluate(()=>({walk:__kitchen.walk.active,applying:__kitchen.multiplayer.applying,status:__kitchen.multiplayer.client.status}));
  await guest.setViewportSize({width:844,height:390});await connected(guest);await walkReady(guest);await pause(300);
  const after=await guest.evaluate(()=>({walk:__kitchen.walk.active,panel:document.querySelector('#panel').classList.contains('open'),applying:__kitchen.multiplayer.applying}));
  check('cold guest rotates before walk and enters walk with no leftover open panel',!early.walk&&after.walk&&!after.applying&&!after.panel,{early,after});
  await guest.keyboard.press('3');await pause(400);const before=await guest.evaluate(()=>({shots:__kitchen.viewmodel.shots,ammo:__kitchen.viewmodel.ammo}));
  await guest.getByRole('button',{name:'Выстрел',exact:true}).tap();await guest.getByRole('button',{name:'Прицел',exact:true}).tap();await pause(200);
  const fired=await guest.evaluate(()=>({shots:__kitchen.viewmodel.shots,ammo:__kitchen.viewmodel.ammo,aim:__kitchen.viewmodel.aiming}));
  await guest.getByRole('button',{name:'Прыжок',exact:true}).tap();const heights=[];for(let n=0;n<8;n++){await pause(70);heights.push(await guest.evaluate(()=>__kitchen.walk.getNetworkPose().y));}
  const geometry=await guest.evaluate(()=>{const b=s=>document.querySelector(s).getBoundingClientRect().toJSON(),map=b('.km'),joy=b('.kw-joy'),fire=b('.kvm-fire'),area=(a,z)=>Math.max(0,Math.min(a.right,z.right)-Math.max(a.left,z.left))*Math.max(0,Math.min(a.bottom,z.bottom)-Math.max(a.top,z.top));const f=document.querySelector('.km-fold'),r=f.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{map,joy,fire,mapJoy:area(map,joy),mapFire:area(map,fire),inside:map.left>=0&&map.top>=0&&map.right<=innerWidth&&map.bottom<=innerHeight,foldHit:hit===f||f.contains(hit)};});
  check('cold-rotation native mobile fire aim jump and non-overlapping map',fired.shots>before.shots&&fired.ammo.mag<before.ammo.mag&&fired.aim>.5&&Math.max(...heights)>.1&&geometry.mapJoy===0&&geometry.mapFire===0&&geometry.inside&&geometry.foldHit,{before,fired,heights,geometry});await screenshot(guest,'mobile-after-cold-rotation');
  await guest.setViewportSize({width:390,height:844});await pause(250);await guest.getByRole('button',{name:'Выстрел',exact:true}).tap();await screenshot(guest,'mobile-returned-portrait');
  const identity=await self(guest);await leave(guest);await pause(5000);await guest.goto(invite,{waitUntil:'domcontentloaded'});await join(guest,'Mobile resume attempt');const resumed=await self(guest);
  check('fresh mobile leave rejoin retains identity and restored walk',identity.id===resumed.id&&identity.name===resumed.name&&identity.avatar===resumed.avatar,{before:identity,after:resumed});
  await leave(host);await pause(5000);await gc.close();await hc.close();resource('after-mobile-close');
}
const timer=setTimeout(()=>{timedOut=true;report.deadline='ten-minute deadline reached';save();browser?.close();},10*60*1000);
try{
  const disk=fs.statfsSync(output);report.availableDiskBytes=Number(disk.bavail)*Number(disk.bsize);if(report.availableDiskBytes<40*1024**3)throw Error('Under40 GiB free; browser not started.');
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});report.browserVersion=browser.version();
  resource('browser-started');await gallery();await capacity();await mobile();check('no uncaught page exceptions across all phases',report.pageErrors.length===0,report.pageErrors);
}catch(error){report.failure={message:error.message,stack:error.stack};console.log(JSON.stringify({failure:error.message}));}
finally{clearTimeout(timer);await browser?.close();report.cleanup=true;report.timedOut=timedOut;report.endedAt=new Date().toISOString();report.durationMs=stamp();report.temporaryScreenshots=captures;resource('browser-closed');save();console.log(JSON.stringify({finished:true,cleanup:true,durationMs:report.durationMs,failedChecks:report.checks.filter(c=>c.status==='FAIL').map(c=>c.name),failure:report.failure?.message,output}));}
process.exitCode=report.failure||timedOut||report.checks.some(c=>c.status==='FAIL')?1:0;
