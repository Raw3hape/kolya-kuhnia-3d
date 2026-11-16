// Bounded real WebGL / WebRTC feature QA. Existing Playwright only, no installs.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs QA_URL=https://... node tools/qa/party-ui-qa.mjs
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const moduleName=process.env.PLAYWRIGHT_MODULE||'playwright';
const {chromium}=await import(path.isAbsolute(moduleName)?pathToFileURL(moduleName).href:moduleName);
const url=process.env.QA_URL||'http://127.0.0.1:8765/';
const output=path.resolve(process.env.QA_OUTPUT||'output/playwright/party-release');
fs.mkdirSync(output,{recursive:true});
const report={url,checks:[],errors:[],cleanup:false},contexts=[];
let browser;
const watchdog=setTimeout(()=>{browser?.close().finally(()=>process.exit(2));},360000);
function check(name,pass,details){report.checks.push({name,pass,details});console.log(JSON.stringify({name,pass}));if(!pass)throw Error(name);}
async function page(target=url,mobile=false){
  const c=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});contexts.push(c);
  await c.addInitScript(()=>localStorage.setItem('kitchen-ui-v1',JSON.stringify({quality:'eco',seen:{intro:true}})));
  const p=await c.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>report.errors.push(e.message));
  await p.goto(target,{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>window.__kitchen?.party?.debug.ready&&window.__kitchen?.hunt?.stats?.ready,null,{timeout:90000});
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
async function connected(p){await p.waitForFunction(()=>__kitchen.multiplayer.client.connected,null,{timeout:60000});await p.evaluate(()=>__kitchen.multiplayer.lobby.close());}
async function screenshot(p,name){await p.screenshot({path:path.join(output,name+'.png')});}
try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
  const host=await page();await host.waitForFunction(()=>__kitchen.walk.walking);
  await host.locator('.hide-btn').click().catch(()=>{});
  // Fixture placement uses the existing public walkthrough; every take/use/look below is native input.
  await host.evaluate(()=>{__kitchen.viewmodel.setWeapon('none');__kitchen.walk.enter({x:1.2,z:1.74},Math.PI*1.5);});await host.waitForTimeout(1000);
  await aim(host,[2.10,1,1.74]);await host.keyboard.press('e');await host.waitForTimeout(750);
  const held=await host.evaluate(()=>({id:__kitchen.party.held?.id,walking:__kitchen.walk.walking,seated:__kitchen.seats.active}));
  check('E takes the vape without also sitting behind it',held.id==='vape-island'&&held.walking&&!held.seated,held);
  await host.mouse.click(650,400);await host.waitForTimeout(1000);
  check('native puff compiles and renders bounded soft smoke',await host.evaluate(()=>__kitchen.party.debug.effects.smoke>0&&__kitchen.party.debug.effects.smoke<=180));await screenshot(host,'solo-smoke');
  await host.evaluate(()=>__kitchen.seats.sitOn('sofa'));await host.waitForTimeout(1000);
  const before=await host.evaluate(()=>__kitchen.camera.quaternion.toArray());
  await host.mouse.move(620,350);await host.mouse.down({button:'right'});await host.mouse.move(690,330,{steps:8});await host.mouse.up({button:'right'});await host.waitForTimeout(250);
  const after=await host.evaluate(()=>({q:__kitchen.camera.quaternion.toArray(),held:__kitchen.party.held?.id,seated:__kitchen.seats.active}));
  check('right mouse looks around while seated carrying vape',after.held==='vape-island'&&after.seated&&Math.hypot(...after.q.map((n,i)=>n-before[i]))>.02,after);
  await host.keyboard.press('q');await host.evaluate(()=>__kitchen.seats.stand({toWalk:true}));await host.waitForTimeout(1000);
  await host.locator('#kmp-launch').click();await host.locator('#kmp-name').fill('Party release host');await host.locator('.kmp-form button[type=submit]').click();await connected(host);
  await host.waitForFunction(()=>__kitchen.walk.walking&&!__kitchen.multiplayer.applying);
  await host.keyboard.down('w');await host.waitForTimeout(1770);await host.keyboard.up('w');await host.waitForTimeout(300);
  await aim(host,[2.10,1,1.74]);await host.keyboard.press('e');await host.waitForTimeout(750);
  check('host takes vape through room authority',await host.evaluate(()=>__kitchen.party.held?.id==='vape-island'));
  const guest=await page(await host.evaluate(()=>__kitchen.multiplayer.client.inviteUrl));
  await guest.locator('#kmp-name').fill('Party release guest');await guest.locator('.kmp-form button[type=submit]').click();await connected(guest);await guest.waitForTimeout(600);
  const ids=await Promise.all([host,guest].map(p=>p.evaluate(()=>__kitchen.party.debug.state.items.find(i=>i.kind==='vape').owner)));
  check('late WebRTC guest receives existing ownership',ids[0]&&ids[0]===ids[1],ids);
  await host.mouse.click(650,400);await host.waitForTimeout(1100);
  const smoke=await Promise.all([host,guest].map(p=>p.evaluate(()=>__kitchen.party.debug.effects.smoke)));
  check('one authoritative puff renders on both clients',smoke.every(n=>n>0&&n<=180),smoke);
  const grip=await guest.evaluate(()=>{const root=__kitchen.scene.getObjectByName('party_remote_props'),prop=root.children.find(o=>o.visible),avatar=__kitchen.scene.children.find(o=>o.userData.networkAvatar),wrist=avatar?.getObjectByName('right_wrist');return prop&&wrist?prop.position.distanceTo(wrist.getWorldPosition(prop.position.clone())):null;});
  check('observer item follows animated wrist socket',grip!==null&&grip<.17,grip);await screenshot(guest,'guest-smoke');
  await guest.context().close();await host.context().close();
  const mobile=await page(url,true);await mobile.waitForFunction(()=>__kitchen.walk.walking);
  await mobile.evaluate(()=>__kitchen.walk.enter({x:1.2,z:1.74},Math.PI*1.5));await mobile.waitForTimeout(1000);
  await mobile.evaluate(()=>__kitchen.party.command('take','vape-island'));await mobile.waitForTimeout(750);
  const rects=await mobile.locator('.party-touch:visible').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {name:e.textContent,x:r.x,y:r.y,w:r.width,h:r.height};}));
  const overlap=rects.some((a,i)=>rects.some((b,j)=>i<j&&a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y));
  const jump=await mobile.locator('.kw-jump').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};});
  const jumpOverlap=rects.some(a=>a.x<jump.x+jump.w&&a.x+a.w>jump.x&&a.y<jump.y+jump.h&&a.y+a.h>jump.y);
  check('mobile actions are visible and clear of jump and each other',rects.length>=2&&!overlap&&!jumpOverlap&&rects.every(r=>r.x>=0&&r.x+r.w<=391),{rects,jump});
  await mobile.getByRole('button',{name:'Затяжка',exact:true}).tap();await mobile.waitForTimeout(1000);
  check('native mobile tap emits smoke',await mobile.evaluate(()=>__kitchen.party.debug.effects.smoke>0));await screenshot(mobile,'mobile-smoke');
  check('no application errors',report.errors.length===0,report.errors);
}catch(error){
  report.failure=error.message;process.exitCode=1;report.failureState=[];
  for(const c of contexts)for(const p of c.pages())if(!p.isClosed()){
    const state=await p.evaluate(()=>({origin:location.origin,status:window.__kitchen?.multiplayer?.client?.status,
      role:window.__kitchen?.multiplayer?.client?.role,lobby:document.querySelector('#kmp-lobby')?.innerText,
      players:window.__kitchen?.multiplayer?.client?.state?.players?.length})).catch(()=>null);
    report.failureState.push(state);await screenshot(p,'failure-'+report.failureState.length).catch(()=>{});
  }
}
finally{clearTimeout(watchdog);for(const c of contexts)await c.close().catch(()=>{});await browser?.close();report.cleanup=true;fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({complete:!report.failure,failure:report.failure,cleanup:true}));}
