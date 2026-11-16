// Real phone CSS3D + YouTube + WebRTC regression. Existing Playwright only.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs QA_URL=https://... node tools/qa/phone-ui-qa.mjs
// Fixture movement uses the existing walkthrough in solo; E / arrows / Q and network pickup are native input.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const name=process.env.PLAYWRIGHT_MODULE||'playwright';
const {chromium}=await import(path.isAbsolute(name)?pathToFileURL(name).href:name);
const url=process.env.QA_URL||'http://127.0.0.1:8765/';
const output=path.resolve(process.env.QA_OUTPUT||'output/playwright/phone-release');fs.mkdirSync(output,{recursive:true});
const report={url,checks:[],errors:[],cleanup:false},contexts=[];let browser;
const timer=setTimeout(()=>{browser?.close().finally(()=>process.exit(2));},360000);
function save(){fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));}
function check(label,pass,details){report.checks.push({label,pass,details});save();console.log(JSON.stringify({label,pass}));if(!pass)throw Error(label);}
async function page(target=url,mobile=false){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},hasTouch:mobile,isMobile:mobile,deviceScaleFactor:1});contexts.push(context);
 await context.addInitScript(()=>localStorage.setItem('kitchen-ui-v1',JSON.stringify({quality:'eco',seen:{intro:true}})));
 const p=await context.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>report.errors.push(e.message));
 await p.goto(target,{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>window.__kitchen?.tv?.status.found.includes('phone')&&window.__kitchen?.hunt?.stats.ready,null,{timeout:90000});
 await p.getByRole('button',{name:'Понятно',exact:true}).click({timeout:500}).catch(()=>{});
 await p.locator('.hide-btn').click({timeout:500}).catch(()=>{});return p;
}
async function aim(p,target){
 for(let n=0;n<10;n++){
  const c=await p.evaluate(()=>{const k=__kitchen,s=k.walk.getNetworkPose();return {...s,eye:k.camera.position.y};});
  const dx=target[0]-c.x,dz=target[2]-c.z,yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(target[1]-c.eye,Math.hypot(dx,dz));
  const delta=Math.atan2(Math.sin(c.yaw-yaw),Math.cos(c.yaw-yaw));
  const mx=Math.max(-160,Math.min(160,delta/.0042)),my=Math.max(-140,Math.min(140,(c.pitch-pitch)/.0042));
  if(Math.abs(mx)<1&&Math.abs(my)<1)break;
  const v=p.viewportSize(),x=v.width/2,y=v.height/2;
  await p.mouse.move(x,y);await p.mouse.down({button:'right'});await p.mouse.move(x+mx,y+my,{steps:6});await p.mouse.up({button:'right'});await p.waitForTimeout(100);
 }
 await p.waitForTimeout(200);
}
async function surface(p){return p.evaluate(()=>{
 const l=document.querySelector('.tv-layer'),f=l?.querySelector('[draggable="false"]'),s=f?.firstElementChild,iframe=f?.querySelector('iframe');
 const r=f?.getBoundingClientRect(),ir=iframe?.getBoundingClientRect();
 return {status:__kitchen.tv.status,layer:l&&getComputedStyle(l).zIndex,visible:f&&getComputedStyle(f).visibility,display:f&&getComputedStyle(f).display,
  shell:s&&getComputedStyle(s).backgroundColor,rect:r?{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}:null,
  iframe:iframe?{opacity:getComputedStyle(iframe).opacity,w:ir.width,h:ir.height}:null,width:innerWidth,height:innerHeight};
});}
async function assertHeld(p,label){
 await p.waitForFunction(()=>{const s=__kitchen.tv.status,f=document.querySelector('.tv-layer [draggable="false"]'),r=f?.getBoundingClientRect();return s.held&&s.shown&&!s.hole.length&&r?.width>80&&r?.height>150&&!f.firstElementChild.getAnimations().some(a=>a.playState==='running');},null,{timeout:10000});
 const s=await surface(p),r=s.rect;
 check(label+' visible phone shell',s.status.held&&s.status.screen==='phone'&&s.layer==='1'&&s.visible==='visible'&&s.display!=='none'&&r&&r.w>80&&r.h>150&&r.x>=-2&&r.right<=s.width+2&&r.y>=-2&&r.bottom<=s.height+2,s);
 await p.waitForFunction(()=>__kitchen.tv.status.loaded==='phone'&&__kitchen.tv.status.state===1&&Number(getComputedStyle(document.querySelector('.tv-layer iframe')).opacity)>.98,null,{timeout:45000});
 await p.waitForFunction(()=>{const f=document.querySelector('.tv-layer iframe');return f&&Number(getComputedStyle(f).opacity)>.9;},null,{timeout:4000});
 const playing=await surface(p);check(label+' actual Shorts playback',playing.iframe&&Number(playing.iframe.opacity)>.9&&playing.status.state===1,playing);
}
async function shot(p,label){await p.screenshot({path:path.join(output,label+'.png')});}
async function home(p){return p.evaluate(()=>__kitchen.tv.networkPosition());}
async function fixture(p){
 await p.waitForFunction(()=>__kitchen.walk.walking);
 const h=await home(p);check('phone home exists',Array.isArray(h)&&h.every(Number.isFinite),h);
 await p.evaluate(h=>{__kitchen.viewmodel.setWeapon('none');__kitchen.walk.enter({x:h[0]-1.0,z:h[2]+.35},-Math.PI/2);},h);
 await p.waitForTimeout(1000);await aim(p,h);return h;
}
async function pickup(p,mobile=false){
 await p.waitForFunction(()=>document.body.classList.contains('khh-on'),null,{timeout:10000});
 if(mobile)await p.getByRole('button',{name:'Взять телефон',exact:true}).tap();else await p.keyboard.press('e');
}
async function nextVideo(p,mobile=false){
 const before=await p.evaluate(()=>__kitchen.tv.snapshot().phone.index);
 if(mobile){
  const s=await surface(p),r=s.rect,x=r.x+r.w*.5,y=r.y+r.h*.62;
  const c=await p.context().newCDPSession(p);
  try{await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let n=1;n<=4;n++)await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-n*25}]});
   await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }finally{await c.detach();}
 }else await p.keyboard.press('ArrowDown');
 await p.waitForFunction(index=>__kitchen.tv.snapshot().phone.index!==index,before);
 await p.waitForFunction(()=>__kitchen.tv.status.state===1,null,{timeout:45000});
 check((mobile?'mobile swipe':'ArrowDown')+' advances playing Shorts',await p.evaluate(i=>__kitchen.tv.snapshot().phone.index!==i,before));
}
async function put(p,mobile=false){
 if(mobile)await p.getByRole('button',{name:'Положить',exact:true}).tap();else await p.keyboard.press('q');
 await p.waitForFunction(()=>!__kitchen.tv.status.held);
 const restored=await p.evaluate(()=>{const p=__kitchen.tv.screens().find(s=>s.id==='phone');return p?.holder?.children[0]?.visible===true;});
 check((mobile?'mobile return':'Q return')+' restores island phone',restored);
}
async function connected(p){await p.waitForFunction(()=>__kitchen.multiplayer.client.connected,null,{timeout:60000});await p.evaluate(()=>__kitchen.multiplayer.lobby.close());}
async function walkTo(p,target){
 for(let n=0;n<8;n++){
  const c=await p.evaluate(()=>({pose:__kitchen.walk.getNetworkPose(),eye:__kitchen.camera.position.y}));
  const d=Math.hypot(c.pose.x-target[0],c.pose.z-target[1]);if(d<.16)return;
  await aim(p,[target[0],c.eye,target[1]]);await p.keyboard.down('w');await p.waitForTimeout(Math.min(900,d/1.4*1000));await p.keyboard.up('w');await p.waitForTimeout(150);
 }
 throw Error('native walk to phone approach was obstructed');
}
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
 const host=await page();await fixture(host);await pickup(host);await assertHeld(host,'desktop');await nextVideo(host);await shot(host,'desktop-phone');await put(host);
 await host.evaluate(()=>{const tv=__kitchen.tv,set=tv.setNetwork;tv.setNetwork=adapter=>{window.__phoneQAAdapter=adapter;return set(adapter);};});
 await host.locator('#kmp-launch').click();await host.locator('#kmp-name').fill('Phone QA host');await host.locator('.kmp-form button[type=submit]').click();await connected(host);
 await host.waitForFunction(()=>__kitchen.walk.walking&&!__kitchen.multiplayer.applying);
 const h=await home(host);await walkTo(host,[h[0]-1.0,h[2]+.35]);await aim(host,h);await pickup(host);await assertHeld(host,'multiplayer host');
 const seat=await host.evaluate(()=>{const p=__kitchen.walk.getNetworkPose();return __kitchen.seats.networkSeats().sort((a,b)=>Math.hypot(a.position[0]-p.x,a.position[2]-p.z)-Math.hypot(b.position[0]-p.x,b.position[2]-p.z))[0].id;});
 await host.evaluate(id=>__kitchen.seats.sitOn(id),seat);await host.waitForFunction(()=>__kitchen.seats.active);
 // Rebind the real authority adapter while ownership remains canonical: this
 // reproduces reconnect/late ownership presentation while the player is seated.
 await host.evaluate(()=>__kitchen.tv.setNetwork(window.__phoneQAAdapter));
 await assertHeld(host,'seated ownership restore');await shot(host,'seated-phone');
 await host.evaluate(()=>__kitchen.seats.stand({toWalk:true}));await host.waitForFunction(()=>__kitchen.walk.walking&&!__kitchen.seats.active);
 const guest=await page(await host.evaluate(()=>__kitchen.multiplayer.client.inviteUrl));
 await guest.locator('#kmp-name').fill('Phone QA guest');await guest.locator('.kmp-form button[type=submit]').click();await connected(guest);
 await guest.waitForFunction(()=>__kitchen.multiplayer.client.state.players.length===2);
 check('late guest sees phone owner and hidden island model',await guest.evaluate(()=>{const k=__kitchen,p=k.tv.screens().find(s=>s.id==='phone');return k.multiplayer.client.state.items.phone!==k.multiplayer.client.id&&k.multiplayer.client.state.items.phone!=null&&p.holder.children[0].visible===false&&!k.tv.status.held;}));
 await nextVideo(host);const index=await host.evaluate(()=>__kitchen.tv.snapshot().phone.index);
 await guest.waitForFunction(i=>__kitchen.tv.snapshot().phone.index===i,index);check('Shorts selection is shared with observer',true,index);await shot(host,'multiplayer-phone');
 await put(host);await guest.context().close();await host.context().close();
 const mobile=await page(url,true);await fixture(mobile);await pickup(mobile,true);await assertHeld(mobile,'portrait');await nextVideo(mobile,true);await shot(mobile,'portrait-phone');await put(mobile,true);
 check('no application errors',report.errors.length===0,report.errors);
}catch(error){report.failure=error.message;process.exitCode=1;
 report.failureState=[];for(const c of contexts)for(const p of c.pages())if(!p.isClosed()){report.failureState.push(await surface(p).catch(()=>null));await shot(p,'failure-'+report.failureState.length).catch(()=>{});}
}finally{clearTimeout(timer);for(const c of contexts)await c.close().catch(()=>{});await browser?.close();report.cleanup=true;save();console.log(JSON.stringify({complete:!report.failure,failure:report.failure,cleanup:true}));}
