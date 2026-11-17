// Independent two-browser WebRTC witness. No player teleport or forced camera pose.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { awaitPlayable } from './await-playable.mjs';
const moduleName=process.env.PLAYWRIGHT_MODULE||'playwright';
const {chromium}=await import(path.isAbsolute(moduleName)?pathToFileURL(moduleName).href:moduleName);
const url=process.env.QA_URL||'http://127.0.0.1:8765/';
const output=path.resolve(process.env.QA_OUTPUT||'output/playwright/rc-network-correction-independent');fs.mkdirSync(output,{recursive:true});
const report={url,nodePid:process.pid,mode:'two rendered browsers / real WebRTC / native movement and controls',checks:[],errors:[],cleanup:false};
const contexts=[];let browser,host,guest;
const watchdog=setTimeout(()=>browser?.close().finally(()=>process.exit(2)),600000);
function check(name,pass,details){report.checks.push({name,pass,details});console.log(JSON.stringify({name,pass}));if(!pass)throw Error(name+': '+JSON.stringify(details));}
async function page(target=url){
 const c=await browser.newContext({viewport:{width:1360,height:850},deviceScaleFactor:1});contexts.push(c);
 await c.addInitScript(()=>{localStorage.setItem('kitchen-ui-v1',JSON.stringify({quality:'eco',seen:{intro:true}}));localStorage.setItem('kitchen-life-v1',JSON.stringify({life:false,sound:'off',mute:true}));});
 await c.addInitScript(()=>{window.__networkRCKeyEvents=[];window.addEventListener('keydown',e=>{if(e.code==='KeyH')window.__networkRCKeyEvents.push({code:e.code,key:e.key,tag:e.target?.tagName,editable:!!e.target?.isContentEditable});},true);});
 if(process.env.QA_ACCESS_URL_FILE)await c.request.get(fs.readFileSync(process.env.QA_ACCESS_URL_FILE,'utf8').trim());
 const p=await c.newPage();p.setDefaultTimeout(16000);p.on('pageerror',e=>report.errors.push(e.message));
 await p.goto(target,{waitUntil:'domcontentloaded'});await awaitPlayable(p);await p.waitForFunction(()=>__kitchen.rc?.config&&__kitchen.party?.debug.ready);
 await p.getByRole('button',{name:'Понятно',exact:true}).click({timeout:500}).catch(()=>{});return p;
}
async function screenshot(p,name){await p.screenshot({path:path.join(output,name+'.png')});}
async function aim(p,target){
 for(let j=0;j<14;j++){const s=await p.evaluate(()=>({...__kitchen.walk.getNetworkPose(),eye:__kitchen.camera.position.y})),dx=target[0]-s.x,dz=target[2]-s.z;
 const yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(target[1]-s.eye,Math.hypot(dx,dz));const angle=Math.atan2(Math.sin(s.yaw-yaw),Math.cos(s.yaw-yaw));
 const mx=Math.max(-210,Math.min(210,angle/.0042)),my=Math.max(-140,Math.min(140,(s.pitch-pitch)/.0042));if(Math.abs(mx)<.6&&Math.abs(my)<.6)break;
 await p.mouse.move(620,350);await p.mouse.down({button:'right'});await p.mouse.move(620+mx,350+my,{steps:5});await p.mouse.up({button:'right'});await p.waitForTimeout(70);}
 await p.waitForTimeout(250);
}
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
    // Authority spawns bodies 45 cm apart. A 4 cm artificial planner inflation
    // makes every adjacent 15 cm grid cell falsely impassable at that spawn.
    const free=q=>roomOf(plan,q.x,q.z)&&isFree(q,col,others,WALK.radius+.004);
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
async function installRecorder(p){
 await p.evaluate(()=>{
  const api=__kitchen,original=api.renderer.render;window.__networkRCOriginalRender=original;window.__networkRCEyes=[];
  const request=api.multiplayer.client.request;window.__networkRCOriginalRequest=request;window.__networkRCHandoffs=[];
  api.multiplayer.client.request=function(action,...rest){const result=request.call(this,action,...rest);if(action.kind==='handoff')Promise.resolve(result).then(value=>window.__networkRCHandoffs.push({action,result:value}),error=>window.__networkRCHandoffs.push({action,error:error.message}));return result;};
  api.renderer.render=function(scene,camera,...rest){
   // Mirrors render the same scene into offscreen targets; they are not the
   // actual viewport and must not hide a wrong field camera in the final frame.
   if(scene===api.scene&&this.getRenderTarget()===null&&api.rc.controlling){window.__networkRCEyes.push(camera.position.toArray());if(window.__networkRCEyes.length>60)window.__networkRCEyes.shift();}
   return original.call(this,scene,camera,...rest);
  };
 });
}
async function witness(p){return p.evaluate(()=>{
 const api=__kitchen,s=api.multiplayer.client.state,self=s.players.find(p=>p.id===api.multiplayer.client.id);
 const other=s.players.find(p=>p.id!==self.id),avatar=api.scene.children.find(o=>o.userData.networkAvatar),head=avatar?.getObjectByName('avatar_head');
 return{id:self.id,self:{x:self.x,y:self.y,z:self.z,lookYaw:self.lookYaw,pitch:self.pitch,held:self.held},other:other?{id:other.id,x:other.x,y:other.y,z:other.z,lookYaw:other.lookYaw,pitch:other.pitch,held:other.held}:null,
  body:api.walk.getNetworkPose(),camera:api.camera.position.toArray(),quaternion:api.camera.quaternion.toArray(),renderEyes:window.__networkRCEyes||[],
  headQuaternion:head?.quaternion.toArray(),avatarVisible:!!avatar?.visible,headVisible:!!head?.visible,rc:api.rc.snapshot(),controlling:api.rc.controlling};
});}
const anchored=(state,anchor)=>state.renderEyes.length>0&&state.renderEyes.every(c=>Math.hypot(...c.map((v,i)=>v-anchor.camera[i]))<.06)&&Math.hypot(state.self.x-anchor.self.x,state.self.y-anchor.self.y,state.self.z-anchor.self.z)<.002;
async function carVisible(p,id){return p.evaluate(async id=>{
 const T=await import('three'),view=__kitchen.scene.getObjectByName('rc_car_'+id),camera=__kitchen.camera;
 if(!view||!view.visible)return{visible:false};view.updateWorldMatrix(true,true);
 const box=new T.Box3().setFromObject(view),center=box.getCenter(new T.Vector3()).project(camera),min=new T.Vector2(Infinity,Infinity),max=new T.Vector2(-Infinity,-Infinity);
 for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z]){const v=new T.Vector3(x,y,z).project(camera);min.min(v);max.max(v);}
 return{visible:Math.abs(center.x)<1&&Math.abs(center.y)<1&&center.z>-1&&center.z<1,width:(max.x-min.x)*innerWidth/2,height:(max.y-min.y)*innerHeight/2,center:center.toArray()};
},id);}
try{
 console.log(JSON.stringify({resource:'independent network QA browser',nodePid:process.pid,project:process.cwd(),ends:'finally browser.close or 600s watchdog'}));
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
 host=await page();await host.locator('#kmp-launch').click();await host.locator('#kmp-name').fill('RC независимый хозяин');await host.locator('.kmp-form button[type=submit]').click();await connected(host);
 await host.waitForFunction(()=>__kitchen.walk.walking&&!__kitchen.multiplayer.applying);await host.evaluate(()=>{if(document.querySelector('#panel.open'))document.querySelector('.hide-btn')?.click()});
 const invite=await host.evaluate(()=>__kitchen.multiplayer.client.inviteUrl);guest=await page(invite);await guest.locator('#kmp-name').fill('RC независимый друг');await guest.locator('.kmp-form button[type=submit]').click();await connected(guest);
 await guest.waitForFunction(()=>__kitchen.walk.walking&&!__kitchen.multiplayer.applying);await guest.evaluate(()=>{if(document.querySelector('#panel.open'))document.querySelector('.hide-btn')?.click()});
 check('two independent rendered clients join through real WebRTC',await guest.evaluate(()=>__kitchen.multiplayer.client.state.players.length===2));
 // Walk through the actual apartment and the validated open balcony door.
 await walkRoute(host,4.8,.9);await aim(host,[5.02,1.1,0]);await host.evaluate(()=>__kitchen.doors.setOpen('kitchen_balcony_door',true));await host.waitForTimeout(1000);
 await walkRoute(host,4.9,-1.18);await walkRoute(host,-1.32,-.92);
 await walkRoute(guest,4.8,.9);await walkRoute(guest,4.9,-1.18);await walkRoute(guest,-.54,-.92);
 await Promise.all([installRecorder(host),installRecorder(guest)]);
 const control=await host.evaluate(()=>__kitchen.rc.controllers[0]);await aim(host,control.position);await host.waitForFunction(()=>!!__kitchen.rc.target);
 const hostAnchor=await witness(host),hostId=hostAnchor.id;await host.keyboard.press('e');await host.waitForFunction(()=>__kitchen.rc.controlling);await guest.waitForFunction(()=>__kitchen.rc.snapshot().cars.some(c=>c.owner));await host.waitForTimeout(600);
 const initial=await witness(host),carId=initial.rc.cars.find(c=>c.owner===hostId).id;
 report.handoffProbe=await host.evaluate(async()=>{
  const api=__kitchen,meta=await api.multiplayer.roomState(),{rayBox,sanitizeObjects}=await import('/js/multiplayer/authority.js'),{NETWORK_RULES:R}=await import('/js/multiplayer/rules.js'),{buildColliders}=await import('/js/multiplayer/collision.js');
  const state=api.multiplayer.client.state,p=api.multiplayer.client.self,t=state.players.find(q=>q.id!==p.id),eye=q=>q.eyeY??q.y+1.6794,origin=[p.x,eye(p)-R.handoffEyeOffset,p.z],delta=[t.x-p.x,eye(t)-eye(p),t.z-p.z],length=Math.hypot(...delta),direction=delta.map(n=>n/length),objects=sanitizeObjects(meta.objects),range=length-.01;
  const represented=box=>objects.some(o=>o.bounds[0]>=box.x0-R.collisionGeometryMargin&&o.bounds[3]<=box.x1+R.collisionGeometryMargin&&o.bounds[2]>=box.z0-R.collisionGeometryMargin&&o.bounds[5]<=box.z1+R.collisionGeometryMargin);
  const objectHits=objects.filter(o=>!state.broken.includes(o.unitId)&&rayBox(origin,direction,o.bounds,range)).map(o=>({id:o.id,unitId:o.unitId,bounds:o.bounds}));
  const extraHits=(meta.collision.extra||meta.collision.boxes||[]).filter(b=>b.ax===undefined&&rayBox(origin,direction,[b.x0,0,b.z0,b.x1,3,b.z1],range)).map(b=>({box:b,represented:represented(b)}));
  const plan=await fetch('/spec/plan.generated.json').then(r=>r.json()),walls=buildColliders(plan).boxes.filter(b=>rayBox([p.x,1.2,p.z],direction,[b.x0,-10,b.z0,b.x1,10,b.z1],range));
  return{p:{id:p.id,x:p.x,z:p.z,held:p.held},target:{id:t.id,x:t.x,z:t.z,held:t.held},origin,direction,length,objectHits,extraHits,walls,rcOwner:api.rc.snapshot().cars.find(c=>c.id===p.held)?.owner};
 });console.log('HANDOFF_PROBE '+JSON.stringify(report.handoffProbe));
 check('host actual viewport camera remains original balcony eyes after pickup',anchored(initial,hostAnchor),{anchor:hostAnchor.camera,actual:initial.renderEyes,body:initial.self});
 // The observer first looks at the driver's real avatar, rather than only
 // accepting a changed network field as proof of head presentation.
 await aim(guest,[hostAnchor.self.x,1.55,hostAnchor.self.z]);await guest.waitForTimeout(300);const observerBefore=await witness(guest);
 const carStart=initial.rc.cars.find(c=>c.id===carId).position;
 await host.keyboard.down('w');await host.waitForTimeout(1200);await host.keyboard.down('d');await host.waitForTimeout(600);await host.keyboard.up('d');await host.keyboard.up('w');
 await host.mouse.move(620,350);await host.mouse.down({button:'right'});await host.mouse.move(710,385,{steps:9});await host.mouse.up({button:'right'});
 await guest.waitForFunction(before=>{const p=__kitchen.multiplayer.client.state.players.find(p=>p.id===before.id);return p&&Math.abs(p.pitch-before.pitch)>.03&&Math.abs(Math.atan2(Math.sin(p.lookYaw-before.lookYaw),Math.cos(p.lookYaw-before.lookYaw)))>.08},observerBefore.other);
 await guest.waitForTimeout(400);const hostMoved=await witness(host),observerAfter=await witness(guest);
 check('native throttle, steering and head look keep authoritative body and final render eyes on balcony',anchored(hostMoved,hostAnchor),{anchor:hostAnchor.self,body:hostMoved.self,eyes:hostMoved.renderEyes});
 check('remote avatar head pose changes with accepted driver look while body stays fixed',observerAfter.avatarVisible&&observerAfter.headVisible&&observerBefore.headQuaternion&&observerAfter.headQuaternion&&Math.hypot(...observerAfter.headQuaternion.map((v,i)=>v-observerBefore.headQuaternion[i]))>.015&&Math.hypot(observerAfter.other.x-hostAnchor.self.x,observerAfter.other.z-hostAnchor.self.z)<.002,{before:observerBefore.other,after:observerAfter.other,headBefore:observerBefore.headQuaternion,headAfter:observerAfter.headQuaternion});
 await screenshot(guest,'observer-driver-head');
 const observedCar=observerAfter.rc.cars.find(c=>c.id===carId);check('observer receives the same moving owned car',observedCar.owner===hostId&&Math.hypot(...observedCar.position.map((v,i)=>v-carStart[i]))>.5,{carStart,observedCar});
 await aim(guest,observedCar.position.map((v,i)=>v+(i===1?.3:0)));await host.keyboard.press('c');await host.waitForTimeout(500);
 const modelWitness=await carVisible(guest,carId);check('moving car is a projected visible 3D object in the observer viewport',modelWitness.visible&&modelWitness.width>6&&modelWitness.height>3,modelWitness);await screenshot(host,'host-balcony-driver');
 const guestAnchor=await witness(guest);await host.waitForTimeout(400);await host.bringToFront();await host.keyboard.press('h');
 await guest.waitForFunction(()=>__kitchen.rc.controlling);await host.waitForFunction(()=>!__kitchen.rc.controlling);await guest.waitForTimeout(600);
 const passed=await witness(guest);check('native handoff moves one controller and preserves receiver actual balcony viewpoint',passed.rc.cars.filter(c=>c.owner===passed.id).length===1&&passed.rc.cars.find(c=>c.id===carId)?.owner===passed.id&&anchored(passed,guestAnchor),{anchor:guestAnchor.self,receiver:passed.self,eyes:passed.renderEyes,owners:passed.rc.cars.map(c=>({id:c.id,owner:c.owner}))});
 const receivedPosition=passed.rc.cars.find(c=>c.id===carId).position;await guest.keyboard.down('w');await guest.waitForTimeout(900);await guest.keyboard.up('w');await guest.waitForTimeout(250);
 const guestDriven=await witness(guest);check('new driver controls the same car and never walks while holding controller',anchored(guestDriven,guestAnchor)&&Math.hypot(...guestDriven.rc.cars.find(c=>c.id===carId).position.map((v,i)=>v-receivedPosition[i]))>.25,{anchor:guestAnchor.self,driver:guestDriven.self});await screenshot(guest,'receiver-balcony-driver');
 await guest.keyboard.press('Escape');await guest.waitForFunction(()=>!__kitchen.rc.controlling);await host.waitForFunction(()=>!__kitchen.rc.snapshot().cars.some(c=>c.owner));
 check('native exit releases controller for both clients and removes driving HUD',await guest.evaluate(()=>!__kitchen.rc.controlling&&document.querySelector('.rc-hud').hidden&&!document.body.classList.contains('rc-controlling')));
 check('no uncaught browser errors',report.errors.length===0,report.errors);
}catch(error){report.failure=error.stack;process.exitCode=1;console.error(error.stack);report.failureState=await Promise.all([host,guest].filter(Boolean).map(p=>p.evaluate(()=>({self:__kitchen.multiplayer.client.self,keys:window.__networkRCKeyEvents,actions:window.__networkRCHandoffs,nearby:__kitchen.multiplayer.client.state.players.map(p=>({id:p.id,x:p.x,y:p.y,z:p.z,held:p.held,eyeY:p.eyeY,seat:p.seat})),handoffUI:document.querySelector('.kmp-handoff')?.textContent})).catch(()=>null)));for(const p of[host,guest].filter(Boolean))await screenshot(p,'failure-'+(p===host?'host':'guest')).catch(()=>{});}
finally{
 for(const p of[host,guest].filter(Boolean))await p.evaluate(()=>{if(window.__networkRCOriginalRender)__kitchen.renderer.render=window.__networkRCOriginalRender;if(window.__networkRCOriginalRequest)__kitchen.multiplayer.client.request=window.__networkRCOriginalRequest;__kitchen.multiplayer?.client?.leave();}).catch(()=>{});
 for(const c of contexts)await c.close().catch(()=>{});await browser?.close().catch(()=>{});clearTimeout(watchdog);report.cleanup=!browser?.isConnected();
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:report.checks.length,passed:report.checks.filter(c=>c.pass).length,cleanup:report.cleanup,report:path.join(output,'report.json'),failure:report.failure}));
}
