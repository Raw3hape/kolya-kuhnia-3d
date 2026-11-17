// Bounded real WebGL/WebRTC acceptance. Only solo fixture placement teleports.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {awaitPlayable} from './await-playable.mjs';
const moduleName=process.env.PLAYWRIGHT_MODULE||'playwright';
const {chromium}=await import(path.isAbsolute(moduleName)?pathToFileURL(moduleName).href:moduleName);
const url=process.env.QA_URL||'http://127.0.0.1:8765/';
const output=path.resolve(process.env.QA_OUTPUT||'output/playwright/interactive');fs.mkdirSync(output,{recursive:true});
const report={url,checks:[],errors:[],cleanup:false},contexts=[];let browser;
const watchdog=setTimeout(()=>browser?.close().finally(()=>process.exit(2)),900000);
function check(name,pass,details){report.checks.push({name,pass,details});console.log(JSON.stringify({name,pass}));if(!pass)throw Error(name+': '+JSON.stringify(details));}
async function page(target=url,mobile=false){
 const c=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});contexts.push(c);
 await c.addInitScript(()=>{localStorage.setItem('kitchen-ui-v1',JSON.stringify({quality:'eco',seen:{intro:true}}));localStorage.setItem('kitchen-life-v1',JSON.stringify({life:false,sound:'off',mute:true}));});
 if(process.env.QA_ACCESS_URL_FILE){const access=fs.readFileSync(process.env.QA_ACCESS_URL_FILE,'utf8').trim();await c.request.get(access,{timeout:30000});}
 const p=await c.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>{report.errors.push(e.message);console.log('PAGEERROR '+e.message)});
 await p.goto(target,{waitUntil:'domcontentloaded'});await awaitPlayable(p);await p.waitForFunction(()=>__kitchen.rc?.config&&__kitchen.party?.debug.ready);await p.getByRole('button',{name:'Понятно',exact:true}).click({timeout:500}).catch(()=>{});
 return p;
}
async function screenshot(p,name){await p.screenshot({path:path.join(output,name+'.png')});}
async function aim(p,target){
 for(let j=0;j<14;j++){const s=await p.evaluate(()=>({...__kitchen.walk.getNetworkPose(),eye:__kitchen.camera.position.y})),dx=target[0]-s.x,dz=target[2]-s.z;
 const yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(target[1]-s.eye,Math.hypot(dx,dz));const angle=Math.atan2(Math.sin(s.yaw-yaw),Math.cos(s.yaw-yaw));
 const mx=Math.max(-210,Math.min(210,angle/.0042)),my=Math.max(-140,Math.min(140,(s.pitch-pitch)/.0042));if(Math.abs(mx)<.6&&Math.abs(my)<.6)break;
 await p.mouse.move(620,350);await p.mouse.down({button:'right'});await p.mouse.move(620+mx,350+my,{steps:5});await p.mouse.up({button:'right'});await p.waitForTimeout(70);}
 await p.waitForTimeout(250);
}
async function idle(p){await p.waitForFunction(()=>{const h=__kitchen.party.held;return h&&(!h.action||__kitchen.party.debug.state.time-h.action.at>=h.action.duration)});}
async function connected(p){await p.waitForFunction(()=>__kitchen.multiplayer.client.connected,null,{timeout:60000});await p.evaluate(()=>__kitchen.multiplayer.lobby.close());}
async function walkTo(p,x,z){
 const deadline=Date.now()+18000;while(Date.now()<deadline){const s=await p.evaluate(()=>__kitchen.walk.getNetworkPose()),d=Math.hypot(s.x-x,s.z-z);if(d<.16)return;await aim(p,[x,1.6794,z]);await p.keyboard.down('w');await p.waitForTimeout(Math.max(60,Math.min(260,d/3*1000)));await p.keyboard.up('w');await p.waitForTimeout(50)}throw Error('walk route blocked '+x+','+z);
}
async function walkRoute(p,x,z){
  // Plan from the real collider snapshot; never teleport a network player.
  const route=await p.evaluate(async({x,z})=>{
    const {isFree,roomOf,WALK}=await import('/js/multiplayer/collision.js');
    const plan=await fetch('/spec/plan.generated.json').then(r=>r.json()),col=__kitchen.walk.collisionSnapshot(),start=__kitchen.walk.getNetworkPose(),step=.15;
    const point=(i,j)=>({x:start.x+i*step,z:start.z+j*step}),key=(i,j)=>`${i},${j}`;
    const others=(__kitchen.multiplayer.client.state?.players||[]).filter(p=>p.id!==__kitchen.multiplayer.client.id).map(p=>({x:p.x,z:p.z,radius:WALK.radius}));
    const free=q=>roomOf(plan,q.x,q.z)&&isFree(q,col,others,WALK.radius+.04);
    const open=[{i:0,j:0,g:0,f:Math.hypot(x-start.x,z-start.z)}],cost=new Map([['0,0',0]]),parents=new Map();let last;
    for(let visit=0;open.length&&visit<7000;visit++){
      open.sort((a,b)=>b.f-a.f);const n=open.pop(),q=point(n.i,n.j),k=key(n.i,n.j);if(n.g>cost.get(k))continue;
      if(Math.hypot(q.x-x,q.z-z)<.16){last=k;break;}
      for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){const i=n.i+di,j=n.j+dj,t=point(i,j),nk=key(i,j),g=n.g+step;if(!free(t)||g>=(cost.get(nk)??Infinity))continue;cost.set(nk,g);parents.set(nk,k);open.push({i,j,g,f:g+Math.hypot(t.x-x,t.z-z)});}
    }
    if(!last)throw Error('no collision-free route '+JSON.stringify({start,x,z,goalFree:free({x,z}),others,visited:cost.size}));
    const path=[];while(last!=='0,0'){const [i,j]=last.split(',').map(Number);path.unshift(point(i,j));last=parents.get(last);}path.unshift({x:start.x,z:start.z});
    const clear=(a,b)=>{const n=Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/.05);for(let j=1;j<=n;j++)if(!free({x:a.x+(b.x-a.x)*j/n,z:a.z+(b.z-a.z)*j/n}))return false;return true;};
    const out=[];for(let i=0;i<path.length-1;){let j=path.length-1;while(j>i+1&&!clear(path[i],path[j]))j--;out.push(path[j]);i=j;}return out;
  },{x,z});
  for(const q of route)await walkTo(p,q.x,q.z);
}
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
 const solo=await page();await solo.evaluate(()=>{if(document.querySelector('#panel.open'))document.querySelector('.hide-btn')?.click()});
 const energy=await solo.evaluate(()=>__kitchen.party.spec.items.find(i=>i.kind==='energy'&&i.position[1]>.3&&i.position[1]<.5&&i.position[0]>.4).id);
 if(process.env.QA_RC_ONLY!=='1'&&process.env.QA_ROOM_ONLY!=='1'){
 await solo.evaluate(()=>{__kitchen.viewmodel.setWeapon('none');__kitchen.walk.enter({x:1.55,z:2.48},Math.PI/2)});await solo.waitForTimeout(1100);
 await aim(solo,await solo.evaluate(()=>__kitchen.party.interactionPoint('fridge')));await screenshot(solo,'fridge-closed');
 await solo.waitForFunction(()=>__kitchen.party.target?.id==='fridge');await solo.keyboard.press('e');await solo.waitForFunction(()=>__kitchen.party.debug.state.fridgeOpen);await solo.waitForTimeout(800);await screenshot(solo,'fridge-stocked');

 await aim(solo,await solo.evaluate(id=>__kitchen.party.interactionPoint(id),energy));await solo.waitForFunction(()=>__kitchen.party.target?.kind==='energy');await solo.keyboard.press('e');await solo.waitForFunction(()=>__kitchen.party.held?.kind==='energy');await idle(solo);await screenshot(solo,'energy-held');
 await solo.mouse.click(640,400);await solo.waitForFunction(()=>__kitchen.party.held?.sips===1);await idle(solo);
 check('solo fridge opens and native pickup/sip activates camera effect',await solo.evaluate(()=>__kitchen.party.held.sips===1&&!document.querySelector('.party-energy-effect').hidden));
 const seat=await solo.evaluate(()=>__kitchen.seats.networkSeats().find(s=>s.id.startsWith('sofa')));
 await solo.evaluate(s=>__kitchen.walk.enter({x:s.stand[0],z:s.stand[1]},0),seat);await solo.waitForTimeout(1100);await solo.evaluate(id=>__kitchen.seats.sitOn(id),seat.id);await solo.waitForFunction(()=>__kitchen.seats.active);await solo.waitForTimeout(700);
 await solo.mouse.click(640,400);await solo.waitForFunction(()=>__kitchen.party.held?.sips===2);await idle(solo);await screenshot(solo,'energy-seated');
 check('energy can be drunk while seated and stays in hand',await solo.evaluate(()=>__kitchen.seats.active&&__kitchen.party.held?.sips===2));
 for(let i=3;i<=5;i++){await solo.mouse.click(640,400);await solo.waitForFunction(sips=>__kitchen.party.held?.sips===sips,i);await idle(solo)}
 await solo.keyboard.press('c');await solo.waitForFunction(()=>__kitchen.party.held?.crushed);await idle(solo);await solo.keyboard.press('q');await solo.waitForFunction(()=>!__kitchen.party.held);await solo.waitForTimeout(2300);
 check('five sips, crush, throw leave physical bottle litter',await solo.evaluate(()=>__kitchen.party.debug.state.items.some(i=>i.kind==='energy'&&i.crushed&&i.status==='resting')));
 await solo.evaluate(()=>__kitchen.seats.stand({toWalk:true}));await solo.waitForTimeout(900);
 }
 const control=await solo.evaluate(()=>__kitchen.rc.controllers[2]);
 if(process.env.QA_ROOM_ONLY!=='1'){
 await solo.evaluate(()=>{__kitchen.doors.setOpen('room3_balcony_door',true,{instant:true});__kitchen.walk.enter({x:-1.37,z:-.9},0)});await solo.waitForTimeout(1100);
 await aim(solo,control.position);await solo.waitForFunction(()=>!!__kitchen.rc.target);await screenshot(solo,'rc-table');await solo.keyboard.press('e');await solo.waitForFunction(()=>__kitchen.rc.controlling);await solo.waitForTimeout(800);
 const before=await solo.evaluate(()=>({body:__kitchen.walk.getNetworkPose(),car:__kitchen.rc.held.position}));await solo.keyboard.down('w');await solo.waitForTimeout(1400);await solo.keyboard.down('a');await solo.waitForTimeout(600);await solo.keyboard.up('a');await solo.keyboard.up('w');await solo.keyboard.down('Space');await solo.waitForTimeout(300);await solo.keyboard.up('Space');
 const after=await solo.evaluate(()=>({body:__kitchen.walk.getNetworkPose(),car:__kitchen.rc.held.position,speed:__kitchen.rc.held.speed}));
 check('native RC gas, turn and brake move car and freeze avatar',Math.hypot(...after.car.map((v,i)=>v-before.car[i]))>1&&Math.hypot(after.body.x-before.body.x,after.body.z-before.body.z)<.001,{before,after});
 const cameraBefore=await solo.evaluate(()=>({camera:__kitchen.rc.viewCamera.position.toArray(),quaternion:__kitchen.rc.viewCamera.quaternion.toArray(),body:__kitchen.walk.getNetworkPose()}));
 await solo.keyboard.down('w');await solo.mouse.move(730,450);await solo.mouse.down();await solo.mouse.move(980,390,{steps:14});await solo.mouse.up();await solo.keyboard.up('w');await solo.waitForTimeout(400);
 const cameraAfter=await solo.evaluate(()=>({camera:__kitchen.rc.viewCamera.position.toArray(),quaternion:__kitchen.rc.viewCamera.quaternion.toArray(),body:__kitchen.walk.getNetworkPose(),car:__kitchen.rc.held.position}));
 check('touchpad-style primary drag turns balcony head while keyboard drives without moving camera or avatar',Math.hypot(...cameraAfter.quaternion.map((v,i)=>v-cameraBefore.quaternion[i]))>.02&&Math.hypot(...cameraAfter.camera.map((v,i)=>v-cameraBefore.camera[i]))<.01&&Math.hypot(cameraAfter.body.x-cameraBefore.body.x,cameraAfter.body.z-cameraBefore.body.z)<.001);
 const fovBefore=await solo.evaluate(()=>__kitchen.camera.fov);
 await solo.mouse.move(700,450);await solo.mouse.wheel(0,-140);await solo.waitForTimeout(600);
 check('trackpad wheel optically zooms from the balcony and keyboard C locates the car',await solo.evaluate(before=>__kitchen.camera.fov<before&&__kitchen.camera.fov>8,fovBefore));
 await solo.keyboard.press('c');await solo.waitForTimeout(800);await screenshot(solo,'rc-driving');
 await solo.getByRole('button',{name:'Положить пульт и закончить управление машинкой',exact:true}).click();await solo.waitForFunction(()=>!__kitchen.rc.controlling);check('clear exit returns camera and player to balcony',await solo.evaluate(()=>!document.body.classList.contains('rc-controlling')&&__kitchen.camera.position.y>1));
 }
 if(process.env.QA_ROOM_ONLY!=='1'){
  await solo.waitForFunction(()=>__kitchen.social.debug.state.pizza?.location==='courier',null,{timeout:55000});
  await solo.evaluate(()=>{__kitchen.doors.setOpen('entry_door',true,{instant:true});__kitchen.walk.enter({x:-2.03,z:5.25},Math.PI)});await solo.waitForTimeout(1100);
  await solo.waitForFunction(()=>__kitchen.social.debug.state.courier?.phase==='offering');await aim(solo,await solo.evaluate(()=>__kitchen.social.debug.state.pizza.position));await solo.keyboard.press('e');await solo.waitForFunction(()=>__kitchen.social.held);await solo.waitForTimeout(1000);
  await solo.evaluate(()=>__kitchen.walk.enter({x:-1.37,z:-.9},0));await solo.waitForTimeout(1000);await aim(solo,control.position);await solo.keyboard.press('e');await solo.waitForFunction(()=>__kitchen.rc.controlling);
  check('solo pizza-to-controller pickup releases the old family without duplicate hands',await solo.evaluate(()=>!__kitchen.social.held&&!__kitchen.party.held&&!__kitchen.tv.status.held&&!__kitchen.paper.held&&__kitchen.rc.controlling));
  await solo.keyboard.press('Escape');await solo.waitForFunction(()=>!__kitchen.rc.controlling);
 }
 if(process.env.QA_SOLO_ONLY!=='1'){
  await solo.locator('#kmp-launch').click();await solo.locator('#kmp-name').fill('Тест хозяин');await solo.locator('.kmp-form button[type=submit]').click();await connected(solo);
  await solo.waitForFunction(()=>__kitchen.walk.walking&&!__kitchen.multiplayer.applying);
  await walkRoute(solo,1.35,2.3);await aim(solo,await solo.evaluate(()=>__kitchen.party.interactionPoint('fridge')));await solo.keyboard.press('e');await solo.waitForFunction(()=>__kitchen.party.debug.state.fridgeOpen);await solo.waitForTimeout(600);
  await aim(solo,await solo.evaluate(id=>__kitchen.party.interactionPoint(id),energy));await solo.keyboard.press('e');await solo.waitForFunction(()=>__kitchen.party.held?.kind==='energy');await idle(solo);
  const guest=await page(await solo.evaluate(()=>__kitchen.multiplayer.client.inviteUrl));await guest.locator('#kmp-name').fill('Тест друг');await guest.locator('.kmp-form button[type=submit]').click();await connected(guest);
  await Promise.all([solo,guest].map(async p=>{await p.waitForFunction(()=>!__kitchen.multiplayer.applying&&__kitchen.walk.walking);await p.evaluate(()=>{if(document.querySelector('#panel.open'))document.querySelector('.hide-btn')?.click()})}));
  check('two independent rendered clients connect via real WebRTC',await guest.evaluate(()=>__kitchen.multiplayer.client.state.players.length===2));
  await walkRoute(guest,2.02,2.7);await solo.waitForTimeout(300);await solo.keyboard.press('h');await guest.waitForFunction(()=>__kitchen.party.held?.kind==='energy');
  check('generic native handoff replicates energy ownership and renders remotely',await solo.evaluate(()=>!__kitchen.party.held&&__kitchen.multiplayer.client.state.players.find(p=>p.id!==__kitchen.multiplayer.client.id)?.held?.startsWith('energy')));await idle(guest);await screenshot(guest,'room-energy-received');
  await guest.mouse.click(640,400);await guest.waitForFunction(()=>__kitchen.party.held?.sips===1);await idle(guest);await solo.waitForFunction(()=>__kitchen.party.debug.state.items.find(i=>i.owner&&i.kind==='energy')?.sips===1);
  await guest.keyboard.press('q');await guest.waitForFunction(()=>!__kitchen.party.held);await solo.waitForTimeout(2500);
  await walkRoute(guest,3.5,3.0);await walkRoute(solo,1.2,1.65);await aim(solo,await solo.evaluate(()=>__kitchen.tv.networkPosition()));await solo.keyboard.press('e');await solo.waitForFunction(()=>__kitchen.tv.status.held);await walkRoute(solo,2.9,3.0);await solo.keyboard.press('h');await guest.waitForFunction(()=>__kitchen.tv.status.held);check('same generic handoff transfers the real interactive phone',true);await guest.keyboard.press('q');await guest.waitForFunction(()=>!__kitchen.tv.status.held);
  await walkRoute(guest,3.5,3.0);
  await walkRoute(solo,4.8,.9);await aim(solo,[5.02,1.1,0]);await solo.evaluate(()=>__kitchen.doors.setOpen('kitchen_balcony_door',true));await solo.waitForTimeout(1000);await walkRoute(solo,4.9,-1.18);await walkRoute(solo,-1.32,-.92);
  await aim(solo,control.position);await solo.waitForFunction(()=>!!__kitchen.rc.target);await solo.keyboard.press('e');await solo.waitForFunction(()=>__kitchen.rc.controlling);await guest.waitForFunction(()=>__kitchen.rc.snapshot().cars.some(c=>c.owner));
  const roomCar=await solo.evaluate(()=>({id:__kitchen.rc.held.id,position:__kitchen.rc.held.position}));await solo.keyboard.down('w');await solo.waitForTimeout(1500);await solo.keyboard.up('w');await solo.waitForTimeout(300);
  check('network RC predictions reconcile and guest sees moving car',await guest.evaluate(({id,position})=>{const c=__kitchen.rc.snapshot().cars.find(c=>c.id===id);return c&&Math.hypot(...c.position.map((v,i)=>v-position[i]))>1},roomCar));await screenshot(solo,'room-rc-driving');
  await solo.keyboard.press('Escape');await solo.waitForFunction(()=>!__kitchen.rc.controlling);await guest.waitForFunction(()=>!__kitchen.rc.snapshot().cars.some(c=>c.owner));
  await guest.evaluate(()=>__kitchen.multiplayer.client.leave());await solo.evaluate(()=>__kitchen.multiplayer.client.leave());await guest.context().close();
 }
 await solo.context().close();
 const mobile=await page(url,true);await mobile.evaluate(()=>{__kitchen.viewmodel.setWeapon('none');__kitchen.doors.setOpen('room3_balcony_door',true,{instant:true});__kitchen.walk.enter({x:-1.37,z:-.9},0)});await mobile.waitForTimeout(1100);await mobile.evaluate(()=>__kitchen.rc.command('take','rc-0'));await mobile.waitForFunction(()=>__kitchen.rc.controlling);await mobile.waitForTimeout(700);
 const gas=mobile.getByRole('button',{name:'Ехать вперёд',exact:true});const box=await gas.boundingBox();await mobile.mouse.move(box.x+box.width/2,box.y+box.height/2);await mobile.mouse.down();await mobile.waitForTimeout(900);await mobile.mouse.up();const mobileBefore=await mobile.evaluate(()=>({position:__kitchen.camera.position.toArray(),quaternion:__kitchen.camera.quaternion.toArray()}));
 const touchSession=await mobile.context().newCDPSession(mobile);const gx=box.x+box.width/2,gy=box.y+box.height/2;
 await touchSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:gx,y:gy,id:1},{x:180,y:350,id:2}]});
 await touchSession.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:gx,y:gy,id:1},{x:275,y:390,id:2}]});await mobile.waitForTimeout(650);
 await touchSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await mobile.waitForTimeout(250);
 check('mobile gas and balcony head-look respond independently without moving the camera position',await mobile.evaluate(before=>Math.hypot(...__kitchen.camera.quaternion.toArray().map((v,i)=>v-before.quaternion[i]))>.01&&Math.hypot(...__kitchen.camera.position.toArray().map((v,i)=>v-before.position[i]))<.01,mobileBefore));
 await screenshot(mobile,'mobile-rc');
 check('mobile has visible touch gas and clear exit without overflow',await mobile.evaluate(()=>{const r=document.querySelector('.rc-exit').getBoundingClientRect();return r.width>=100&&r.left>=0&&r.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth}));
 check('mobile own-car marker remains below the RC controls',await mobile.evaluate(()=>{const m=document.querySelector('.rc-driver-marker'),h=document.querySelector('.rc-hud');return !m.hidden&&m.getBoundingClientRect().top>=h.getBoundingClientRect().bottom+2}));
 await mobile.getByRole('button',{name:'Положить пульт и закончить управление машинкой',exact:true}).click();await mobile.waitForFunction(()=>!__kitchen.rc.controlling);
 check('browser has no uncaught errors',report.errors.length===0,report.errors);
}catch(error){report.failure=error.stack;console.error(error.stack);process.exitCode=1;for(const c of contexts)for(const p of c.pages())await screenshot(p,'failure-'+contexts.indexOf(c)).catch(()=>{});}
finally{for(const c of contexts)await c.close().catch(()=>{});await browser?.close();clearTimeout(watchdog);report.cleanup=true;fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,pass:!report.failure&&report.checks.every(c=>c.pass),failure:report.failure,cleanup:report.cleanup}));}
