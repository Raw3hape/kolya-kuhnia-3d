// Portable authoritative RC rules. The MIT cannon-es RaycastVehicle owns
// suspension, tire friction, engine/brake forces, rigid bodies and collisions.
// This adapter owns only intent, item ownership, arena policy and snapshots.
import * as CANNON from '../vendor/cannon-es-0.20.0/cannon-es.js';
import {getRCVehicleLayout,RC_VEHICLE_AXES as AXES} from './rc-vehicle-layout.js';
import {createPlayableField} from './playable-field.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>Number.isFinite(v);
const vec=a=>Array.isArray(a)&&a.length===3&&a.every(finite);
const round=n=>Math.round(n*10000)/10000;
// A carry-mode handbrake becomes a native static parking stand only after
// genuine support and sustained low motion. Dynamic mass is restored on drive.
const PARKING_POLICY=Object.freeze({linearSpeed:.16,angularSpeed:.35,settleSeconds:.15,brakeDeceleration:8});
export function createRCArena(spec,site){return createPlayableField({clearance:spec.arena.margin});}

export function controllerPositions(spec){
 const c=spec.controllers,t=spec.table.position,n=spec.designs.length;
 return spec.designs.map((d,i)=>({id:`rc-${i}`,designId:d.id,position:[t[0]+(i%c.columns-(c.columns-1)/2)*c.spacing[0],c.height,t[2]+(Math.floor(i/c.columns)-(Math.ceil(n/c.columns)-1)/2)*c.spacing[1]]}));
}
export function createRCSimulation({spec,site}){
 if(!spec?.physics||!site||!spec.designs?.length)throw Error('rc_config');
 const rules=spec.physics,arena=createRCArena(spec,site),ground=-(site.floorY||0),controllers=controllerPositions(spec);
 const world=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0)});world.allowSleep=true;world.broadphase=new CANNON.SAPBroadphase(world);world.solver.iterations=8;
 const groundBody=new CANNON.Body({mass:0,shape:new CANNON.Plane()});groundBody.quaternion.setFromEuler(-Math.PI/2,0,0);groundBody.position.y=ground;world.addBody(groundBody);
 const boundaryBodies=[];
 // Real perimeter contacts go through cannon-es, just like chassis collisions.
 // Static walls sit outside the visible contour. No attribute/radius barriers.
 const wall=spec.arena.boundaryWall;
 for(const contour of arena.contours){const r=contour.points;for(let i=0,j=r.length-1;i<r.length;j=i++){
  const a=r[j],b=r[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<1e-5)continue;
  let nx=-dz/length,nz=dx/length;const mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2;
  if(arena.inside(mx+nx*.02,mz+nz*.02)){nx=-nx;nz=-nz;}
  const body=new CANNON.Body({mass:0,shape:new CANNON.Box(new CANNON.Vec3(length/2+wall.thickness/2,wall.height/2,wall.thickness/2))});
  body.position.set(mx+nx*wall.thickness/2,ground+wall.height/2,mz+nz*wall.thickness/2);body.quaternion.setFromAxisAngle(new CANNON.Vec3(0,1,0),-Math.atan2(dz,dx));world.addBody(body);boundaryBodies.push(body);
 }}

 const cars=new Map(),physics=new Map();let time=0,accumulator=0;
 function spawnFor(index){
  const s=spec.arena.spawn,columns=s.columns;let p=[s.center[0]+(index%columns-(columns-1)/2)*s.spacing[0],s.center[1]+Math.floor(index/columns)*s.spacing[1]];
  const point=arena.nearestSafe(...p);if(point)return point;throw Error('rc_no_safe_spawn');
 }
 const neutral=()=>({throttle:0,steer:0,brake:false}),parked=()=>({throttle:0,steer:0,brake:true});
 function resetBody(car){
  setParking(car,false);const {body,vehicle,layout}=physics.get(car.id),[x,z]=spawnFor(car.index);
  body.quaternion.setFromEuler(0,spec.arena.spawn.heading,0);const centre=body.quaternion.vmult(new CANNON.Vec3(...layout.centerOfMass));body.position.set(x+centre.x,ground+centre.y+rules.spawnClearance,z+centre.z);body.velocity.setZero();body.angularVelocity.setZero();body.force.setZero();body.torque.setZero();body.wakeUp();
  car.input=car.controlMode==='drive'?neutral():parked();car.driveThrottle=0;car.steering=0;car.inputAt=time;car.resetAt=time;car.lastSafe=[x,z];car.speed=0;car.atBoundary=false;car.parkingStableSeconds=0;
  for(let i=0;i<4;i++){vehicle.setSteeringValue(0,i);vehicle.applyEngineForce(0,i);vehicle.setBrake(car.controlMode==='carry'?rules.brakeForce:0,i);const wheel=vehicle.wheelInfos[i];wheel.rotation=0;wheel.deltaRotation=0;wheel.suspensionLength=rules.suspension.restLength;wheel.steering=0;vehicle.updateWheelTransform(i);}
 }
 spec.designs.forEach((design,index)=>{
  const layout=getRCVehicleLayout(design,rules),id=`rc-${index}`,body=new CANNON.Body({mass:rules.mass,linearDamping:rules.linearDamping,angularDamping:rules.angularDamping,sleepSpeedLimit:.08,sleepTimeLimit:1.5});
  body.addShape(new CANNON.Box(new CANNON.Vec3(...layout.collider.halfExtents)),new CANNON.Vec3(...layout.collider.offset));
  // Bullet volumes include the cabin and wheels without changing driving physics.
  const shotBody=new CANNON.Body();
  shotBody.addShape(new CANNON.Box(new CANNON.Vec3(...layout.collider.halfExtents)),new CANNON.Vec3(...layout.collider.offset));
  const cabinHeight=Math.max(.03,(design.roof-layout.collider.center[1]-layout.collider.halfExtents[1])*.5);
  shotBody.addShape(new CANNON.Box(new CANNON.Vec3(design.width*.34,cabinHeight,design.length*.29)),
   new CANNON.Vec3(-layout.centerOfMass[0],design.roof-cabinHeight-layout.centerOfMass[1],-layout.centerOfMass[2]));
  for(const w of layout.wheels)shotBody.addShape(new CANNON.Box(new CANNON.Vec3(w.width*.45,w.radius*.79,w.radius*.79)),
   new CANNON.Vec3(...w.connection));
  body.angularFactor.set(...rules.angularFactor);
  const vehicle=new CANNON.RaycastVehicle({chassisBody:body,indexRightAxis:AXES.right,indexUpAxis:AXES.up,indexForwardAxis:AXES.forward}),s=rules.suspension;
  for(const wheel of layout.wheels)vehicle.addWheel({radius:wheel.radius,directionLocal:new CANNON.Vec3(...AXES.direction),axleLocal:new CANNON.Vec3(...AXES.axle),chassisConnectionPointLocal:new CANNON.Vec3(...wheel.connection),suspensionStiffness:s.stiffness,suspensionRestLength:s.restLength,frictionSlip:s.frictionSlip,dampingRelaxation:s.relaxation,dampingCompression:s.compression,maxSuspensionForce:rules.mass*70,maxSuspensionTravel:s.travel,rollInfluence:s.rollInfluence,customSlidingRotationalSpeed:-30,useCustomSlidingRotationalSpeed:true,isFrontWheel:wheel.front});
  const car={id,index,designId:design.id,color:design.color,owner:null,status:'ready',controlMode:'carry',parked:false,parkingStableSeconds:0,hp:rules.maxHp,maxHp:rules.maxHp,input:neutral(),inputAt:0,inputSeq:0,steering:0,driveThrottle:0,respawnAt:0,lastSafe:null,resetAt:-10,speed:0};
  cars.set(id,car);physics.set(id,{body,shotBody,vehicle,layout,dynamicMass:rules.mass,inWorld:false});resetBody(car);
 });
 const held=playerId=>[...cars.values()].find(c=>c.owner===playerId)||null;
 const isDriving=playerId=>held(playerId)?.controlMode==='drive';
 function clearDriveIntent(car){car.driveThrottle=0;if(car.controlMode==='drive')setParking(car,false);if(!car.parked)car.parkingStableSeconds=0;car.input=car.controlMode==='drive'?neutral():parked();car.inputAt=time;car.steering=0;const{vehicle,body}=physics.get(car.id);for(let i=0;i<vehicle.wheelInfos.length;i++){vehicle.applyEngineForce(0,i);vehicle.setSteeringValue(0,i);vehicle.setBrake(car.controlMode==='carry'?rules.brakeForce:rules.idleBrake,i);vehicle.updateWheelTransform(i);}if(!car.parked)body.wakeUp();}
 const error=reason=>({ok:false,error:reason});
 function add(car){const p=physics.get(car.id);if(!p.inWorld){p.vehicle.addToWorld(world);p.inWorld=true;if(car.parked)world.removeEventListener('preStep',p.vehicle.preStepCallback);}}
 function remove(car){const p=physics.get(car.id);if(p.inWorld){p.vehicle.removeFromWorld(world);p.inWorld=false;}}
 function setParking(car,on){
  const p=physics.get(car.id);if(!p)return;const{body,vehicle}=p;
  car.parked=on;car.parkingStableSeconds=on?PARKING_POLICY.settleSeconds:0;
  body.type=on?CANNON.Body.STATIC:CANNON.Body.DYNAMIC;body.mass=on?0:p.dynamicMass;body.updateMassProperties();body.aabbNeedsUpdate=true;world.broadphase.dirty=true;
  if(on){body.velocity.setZero();body.angularVelocity.setZero();body.force.setZero();body.torque.setZero();body.sleep();vehicle.currentVehicleSpeedKmHour=0;car.speed=0;for(const wheel of vehicle.wheelInfos)wheel.deltaRotation=0;if(p.inWorld)world.removeEventListener('preStep',vehicle.preStepCallback);}
  else{body.wakeUp();if(p.inWorld)world.addEventListener('preStep',vehicle.preStepCallback);}
 }
 function considerParking(car,dt){
  if(car.controlMode!=='carry'){car.parkingStableSeconds=0;return;}
  const{body,vehicle}=physics.get(car.id);
  const wheelSupport=vehicle.wheelInfos.every(w=>w.raycastResult.body===groundBody);
  const chassisSupport=world.contacts.some(c=>c.bi===body&&c.bj===groundBody||c.bj===body&&c.bi===groundBody);
  const still=body.velocity.lengthSquared()<=PARKING_POLICY.linearSpeed**2&&body.angularVelocity.lengthSquared()<=PARKING_POLICY.angularSpeed**2;
  car.parkingStableSeconds=car.controlMode==='carry'&&still&&(wheelSupport||chassisSupport)?car.parkingStableSeconds+dt:0;
  if(car.parkingStableSeconds+1e-9>=PARKING_POLICY.settleSeconds)setParking(car,true);
 }
 function releasePlayer(playerId){const car=held(playerId);if(!car)return false;remove(car);car.owner=null;car.status='ready';car.controlMode='carry';car.input=parked();car.hp=rules.maxHp;car.respawnAt=0;resetBody(car);return true;}
 function takeError(player,id){const car=cars.get(id);if(!player?.id)return'rc_player';if(player.seat)return'rc_seated';if(!car)return'rc_item';if(car.owner)return'rc_owned';const c=controllers[car.index];if(!finite(player.x)||!finite(player.z)||Math.hypot(player.x-c.position[0],player.z-c.position[2])>spec.controllers.reach)return'rc_reach';return held(player.id)?'rc_hands_full':null;}
 function command(player,verb,id,input={}){
  if(!player?.id)return error('rc_player');const car=cars.get(id);if(!car)return error('rc_item');
  if(verb==='take'){
   const reason=takeError(player,id);if(reason)return error(reason);car.owner=player.id;car.status='active';car.controlMode='drive';car.hp=rules.maxHp;car.inputSeq=0;resetBody(car);add(car);return{ok:true,id};
  }
  if(car.owner!==player.id)return error('rc_not_owner');
  if(verb==='release'){releasePlayer(player.id);return{ok:true};}
  if(verb==='pause'){const fence=input?.seq;if(fence!==undefined&&(!Number.isSafeInteger(fence)||fence<0))return error('rc_input');if(fence!==undefined)car.inputSeq=Math.max(car.inputSeq,fence);car.controlMode='carry';clearDriveIntent(car);return{ok:true};}
  if(verb==='drive'){if(player.seat)return error('rc_seated');if(car.controlMode!=='drive'){car.controlMode='drive';clearDriveIntent(car);}return{ok:true};}
  if(verb==='respawn'){
   if(car.status==='wrecked'&&time<car.respawnAt)return error('rc_repairing');if(car.status==='active'&&time-car.resetAt<rules.resetCooldown)return error('rc_reset_cooldown');
   const repairing=car.status==='wrecked';car.status='active';if(repairing)car.hp=rules.maxHp;car.respawnAt=0;resetBody(car);add(car);return{ok:true};
  }
  if(verb==='input'){
   if(car.controlMode!=='drive')return error('rc_paused');
   if(car.status!=='active')return error('rc_wrecked');
   if(!finite(input.throttle)||!finite(input.steer)||Math.abs(input.throttle)>1||Math.abs(input.steer)>1||typeof input.brake!=='boolean'||!Number.isSafeInteger(input.seq)||input.seq<0)return error('rc_input');
   if(input.seq<=car.inputSeq)return error('rc_input_order');car.inputSeq=input.seq;car.input={throttle:input.throttle,steer:input.steer,brake:input.brake};car.inputAt=time;physics.get(id).body.wakeUp();return{ok:true};
  }
  return error('rc_verb');
 }
 function transfer(actorId,targetId,id){const car=cars.get(id);if(!car||car.owner!==actorId)return error('rc_not_owner');if(!targetId||held(targetId))return error('rc_hands_full');car.owner=targetId;car.controlMode='carry';car.inputSeq=0;clearDriveIntent(car);return{ok:true,id};}
 function advance(dt){
  for(const car of cars.values()){
   if(car.status!=='active'||car.parked)continue;const {body,vehicle,layout}=physics.get(car.id),input=car.controlMode==='carry'?parked():time-car.inputAt>rules.staleInputSeconds?neutral():car.input;
   const speed=body.velocity.length();car.speed=vehicle.currentVehicleSpeedKmHour/3.6;
   // Input +steer means driver's right: forward(+Z) cross up(+Y) is -X.
   // Cannon's positive steering rotates the nose toward +X, so convert once
   // here for solo, host authority and client prediction alike.
   const target=-input.steer*rules.maxSteer*(1-(1-rules.highSpeedSteer)*clamp(speed/rules.steerSpeed,0,1));car.steering+=(target-car.steering)*(1-Math.exp(-rules.steerResponse*dt));
   const localVelocity=body.vectorToLocalFrame(body.velocity),opposing=input.throttle*localVelocity.z<-.4;
   // Ramp motor demand on the fixed physics clock, independent of packet or
   // render rate. Brake, stale input and direction changes clear stored torque.
   const demand=input.brake||opposing?0:input.throttle;
   if(!demand||demand*car.driveThrottle<0)car.driveThrottle=0;
   car.driveThrottle+=clamp(demand-car.driveThrottle,-rules.throttleRiseRate*dt,rules.throttleRiseRate*dt);
   const force=car.driveThrottle>0?(localVelocity.z<rules.maxSpeed?-car.driveThrottle*rules.engineForce:0):(localVelocity.z>-rules.reverseMaxSpeed?-car.driveThrottle*rules.reverseForce:0);
   // Cannon's brake limit is an impulse per wheel per step. A constant large
   // impulse at rest creates suspension/friction chatter instead of parking.
   const brake=input.brake?(car.controlMode==='carry'?rules.mass*PARKING_POLICY.brakeDeceleration*dt/vehicle.wheelInfos.length:rules.brakeForce):opposing?rules.brakeForce*.65:Math.abs(input.throttle)<.01?rules.idleBrake:0;
   for(let i=0;i<4;i++){vehicle.setSteeringValue(layout.wheels[i].steer?car.steering:0,i);vehicle.applyEngineForce(force,i);vehicle.setBrake(brake,i);}
  }
  world.step(dt);
  for(const car of cars.values()){
   if(car.status!=='active'||car.parked)continue;const {body,vehicle}=physics.get(car.id);const inside=arena.inside(body.position.x,body.position.z);car.atBoundary=!arena.safe(body.position.x,body.position.z);if(inside)car.lastSafe=[body.position.x,body.position.z];else{body.position.x=car.lastSafe[0];body.position.z=car.lastSafe[1];body.velocity.x=0;body.velocity.z=0;car.input={...car.input,throttle:0};}
   // Recovery is a game rule. Flipped cars remain physical until the driver asks R.
   if(![body.position.x,body.position.y,body.position.z].every(finite)||body.position.y<ground-5)resetBody(car);
   considerParking(car,dt);for(let i=0;i<4;i++)vehicle.updateWheelTransform(i);
  }
 }
 function step(dt){
  if(!finite(dt)||dt<=0)return;const bounded=Math.min(dt,rules.fixedStep*rules.maxSubSteps);accumulator+=bounded;
  for(let i=0;i<rules.maxSubSteps&&accumulator+1e-9>=rules.fixedStep;i++){time+=rules.fixedStep;advance(rules.fixedStep);accumulator=Math.max(0,accumulator-rules.fixedStep);}
 }
 function damage(id,amount){const car=cars.get(id);if(!car||car.status!=='active'||!finite(amount)||amount<=0)return error('rc_damage');car.hp=Math.max(0,car.hp-amount);if(!car.hp){car.status='wrecked';car.respawnAt=time+rules.respawnSeconds;car.input=neutral();car.driveThrottle=0;const p=physics.get(id);p.body.velocity.scale(.2,p.body.velocity);remove(car);setParking(car,false);}return{ok:true,id,hp:car.hp,maxHp:car.maxHp,destroyed:car.hp===0};}
 function raycast(origin,direction,range=Infinity){
  if(!vec(origin)||!vec(direction)||!(range>0))return null;
  const d=new CANNON.Vec3(...direction),length=d.length();if(length<.0001)return null;
  const from=new CANNON.Vec3(...origin),to=from.vadd(d.scale((range===Infinity?10000:range)/length));
  const ray=new CANNON.Ray(from,to),result=new CANNON.RaycastResult();ray.mode=CANNON.Ray.CLOSEST;ray.result=result;
  let best=null;
  for(const car of cars.values()){
   if(car.status==='ready')continue;
   const {body,shotBody,vehicle,layout}=physics.get(car.id);
   shotBody.position.copy(body.position);shotBody.quaternion.copy(body.quaternion);
   for(const wheel of layout.wheels)shotBody.shapeOffsets[wheel.index+2].y=wheel.connection[1]-vehicle.wheelInfos[wheel.index].suspensionLength;
   result.reset();ray.intersectBody(shotBody,result);
   if(result.hasHit&&(!best||result.distance<best.distance))best={id:car.id,distance:result.distance,point:result.hitPointWorld.toArray(),normal:result.hitNormalWorld.toArray()};
  }return best;
 }
 function serialize(c){const{body,vehicle}=physics.get(c.id);return{id:c.id,index:c.index,designId:c.designId,color:c.color,owner:c.owner,status:c.status,controlMode:c.controlMode,parked:c.parked,parkingStableSeconds:round(c.parkingStableSeconds),hp:c.hp,maxHp:c.maxHp,position:body.position.toArray().map(round),quaternion:body.quaternion.toArray().map(round),velocity:body.velocity.toArray().map(round),angularVelocity:body.angularVelocity.toArray().map(round),speed:round(c.speed),atBoundary:!!c.atBoundary,steering:round(c.steering),driveThrottle:round(c.driveThrottle),wheels:vehicle.wheelInfos.map((w,i)=>({id:physics.get(c.id).layout.wheels[i].id,rotation:round(w.rotation),suspensionLength:round(w.suspensionLength),steering:round(w.steering),deltaRotation:round(w.deltaRotation),position:w.worldTransform.position.toArray().map(round),quaternion:w.worldTransform.quaternion.toArray().map(round)})),inputSeq:c.inputSeq,input:{...c.input},inputAt:round(c.inputAt),respawnAt:round(c.respawnAt),resetAt:round(c.resetAt),lastSafe:c.lastSafe.map(round)};}
 function snapshot(){return{version:1,time:round(time),cars:[...cars.values()].map(serialize)};}
 function pose(id){const car=cars.get(id);return car?serialize(car):null;}
 function restore(state){
  if(!Array.isArray(state?.cars)||!finite(state.time)||state.cars.some(c=>!c||typeof c!=='object'||c.controlMode!==undefined&&!['drive','carry'].includes(c.controlMode)))return false;time=state.time;accumulator=0;
  for(const next of state.cars){const car=cars.get(next.id);if(!car||!vec(next.position)||!Array.isArray(next.quaternion)||next.quaternion.length!==4||!next.quaternion.every(finite))continue;remove(car);setParking(car,false);const {body,vehicle}=physics.get(car.id);for(const key of ['speed','owner','status','hp','inputSeq','steering','respawnAt','inputAt','resetAt','atBoundary'])if(next[key]!==undefined)car[key]=next[key];car.controlMode=['drive','carry'].includes(next.controlMode)?next.controlMode:car.owner?'drive':'carry';car.input=car.controlMode==='carry'?parked():next.input?{...next.input}:neutral();car.driveThrottle=car.controlMode==='drive'&&finite(next.driveThrottle)?clamp(next.driveThrottle,-1,1):0;car.lastSafe=Array.isArray(next.lastSafe)?[...next.lastSafe]:[next.position[0],next.position[2]];body.position.set(...next.position);body.quaternion.set(...next.quaternion);body.velocity.set(...(next.velocity||[0,0,0]));body.angularVelocity.set(...(next.angularVelocity||[0,0,0]));for(let i=0;i<vehicle.wheelInfos.length;i++){const wheel=vehicle.wheelInfos[i],w=next.wheels?.[i];if(w&&w.id===physics.get(car.id).layout.wheels[i].id){for(const key of ['rotation','suspensionLength','steering','deltaRotation'])if(finite(w[key]))wheel[key]=w[key];}if(car.controlMode==='carry'){wheel.steering=0;vehicle.applyEngineForce(0,i);vehicle.setBrake(rules.brakeForce,i);}vehicle.updateWheelTransform(i);}if(car.controlMode==='carry')car.steering=0;car.parkingStableSeconds=finite(next.parkingStableSeconds)?clamp(next.parkingStableSeconds,0,PARKING_POLICY.settleSeconds):0;if(next.parked===true&&car.controlMode==='carry'&&car.status==='active')setParking(car,true);if(car.status==='active')add(car);}
  return true;
 }
 return{canTake:(player,id)=>!takeError(player,id),command,held,isDriving,transfer,releasePlayer,step,snapshot,pose,restore,raycast,damage,arena,controllers,get time(){return time;},dispose(){for(const c of cars.values())remove(c);world.removeBody(groundBody);for(const body of boundaryBodies)world.removeBody(body);}};
}
