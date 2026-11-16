// Bounded real WebGL / WebRTC feature QA. Existing Playwright only, no installs.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs QA_URL=https://... node tools/qa/party-ui-qa.mjs
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {awaitPlayable} from './await-playable.mjs';
const moduleName=process.env.PLAYWRIGHT_MODULE||'playwright';
const {chromium}=await import(path.isAbsolute(moduleName)?pathToFileURL(moduleName).href:moduleName);
const url=process.env.QA_URL||'http://127.0.0.1:8765/';
const output=path.resolve(process.env.QA_OUTPUT||'output/playwright/party-release');
fs.mkdirSync(output,{recursive:true});
const report={url,checks:[],errors:[],cleanup:false},contexts=[],assetGates=new Map();
let browser;
const watchdog=setTimeout(()=>{browser?.close().finally(()=>process.exit(2));},360000);
function check(name,pass,details){report.checks.push({name,pass,details});console.log(JSON.stringify({name,pass}));if(!pass)throw Error(name);}
async function page(target=url,mobile=false,delayProps=false){
  const c=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});contexts.push(c);
  let release;
  if(delayProps){const gate=new Promise(resolve=>release=resolve);await c.route('**/models/party/props/library.glb*',async route=>{await gate;await route.continue().catch(()=>{});});}
  await c.addInitScript(()=>localStorage.setItem('kitchen-ui-v1',JSON.stringify({quality:'eco',seen:{intro:true}})));
  const p=await c.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>report.errors.push(e.message));
  if(release)assetGates.set(p,release);
  await p.goto(target,{waitUntil:'domcontentloaded'});
  if(!delayProps)await awaitPlayable(p);
  await p.waitForFunction(delayed=>window.__kitchen?.party?.debug.ready&&(delayed||window.__kitchen?.partyProps?.debug.count>0)&&window.__kitchen?.hunt?.stats?.ready,delayProps,{timeout:90000});
  await p.getByRole('button',{name:'Понятно',exact:true}).click({timeout:500}).catch(()=>{});
  return p;
}
async function aim(p,target){
  for(let j=0;j<9;j++){
    const s=await p.evaluate(()=>__kitchen.walk.getNetworkPose()),dx=target[0]-s.x,dz=target[2]-s.z;
    const yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(target[1]-1.6794,Math.hypot(dx,dz));
    const angle=Math.atan2(Math.sin(s.yaw-yaw),Math.cos(s.yaw-yaw));
    const mx=Math.max(-210,Math.min(210,angle/.0042)),my=Math.max(-140,Math.min(140,(s.pitch-pitch)/.0042));
    if(Math.abs(mx)<1&&Math.abs(my)<1)break;
    await p.mouse.move(620,350);await p.mouse.down({button:'right'});await p.mouse.move(620+mx,350+my,{steps:6});await p.mouse.up({button:'right'});await p.waitForTimeout(100);
  }
  await p.waitForTimeout(250);
}
async function idleItem(p){await p.waitForFunction(()=>{const p=__kitchen.party,h=p.held;return h&&(!h.action||p.debug.state.time-h.action.at>=h.action.duration);});}
async function walkTo(p,x,z){
  await aim(p,[x,1.6794,z]);const until=Date.now()+15000;
  while(Date.now()<until){const pose=await p.evaluate(()=>__kitchen.walk.getNetworkPose()),d=Math.hypot(pose.x-x,pose.z-z);if(d<.09)return;
    await p.keyboard.down('w');await p.waitForTimeout(Math.max(60,Math.min(260,d/3*1000)));await p.keyboard.up('w');await p.waitForTimeout(50);
  }
  throw Error(`native walk did not reach ${x},${z}`);
}
async function walkRoute(p,x,z){
  // Plan from the real collider snapshot; never teleport a network player.
  const route=await p.evaluate(async({x,z})=>{
    const {isFree,roomOf,WALK}=await import('/js/multiplayer/collision.js');
    const plan=await fetch('/spec/plan.generated.json').then(r=>r.json()),col=__kitchen.walk.collisionSnapshot(),start=__kitchen.walk.getNetworkPose(),step=.15;
    const point=(i,j)=>({x:start.x+i*step,z:start.z+j*step}),key=(i,j)=>`${i},${j}`;
    const free=q=>roomOf(plan,q.x,q.z)&&isFree(q,col,[],WALK.radius+.04);
    const open=[{i:0,j:0,g:0,f:Math.hypot(x-start.x,z-start.z)}],cost=new Map([['0,0',0]]),parents=new Map();let last;
    for(let visit=0;open.length&&visit<7000;visit++){
      open.sort((a,b)=>b.f-a.f);const n=open.pop(),q=point(n.i,n.j),k=key(n.i,n.j);if(n.g>cost.get(k))continue;
      if(Math.hypot(q.x-x,q.z-z)<.16){last=k;break;}
      for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){const i=n.i+di,j=n.j+dj,t=point(i,j),nk=key(i,j),g=n.g+step;if(!free(t)||g>=(cost.get(nk)??Infinity))continue;cost.set(nk,g);parents.set(nk,k);open.push({i,j,g,f:g+Math.hypot(t.x-x,t.z-z)});}
    }
    if(!last)throw Error('no collision-free route to beer');
    const path=[];while(last!=='0,0'){const [i,j]=last.split(',').map(Number);path.unshift(point(i,j));last=parents.get(last);}path.unshift({x:start.x,z:start.z});
    const clear=(a,b)=>{const n=Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/.05);for(let j=1;j<=n;j++)if(!free({x:a.x+(b.x-a.x)*j/n,z:a.z+(b.z-a.z)*j/n}))return false;return true;};
    const out=[];for(let i=0;i<path.length-1;){let j=path.length-1;while(j>i+1&&!clear(path[i],path[j]))j--;out.push(path[j]);i=j;}return out;
  },{x,z});
  for(const q of route)await walkTo(p,q.x,q.z);
}
async function connected(p){await p.waitForFunction(()=>__kitchen.multiplayer.client.connected,null,{timeout:60000});await p.evaluate(()=>__kitchen.multiplayer.lobby.close());}
async function screenshot(p,name){await p.screenshot({path:path.join(output,name+'.png')});}
try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
  const host=await page();await host.waitForFunction(()=>__kitchen.walk.walking);
  check('network runtime is ready before the first multiplayer action',await host.evaluate(()=>typeof window.Peer==='function'));
  const labelIds=await host.evaluate(()=>__kitchen.party.labels.world);
  check('eight bottles have eight stable unique labels',Object.keys(labelIds).length===8&&new Set(Object.values(labelIds)).size===8&&Object.entries(labelIds).every(([id,label])=>id===label),labelIds);
  await host.locator('.hide-btn').click().catch(()=>{});
  // Fixture placement uses the existing public walkthrough; every take/use/look below is native input.
  await host.evaluate(()=>{__kitchen.viewmodel.setWeapon('none');__kitchen.walk.enter({x:1.2,z:1.74},Math.PI*1.5);});await host.waitForTimeout(1000);
  await aim(host,await host.evaluate(()=>__kitchen.party.interactionPoint('vape-island')));await host.keyboard.press('e');await idleItem(host);
  const held=await host.evaluate(()=>({id:__kitchen.party.held?.id,walking:__kitchen.walk.walking,seated:__kitchen.seats.active}));
  check('E takes the vape without also sitting behind it',held.id==='vape-island'&&held.walking&&!held.seated,held);
  await host.mouse.click(650,400);await host.waitForFunction(()=>__kitchen.party.debug.effects.smoke>0);await host.waitForTimeout(100);
  check('native puff compiles and renders bounded soft smoke',await host.evaluate(()=>__kitchen.party.debug.effects.smoke>0&&__kitchen.party.debug.effects.smoke<=180));await screenshot(host,'solo-smoke');
  await host.evaluate(()=>__kitchen.seats.sitOn('sofa'));await host.waitForTimeout(1000);
  const before=await host.evaluate(()=>__kitchen.camera.quaternion.toArray());
  await host.mouse.move(620,350);await host.mouse.down({button:'right'});await host.mouse.move(690,330,{steps:8});await host.mouse.up({button:'right'});await host.waitForTimeout(250);
  const after=await host.evaluate(()=>({q:__kitchen.camera.quaternion.toArray(),held:__kitchen.party.held?.id,seated:__kitchen.seats.active}));
  check('right mouse looks around while seated carrying vape',after.held==='vape-island'&&after.seated&&Math.hypot(...after.q.map((n,i)=>n-before[i]))>.02,after);
  await host.keyboard.press('q');await host.evaluate(()=>__kitchen.seats.stand({toWalk:true}));await host.waitForTimeout(1000);
  await host.evaluate(()=>{__kitchen.doors.setOpen('kitchen_balcony_door',true,{instant:true});__kitchen.walk.enter({x:5.12,z:-.64},0);});await host.waitForTimeout(1000);
  await aim(host,await host.evaluate(()=>__kitchen.party.interactionPoint('beer-0')));await host.keyboard.press('e');await host.waitForTimeout(800);
  check('pickup preserves the specific bottle label',await host.evaluate(()=>__kitchen.party.labels.held===__kitchen.party.held.id));await screenshot(host,'beer-full');
  const fills=[];
  for(let sip=1;sip<=5;sip++){
    await host.mouse.click(650,400);
    await host.waitForFunction(n=>{const p=__kitchen.party,h=p.held;return h?.sips===n&&(!h.action||p.debug.state.time-h.action.at>=h.action.duration);},sip);
    fills.push(await host.evaluate(()=>__kitchen.party.debug.liquid.fill));
    if(sip===2)await screenshot(host,'beer-liquid');
  }
  check('visible bottle liquid drains through five separate native sips',fills.at(-1)===0&&fills.every((f,i)=>!i||f<fills[i-1]),fills);
  await host.keyboard.press('q');await host.waitForFunction(()=>__kitchen.party.debug.state.items.find(i=>i.id==='beer-0').status==='broken',null,{timeout:10000});
  check('new hollow bottle still throws and breaks',true);
  await host.locator('#kmp-launch').click();await host.locator('#kmp-name').fill('Party release host');await host.locator('.kmp-form button[type=submit]').click();await connected(host);
  await host.waitForFunction(()=>__kitchen.walk.walking&&!__kitchen.multiplayer.applying);
  await host.keyboard.down('w');await host.waitForTimeout(1770);await host.keyboard.up('w');await host.waitForTimeout(300);
  await aim(host,await host.evaluate(()=>__kitchen.party.interactionPoint('vape-island')));await host.keyboard.press('e');await idleItem(host);
  check('host takes vape through room authority',await host.evaluate(()=>__kitchen.party.held?.id==='vape-island'));
  const guest=await page(await host.evaluate(()=>__kitchen.multiplayer.client.inviteUrl),false,true);
  const fullStartup=await guest.evaluate(()=>!!__kitchen.startup);
  if(fullStartup){check('slow domestic assets keep initial gameplay gated',await guest.evaluate(()=>__kitchen.startup.status==='loading'&&!document.querySelector('#loading').hidden&&!document.querySelector('#kmp-lobby').open));assetGates.get(guest)();await awaitPlayable(guest);}
  await guest.locator('#kmp-name').fill('Party release guest');await guest.locator('.kmp-form button[type=submit]').click();await connected(guest);await guest.waitForTimeout(600);
  if(!fullStartup){await guest.waitForFunction(()=>__kitchen.multiplayer.applying&&!__kitchen.partyProps);assetGates.get(guest)();}
  await guest.waitForFunction(()=>!__kitchen.multiplayer.applying&&__kitchen.partyProps?.debug.count>0,null,{timeout:60000});
  check('joining waits for slow domestic assets before damage reconciliation',true);
  const ids=await Promise.all([host,guest].map(p=>p.evaluate(()=>__kitchen.party.debug.state.items.find(i=>i.kind==='vape').owner)));
  check('late WebRTC guest receives existing ownership',ids[0]&&ids[0]===ids[1],ids);
  await host.mouse.click(650,400);await host.waitForFunction(()=>__kitchen.party.debug.effects.smoke>0);await host.waitForTimeout(100);
  const smoke=[await host.evaluate(()=>__kitchen.party.debug.effects.smoke)];
  await guest.waitForFunction(()=>__kitchen.party.debug.effects.smoke>0);
  smoke.push(await guest.evaluate(()=>__kitchen.party.debug.effects.smoke));
  check('one authoritative puff renders on both clients',smoke.every(n=>n>0&&n<=180),smoke);
  const grip=await guest.evaluate(()=>{const root=__kitchen.scene.getObjectByName('party_remote_props'),prop=root.children.find(o=>o.visible),avatar=__kitchen.scene.children.find(o=>o.userData.networkAvatar),wrist=avatar?.getObjectByName('right_wrist');return prop&&wrist?prop.position.distanceTo(wrist.getWorldPosition(prop.position.clone())):null;});
  check('observer item follows animated wrist socket',grip!==null&&grip<.17,grip);await screenshot(guest,'guest-smoke');
  await host.keyboard.press('q');await host.waitForTimeout(400);await host.keyboard.press('2');await host.waitForTimeout(1000);
  await aim(host,await host.evaluate(()=>__kitchen.partyProps.interactionPoint('prep-ramekin')));await host.mouse.click(650,400);await host.waitForTimeout(700);
  const shattered=await Promise.all([host,guest].map(p=>p.evaluate(()=>__kitchen.partyProps.debug.holders.find(h=>h.item.id==='prep-ramekin')?.unit.visible===false)));
  check('new realistic ceramic destruction agrees for both players',shattered.every(Boolean),shattered);
  await host.evaluate(()=>__kitchen.viewmodel.setWeapon('none'));
  await walkRoute(host,5.12,-.64);
  await aim(host,await host.evaluate(()=>__kitchen.party.interactionPoint('beer-5')));await host.keyboard.press('e');await idleItem(host);
  await guest.waitForFunction(()=>__kitchen.party.labels.remote['beer-5']==='beer-5');
  const sharedLabel=await Promise.all([host,guest].map(p=>p.evaluate(()=>({held:__kitchen.party.labels.held,remote:__kitchen.party.labels.remote,world:__kitchen.party.labels.world['beer-5']}))));
  check('host and observer retain the same unique beer label',sharedLabel[0].held==='beer-5'&&sharedLabel[1].remote['beer-5']==='beer-5'&&sharedLabel.every(s=>s.world==='beer-5'),sharedLabel);await screenshot(host,'beer-reserve');
  await guest.context().close();await host.context().close();
  const mobile=await page(url,true);await mobile.waitForFunction(()=>__kitchen.walk.walking);
  await mobile.evaluate(()=>__kitchen.walk.enter({x:1.2,z:1.74},Math.PI*1.5));await mobile.waitForTimeout(1000);
  await mobile.evaluate(()=>__kitchen.party.command('take','vape-island'));await idleItem(mobile);
  const rects=await mobile.locator('.party-touch:visible').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {name:e.textContent,x:r.x,y:r.y,w:r.width,h:r.height};}));
  const overlap=rects.some((a,i)=>rects.some((b,j)=>i<j&&a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y));
  const jump=await mobile.locator('.kw-jump').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};});
  const jumpOverlap=rects.some(a=>a.x<jump.x+jump.w&&a.x+a.w>jump.x&&a.y<jump.y+jump.h&&a.y+a.h>jump.y);
  check('mobile actions are visible and clear of jump and each other',rects.length>=2&&!overlap&&!jumpOverlap&&rects.every(r=>r.x>=0&&r.x+r.w<=391),{rects,jump});
  await mobile.getByRole('button',{name:'Затяжка',exact:true}).tap();await mobile.waitForFunction(()=>__kitchen.party.debug.effects.smoke>0);await mobile.waitForTimeout(100);
  check('native mobile tap emits smoke',await mobile.evaluate(()=>__kitchen.party.debug.effects.smoke>0));await screenshot(mobile,'mobile-smoke');
  check('no application errors',report.errors.length===0,report.errors);
}catch(error){
  report.failure=error.message;process.exitCode=1;report.failureState=[];
  for(const c of contexts)for(const p of c.pages())if(!p.isClosed()){
    const state=await p.evaluate(()=>({origin:location.origin,status:window.__kitchen?.multiplayer?.client?.status,
      role:window.__kitchen?.multiplayer?.client?.role,lobby:document.querySelector('#kmp-lobby')?.innerText,
      players:window.__kitchen?.multiplayer?.client?.state?.players?.length,pose:window.__kitchen?.walk?.getNetworkPose(),held:window.__kitchen?.party?.held?.id,target:window.__kitchen?.party?.target?.id})).catch(()=>null);
    report.failureState.push(state);await screenshot(p,'failure-'+report.failureState.length).catch(()=>{});
  }
}
finally{clearTimeout(watchdog);for(const release of assetGates.values())release();for(const c of contexts)await c.close().catch(()=>{});await browser?.close();report.cleanup=true;fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({complete:!report.failure,failure:report.failure,cleanup:true}));}
