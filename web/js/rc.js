// RC presentation/input adapter. Ownership/HP live in rc-state.js; cannon-es
// predicts the local car immediately while host snapshots reconcile the result.
// A separate chase camera never changes the player's body or network pose.
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {createRCSimulation} from './rc-state.js';
import {createRCOrbit} from './rc-camera.js';
import {assetUrl,track,retry} from './loading.js';
import {addTargets} from './hunt.js';
import {injectStyle} from './minimap.js';
import {addHelp} from './help.js';
import {createPartyOverlay} from './party-overlay.js';
import {acquireSceneIndex} from './scene-index.js';
import {isTransient} from './network-objects.js';
addHelp(
 {mode:'walk',topic:'rc',keys:['E'],text:'взять пульт на столике слева на балконе — появится своя машинка',order:68},
 {mode:'walk',topic:'rc',keys:['W','A','S','D'],text:'с пультом: W — газ, S — назад, A / D — руль, Пробел — тормоз',order:69},
 {mode:'walk',topic:'rc',keys:['Esc'],text:'закончить гонку; R — вернуть или починить машинку',order:70}
);
const typing=e=>e.target?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName);
const movementKeys=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space']);
export function createRC({THREE,scene,camera,renderer,canvas,pipe,site,getWalk,getSeats,getVM,getParty,getTV,getPaper,beforeCarry,requestRender=()=>{}}){
 let spec=null,sim=null,predictor=null,state=null,network=null,source=null,disposed=false,pending=false,generation=0,aimed=null,heldId=null,players=[],clock=0,sendClock=0,seq=0,lastInput='',savedSolo=null,chaseStarted=false,statusMessage='',exitRequested=false,orbit=null;
 const sceneIndex=acquireSceneIndex(scene),reducedMotion=matchMedia('(prefers-reduced-motion:reduce)'),bounds=new THREE.Box3();
 const root=new THREE.Group();root.name='rc_world';root.userData.rasterOnly=true;root.userData.networkEntity=true;root.userData.networkDynamic=true;scene.add(root);
 const remoteRoot=new THREE.Group();remoteRoot.name='rc_remote_controllers';remoteRoot.userData.networkEntity=true;remoteRoot.userData.rasterOnly=true;scene.add(remoteRoot);
 const handRoot=new THREE.Group();handRoot.name='rc_held_controller';handRoot.userData.viewmodel=true;handRoot.userData.rasterOnly=true;
 const chase=new THREE.PerspectiveCamera(65,camera.aspect,.05,1200);chase.layers.mask=camera.layers.mask;
 const ray=new THREE.Raycaster(),ndc=new THREE.Vector2(),v=new THREE.Vector3(),look=new THREE.Vector3(),q=new THREE.Quaternion(),forward=new THREE.Vector3(),desired=new THREE.Vector3();
 const carViews=new Map(),controllerViews=new Map(),remoteViews=new Map(),keys=new Set(),pendingInputs=[],predictionOffset=new THREE.Vector3(),coarse=matchMedia('(pointer:coarse)');let overlay=null,detachTarget=null,table=null;
 injectStyle('rc-style',CSS);
 const panel=document.createElement('div');panel.className='rc-hud';panel.hidden=true;panel.setAttribute('role','status');
 const title=document.createElement('strong'),stats=document.createElement('span'),hint=document.createElement('span'),exit=document.createElement('button'),reset=document.createElement('button'),follow=document.createElement('button');
 title.className='rc-title';stats.className='rc-stats';hint.className='rc-hint';exit.type=reset.type=follow.type='button';exit.className='rc-exit';reset.className='rc-reset';exit.textContent='Закончить гонку';exit.setAttribute('aria-label','Закончить гонку и вернуться на балкон');reset.textContent='Вернуть машинку';follow.className='rc-camera';follow.textContent='Камера за машинкой';follow.setAttribute('aria-label','Вернуть камеру за машинку, клавиша C');follow.title='C — камера за машинкой · колесо / два пальца — ближе и дальше';panel.append(title,stats,hint,follow,reset,exit);document.body.append(panel);
 const take=document.createElement('button');take.type='button';take.className='rc-take kw-float';take.hidden=true;document.body.append(take);
 const touch=document.createElement('div');touch.className='rc-touch';touch.hidden=true;document.body.append(touch);
 const controls=[['left','←','Повернуть влево','KeyA'],['right','→','Повернуть вправо','KeyD'],['gas','Газ ↑','Ехать вперёд','KeyW'],['reverse','Назад ↓','Ехать назад','KeyS'],['brake','Тормоз','Тормоз','Space']];
 for(const [name,label,aria,key]of controls){const b=document.createElement('button');b.type='button';b.className='rc-control rc-'+name;b.textContent=label;b.setAttribute('aria-label',aria);b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keys.add(key);sendInput(true);});for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,()=>{keys.delete(key);sendInput(true);});touch.append(b);}
 const active=()=>!!getWalk?.()?.walking&&!getSeats?.()?.active&&!pipe.photo;
 const selfId=()=>network?(typeof network.selfId==='function'?network.selfId():network.selfId):'solo';
 const held=()=>state?.cars.find(c=>c.owner===selfId())||null;
 const pose=()=>({id:'solo',x:camera.position.x,y:camera.position.y-(getWalk?.()?.eyeHeight||1.68),z:camera.position.z});
 const design=id=>spec?.designs.find(d=>d.id===id);
 function makeController(color){const t=source.getObjectByName('controller');if(!t)throw Error('rc_controller_model');const o=t.clone(true);o.traverse(m=>{if(m.isMesh){m.castShadow=false;m.receiveShadow=false;}});const badge=new THREE.Mesh(new THREE.BoxGeometry(.105,.005,.017),new THREE.MeshStandardMaterial({color,roughness:.4,metalness:.1}));badge.name='rc_controller_color';badge.position.set(0,.079,.033);o.add(badge);return o;}
 function releaseController(o){o?.getObjectByName('rc_controller_color')?.geometry.dispose();o?.getObjectByName('rc_controller_color')?.material.dispose();}
 function stopDriving(){keys.clear();orbit?.reset();pendingInputs.length=0;predictionOffset.set(0,0,0);pipe.setViewCamera?.(null);chaseStarted=false;handRoot.visible=false;document.body.classList.remove('rc-controlling');}
 function accept(next,context={}){
  if(!next)return;const oldHeld=held(),oldPred=network&&predictor?.pose(heldId);state=next;players=context.players||players;
  const h=held();if(h?.id!==heldId){
   stopDriving();releaseController(handRoot.children[0]);handRoot.clear();heldId=h?.id||null;exitRequested=false;seq=h?.inputSeq||0;lastInput='';sendClock=0;
   if(h&&source){getVM?.()?.setWeapon('none');handRoot.add(makeController(h.color));const hands=source.getObjectByName('controller_hands');if(hands)handRoot.add(hands.clone(true));}
  }
  if(network&&predictor){
   predictor.restore(next);
   const ack=h?.inputSeq||0;while(pendingInputs.length&&pendingInputs[0].input.seq<=ack)pendingInputs.shift();
   for(const entry of pendingInputs){predictor.command({id:selfId()},'input',entry.id,entry.input);predictor.step(entry.dt);}
   if(h&&oldHeld?.id===h.id&&oldPred){const now=predictor.pose(h.id);if(now&&oldPred.position){predictionOffset.add(v.fromArray(oldPred.position).sub(new THREE.Vector3().fromArray(now.position)));if(predictionOffset.length()>4)predictionOffset.set(0,0,0);}}
  }
  renderUI();
 }
 async function command(verb,id=held()?.id||aimed?.id,input){
  if(!sim||pending&&verb!=='input'||!id)return{ok:false,error:'rc_pending'};
  if(verb==='release'){exitRequested=true;stopDriving();renderUI();}
  if(verb==='take'&&!active())return{ok:false,error:'rc_not_walking'};
  if(network?.ready&&network.ready()===false)return{ok:false,error:'rc_disconnected'};
  const token=generation;if(verb!=='input'){pending=true;renderUI();}
  try{
   if(!network&&verb==='take'&&(!sim.canTake(pose(),id)||beforeCarry&&!await beforeCarry()))return{ok:false,error:'rc_hands_busy'};
   if(token!==generation||verb==='take'&&!active())return{ok:false,error:'rc_generation'};
   if(!network&&verb==='take'&&!beforeCarry){getVM?.()?.setWeapon('none');getTV?.()?.hold(false);getPaper?.()?.drop();await getParty?.()?.command?.('return');}
   const result=network?await network.request({kind:'rc',verb,id,...(input?{input}:{})}):sim.command(pose(),verb,id,input);
   if(token!==generation)return{ok:false,error:'rc_generation'};
   if(!network)accept(sim.snapshot());
   if(!result?.ok&&verb!=='input')statusMessage=result?.error==='rc_repairing'?'Механик ещё чинит машинку':result?.error==='rc_owned'?'Этот пульт уже взяли':'Не получилось. Попробуйте ещё раз';
   if(result?.ok)statusMessage='';else if(verb==='release'&&(!network?.ready||network.ready()))exitRequested=false;return result;
  }catch{if(token===generation)statusMessage='Связь прервалась. Попробуйте ещё раз';return{ok:false,error:'rc_network'};}
  finally{if(token===generation&&verb!=='input'){pending=false;renderUI();requestRender();}}
 }
 function getInput(){return{throttle:(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0),steer:(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0),brake:keys.has('Space')};}
 function sendInput(force=false){
  const h=held();if(!h||h.status!=='active'||exitRequested)return;const input=getInput(),key=JSON.stringify(input);
  if(!force&&sendClock<1/spec.physics.inputHz&&key===lastInput)return;
  if(network?.ready&&network.ready()===false){keys.clear();return;}
  input.seq=++seq;const dt=Math.max(spec.physics.fixedStep,Math.min(.1,sendClock));sendClock=0;lastInput=key;
  if(network){const action={kind:'rc',verb:'input',id:h.id,input};if(network.send&&network.send(action)===false){keys.clear();return;}predictor.command({id:selfId()},'input',h.id,input);pendingInputs.push({id:h.id,input,dt});if(pendingInputs.length>120)pendingInputs.shift();if(!network.send)Promise.resolve(network.request(action)).catch(()=>{keys.clear();});}
  else sim.command(pose(),'input',h.id,input);
 }
 function aim(){
  aimed=null;if(!active()||held()||pending||!source)return;
  ray.setFromCamera(ndc.set(0,0),camera);ray.far=spec.controllers.reach;
  const hit=ray.intersectObjects([...controllerViews.values()],true)[0];if(!hit)return;
  let o=hit.object;while(o&&!o.userData.rcId)o=o.parent;
  if(!o)return;const car=state.cars.find(c=>c.id===o.userData.rcId);if(car?.owner)return;
  // A table can be seen through; apartment walls and doors cannot.
  const candidates=[];for(const mesh of sceneIndex.materialObjects){if(!mesh.isMesh||!sceneIndex.visible(mesh))continue;let ignore=false;for(let p=mesh;p&&p!==scene;p=p.parent)if(isTransient(p)||p.userData.passLight){ignore=true;break;}if(ignore)continue;if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();bounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);if(bounds.distanceToPoint(camera.position)>spec.controllers.reach)continue;if(ray.ray.intersectsBox(bounds))candidates.push(mesh);}
  const obstruction=ray.intersectObjects(candidates,false).find(h=>h.distance<hit.distance-.04);
  if(!obstruction)aimed=car;
 }
 function renderUI(){
  const h=held(),can=!!h&&active()&&!exitRequested;panel.hidden=!can;touch.hidden=!can||!coarse.matches;
  if(h){const d=design(h.designId),remaining=Math.max(0,Math.ceil((h.respawnAt||0)-(state?.time||0)));title.textContent=d?.name||'Радиомашинка';title.style.color=h.color;stats.textContent=h.status==='wrecked'?`Машинка разбита · ${remaining?`ремонт ${remaining} с`:'можно починить'}`:`${Math.round(Math.abs(h.speed||0)*3.6)} км/ч · HP ${Math.ceil(h.hp)} / ${h.maxHp}`;
   const flipped=h.quaternion&&1-2*(h.quaternion[0]**2+h.quaternion[2]**2)<.3;hint.textContent=statusMessage||(h.atBoundary?'Край поля — поверните обратно':flipped?'Машинка перевернулась · нажмите «Вернуть машинку»':!network||!network.ready||network.ready()?(coarse.matches?'Газ / руль — кнопки · ведите по полю, чтобы осмотреться':'W / S — газ и назад · A / D — руль · Пробел — тормоз · мышь / тачпад — осмотр'):'Связь восстанавливается… управление на паузе');
   reset.textContent=h.status==='wrecked'?(remaining?`Ремонт ${remaining} с`:'Починить и продолжить'):'Вернуть машинку · R';reset.disabled=pending||h.status==='wrecked'&&remaining>0;exit.disabled=pending;}
  take.hidden=!aimed||!!h||!active();take.textContent=`${coarse.matches?'':'E · '}Взять пульт${aimed?' · '+design(aimed.designId).name:''}`;take.disabled=pending;
  document.body.classList.toggle('rc-controlling',can);
 }
 function animateCar(view,car,dt,local=false){
  view.visible=car.status!=='ready';if(!view.visible)return;
  desired.fromArray(car.position);desired.y-=spec.physics.chassisOffset;if(local)desired.add(predictionOffset);
  q.fromArray(car.quaternion);const k=local?1:1-Math.exp(-spec.physics.remoteSmooth*dt);
  if(!view.userData.seen){view.position.copy(desired);view.quaternion.copy(q);view.userData.seen=true;}else{view.position.lerp(desired,k);view.quaternion.slerp(q,k);}
  view.updateMatrixWorld(true);
  for(let i=0;i<4;i++){const wheel=view.userData.wheels[i],w=car.wheels?.[i];if(!wheel||!w)continue;v.fromArray(w.position);if(local)v.add(predictionOffset);view.worldToLocal(v);wheel.position.copy(v);wheel.quaternion.copy(view.quaternion).invert().multiply(q.fromArray(w.quaternion));}
  view.userData.body.scale.y=car.status==='wrecked'?.7:1;
 }
 function update(dt){
  if(!sim||!source||disposed)return false;clock+=dt;sendClock+=dt;
  const h=held();if(h&&(!active()||exitRequested)&&!pending&&(!network?.ready||network.ready()))command('release',h.id);
  if(h&&!exitRequested)sendInput();if(!network&&state.cars.some(c=>c.owner)){sim.step(dt);state={...state,time:sim.time,cars:state.cars.map(c=>c.owner?sim.pose(c.id):c)};}else if(network&&predictor&&(!network.ready||network.ready())&&h)predictor.step(dt);
  const predicted=network&&predictor&&h?predictor.pose(h.id):null;predictionOffset.multiplyScalar(Math.exp(-12*dt));
  for(const car of state.cars){const local=car.owner===selfId(),display=local&&predicted?predicted:car;animateCar(carViews.get(car.id),display,dt,local);const c=controllerViews.get(car.id);c.visible=!car.owner;
   let remote=remoteViews.get(car.id);if(car.owner&&car.owner!==selfId()&&!remote){remote=makeController(car.color);remoteViews.set(car.id,remote);remoteRoot.add(remote);}if(remote){const p=players.find(p=>p.id===car.owner);remote.visible=!!p&&car.owner!==selfId();if(remote.visible){const grip=network?.gripForPlayer?.(car.owner);if(grip){grip.getWorldPosition(remote.position);grip.getWorldQuaternion(remote.quaternion);remote.position.add(v.set(-.11,0,0).applyQuaternion(remote.quaternion));}else{const yaw=p.lookYaw??p.yaw??0;remote.position.set(p.x+Math.cos(yaw)*.12,(p.eyeY??p.y+1.68)-.55,p.z-Math.cos(yaw)*.3);remote.rotation.set(-.25,yaw,0);}}}
  }
  if(h&&active()&&!exitRequested){
   const view=carViews.get(h.id);view.updateMatrixWorld(true);forward.set(0,0,1).applyQuaternion(view.quaternion);const heading=Math.atan2(forward.x,forward.z),o=orbit.step(dt,heading),radius=o.distance*Math.cos(o.pitch);v.set(-Math.sin(o.azimuth)*radius,o.distance*Math.sin(o.pitch),-Math.cos(o.azimuth)*radius).add(view.position);v.y=Math.max(v.y,-site.floorY+1.15);look.copy(view.position);look.y=Math.max(look.y+spec.view.lookHeight,-site.floorY+.35);
   if(!chaseStarted||reducedMotion.matches){chase.position.copy(v);chaseStarted=true;}else chase.position.lerp(v,1-Math.exp(-spec.view.followResponse*dt));chase.aspect=camera.aspect;chase.fov=spec.view.cameraFov;chase.updateProjectionMatrix();chase.lookAt(look);chase.updateMatrixWorld(true);pipe.setViewCamera?.(chase);
   handRoot.visible=!pipe.photo;handRoot.position.fromArray(spec.view.controllerPosition).applyQuaternion(chase.quaternion).add(chase.position);handRoot.quaternion.copy(chase.quaternion).multiply(q.setFromEuler(new THREE.Euler(...spec.view.controllerRotation)));
   // Fine mechanical animation, shared original controller geometry.
   const stick=handRoot.children[0];if(stick){const input=getInput();stick.rotation.x=Math.sin(clock*1.8)*.012+input.throttle*.025;stick.rotation.z=-input.steer*.035;}
  }else if(chaseStarted)stopDriving();
  if(clock%(1/10)<dt)aim();renderUI();return!!h||state.cars.some(c=>c.status==='active');
 }
 function setNetwork(adapter){
  generation++;pending=false;exitRequested=false;stopDriving();if(adapter&&!network)savedSolo=sim?.snapshot();network=adapter||null;players=[];heldId=null;seq=0;lastInput='';
  if(!adapter&&sim){if(savedSolo)sim.restore(savedSolo);savedSolo=null;state=sim.snapshot();accept(state);}else state=state?{...state,cars:state.cars.map(c=>({...c,owner:null,status:'ready'}))}:null;
 }
 const stop=e=>{e.preventDefault();e.stopImmediatePropagation();};
 function onKey(e){if(typing(e)||e.metaKey||e.ctrlKey||e.altKey)return;const h=held();if(h&&!exitRequested){
   if(movementKeys.has(e.code)){keys.add(e.code);if(!e.repeat)sendInput(true);stop(e);}
   else if(['Escape','KeyQ','KeyE'].includes(e.code)){if(!e.repeat)command('release',h.id);stop(e);}
   else if(e.code==='KeyC'){if(!e.repeat)resetCamera();stop(e);}
   else if(e.code==='KeyR'){if(!e.repeat)command('respawn',h.id);stop(e);}
   else if(/^Digit[1-5]$/.test(e.code)||e.code==='KeyF'){stop(e);}
  }else if(e.code==='KeyE'&&!e.repeat&&aimed){command('take',aimed.id);stop(e);}}
 function onUp(e){if(!keys.has(e.code))return;keys.delete(e.code);sendInput(true);if(held())stop(e);}
 function onBlur(){keys.clear();orbit?.cancel();sendInput(true);}
 function resetCamera(){orbit?.reset();requestRender();}
 function onPointer(e){if(e.target!==canvas)return;if(held()&&!exitRequested){if(e.button===0||e.button===2){orbit?.down(e.pointerId,e.clientX,e.clientY);try{canvas.setPointerCapture(e.pointerId);}catch{}stop(e);}}else if(aimed&&e.button===0&&getVM?.()?.weapon==='none'){command('take',aimed.id);stop(e);}}
 function onPointerMove(e){if(!held()||exitRequested||!orbit)return;const locked=document.pointerLockElement===canvas;const used=locked?orbit.look(e.movementX,e.movementY):orbit.move(e.pointerId,e.clientX,e.clientY);if(used){requestRender();stop(e);}}
 function onPointerEnd(e){if(orbit?.up(e.pointerId))stop(e);}
 function onPointerCancel(e){orbit?.cancel();keys.clear();sendInput(true);if(held()&&!exitRequested)stop(e);}
 function onLockedMouseMove(e){if(document.pointerLockElement===canvas&&held()&&!exitRequested){stop(e);}}
 function onWheel(e){if(e.target!==canvas||!held()||exitRequested||!orbit)return;const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?innerHeight:1);if(orbit.zoom(delta)){requestRender();stop(e);}}
 window.addEventListener('keydown',onKey,true);window.addEventListener('keyup',onUp,true);window.addEventListener('blur',onBlur);window.addEventListener('pointerdown',onPointer,true);window.addEventListener('pointermove',onPointerMove,true);window.addEventListener('mousemove',onLockedMouseMove,true);window.addEventListener('pointerup',onPointerEnd,true);window.addEventListener('pointercancel',onPointerCancel,true);window.addEventListener('wheel',onWheel,{capture:true,passive:false});
 take.onclick=()=>command('take',aimed?.id);exit.onclick=()=>command('release');reset.onclick=()=>command('respawn');follow.onclick=resetCamera;
 const ready=retry(()=>fetch('spec/rc.json').then(r=>{if(!r.ok)throw Error('rc_config');return r.json();})).then(async data=>{
  if(disposed)return;spec=data;orbit=createRCOrbit(spec.view.orbit);resetCamera();sim=createRCSimulation({spec,site});predictor=createRCSimulation({spec,site});state=sim.snapshot();
  const url=assetUrl(spec.asset),loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);const gltf=await track(retry(()=>loader.loadAsync(url)),{label:'Гараж радиомашинок',url});source=gltf.scene;if(disposed){releaseResources();return;}
  table=source.getObjectByName('rc_table').clone(true);table.position.fromArray(spec.table.position);root.add(table);
  for(const car of state.cars){
   const template=source.getObjectByName('rc_'+car.designId);if(!template)throw Error('rc_car_model:'+car.designId);const view=template.clone(true);view.name='rc_car_'+car.id;view.userData.rcId=car.id;view.userData.wheels=['wheel_FL','wheel_FR','wheel_RL','wheel_RR'].map(prefix=>view.children.find(c=>c.name.startsWith(prefix)));view.userData.body=view.children.find(c=>c.name.startsWith('body'));view.visible=false;view.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;}});root.add(view);carViews.set(car.id,view);
   const controller=makeController(car.color),c=sim.controllers.find(c=>c.id===car.id);controller.position.fromArray(c.position);controller.userData.rcId=car.id;controllerViews.set(car.id,controller);root.add(controller);
  }
  overlay=createPartyOverlay({THREE,renderer,scene,camera:chase,pipe,root:handRoot,active:()=>!!held()&&active()});
  detachTarget=addTargets({raycast(raycaster){if(network)return null;const r=sim.raycast(raycaster.ray.origin.toArray(),raycaster.ray.direction.toArray(),raycaster.far);if(!r)return null;return{distance:r.distance,point:new THREE.Vector3().fromArray(r.point),normal:new THREE.Vector3(0,1,0),object:carViews.get(r.id),surface:{albedo:[.44,.50,.54],solid:true,flesh:false,metal:true},hit(weaponId,damage){sim.damage(r.id,damage);accept(sim.snapshot());requestRender();}};}});
  accept(state);requestRender();
 });
 function releaseResources(){const resources=new Set();source?.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){resources.add(m);for(const v of Object.values(m))if(v?.isTexture)resources.add(v);}});for(const r of resources)r.dispose?.();source=null;}
 return{ready,update,command,setNetwork,applyNetwork:accept,get config(){return spec;},snapshot:()=>state,get controlling(){return!!held();},get held(){return held();},get target(){return aimed;},get viewCamera(){return held()&&!exitRequested?chase:null;},get controllers(){return sim?.controllers||[];},get colliders(){if(!spec)return[];const t=spec.table,p=t.position,w=t.size[0]/2,d=t.size[2]/2;return[{x0:p[0]-w,x1:p[0]+w,z0:p[2]-d,z1:p[2]+d}];},dispose(){disposed=true;generation++;stopDriving();sceneIndex.release();window.removeEventListener('keydown',onKey,true);window.removeEventListener('keyup',onUp,true);window.removeEventListener('blur',onBlur);window.removeEventListener('pointerdown',onPointer,true);window.removeEventListener('pointermove',onPointerMove,true);window.removeEventListener('mousemove',onLockedMouseMove,true);window.removeEventListener('pointerup',onPointerEnd,true);window.removeEventListener('pointercancel',onPointerCancel,true);window.removeEventListener('wheel',onWheel,true);detachTarget?.();overlay?.dispose();sim?.dispose();predictor?.dispose();for(const o of [...controllerViews.values(),...remoteViews.values(),...handRoot.children])releaseController(o);root.removeFromParent();remoteRoot.removeFromParent();panel.remove();take.remove();touch.remove();releaseResources();}};
}
const CSS=`
.rc-hud{position:fixed;z-index:30;left:50%;top:calc(env(safe-area-inset-top,0px) + 16px);transform:translateX(-50%);display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:center;max-width:min(780px,94vw);padding:12px 16px;border:1px solid #ffffff25;border-radius:18px;background:#15232af2;box-shadow:0 6px 28px #0004;color:#f1f5ee;font:13px/1.4 system-ui;backdrop-filter:blur(12px)}.rc-hud[hidden],.rc-take[hidden],.rc-touch[hidden]{display:none!important}.rc-title{font-size:15px}.rc-stats{font-variant-numeric:tabular-nums;white-space:nowrap}.rc-hint{flex-basis:100%;text-align:center;font-size:12px;color:#d2dccd}.rc-hud button,.rc-take,.rc-control{font:600 13px system-ui;color:#f1f5ee;border:1px solid #ffffff35;border-radius:11px;padding:10px 14px;background:#31454d;cursor:pointer;touch-action:none}.rc-hud .rc-exit{background:#eff5e9;color:#182b2b;min-height:44px}.rc-hud button:focus-visible,.rc-take:focus-visible,.rc-control:focus-visible{outline:3px solid #c9ec70;outline-offset:3px}.rc-hud button:disabled{opacity:.55;cursor:wait}.rc-take{position:fixed;z-index:12;left:50%;bottom:calc(var(--hud-bottom,76px) + 20px);transform:translateX(-50%);background:#163830f0;max-width:92vw}.rc-control{position:fixed;z-index:31;min-height:58px;min-width:64px;background:#213a40ed}.rc-left{left:16px;bottom:160px}.rc-right{left:92px;bottom:160px}.rc-gas{right:16px;bottom:225px;min-width:110px;background:#487b42ed}.rc-reverse{right:16px;bottom:160px;min-width:110px}.rc-brake{right:16px;bottom:95px;min-width:110px;background:#86543bed}.rc-control:active{filter:brightness(1.3);transform:scale(.97)}body.rc-controlling .title-card,body.rc-controlling #hud-bottom,body.rc-controlling #panel,body.rc-controlling #panel-toggle,body.rc-controlling #kh-score,body.rc-controlling .kh-score,body.rc-controlling #kh-hud,body.rc-controlling .kh-hud,body.rc-controlling #coach,body.rc-controlling .party-hud,body.rc-controlling .khh-hint,body.rc-controlling #kw-dock,body.rc-controlling .tv-layer,body.rc-controlling .kw-jump,body.rc-controlling .kw-joy,body.rc-controlling .kd-hint,body.rc-controlling .ks-hint{visibility:hidden!important}
@media(max-width:650px){.rc-hud{top:calc(env(safe-area-inset-top,0px) + 12px);padding:10px;gap:7px;width:calc(100vw - 24px);box-sizing:border-box}.rc-title{font-size:13px}.rc-hud button{padding:9px 12px;font-size:12px}.rc-hint{font-size:11px}.rc-hud .rc-exit{margin-left:auto}.rc-stats{font-size:12px}}@media(prefers-reduced-motion:reduce){.rc-control:active{transform:none}}
`;
