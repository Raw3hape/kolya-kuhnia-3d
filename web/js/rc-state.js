// Portable authoritative RC rules. The MIT cannon-es RaycastVehicle owns
// suspension, tire friction, engine/brake forces, rigid bodies and collisions.
// This adapter owns only intent, item ownership, arena policy and snapshots.
import * as CANNON from '../vendor/cannon-es-0.20.0/cannon-es.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>Number.isFinite(v);
const vec=a=>Array.isArray(a)&&a.length===3&&a.every(finite);
const round=n=>Math.round(n*10000)/10000;
function inPoly(poly,x,z){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function createRCArena(spec,site){
 const polys=(site?.areas||[]).filter(a=>spec.arena.kinds.includes(a.kind)).map(a=>a.poly);
 const [hx,hz]=spec.arena.home,limits=spec.arena;
 const inside=(x,z)=>finite(x)&&finite(z)&&Math.hypot(x-hx,z-hz)>=limits.minDistance&&Math.hypot(x-hx,z-hz)<=limits.maxDistance&&polys.some(p=>inPoly(p,x,z));
 const safe=(x,z)=>{const m=limits.margin;return inside(x,z)&&inside(x+m,z)&&inside(x-m,z)&&inside(x,z+m)&&inside(x,z-m);};
 return {inside,safe,polys};
}
export function controllerPositions(spec){
 const c=spec.controllers,t=spec.table.position,n=spec.designs.length;
 return spec.designs.map((d,i)=>({id:`rc-${i}`,designId:d.id,position:[t[0]+(i%c.columns-(c.columns-1)/2)*c.spacing[0],c.height,t[2]+(Math.floor(i/c.columns)-(Math.ceil(n/c.columns)-1)/2)*c.spacing[1]]}));
}
export function createRCSimulation({spec,site}){
 if(!spec?.physics||!site||!spec.designs?.length)throw Error('rc_config');
 const rules=spec.physics,arena=createRCArena(spec,site),ground=-(site.floorY||0),controllers=controllerPositions(spec);
 const world=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0)});world.allowSleep=true;world.broadphase=new CANNON.SAPBroadphase(world);world.solver.iterations=8;
 const groundBody=new CANNON.Body({mass:0,shape:new CANNON.Plane()});groundBody.quaternion.setFromEuler(-Math.PI/2,0,0);groundBody.position.y=ground;world.addBody(groundBody);
 const cars=new Map(),physics=new Map();let time=0,accumulator=0;
 function spawnFor(index){
  const s=spec.arena.spawn,columns=s.columns;let p=[s.center[0]+(index%columns-(columns-1)/2)*s.spacing[0],s.center[1]+Math.floor(index/columns)*s.spacing[1]];
  if(arena.safe(...p))return p;
  // Deterministic bounded search when the authored spawn is moved by a site revision.
  for(let r=2;r<150;r+=2)for(let k=0;k<32;k++){const a=k/32*Math.PI*2;const q=[s.center[0]+Math.sin(a)*r,s.center[1]+Math.cos(a)*r];if(arena.safe(...q))return q;}
  throw Error('rc_no_safe_spawn');
 }
 const neutral=()=>({throttle:0,steer:0,brake:false});
 function resetBody(car){
  const {body,vehicle}=physics.get(car.id),[x,z]=spawnFor(car.index);
  body.position.set(x,ground+.49,z);body.quaternion.set(0,0,0,1);body.velocity.setZero();body.angularVelocity.setZero();body.force.setZero();body.torque.setZero();body.wakeUp();
  car.input=neutral();car.steering=0;car.inputAt=time;car.resetAt=time;car.lastSafe=[x,z];car.speed=0;car.atBoundary=false;
  for(let i=0;i<4;i++){vehicle.setSteeringValue(0,i);vehicle.applyEngineForce(0,i);vehicle.setBrake(0,i);const wheel=vehicle.wheelInfos[i];wheel.rotation=0;wheel.deltaRotation=0;wheel.suspensionLength=rules.suspension.restLength;}
 }
 spec.designs.forEach((design,index)=>{
  const id=`rc-${index}`,body=new CANNON.Body({mass:rules.mass,linearDamping:rules.linearDamping,angularDamping:rules.angularDamping,sleepSpeedLimit:.08,sleepTimeLimit:1.5});
  body.addShape(new CANNON.Box(new CANNON.Vec3(...rules.chassisHalf)),new CANNON.Vec3(...rules.shapeOffset));
  body.angularFactor.set(...rules.angularFactor);
  const vehicle=new CANNON.RaycastVehicle({chassisBody:body,indexRightAxis:0,indexUpAxis:1,indexForwardAxis:2}),s=rules.suspension;
  for(const [x,z] of [[-1,1],[1,1],[-1,-1],[1,-1]])vehicle.addWheel({radius:design.wheel??rules.wheelRadius,directionLocal:new CANNON.Vec3(0,-1,0),axleLocal:new CANNON.Vec3(-1,0,0),chassisConnectionPointLocal:new CANNON.Vec3(x*rules.track/2,0,z*rules.wheelbase/2),suspensionStiffness:s.stiffness,suspensionRestLength:s.restLength,frictionSlip:s.frictionSlip,dampingRelaxation:s.relaxation,dampingCompression:s.compression,maxSuspensionForce:rules.mass*70,maxSuspensionTravel:s.travel,rollInfluence:s.rollInfluence,customSlidingRotationalSpeed:-30,useCustomSlidingRotationalSpeed:true,isFrontWheel:z>0});
  const car={id,index,designId:design.id,color:design.color,owner:null,status:'ready',hp:rules.maxHp,maxHp:rules.maxHp,input:neutral(),inputAt:0,inputSeq:0,steering:0,respawnAt:0,lastSafe:null,resetAt:-10,speed:0};
  cars.set(id,car);physics.set(id,{body,vehicle,inWorld:false});resetBody(car);
 });
 const held=playerId=>[...cars.values()].find(c=>c.owner===playerId)||null;
 const error=reason=>({ok:false,error:reason});
 function add(car){const p=physics.get(car.id);if(!p.inWorld){p.vehicle.addToWorld(world);p.inWorld=true;}}
 function remove(car){const p=physics.get(car.id);if(p.inWorld){p.vehicle.removeFromWorld(world);p.inWorld=false;}}
 function releasePlayer(playerId){const car=held(playerId);if(!car)return false;remove(car);car.owner=null;car.status='ready';car.input=neutral();car.hp=rules.maxHp;car.respawnAt=0;resetBody(car);return true;}
 function takeError(player,id){const car=cars.get(id);if(!player?.id)return'rc_player';if(!car)return'rc_item';if(car.owner)return'rc_owned';const c=controllers[car.index];if(!finite(player.x)||!finite(player.z)||Math.hypot(player.x-c.position[0],player.z-c.position[2])>spec.controllers.reach)return'rc_reach';return held(player.id)?'rc_hands_full':null;}
 function command(player,verb,id,input={}){
  if(!player?.id)return error('rc_player');const car=cars.get(id);if(!car)return error('rc_item');
  if(verb==='take'){
   const reason=takeError(player,id);if(reason)return error(reason);car.owner=player.id;car.status='active';car.hp=rules.maxHp;car.inputSeq=0;resetBody(car);add(car);return{ok:true,id};
  }
  if(car.owner!==player.id)return error('rc_not_owner');
  if(verb==='release'){releasePlayer(player.id);return{ok:true};}
  if(verb==='respawn'){
   if(car.status==='wrecked'&&time<car.respawnAt)return error('rc_repairing');if(car.status==='active'&&time-car.resetAt<rules.resetCooldown)return error('rc_reset_cooldown');
   const repairing=car.status==='wrecked';car.status='active';if(repairing)car.hp=rules.maxHp;car.respawnAt=0;resetBody(car);add(car);return{ok:true};
  }
  if(verb==='input'){
   if(car.status!=='active')return error('rc_wrecked');
   if(!finite(input.throttle)||!finite(input.steer)||Math.abs(input.throttle)>1||Math.abs(input.steer)>1||typeof input.brake!=='boolean'||!Number.isSafeInteger(input.seq)||input.seq<0)return error('rc_input');
   if(input.seq<=car.inputSeq)return error('rc_input_order');car.inputSeq=input.seq;car.input={throttle:input.throttle,steer:input.steer,brake:input.brake};car.inputAt=time;physics.get(id).body.wakeUp();return{ok:true};
  }
  return error('rc_verb');
 }
 function transfer(actorId,targetId,id){const car=cars.get(id);if(!car||car.owner!==actorId)return error('rc_not_owner');if(!targetId||held(targetId))return error('rc_hands_full');car.owner=targetId;car.input=neutral();car.inputAt=time;car.inputSeq=0;return{ok:true,id};}
 function advance(dt){
  for(const car of cars.values()){
   if(car.status!=='active')continue;const {body,vehicle}=physics.get(car.id),input=time-car.inputAt>rules.staleInputSeconds?neutral():car.input;
   const speed=body.velocity.length();car.speed=vehicle.currentVehicleSpeedKmHour/3.6;
   const target=input.steer*rules.maxSteer*(1-(1-rules.highSpeedSteer)*clamp(speed/rules.maxSpeed,0,1));car.steering+=(target-car.steering)*(1-Math.exp(-rules.steerResponse*dt));
   const localVelocity=body.vectorToLocalFrame(body.velocity),opposing=input.throttle*localVelocity.z<-.4;
   const force=input.throttle>0?(localVelocity.z<rules.maxSpeed?-input.throttle*rules.engineForce:0):(localVelocity.z>-rules.reverseMaxSpeed?-input.throttle*rules.reverseForce:0);
   for(let i=0;i<4;i++){vehicle.setSteeringValue(i<2?car.steering:0,i);vehicle.applyEngineForce(force,i);vehicle.setBrake(input.brake?rules.brakeForce:opposing?rules.brakeForce*.65:Math.abs(input.throttle)<.01?rules.idleBrake:0,i);}
  }
  world.step(dt);
  for(const car of cars.values()){
   if(car.status!=='active')continue;const {body,vehicle}=physics.get(car.id);car.atBoundary=!arena.safe(body.position.x,body.position.z);if(!car.atBoundary)car.lastSafe=[body.position.x,body.position.z];else{body.position.x=car.lastSafe[0];body.position.z=car.lastSafe[1];body.velocity.x=0;body.velocity.z=0;car.input={...car.input,throttle:0};}
   // Recovery is a game rule. Flipped cars remain physical until the driver asks R.
   if(![body.position.x,body.position.y,body.position.z].every(finite)||body.position.y<ground-5)resetBody(car);
   for(let i=0;i<4;i++)vehicle.updateWheelTransform(i);
  }
 }
 function step(dt){
  if(!finite(dt)||dt<=0)return;const bounded=Math.min(dt,rules.fixedStep*rules.maxSubSteps);accumulator+=bounded;
  for(let i=0;i<rules.maxSubSteps&&accumulator+1e-9>=rules.fixedStep;i++){time+=rules.fixedStep;advance(rules.fixedStep);accumulator=Math.max(0,accumulator-rules.fixedStep);}
 }
 function damage(id,amount){const car=cars.get(id);if(!car||car.status!=='active'||!finite(amount)||amount<=0)return error('rc_damage');car.hp=Math.max(0,car.hp-amount);if(!car.hp){car.status='wrecked';car.respawnAt=time+rules.respawnSeconds;car.input=neutral();const p=physics.get(id);p.body.velocity.scale(.2,p.body.velocity);remove(car);}return{ok:true,id,hp:car.hp,destroyed:car.hp===0};}
 function raycast(origin,direction,range=Infinity){
  if(!vec(origin)||!vec(direction)||!(range>0))return null;const d=new CANNON.Vec3(...direction),length=d.length();if(length<.0001)return null;d.scale(1/length,d);let best=null;
  for(const car of cars.values()){
   if(car.status!=='active')continue;const {body}=physics.get(car.id),from=new CANNON.Vec3(...origin),to=from.vadd(d.scale(range===Infinity?10000:range)),ray=new CANNON.Ray(from,to),result=new CANNON.RaycastResult();ray.mode=CANNON.Ray.CLOSEST;ray.result=result;ray.intersectBody(body,result);
   if(result.hasHit&&(!best||result.distance<best.distance))best={id:car.id,distance:result.distance,point:result.hitPointWorld.toArray()};
  }return best;
 }
 function serialize(c){const{body,vehicle}=physics.get(c.id);return{id:c.id,index:c.index,designId:c.designId,color:c.color,owner:c.owner,status:c.status,hp:c.hp,maxHp:c.maxHp,position:body.position.toArray().map(round),quaternion:body.quaternion.toArray().map(round),velocity:body.velocity.toArray().map(round),angularVelocity:body.angularVelocity.toArray().map(round),speed:round(c.speed),atBoundary:!!c.atBoundary,steering:round(c.steering),wheels:vehicle.wheelInfos.map(w=>({position:w.worldTransform.position.toArray().map(round),quaternion:w.worldTransform.quaternion.toArray().map(round)})),inputSeq:c.inputSeq,input:{...c.input},inputAt:round(c.inputAt),respawnAt:round(c.respawnAt),resetAt:round(c.resetAt),lastSafe:c.lastSafe.map(round)};}
 function snapshot(){return{version:1,time:round(time),cars:[...cars.values()].map(serialize)};}
 function pose(id){const car=cars.get(id);return car?serialize(car):null;}
 function restore(state){
  if(!state?.cars||!finite(state.time))return false;time=state.time;accumulator=0;
  for(const next of state.cars){const car=cars.get(next.id);if(!car||!vec(next.position)||!Array.isArray(next.quaternion)||next.quaternion.length!==4||!next.quaternion.every(finite))continue;remove(car);const {body}=physics.get(car.id);for(const key of ['owner','status','hp','inputSeq','steering','respawnAt','inputAt','resetAt','atBoundary'])if(next[key]!==undefined)car[key]=next[key];car.input=next.input?{...next.input}:neutral();car.lastSafe=Array.isArray(next.lastSafe)?[...next.lastSafe]:[next.position[0],next.position[2]];body.position.set(...next.position);body.quaternion.set(...next.quaternion);body.velocity.set(...(next.velocity||[0,0,0]));body.angularVelocity.set(...(next.angularVelocity||[0,0,0]));if(car.status==='active')add(car);}
  return true;
 }
 return{canTake:(player,id)=>!takeError(player,id),command,held,transfer,releasePlayer,step,snapshot,pose,restore,raycast,damage,arena,controllers,get time(){return time;},dispose(){for(const c of cars.values())remove(c);world.removeBody(groundBody);}};
}
