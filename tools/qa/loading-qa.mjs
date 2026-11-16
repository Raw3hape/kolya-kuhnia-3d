// Cold startup → complete apartment → native movement / invited guest.
// A held real afterRoom asset proves that the first raster cannot dismiss loading.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'/Users/nikita/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs').href);
const url=process.env.QA_URL||'http://127.0.0.1:8779/';
const out=path.resolve(process.env.QA_OUTPUT||'output/playwright/loading-2026-11-16/e2e');fs.mkdirSync(out,{recursive:true});
const report={url,checks:[],errors:[],timings:[],cleanup:false};let browser;
const deadline=setTimeout(()=>browser?.close(),480000);
const check=(name,pass,details)=>{report.checks.push({name,pass,details});console.log(JSON.stringify({name,pass}));if(!pass)throw Error(name);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function page({width=1280,height=720,quality='eco',cpu=1,mobile=false}={}){
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile});
 await context.addInitScript(({quality})=>{localStorage.setItem('kitchen-ui-v1',JSON.stringify({quality,seen:{intro:true}}));localStorage.setItem('kitchen-life-v1',JSON.stringify({life:true,mute:true}));},{quality});
 const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));p.setDefaultTimeout(15000);
 if(cpu>1){const c=await context.newCDPSession(p);await c.send('Emulation.setCPUThrottlingRate',{rate:cpu});}
 return p;
}
async function playable(p){
 await p.waitForFunction(()=>window.__kitchen?.startup?.status==='ready'||document.querySelector('#loading.failed'),null,{timeout:210000});
 const s=await p.evaluate(()=>({state:window.__kitchen?.startup?.state,error:document.querySelector('.ld-error p')?.textContent}));
 if(s.state?.status!=='ready')throw Error('Startup failed: '+s.error);
 await p.locator('#loading').waitFor({state:'hidden'});
 return p.evaluate(()=>({pending:__kitchen.startup.state.pending,lighting:__kitchen.lighting.debug.stable,preparing:__kitchen.pipe.preparing,grow:__kitchen.decor.grow.length,walk:__kitchen.walk.active,bodyReady:document.body.classList.contains('ready'),marks:performance.getEntriesByType('mark').filter(x=>x.name.startsWith('kitchen:')).map(x=>({name:x.name,ms:x.startTime}))}));
}
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
 let release,heldResolve;const held=new Promise(r=>{heldResolve=r;}),unblock=new Promise(r=>{release=r;});
 const host=await page();
 await host.route('**/spec/newspaper.json',async route=>{heldResolve();await unblock;await route.continue().catch(()=>{});});
 await host.goto(url,{waitUntil:'domcontentloaded'});await held;
 await host.waitForFunction(()=>window.__kitchen?.walk.active&&__kitchen.startup.state.phase==='details',null,{timeout:60000});
 await host.evaluate(()=>{window.__startupCheck={last:0,monotonic:true,phases:[]};const off=__kitchen.startup.subscribe(s=>{const c=__startupCheck;c.monotonic&&=s.percent>=c.last;c.last=s.percent;if(c.phases.at(-1)!==s.phase)c.phases.push(s.phase);if(s.status!=='loading')queueMicrotask(off);});});
 const first=await host.locator('.ld-quote').textContent();await sleep(4300);const second=await host.locator('.ld-quote').textContent();
 const position=await host.evaluate(()=>__kitchen.camera.position.toArray());await host.keyboard.down('KeyW');await sleep(300);await host.keyboard.up('KeyW');await host.keyboard.press('Digit3');await host.mouse.click(640,360);
 const locked=await host.evaluate(()=>({position:__kitchen.camera.position.toArray(),weapon:__kitchen.viewmodel.weapon,status:__kitchen.startup.status,hidden:document.querySelector('#loading').hidden,inert:document.querySelector('#panel').inert}));
 check('first raster stays covered while a real deferred asset is pending',locked.status==='loading'&&!locked.hidden&&locked.inert,locked);
 check('captions rotate while loading',first!==second,{first,second});
 check('loading blocks game movement, weapons and pointer input',JSON.stringify(position)===JSON.stringify(locked.position)&&locked.weapon==='none',locked);
 await host.screenshot({path:path.join(out,'loading-desktop.png')});release();
 const ready=await playable(host);report.timings.push({scenario:'desktop held asset',...ready});
 const monotonic=await host.evaluate(()=>__startupCheck);check('ready means settled resources, GI and real raster frames',ready.pending===0&&ready.lighting&&!ready.preparing&&ready.grow===0&&ready.walk&&ready.bodyReady,ready);
 check('progress is monotonic and finishes at 100',monotonic.monotonic&&monotonic.last===100,monotonic);
 await host.keyboard.down('KeyW');await sleep(450);await host.keyboard.up('KeyW');const moved=await host.evaluate(()=>__kitchen.camera.position.toArray());check('native movement works immediately after loading',Math.hypot(moved[0]-position[0],moved[2]-position[2])>0.05,{before:position,after:moved});
 await host.getByRole('button',{name:'Играть вместе',exact:true}).click();await host.getByPlaceholder('Как вас зовут?').fill('Loading QA Host');await host.getByRole('button',{name:'Создать комнату',exact:true}).click();await host.waitForFunction(()=>__kitchen.multiplayer.client.connected,null,{timeout:60000});await host.evaluate(()=>__kitchen.multiplayer.lobby.close());
 const invite=await host.evaluate(()=>__kitchen.multiplayer.client.inviteUrl),guest=await page({width:390,height:844,mobile:true,cpu:4});
 await guest.goto(invite,{waitUntil:'domcontentloaded'});await guest.screenshot({path:path.join(out,'loading-mobile.png')});
 const early=await guest.evaluate(()=>({loading:!document.querySelector('#loading').hidden,lobby:document.querySelector('#kmp-lobby')?.open||false}));
 check('invite waits behind initial loading without a modal deadlock',early.loading&&!early.lobby,early);
 await guest.setViewportSize({width:844,height:390});await sleep(250);await guest.screenshot({path:path.join(out,'loading-landscape.png')});await guest.setViewportSize({width:390,height:844});
 const mobileReady=await playable(guest);report.timings.push({scenario:'mobile CPU4 invited guest',...mobileReady});await guest.getByPlaceholder('Как вас зовут?').waitFor({state:'visible'});
 const focus=await guest.locator('#kmp-name').evaluate(x=>x===document.activeElement);check('guest name form opens and receives focus after preparation',focus);
 await guest.getByPlaceholder('Как вас зовут?').fill('Loading QA Guest');await guest.getByRole('button',{name:'Войти в квартиру',exact:true}).tap();
 await guest.waitForFunction(()=>__kitchen.multiplayer.client.connected&&__kitchen.walk.active&&!__kitchen.multiplayer.applying,null,{timeout:90000});await guest.evaluate(()=>__kitchen.multiplayer.lobby.close());
 const connected=await Promise.all([host,guest].map(p=>p.evaluate(()=>({connected:__kitchen.multiplayer.client.connected,players:__kitchen.multiplayer.client.state.players.length}))));check('host and mobile guest remain fully connected',connected.every(s=>s.connected&&s.players===2),connected);
 await guest.context().close();await host.context().close();
 const failed=await page({width:360,height:640});let attempts=0;const broken='**/textures/hdri/512/*.hdr*';await failed.route(broken,route=>{attempts++;return route.abort('failed');});await failed.goto(url,{waitUntil:'domcontentloaded'});await failed.locator('#loading.failed').waitFor({state:'visible',timeout:60000});
 const failure=await failed.evaluate(()=>({status:window.__kitchen?.startup.status,ready:document.body.classList.contains('ready'),error:document.querySelector('.ld-error p').textContent,pct:document.querySelector('.ld-pct').textContent,origin:performance.timeOrigin}));
 check('failed critical asset offers retry and never unlocks gameplay',failure.status==='error'&&!failure.ready&&attempts===3, {...failure,attempts});await failed.screenshot({path:path.join(out,'loading-error.png')});
 await failed.unroute(broken);await Promise.all([failed.waitForNavigation({waitUntil:'domcontentloaded'}),failed.getByRole('button',{name:'Попробовать ещё раз',exact:true}).click()]);await playable(failed);check('retry reloads and reaches a genuinely playable apartment',await failed.evaluate(origin=>performance.timeOrigin!==origin,failure.origin));await failed.context().close();
 const missing=await page();await missing.route('**/js/main.js',route=>route.abort('failed'));await missing.goto(url,{waitUntil:'domcontentloaded'});await missing.locator('#loading.failed').waitFor({state:'visible'});check('module download failure still leaves a readable retry screen',await missing.getByRole('button',{name:'Попробовать ещё раз',exact:true}).isVisible());await missing.context().close();
 const lifecycle=await page();await lifecycle.route('**/js/main.js',route=>route.fulfill({contentType:'text/javascript',body:''}));await lifecycle.goto(url,{waitUntil:'domcontentloaded'});
 const restored=await lifecycle.evaluate(async()=>{const{startup}=await import('./js/startup-state.js');startup.complete();await Promise.resolve();dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));return{hidden:document.querySelector('#loading').hidden,inert:document.querySelector('#panel').inert};});check('pagehide during the final transition cannot leave the page locked',restored.hidden&&!restored.inert,restored);await lifecycle.context().close();
 if(process.env.QA_EXTENDED==='1'){
  const high=await page({quality:'high'});await high.goto(url,{waitUntil:'domcontentloaded'});const highReady=await playable(high);report.timings.push({scenario:'high',...highReady});const state=await high.evaluate(()=>({quality:__kitchen.pipe.quality,tier:__kitchen.M.floorA.userData.tier,normal:!!__kitchen.M.floorA.normalMap}));check('high quality waits for its complete materials and lighting',state.quality==='high'&&state.tier==='full'&&state.normal,state);await high.screenshot({path:path.join(out,'ready-high.png')});await high.context().close();
 }
 check('no application errors',report.errors.length===0,report.errors);
}catch(error){report.failure=error.stack;process.exitCode=1;console.error(error.stack);}
finally{clearTimeout(deadline);await browser?.close();report.cleanup=true;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({complete:!report.failure,cleanup:true}));}
