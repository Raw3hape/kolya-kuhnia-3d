// Real renderer and WebRTC delivery checks. Only solo setup and delivery wait are accelerated.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { awaitPlayable } from './await-playable.mjs';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const url = process.env.QA_URL || 'http://127.0.0.1:8765/';
const output = path.resolve(process.env.QA_OUTPUT || 'output/playwright/courier-qa'); fs.mkdirSync(output, { recursive: true });
const report = { url, checks: [], errors: [] }; let browser;
const watchdog = setTimeout(() => browser?.close().finally(() => process.exit(2)), 600000);
function check(name, pass, details) { report.checks.push({ name, pass, details }); console.log(JSON.stringify({ name, pass })); if (!pass) throw Error(name); }
async function page(target = url, mobile = false, deferMonsters = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, isMobile: mobile, hasTouch: mobile });
  let releaseModels; const modelGate = new Promise(resolve => { releaseModels = resolve; });
  if (deferMonsters) await context.route('**/models/life/*.glb*', async route => { await modelGate; await route.continue(); });
  await context.addInitScript(() => { localStorage.setItem('kitchen-ui-v1', JSON.stringify({ quality: 'eco', seen: { intro: true } })); localStorage.setItem('kitchen-life-v1', JSON.stringify({ life: true, sound: 'walk', mute: false })); });
  await context.route('**/spec/social.json', async route => { const response = await route.fetch(), spec = await response.json(); spec.rules.firstDelivery = 12; spec.rules.courierWait = 180; await route.fulfill({ response, json: spec }); });
  const p = await context.newPage(); p.on('pageerror', e => report.errors.push(e.message)); p.setDefaultTimeout(15000);
  await p.goto(target, { waitUntil: 'domcontentloaded' }); await awaitPlayable(p);
  await p.getByRole('button', { name: 'Понятно', exact: true }).click({ timeout: 500 }).catch(() => {});
  await p.waitForFunction(()=>__kitchen.walk.walking); p.releaseModels = releaseModels; return p;
}
async function aim(p, target) {
  if (await p.evaluate(() => matchMedia('(pointer:coarse)').matches)) {
    await p.evaluate(pos => { const s = __kitchen.walk.getNetworkPose(); __kitchen.walk.reconcileNetwork({ ...s, yaw: Math.atan2(s.x-pos[0],s.z-pos[2]), pitch: Math.atan2(pos[1]-__kitchen.camera.position.y,Math.hypot(pos[0]-s.x,pos[2]-s.z)) }, s.ack, { snap: true }); }, target);
  } else for (let j=0;j<14;j++) {
    const s = await p.evaluate(() => ({ ...__kitchen.walk.getNetworkPose(), eye: __kitchen.camera.position.y }));
    const dx=target[0]-s.x,dz=target[2]-s.z,yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(target[1]-s.eye,Math.hypot(dx,dz));
    const mx=Math.max(-210,Math.min(210,Math.atan2(Math.sin(s.yaw-yaw),Math.cos(s.yaw-yaw))/.0042)),my=Math.max(-140,Math.min(140,(s.pitch-pitch)/.0042));
    if(Math.abs(mx)<.6&&Math.abs(my)<.6) break;
    await p.mouse.move(620,350); await p.mouse.down({button:'right'});await p.mouse.move(620+mx,350+my,{steps:5});await p.mouse.up({button:'right'});await p.waitForTimeout(60);
  }
  await p.waitForTimeout(250);
}
async function shot(p,name){await p.screenshot({path:path.join(output,name+'.png')});}
async function pizzaAim(p){await aim(p,await p.evaluate(()=>__kitchen.social.debug.state.pizza.position.map((n,i)=>i===1?n+.02:n)));}
async function monsterState(p){return p.evaluate(()=>{const m=__kitchen.life.debug.mods.landing.debug,g=__kitchen.scene.getObjectByName('life_monsters');return {visitor:m.visitor,loaded:m.cast.length,visible:!!g?.visible,colliders:__kitchen.life.colliders().length,voices:m.voices};});}
async function walkTo(p,x,z){const deadline=Date.now()+18000;while(Date.now()<deadline){const pose=await p.evaluate(()=>__kitchen.walk.getNetworkPose()),d=Math.hypot(pose.x-x,pose.z-z);if(d<.27)return;await aim(p,[x,1.68,z]);await p.keyboard.down('w');await p.waitForTimeout(Math.max(70,Math.min(350,d/3*1000)));await p.keyboard.up('w');await p.waitForTimeout(60);}throw Error('native route blocked '+JSON.stringify({x,z,pose:await p.evaluate(()=>__kitchen.walk.getNetworkPose())}));}
async function connected(p){await p.waitForFunction(()=>__kitchen.multiplayer.client.connected,null,{timeout:60000});await p.evaluate(()=>__kitchen.multiplayer.lobby.close());}
try {
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
  if(process.env.QA_DEFER_ONLY) {
    const p = await page(url, false, true);
    const pipe = await p.evaluate(() => { const item = __kitchen.party.debug.state.items.find(i => i.kind === 'vape'); __kitchen.walk.enter({x:item.position[0],z:item.position[2]+.6}); return item; });
    await p.waitForTimeout(900); const picked = await p.evaluate(id => __kitchen.party.command('take',id), pipe.id); check('hands occupied by an actual pipe before visit',picked.ok);
    await p.evaluate(()=>{__kitchen.walk.enter({x:-2.03,z:5.3},Math.PI);__kitchen.doors.setOpen('entry_door',true,{instant:true});});
    await p.waitForFunction(()=>__kitchen.social.debug.state.courier?.phase==='offering',null,{timeout:25000}); p.releaseModels();
    await p.waitForFunction(()=>__kitchen.scene.getObjectByName('life_monsters')?.parent?.name==='life_landing');
    const delayed = await monsterState(p); check('late monster asset completion cannot reappear over courier',delayed.loaded===3&&delayed.visitor&&!delayed.visible&&delayed.colliders===0,delayed);
    await pizzaAim(p); await p.waitForFunction(()=>__kitchen.social.debug.target==='courier'); await p.mouse.click(640,400); await p.waitForFunction(()=>__kitchen.social.held&&!__kitchen.party.held);
    check('native click with a pipe returns it and receives one pizza',await p.evaluate(id=>__kitchen.party.debug.state.items.find(i=>i.id===id).owner===null,pipe.id)); await p.context().close();
  }
  if(!process.env.QA_ROOM_ONLY && !process.env.QA_DEFER_ONLY){
    const p=await page();
    await p.evaluate(()=>{__kitchen.walk.exit({restore:false});__kitchen.doors.setOpen('entry_door',true,{instant:true});});
    await p.evaluate(()=>__kitchen.life.debug.mods.landing.preload());
    await p.waitForFunction(()=>__kitchen.scene.getObjectByName('life_monsters')?.parent?.name==='life_landing');
    const before=await monsterState(p);check('existing monsters and physics loaded before visit',before.loaded===3&&before.visible&&before.colliders===3,before);
    await p.evaluate(()=>{__kitchen.doors.setOpen('entry_door',false,{instant:true});__kitchen.walk.enter({x:-2.03,z:5.3},Math.PI);});
    await p.waitForFunction(()=>__kitchen.social.debug.state.courier?.phase==='waiting',null,{timeout:25000});
    const during=await monsterState(p);check('arrival hides all monsters, voices and colliders',during.visitor&&!during.visible&&during.colliders===0&&during.voices===0,during);
    check('pizza is held by courier and cannot open through closed door',await p.evaluate(async()=>{const s=__kitchen.social.debug.state;return s.pizza.location==='courier'&&!(await __kitchen.social.command('receive')).ok&&!(await __kitchen.social.command('open')).ok;}));
    await aim(p,[-2.03,1.2,6.53]);await p.waitForFunction(()=>__kitchen.doors.target?.id==='entry_door');await p.keyboard.press('e');
    await p.waitForFunction(()=>__kitchen.social.debug.state.courier?.phase==='offering');await pizzaAim(p);
    await p.waitForFunction(()=>__kitchen.social.debug.target==='courier');await shot(p,'courier-offering');
    check('one box and clear desktop receive action',await p.evaluate(()=>__kitchen.scene.getObjectByName('social_pizza')?.visible&&!document.querySelector('[data-action=receive]').hidden));
    await p.keyboard.press('1');await p.waitForTimeout(150);await pizzaAim(p);
    check('armed hands still target courier',await p.evaluate(()=>__kitchen.social.debug.target==='courier'));
    await p.mouse.click(640,400);await p.waitForFunction(()=>__kitchen.social.held);
    check('click receives and holsters weapon',await p.evaluate(()=>!__kitchen.viewmodel.armed&&__kitchen.social.debug.state.pizza.location==='held'));
    await p.waitForTimeout(1000);await shot(p,'received');
    await p.waitForFunction(()=>!__kitchen.social.debug.state.courier,null,{timeout:7000});
    const after=await monsterState(p);check('monsters stay absent after courier leaves with door open',after.visitor&&!after.visible&&after.colliders===0,after);
    await p.keyboard.press('x');await p.waitForFunction(()=>!__kitchen.social.held);await pizzaAim(p);await p.keyboard.press('e');await p.waitForFunction(()=>__kitchen.social.debug.state.pizza.open);await p.mouse.click(640,400);await p.waitForFunction(()=>__kitchen.social.debug.state.pizza.remaining===11);
    check('received pizza opens and shares edible slices',true);await shot(p,'pizza-shared');
    await p.evaluate(()=>__kitchen.doors.setOpen('entry_door',false,{instant:true}));await p.waitForFunction(()=>!__kitchen.life.debug.mods.landing.debug.visitor);
    await p.evaluate(()=>__kitchen.doors.setOpen('entry_door',true,{instant:true}));check('monsters return only after safely closing the door',await p.evaluate(()=>__kitchen.life.colliders().length===3));
    await p.context().close();
    const mobile=await page(url,true);await mobile.evaluate(()=>{__kitchen.walk.enter({x:-2.03,z:5.3},Math.PI);__kitchen.doors.setOpen('entry_door',true,{instant:true});});
    await mobile.waitForFunction(()=>__kitchen.social.debug.state.courier?.phase==='offering',null,{timeout:25000});await pizzaAim(mobile);await mobile.waitForFunction(()=>__kitchen.social.debug.target==='courier');await shot(mobile,'mobile-offering');
    await mobile.getByRole('button',{name:'Забрать пиццу',exact:true}).tap();await mobile.waitForFunction(()=>__kitchen.social.held);check('mobile receives from hands with one large button',true);await mobile.context().close();
  }
  if(!process.env.QA_SOLO_ONLY && !process.env.QA_DEFER_ONLY){
    const host=await page();await host.evaluate(()=>__kitchen.multiplayer.lobby.open());await host.locator('#kmp-name').fill('Courier Host');await host.getByRole('button',{name:'Создать комнату',exact:true}).click();await connected(host);
    const link=await host.evaluate(()=>__kitchen.multiplayer.client.inviteUrl);const guest=await page(link);await guest.locator('#kmp-name').fill('Courier Guest');await guest.locator('.kmp-form button[type=submit]').click();await connected(guest);
    await walkTo(host,-1.2,4.35);await walkTo(host,-1.25,5.3);await walkTo(host,-2.03,5.3);
    await walkTo(guest,-1.05,4.35);await walkTo(guest,-1.05,5.2);
    await host.waitForFunction(()=>__kitchen.social.debug.state.courier?.phase==='waiting',null,{timeout:25000});
    await aim(host,[-2.03,1.2,6.53]);await host.waitForFunction(()=>__kitchen.doors.target?.id==='entry_door');await host.keyboard.press('e');await host.waitForFunction(()=>__kitchen.social.debug.state.courier?.phase==='offering');
    await Promise.all([host,guest].map(p=>pizzaAim(p)));await Promise.all([host,guest].map(p=>p.waitForFunction(()=>__kitchen.social.debug.target==='courier')));await shot(guest,'room-offering');
    await Promise.all([host.keyboard.press('e'),guest.keyboard.press('e')]);await host.waitForFunction(()=>!!__kitchen.social.debug.state.pizza.owner);await guest.waitForFunction(()=>!!__kitchen.social.debug.state.pizza.owner);
    const owners=await Promise.all([host,guest].map(p=>p.evaluate(()=>__kitchen.social.debug.state.pizza.owner)));check('real WebRTC simultaneous handoff has exactly one shared owner',owners[0]===owners[1]&&!!owners[0],owners);
    await Promise.all([host,guest].map(p=>p.waitForFunction(()=>!__kitchen.social.debug.state.courier,null,{timeout:8000})));
    const states=await Promise.all([host,guest].map(monsterState));check('host and guest suppress stale ambient monsters and physics',states.every(s=>s.visitor&&!s.visible&&s.colliders===0),states);
    await shot(host,'room-received');await guest.context().close();await host.context().close();
  }
  check('no application errors',report.errors.length===0,report.errors);
}catch(e){report.failure=e.message;process.exitCode=1;for(const c of browser?.contexts()||[])for(const p of c.pages()){await shot(p,'failure-'+browser.contexts().indexOf(c)).catch(()=>{});report.lastState=await p.evaluate(()=>({social:__kitchen.social.debug,landing:__kitchen.life.debug.mods.landing.debug.visitor,walk:__kitchen.walk.getNetworkPose(),door:__kitchen.doors.target?.id})).catch(()=>null);}}
finally{await browser?.close();clearTimeout(watchdog);report.cleanup=true;fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,failure:report.failure,cleanup:true}));}
