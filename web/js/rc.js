// RC presentation/input adapter. Ownership/HP live in rc-state.js; cannon-es
// predicts the local car immediately while host snapshots reconcile the result.
// The original player camera stays on the balcony; only the car receives drive input.
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {createRCSimulation} from './rc-state.js';
import {modelOriginFromChassis} from './rc-vehicle-layout.js';
import {createRCViewControls} from './rc-camera.js';
import {createRCHud} from './rc-hud.js';
import {assetUrl,track,retry} from './loading.js';
import {addTargets} from './hunt.js';
import {injectStyle} from './minimap.js';
import {addHelp} from './help.js';
import {createPartyOverlay} from './party-overlay.js';
import {acquireSceneIndex} from './scene-index.js';
import {isTransient} from './network-objects.js';
addHelp(
 {mode:'walk',topic:'rc',keys:['E'],text:'взять пульт на столике слева на балконе — появится своя машинка',order:68},
 {mode:'walk',topic:'rc',keys:['W','A','S','D'],text:'в режиме управления машинкой: W — газ, S — назад, A / D — руль, Пробел — тормоз',order:69},
 {mode:'walk',topic:'rc',keys:['Esc'],text:'закончить гонку; R — вернуть или починить машинку',order:70}
);
const typing=e=>e.target?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName);
const movementKeys=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space']);
export function createRC({THREE,scene,camera,renderer,canvas,pipe,site,getWalk,getSeats,getVM,getParty,getTV,getPaper,beforeCarry,requestRender=()=>{}}){
 let spec=null,sim=null,predictor=null,state=null,network=null,source=null,disposed=false,pending=false,generation=0,aimed=null,heldId=null,heldMode=null,players=[],clock=0,sendClock=0,seq=0,lastInput='',savedSolo=null,statusMessage='',exitRequested=false,viewControls=null,focusPending=false;
 const sceneIndex=acquireSceneIndex(scene),bounds=new THREE.Box3();
 const ownsCanvasTabIndex=!canvas.hasAttribute('tabindex');if(ownsCanvasTabIndex)canvas.tabIndex=0;
 function focusViewport(){if(!document.activeElement?.matches?.('input,textarea,select,[contenteditable="true"]'))canvas.focus({preventScroll:true});}
 const root=new THREE.Group();root.name='rc_world';root.userData.rasterOnly=true;root.userData.networkEntity=true;root.userData.networkDynamic=true;scene.add(root);
 const remoteRoot=new THREE.Group();remoteRoot.name='rc_remote_controllers';remoteRoot.userData.networkEntity=true;remoteRoot.userData.rasterOnly=true;scene.add(remoteRoot);
 const handRoot=new THREE.Group();handRoot.name='rc_held_controller';handRoot.userData.viewmodel=true;handRoot.userData.rasterOnly=true;
 const handCamera=camera.clone();
 const ray=new THREE.Raycaster(),ndc=new THREE.Vector2(),v=new THREE.Vector3(),look=new THREE.Vector3(),q=new THREE.Quaternion(),desired=new THREE.Vector3();
 const originBuffer=new Float64Array(3);
 const carViews=new Map(),controllerViews=new Map(),remoteViews=new Map(),keys=new Set(),pendingInputs=[],predictionOffset=new THREE.Vector3(),coarse=matchMedia('(pointer:coarse)');let overlay=null,detachTarget=null,table=null,boundary=null,driverRing=null;const runtimeResources=new Set();let uiKey='',markerKey='';
 injectStyle('rc-style',CSS);
 const hud=createRCHud({onExit:()=>command('release'),onReset:()=>command('respawn'),onFocus:()=>focusCar(),onMode:()=>switchControlMode(),onDismiss:()=>focusViewport()}),panel=hud.panel;
 const take=document.createElement('button');take.type='button';take.className='rc-take kw-float';take.hidden=true;document.body.append(take);
 let markerTop=160;
 const hudObserver=new ResizeObserver(()=>{markerTop=Math.max(88,panel.getBoundingClientRect().bottom+44);});hudObserver.observe(panel);
 const marker=document.createElement('button');marker.type='button';marker.className='rc-driver-marker';marker.hidden=true;marker.setAttribute('aria-label','Найти свою радиомашинку');document.body.append(marker);
 const touch=document.createElement('div');touch.className='rc-touch';touch.hidden=true;document.body.append(touch);
 const controls=[['left','←','Повернуть влево','KeyA'],['right','→','Повернуть вправо','KeyD'],['gas','Вперёд ↑','Ехать вперёд','KeyW'],['reverse','Назад ↓','Ехать назад','KeyS'],['brake','Тормоз','Тормоз','Space']];
 for(const [name,label,aria,key]of controls){const b=document.createElement('button');b.type='button';b.className='rc-control rc-'+name;b.textContent=label;b.setAttribute('aria-label',aria);b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keys.add(key);sendInput(true);});for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,()=>{keys.delete(key);sendInput(true);});touch.append(b);}
 const active=()=>!!getWalk?.()?.walking&&!getSeats?.()?.active&&!pipe.photo;
 const presenting=()=>!!(getWalk?.()?.active||getSeats?.()?.active)&&!pipe.photo;
 const selfId=()=>network?(typeof network.selfId==='function'?network.selfId():network.selfId):'solo';
 const held=()=>state?.cars.find(c=>c.owner===selfId())||null;
 const isDriving=()=>held()?.controlMode==='drive'&&!exitRequested;
 const pose=()=>({id:'solo',x:camera.position.x,y:camera.position.y-(getWalk?.()?.eyeHeight||1.68),z:camera.position.z});
 const design=id=>spec?.designs.find(d=>d.id===id);
 function makeController(color){const t=source.getObjectByName('controller');if(!t)throw Error('rc_controller_model');const o=t.clone(true);o.traverse(m=>{if(m.isMesh){m.castShadow=false;m.receiveShadow=false;}});const badge=new THREE.Mesh(new THREE.BoxGeometry(.105,.005,.017),new THREE.MeshStandardMaterial({color,roughness:.4,metalness:.1}));badge.name='rc_controller_color';badge.position.set(0,.079,.033);o.add(badge);return o;}
 function releaseController(o){o?.getObjectByName('rc_controller_color')?.geometry.dispose();o?.getObjectByName('rc_controller_color')?.material.dispose();}
 function stopDriving(){keys.clear();viewControls?.reset();getWalk?.()?.setViewMagnification?.(1);pendingInputs.length=0;predictionOffset.set(0,0,0);handRoot.visible=false;marker.hidden=true;if(driverRing)driverRing.visible=false;document.body.classList.remove('rc-controlling','rc-holding');}
 function accept(next,context={}){
  if(!next)return;const oldHeld=held(),oldPred=network&&predictor?.pose(heldId);state=next;players=context.players||players;
  const h=held();if(h?.id!==heldId||h?.controlMode!==heldMode){
   const changedItem=h?.id!==heldId;stopDriving();if(changedItem){releaseController(handRoot.children[0]);handRoot.clear();}
   heldId=h?.id||null;heldMode=h?.controlMode||null;exitRequested=false;seq=h?.inputSeq||0;lastInput='';sendClock=0;
   if(h&&source){focusPending=h.controlMode==='drive';getWalk?.()?.setViewMagnification?.(h.controlMode==='drive'?spec.view.zoom.initial:1);getVM?.()?.setWeapon('none');if(changedItem){handRoot.add(makeController(h.color));const hands=source.getObjectByName('controller_hands');if(hands)handRoot.add(hands.clone(true));}}
  }
  if(network&&predictor){
   predictor.restore(next);
   const ack=h?.inputSeq||0;while(pendingInputs.length&&pendingInputs[0].input.seq<=ack)pendingInputs.shift();
   for(const entry of pendingInputs){predictor.command({id:selfId()},'input',entry.id,entry.input);predictor.step(entry.dt);}
   if(h&&oldHeld?.id===h.id&&oldPred){const now=predictor.pose(h.id);if(now&&oldPred.position){predictionOffset.add(v.fromArray(oldPred.position).sub(new THREE.Vector3().fromArray(now.position)));if(predictionOffset.length()>4)predictionOffset.set(0,0,0);}}
  }
  renderUI();
 }
 function switchControlMode(){
  const h=held();if(!h||pending)return;
  const verb=isDriving()?'pause':'drive';if(verb==='pause'){keys.clear();sendInput(true);viewControls?.cancel();}
  return command(verb,h.id,{seq});
 }
 async function command(verb,id=held()?.id||aimed?.id,input){
  if(!sim||pending&&verb!=='input'||!id)return{ok:false,error:'rc_pending'};
  if(verb==='release'){exitRequested=true;stopDriving();renderUI();}
  if(['take','drive'].includes(verb)&&!active())return{ok:false,error:'rc_not_walking'};
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
   if(result?.ok){statusMessage='';if(verb!=='input')focusViewport();}else if(verb==='release'&&(!network?.ready||network.ready()))exitRequested=false;return result;
  }catch{if(token===generation)statusMessage='Связь прервалась. Попробуйте ещё раз';return{ok:false,error:'rc_network'};}
  finally{if(token===generation&&verb!=='input'){pending=false;renderUI();requestRender();}}
 }
 function getInput(){return{throttle:(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0),steer:(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0),brake:keys.has('Space')};}
 function sendInput(force=false){
  const h=held();if(!h||!isDriving()||h.status!=='active'||exitRequested)return;const input=getInput(),key=JSON.stringify(input);
  if(pending)return;
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
  const h=held(),can=!!h&&presenting()&&!exitRequested,flipped=!!h?.quaternion&&1-2*(h.quaternion[0]**2+h.quaternion[2]**2)<.3;const key=[h?.id,h?.hp,h?.status,Math.round(Math.abs(h?.speed||0)*3.6),Math.ceil((h?.respawnAt||0)-(state?.time||0)),h?.atBoundary,pending,can,flipped,h?.controlMode,active(),coarse.matches,aimed?.id,statusMessage,network?.ready?.()].join('|');if(key===uiKey)return;uiKey=key;touch.hidden=!can||!isDriving()||!coarse.matches;
  if(h){const d=design(h.designId),remaining=Math.max(0,Math.ceil((h.respawnAt||0)-(state?.time||0)));
   const connected=!network||!network.ready||network.ready(),wrecked=h.status==='wrecked';
   const message=statusMessage||(!connected?'Связь восстанавливается · машинка на паузе':wrecked?(remaining?`Машинка разбита · ремонт ${remaining} с`:'Машинка готова к ремонту'):flipped?'Машинка перевернулась':h.atBoundary?'Край поля · поверните обратно':h.controlMode==='carry'&&!active()?'Встаньте, чтобы управлять машинкой':'');
   hud.update({active:can,name:d?.name||'Радиомашинка',color:h.color,velocity:h.speed||0,hp:h.hp,maxHp:h.maxHp,status:h.status,remaining,pending,coarse:coarse.matches,message,needsRecovery:flipped||wrecked,controlMode:h.controlMode,canDrive:active()});
  }else hud.update({active:false});
  take.hidden=!aimed||!!h||!active();take.textContent=`${coarse.matches?'':'E · '}Взять пульт${aimed?' · '+design(aimed.designId).name:''}`;take.disabled=pending;
  document.body.classList.toggle('rc-controlling',can&&isDriving());document.body.classList.toggle('rc-holding',can);
 }
 function animateCar(view,car,dt,local=false){
  view.visible=car.status!=='ready';if(!view.visible)return;
  const layout=design(car.designId).vehicle;
  desired.fromArray(modelOriginFromChassis(car.position,car.quaternion,layout.centerOfMass,originBuffer));
  if(local)desired.add(predictionOffset);
  q.fromArray(car.quaternion);const k=local?1:1-Math.exp(-spec.physics.remoteSmooth*dt);
  if(!view.userData.seen){view.position.copy(desired);view.quaternion.copy(q);view.userData.seen=true;}else{view.position.lerp(desired,k);view.quaternion.slerp(q,k);}
  view.updateMatrixWorld(true);
  for(let i=0;i<4;i++){
   const wheel=view.userData.wheels[i],w=car.wheels?.[i];if(!wheel||!w)continue;
   v.fromArray(w.position);if(local)v.add(predictionOffset);view.worldToLocal(v);wheel.position.copy(v);
   wheel.quaternion.copy(view.quaternion).invert().multiply(q.fromArray(w.quaternion)).multiply(wheel.userData.bindQuaternion);
  }
  view.userData.body.scale.y=car.status==='wrecked'?.7:1;
 }
 function createArenaPresentation(){
  boundary=new THREE.Group();boundary.name='rc_arena_boundary';boundary.visible=false;root.add(boundary);
  const mat=new THREE.LineBasicMaterial({color:spec.view.boundaryColor,transparent:true,opacity:spec.view.boundaryOpacity,depthWrite:false});runtimeResources.add(mat);
  for(const contour of sim.arena.contours){const points=contour.points.map(p=>new THREE.Vector3(p[0],-site.floorY+.045,p[1]));const geometry=new THREE.BufferGeometry().setFromPoints(points);runtimeResources.add(geometry);boundary.add(new THREE.LineLoop(geometry,mat));}
  const geometry=new THREE.TorusGeometry(1,.018,4,48),material=new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.7,depthWrite:false,toneMapped:false});
  runtimeResources.add(geometry);runtimeResources.add(material);driverRing=new THREE.Mesh(geometry,material);driverRing.name='rc_driver_ring';driverRing.userData.rcDriverMarker=true;driverRing.rotation.x=-Math.PI/2;driverRing.visible=false;root.add(driverRing);
 }
 function updateDriverMarker(car){
  const visible=!!car&&presenting()&&!exitRequested;marker.hidden=!visible;if(driverRing)driverRing.visible=visible;
  if(!visible)return;
  const d=design(car.designId),view=carViews.get(car.id);if(!view)return;
  driverRing.position.set(view.position.x,-site.floorY+.04,view.position.z);driverRing.scale.set(d.width*.85,d.length*.62,1);driverRing.material.color.set(car.color);driverRing.userData.rcId=car.id;
  look.copy(view.position);look.y+=spec.view.markerHeight;
  const distance=Math.round(camera.position.distanceTo(look));v.copy(look).project(camera);
  const behind=v.z>1||v.z< -1,off=behind||Math.abs(v.x)>.9||Math.abs(v.y)>.84;
  const x=(behind?-v.x:v.x)*.5+.5,y=(behind?v.y:-v.y)*.5+.5;
  const px=Math.max(74,Math.min(innerWidth-74,x*innerWidth)),py=Math.max(markerTop,Math.min(innerHeight-200,y*innerHeight));
  marker.style.transform=`translate3d(${px}px,${py}px,0) translate(-50%,-100%)`;marker.style.borderColor=car.color;
  const key=[car.id,distance,off].join('|');if(key!==markerKey){markerKey=key;marker.textContent=`${off?'↗ ':''}${d.name} · ${distance} м`;marker.dataset.offscreen=String(off);marker.dataset.rcId=car.id;}
 }
 function update(dt){
  if(!sim||!source||disposed)return false;clock+=dt;sendClock+=dt;
  const h=held();if(h&&(!presenting()||exitRequested)&&!pending&&(!network?.ready||network.ready()))command('release',h.id);
  if(isDriving())sendInput();if(!network&&state.cars.some(c=>c.owner)){sim.step(dt);state={...state,time:sim.time,cars:state.cars.map(c=>c.owner?sim.pose(c.id):c)};}else if(network&&predictor&&(!network.ready||network.ready())&&h)predictor.step(dt);
  const predicted=network&&predictor&&isDriving()?predictor.pose(h.id):null;predictionOffset.multiplyScalar(Math.exp(-12*dt));
  for(const car of state.cars){const local=car.owner===selfId()&&car.controlMode==='drive',display=local&&predicted?predicted:car;animateCar(carViews.get(car.id),display,dt,local);const c=controllerViews.get(car.id);c.visible=!car.owner;
   let remote=remoteViews.get(car.id);if(car.owner&&car.owner!==selfId()&&!remote){remote=makeController(car.color);remoteViews.set(car.id,remote);remoteRoot.add(remote);}if(remote){const p=players.find(p=>p.id===car.owner);remote.visible=!!p&&car.owner!==selfId();if(remote.visible){const grip=network?.gripForPlayer?.(car.owner);if(grip){grip.getWorldPosition(remote.position);grip.getWorldQuaternion(remote.quaternion);remote.position.add(v.set(-.11,0,0).applyQuaternion(remote.quaternion));}else{const yaw=p.lookYaw??p.yaw??0;remote.position.set(p.x+Math.cos(yaw)*.12,(p.eyeY??p.y+1.68)-.55,p.z-Math.cos(yaw)*.3);remote.rotation.set(-.25,yaw,0);}}}
  }
  if(h&&presenting()&&!exitRequested){
   if(focusPending){focusPending=false;focusCar();}
   handCamera.position.copy(camera.position);handCamera.quaternion.copy(camera.quaternion);handCamera.aspect=camera.aspect;handCamera.fov=Math.min(spec.view.controllerMaxFov,2*Math.atan(Math.tan(spec.view.controllerFov*Math.PI/360)/Math.min(1,camera.aspect))*180/Math.PI);handCamera.updateProjectionMatrix();handCamera.updateMatrixWorld(true);
   handRoot.visible=!pipe.photo;
   handRoot.position.fromArray(spec.view.controllerPosition).applyQuaternion(camera.quaternion).add(camera.position);
   handRoot.quaternion.copy(camera.quaternion).multiply(q.setFromEuler(new THREE.Euler(...spec.view.controllerRotation)));
   const stick=handRoot.children[0];if(stick){const input=getInput();stick.rotation.x=Math.sin(clock*1.8)*.012+input.throttle*.025;stick.rotation.z=-input.steer*.035;}
  }else handRoot.visible=false;
  if(boundary)boundary.visible=state.cars.some(c=>c.status!=='ready');updateDriverMarker(h);
  if(clock%(1/10)<dt)aim();renderUI();return!!h||state.cars.some(c=>c.status==='active');
 }
 function setNetwork(adapter){
  generation++;pending=false;exitRequested=false;stopDriving();if(adapter&&!network)savedSolo=sim?.snapshot();network=adapter||null;players=[];heldId=null;heldMode=null;seq=0;lastInput='';
  if(!adapter&&sim){if(savedSolo)sim.restore(savedSolo);savedSolo=null;state=sim.snapshot();accept(state);}else state=state?{...state,cars:state.cars.map(c=>({...c,owner:null,status:'ready'}))}:null;
 }
 const stop=e=>{e.preventDefault();e.stopImmediatePropagation();};
 function onKey(e){if(typing(e)||e.metaKey||e.ctrlKey||e.altKey||e.code==='Space'&&e.target?.closest?.('button'))return;const h=held();if(h&&!exitRequested){
   if(isDriving()&&movementKeys.has(e.code)){keys.add(e.code);if(!e.repeat)sendInput(true);stop(e);}
   else if(['Escape','KeyQ'].includes(e.code)||e.code==='KeyE'&&isDriving()){if(!e.repeat)command('release',h.id);stop(e);}
   else if(e.code==='KeyC'){if(!e.repeat)focusCar();stop(e);}
   else if(e.code==='KeyR'){if(!e.repeat)command('respawn',h.id);stop(e);}
   else if(isDriving()&&(/^Digit[1-5]$/.test(e.code)||e.code==='KeyF')){stop(e);}
  }else if(e.code==='KeyE'&&!e.repeat&&aimed){command('take',aimed.id);stop(e);}}
 function onUp(e){if(!keys.has(e.code))return;keys.delete(e.code);sendInput(true);if(held())stop(e);}
 function onBlur(){keys.clear();viewControls?.cancel();sendInput(true);}
 function focusCar(){
  const h=held();if(!h||!spec)return false;
  const point=[...h.position];point[1]+=spec.view.focusHeight;
  const changed=getWalk?.()?.lookAtPoint?.(point)||false;if(changed)focusViewport();return changed;
 }
 function onPointer(e){
  if(e.target!==canvas)return;
  if(isDriving()){if(e.button===0||e.button===2){canvas.focus({preventScroll:true});viewControls?.down(e.pointerId,e.clientX,e.clientY,e.pointerType==='touch'?'touch':'mouse');try{canvas.setPointerCapture(e.pointerId);}catch{}stop(e);}}
  else if(aimed&&e.button===0&&getVM?.()?.weapon==='none'){command('take',aimed.id);stop(e);}
 }
 function onPointerMove(e){
  if(!isDriving()||!viewControls)return;
  if(document.pointerLockElement===canvas)return;
  const action=viewControls.move(e.pointerId,e.clientX,e.clientY);if(!action)return;
  if(action.zoom)getWalk?.()?.setViewMagnification?.(action.magnification);
  else getWalk?.()?.lookByPixels?.(action.dx,action.dy,spec.view.lookSensitivity[action.type]);
  requestRender();stop(e);
 }
 function onPointerEnd(e){if(viewControls?.up(e.pointerId))stop(e);}
 function onPointerCancel(e){viewControls?.cancel();keys.clear();sendInput(true);if(isDriving())stop(e);}
 function onLockedMouseMove(e){if(document.pointerLockElement===canvas&&isDriving()){getWalk?.()?.lookByPixels?.(e.movementX,e.movementY,spec.view.lookSensitivity.locked);stop(e);}}
 function onWheel(e){if(e.target!==canvas||!isDriving()||!viewControls)return;const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?innerHeight:1);if(viewControls.wheel(delta)){getWalk?.()?.setViewMagnification?.(viewControls.snapshot().magnification);requestRender();stop(e);}}
 window.addEventListener('keydown',onKey,true);window.addEventListener('keyup',onUp,true);window.addEventListener('blur',onBlur);window.addEventListener('pointerdown',onPointer,true);window.addEventListener('pointermove',onPointerMove,true);window.addEventListener('mousemove',onLockedMouseMove,true);window.addEventListener('pointerup',onPointerEnd,true);window.addEventListener('pointercancel',onPointerCancel,true);window.addEventListener('wheel',onWheel,{capture:true,passive:false});
 take.onclick=()=>command('take',aimed?.id);marker.onclick=focusCar;
 const ready=retry(()=>fetch('spec/rc.json').then(r=>{if(!r.ok)throw Error('rc_config');return r.json();})).then(async data=>{
  if(disposed)return;spec=data;viewControls=createRCViewControls(spec.view.zoom);sim=createRCSimulation({spec,site});predictor=createRCSimulation({spec,site});state=sim.snapshot();
  const url=assetUrl(spec.asset),loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);const gltf=await track(retry(()=>loader.loadAsync(url)),{label:'Гараж радиомашинок',url});source=gltf.scene;if(disposed){releaseResources();return;}
  table=source.getObjectByName('rc_table').clone(true);table.position.fromArray(spec.table.position);root.add(table);
  for(const car of state.cars){
   const template=source.getObjectByName('rc_'+car.designId);if(!template)throw Error('rc_car_model:'+car.designId);const view=template.clone(true);view.name='rc_car_'+car.id;view.userData.rcId=car.id;view.userData.wheels=design(car.designId).vehicle.wheels.map(def=>{const pivot=view.getObjectByName(def.node);if(!pivot||pivot.isMesh)throw Error('rc_wheel_pivot:'+def.node);pivot.userData.bindQuaternion=pivot.quaternion.clone();return pivot;});view.userData.body=view.getObjectByName(design(car.designId).vehicle.bodyNode);if(!view.userData.body)throw Error('rc_body_node:'+car.designId);view.visible=false;view.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;}});root.add(view);carViews.set(car.id,view);
   const controller=makeController(car.color),c=sim.controllers.find(c=>c.id===car.id);controller.position.fromArray(c.position);controller.userData.rcId=car.id;controllerViews.set(car.id,controller);root.add(controller);
  }
  createArenaPresentation();
  overlay=createPartyOverlay({THREE,renderer,scene,camera:handCamera,pipe,root:handRoot,active:()=>!!held()&&presenting()&&!exitRequested});
  detachTarget=addTargets({raycast(raycaster){if(network)return null;const r=sim.raycast(raycaster.ray.origin.toArray(),raycaster.ray.direction.toArray(),raycaster.far);if(!r)return null;return{distance:r.distance,point:new THREE.Vector3().fromArray(r.point),normal:new THREE.Vector3(0,1,0),object:carViews.get(r.id),surface:{albedo:[.44,.50,.54],solid:true,flesh:false,metal:true},hit(weaponId,damage){sim.damage(r.id,damage);accept(sim.snapshot());requestRender();}};}});
  accept(state);requestRender();
 });
 function releaseResources(){const resources=new Set();source?.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){resources.add(m);for(const v of Object.values(m))if(v?.isTexture)resources.add(v);}});for(const r of resources)r.dispose?.();source=null;}
 return{ready,update,command,setNetwork,applyNetwork:accept,get config(){return spec;},snapshot:()=>state,get controlling(){return held()?.controlMode==='drive';},get isDriving(){return held()?.controlMode==='drive';},get held(){return held();},get target(){return aimed;},get viewCamera(){return isDriving()?camera:null;},get controllers(){return sim?.controllers||[];},get colliders(){if(!spec)return[];const t=spec.table,p=t.position,w=t.size[0]/2,d=t.size[2]/2;return[{x0:p[0]-w,x1:p[0]+w,z0:p[2]-d,z1:p[2]+d}];},dispose(){disposed=true;generation++;if(ownsCanvasTabIndex&&canvas.getAttribute('tabindex')==='0')canvas.removeAttribute('tabindex');stopDriving();sceneIndex.release();window.removeEventListener('keydown',onKey,true);window.removeEventListener('keyup',onUp,true);window.removeEventListener('blur',onBlur);window.removeEventListener('pointerdown',onPointer,true);window.removeEventListener('pointermove',onPointerMove,true);window.removeEventListener('mousemove',onLockedMouseMove,true);window.removeEventListener('pointerup',onPointerEnd,true);window.removeEventListener('pointercancel',onPointerCancel,true);window.removeEventListener('wheel',onWheel,true);detachTarget?.();overlay?.dispose();sim?.dispose();predictor?.dispose();for(const o of [...controllerViews.values(),...remoteViews.values(),...handRoot.children])releaseController(o);root.removeFromParent();remoteRoot.removeFromParent();hud.dispose();take.remove();touch.remove();marker.remove();hudObserver.disconnect();for(const resource of runtimeResources)resource.dispose();runtimeResources.clear();releaseResources();}};
}
const CSS=`
.rc-driver-marker{position:fixed;left:0;top:0;z-index:12;max-width:170px;padding:5px 9px;border:1px solid;border-radius:12px;background:#18382de8;color:#fff;font:600 11px/1.3 system-ui;cursor:pointer;will-change:transform}.rc-driver-marker[hidden]{display:none}.rc-driver-marker[data-offscreen="true"]{background:#203e35f2}.rc-take[hidden],.rc-touch[hidden]{display:none!important}.rc-take,.rc-control{font:600 13px system-ui;color:#f1f5ee;border:1px solid #ffffff35;border-radius:11px;padding:10px 14px;background:#31454d;cursor:pointer;touch-action:none}.rc-take:focus-visible,.rc-control:focus-visible{outline:3px solid #c9ec70;outline-offset:3px}.rc-take{position:fixed;z-index:12;left:50%;bottom:calc(var(--hud-bottom,76px) + 20px);transform:translateX(-50%);background:#163830f0;max-width:92vw}.rc-control{position:fixed;z-index:31;min-height:58px;min-width:64px;background:#213a40ed}.rc-left{left:16px;bottom:160px}.rc-right{left:92px;bottom:160px}.rc-gas{right:16px;bottom:225px;min-width:110px;background:#487b42ed}.rc-reverse{right:16px;bottom:160px;min-width:110px}.rc-brake{right:16px;bottom:95px;min-width:110px;background:#86543bed}.rc-control:active{filter:brightness(1.3);transform:scale(.97)}body.rc-holding .title-card,body.rc-holding #hud-bottom,body.rc-holding #panel,body.rc-holding #panel-toggle,body.rc-holding #kh-score,body.rc-holding .kh-score,body.rc-holding #kh-hud,body.rc-holding .kh-hud,body.rc-holding #coach,body.rc-holding .party-hud,body.rc-holding .social-hud,body.rc-holding .social-radio,body.rc-holding .party-touch,body.rc-holding .khh-btn,body.rc-holding .khh-hint,body.rc-holding #kw-dock,body.rc-holding .tv-layer,body.rc-controlling .kw-jump,body.rc-controlling .kw-joy,body.rc-holding .kd-hint,body.rc-holding .ks-hint{visibility:hidden!important}
@media(max-height:480px){.rc-control{min-height:54px}.rc-left,.rc-right{bottom:calc(16px + env(safe-area-inset-bottom,0px))}.rc-gas{bottom:calc(78px + env(safe-area-inset-bottom,0px))}.rc-reverse{bottom:calc(16px + env(safe-area-inset-bottom,0px))}.rc-brake{right:140px;bottom:calc(16px + env(safe-area-inset-bottom,0px))}}
@media(prefers-reduced-motion:reduce){.rc-control:active{transform:none}}
`;
