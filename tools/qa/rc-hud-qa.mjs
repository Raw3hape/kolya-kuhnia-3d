// Real native RC input and visual layout acceptance. Fixture placement is solo only.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {awaitPlayable} from './await-playable.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'/Users/nikita/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs').href);
const url=process.env.QA_URL||'http://127.0.0.1:8765/';
const output=path.resolve(process.env.QA_OUTPUT||'output/playwright/rc-hud');fs.mkdirSync(output,{recursive:true});
const report={url,checks:[],errors:[],cleanup:false};let browser;const contexts=[];
const watchdog=setTimeout(()=>browser?.close().finally(()=>process.exit(2)),360000);
function check(name,pass,details){report.checks.push({name,pass,details});console.log(JSON.stringify({name,pass}));if(!pass)throw Error(name+': '+JSON.stringify(details));}
async function shot(p,name){await p.screenshot({path:path.join(output,name+'.png')});}
async function open(mobile){
 const c=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});contexts.push(c);
 await c.addInitScript(()=>{localStorage.setItem('kitchen-ui-v1',JSON.stringify({quality:'eco',seen:{intro:true}}));localStorage.setItem('kitchen-life-v1',JSON.stringify({life:false,sound:'off',mute:true}));});
 if(process.env.QA_ACCESS_URL_FILE)await c.request.get(fs.readFileSync(process.env.QA_ACCESS_URL_FILE,'utf8').trim());
 const p=await c.newPage();p.setDefaultTimeout(14000);p.on('pageerror',e=>report.errors.push(e.message));await p.goto(url,{waitUntil:'domcontentloaded'});await awaitPlayable(p);await p.waitForFunction(()=>__kitchen.rc?.controllers.length===10);
 await p.getByRole('button',{name:'Понятно',exact:true}).click({timeout:500}).catch(()=>{});
 await p.evaluate(()=>{__kitchen.viewmodel.setWeapon('none');__kitchen.doors.setOpen('room3_balcony_door',true,{instant:true});const t=__kitchen.rc.config.table.position;__kitchen.walk.enter({x:t[0],z:t[2]+.65},0);});await p.waitForTimeout(1000);
 // Only fixture location is set directly. Pickup and all subsequent inputs are native.
 const target=await p.evaluate(()=>__kitchen.rc.controllers[0].position);
 for(let i=0;i<16;i++){
  const s=await p.evaluate(()=>({...__kitchen.walk.getNetworkPose(),eye:__kitchen.camera.position.y})),dx=target[0]-s.x,dz=target[2]-s.z;
  const yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(target[1]-s.eye,Math.hypot(dx,dz)),angle=Math.atan2(Math.sin(s.yaw-yaw),Math.cos(s.yaw-yaw));
  const mx=Math.max(-210,Math.min(210,angle/.0042)),my=Math.max(-140,Math.min(140,(s.pitch-pitch)/.0042));if(Math.abs(mx)<.7&&Math.abs(my)<.7)break;
  await p.mouse.move(210,300);await p.mouse.down({button:'right'});await p.mouse.move(210+mx,300+my,{steps:5});await p.mouse.up({button:'right'});await p.waitForTimeout(70);
 }
 await p.waitForFunction(()=>!!__kitchen.rc.target);
 if(mobile)await p.locator('.rc-take').click();else await p.keyboard.press('e');
 await p.waitForFunction(()=>__kitchen.rc.controlling);await p.waitForTimeout(700);return p;
}
async function state(p){return p.evaluate(async()=>{
 const T=await import('three'),a=__kitchen,h=a.rc.held,point=new T.Vector3().fromArray(h.position).project(a.camera),hud=document.querySelector('.rc-hud').getBoundingClientRect();
 return{point:point.toArray(),car:h.position,camera:a.camera.position.toArray(),body:a.walk.getNetworkPose(),hud:{width:hud.width,height:hud.height,top:hud.top,left:hud.left,right:hud.right},overflow:document.documentElement.scrollWidth>innerWidth,help:!document.querySelector('.rc-help').hidden};
});}
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
 const p=await open(false),before=await state(p);await shot(p,'desktop-driving');
 check('desktop HUD leaves the field clear and contains direct focus and exit actions',before.hud.height<=70&&!before.overflow&&!before.help&&await p.locator('.rc-camera').isVisible()&&await p.locator('.rc-exit').isVisible(),before);
 const help=p.getByRole('button',{name:'Помощь и возврат машинки',exact:true});await help.focus();await p.keyboard.press('Space');
 check('keyboard Space opens help without driving or releasing the controller',await p.locator('.rc-help').isVisible()&&await p.evaluate(()=>__kitchen.rc.controlling&&__kitchen.rc.held.input.throttle===0));
 check('help keycaps have explicit readable contrast',await p.locator('.rc-key-guide kbd').first().evaluate(el=>{const s=getComputedStyle(el);return s.color==='rgb(52, 75, 64)'&&s.backgroundColor==='rgb(232, 237, 227)'}));await shot(p,'desktop-help');await p.keyboard.press('Escape');
 check('Escape closes help first and keeps the controller',!await p.locator('.rc-help').isVisible()&&await p.evaluate(()=>__kitchen.rc.controlling));
 await p.mouse.click(720,450,{button:'right'});
 const rightBefore=await state(p);await p.keyboard.down('w');await p.keyboard.down('d');await p.waitForTimeout(1100);await p.keyboard.up('d');await p.keyboard.up('w');const right=await state(p);
 check('native W+D moves the rear-facing car right on the actual balcony viewport',right.point[0]-rightBefore.point[0]>.01,{before:rightBefore.point,after:right.point});
 check('driving never moves balcony eyes or body',Math.hypot(...right.camera.map((n,i)=>n-before.camera[i]))<.01&&Math.hypot(right.body.x-before.body.x,right.body.z-before.body.z)<.002);
 await p.keyboard.press('r');await p.waitForTimeout(700);const leftBefore=await state(p);await p.keyboard.down('w');await p.keyboard.down('a');await p.waitForTimeout(1100);await p.keyboard.up('a');await p.keyboard.up('w');const left=await state(p);
 check('native W+A moves the rear-facing car left on the same viewport',left.point[0]-leftBefore.point[0]<-.01,{before:leftBefore.point,after:left.point});
 await help.click();await p.locator('.rc-reset').click();await p.waitForTimeout(300);check('return to start is available in help and closes the secondary panel',!await p.locator('.rc-help').isVisible()&&await p.evaluate(()=>__kitchen.rc.controlling));
 await p.getByRole('button',{name:'Отойти с пультом',exact:true}).click();await p.waitForFunction(()=>__kitchen.rc.held?.controlMode==='carry');await p.waitForTimeout(400);const carryBefore=await state(p);await p.mouse.click(720,450,{button:'right'});await p.keyboard.down('d');await p.waitForTimeout(700);await p.keyboard.up('d');await p.waitForTimeout(200);const carryAfter=await state(p);
 check('stepping aside preserves the controller, frees walking and parks the car',Math.hypot(carryAfter.body.x-carryBefore.body.x,carryAfter.body.z-carryBefore.body.z)>.3&&Math.hypot(carryAfter.car[0]-carryBefore.car[0],carryAfter.car[2]-carryBefore.car[2])<.15&&await p.evaluate(()=>__kitchen.rc.held.controlMode==='carry'&&!__kitchen.rc.controlling),{before:carryBefore.body,after:carryAfter.body});await shot(p,'desktop-carry');
 await p.getByRole('button',{name:'Управлять машинкой',exact:true}).click();await p.waitForFunction(()=>__kitchen.rc.isDriving);await p.waitForTimeout(250);const resumed=await state(p);await p.mouse.click(720,450,{button:'right'});await p.keyboard.down('w');await p.waitForTimeout(600);await p.keyboard.up('w');const resumedAfter=await state(p);check('explicit resume freezes the new standing position and drives the car',Math.hypot(resumedAfter.body.x-resumed.body.x,resumedAfter.body.z-resumed.body.z)<.002&&Math.hypot(resumedAfter.car[0]-resumed.car[0],resumedAfter.car[2]-resumed.car[2])>.2);
 await p.locator('.rc-exit').focus();await p.keyboard.press('Space');await p.waitForFunction(()=>!__kitchen.rc.controlling);check('keyboard Space on the exit button returns to walking',await p.locator('.rc-hud').isHidden());await p.context().close();
 const mobile=await open(true),m=await state(mobile);await shot(mobile,'phone-driving');
 check('phone HUD is compact with no overflow and help collapsed',m.hud.height<=112&&!m.overflow&&!m.help,m);
 const mh=mobile.getByRole('button',{name:'Помощь и возврат машинки',exact:true});await mh.tap();await shot(mobile,'phone-help');const closeBox=await mobile.getByRole('button',{name:'Закрыть подсказки',exact:true}).boundingBox();check('phone help close has a 44 pixel touch target',closeBox.height>=44,closeBox);
 check('phone help explains touch controls without keyboard clutter',await mobile.locator('.rc-touch-guide').isVisible()&&!await mobile.locator('.rc-key-guide').isVisible());await mobile.getByRole('button',{name:'Закрыть подсказки',exact:true}).tap();
 const gas=await mobile.getByRole('button',{name:'Ехать вперёд',exact:true}).boundingBox(),turn=await mobile.getByRole('button',{name:'Повернуть вправо',exact:true}).boundingBox(),cdp=await mobile.context().newCDPSession(mobile),mb=await state(mobile);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:gas.x+gas.width/2,y:gas.y+gas.height/2,id:1},{x:turn.x+turn.width/2,y:turn.y+turn.height/2,id:2}]});await mobile.waitForTimeout(1100);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});const ma=await state(mobile);
 check('simultaneous native touch gas and right steering also moves the car right',ma.point[0]-mb.point[0]>.01,{before:mb.point,after:ma.point});
 const exitRect=await mobile.locator('.rc-exit').boundingBox();check('phone exit retains a finger-sized target',exitRect.height>=40&&exitRect.width>=80);
 await mobile.setViewportSize({width:568,height:320});await mobile.waitForTimeout(300);check('short landscape keeps every driving button below the HUD and inside the screen',await mobile.evaluate(()=>{const h=document.querySelector('.rc-hud').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.rc-control')].every(b=>{const r=b.getBoundingClientRect();return r.top>=h.bottom+4&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})}));await shot(mobile,'phone-landscape');await mobile.setViewportSize({width:390,height:844});await mobile.waitForTimeout(200);
 await mobile.getByRole('button',{name:'Отойти с пультом',exact:true}).tap();await mobile.waitForFunction(()=>__kitchen.rc.held?.controlMode==='carry');await mobile.waitForTimeout(200);await shot(mobile,'phone-carry');check('phone carry switches from car buttons to the normal walking joystick',!await mobile.getByRole('button',{name:'Ехать вперёд',exact:true}).isVisible()&&await mobile.locator('.kw-joy').isVisible()&&await mobile.getByRole('button',{name:'Управлять машинкой',exact:true}).isVisible());
 await mobile.setViewportSize({width:320,height:740});await mobile.waitForTimeout(200);check('narrow phone keeps carry and exit actions inside the viewport',await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.rc-actions button')].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height>=44})));
 await mobile.locator('.rc-exit').tap();await mobile.waitForFunction(()=>!__kitchen.rc.controlling);check('no uncaught browser errors',report.errors.length===0,report.errors);
}catch(e){report.failure=e.stack;process.exitCode=1;console.error(e.stack);for(const c of contexts)for(const p of c.pages())await shot(p,'failure-'+contexts.indexOf(c)).catch(()=>{});}
finally{for(const c of contexts)await c.close().catch(()=>{});await browser?.close();clearTimeout(watchdog);report.cleanup=true;fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.checks.filter(c=>c.pass).length,total:report.checks.length,failure:report.failure,cleanup:true}));}
