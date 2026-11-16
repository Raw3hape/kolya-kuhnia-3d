// Party gameplay view/input. The same pure simulation runs solo and in the host Worker.
// Ownership, sip counts and flights are canonical; pooled smoke, foley and shards are local.
import { createPartySimulation, createPartyGround } from './party-state.js';
import { createPartyModels } from './party-models.js';
import { createPartyEffects } from './party-effects.js';
import { assignNetworkObjectIds } from './network-objects.js';
import { shotHandlers, onRestore } from './breakables.js';
import { injectStyle } from './minimap.js';
import { addHelp } from './help.js';

addHelp(
  {mode:'walk',topic:'party',keys:['E'],text:'взять пиво на балконе, дудку на острове или шланг кальяна у дивана',order:63},
  {mode:'walk',topic:'party',keys:['ЛКМ'],text:'один глоток / затяжка; пиво выпивается за пять нажатий',order:64},
  {mode:'walk',topic:'party',keys:['Q'],text:'бросить бутылку; вернуть дудку или шланг. X — поставить бутылку обратно',order:65},
);
const typing=e=>e.target?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName);
const visible=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;};
const NAMES={beer:'Кабан Лагер',vape:'Облачная дудка',hookah:'Кальян у дивана'};

export function createParty({THREE,scene,camera,canvas,pipe,plan,site,getWalk,getSeats,getVM,getTV,getPaper,getDoors,getAnchors,requestRender}) {
  let spec=null,sim=null,models=null,effects=null,network=null,state=null,players=[],ready=false,disposed=false;
  let pending=false,generation=0,aimed=null,pickClock=0,heldId=null,actionClock=0,uiKey='',savedSolo=null;
  const world=new THREE.Group();world.name='party_world';world.userData.rasterOnly=true;scene.add(world);
  const handRoot=new THREE.Group();handRoot.name='party_first_person';handRoot.userData.viewmodel=true;handRoot.userData.rasterOnly=true;handRoot.renderOrder=900;scene.add(handRoot);
  const remoteRoot=new THREE.Group();remoteRoot.name='party_remote_props';remoteRoot.userData.networkEntity=true;remoteRoot.userData.rasterOnly=true;scene.add(remoteRoot);
  const objects=new Map(),remoteProps=new Map(),seenAction=new Map(),seenBreak=new Map(),smokeTimes=new Map();
  const V=()=>new THREE.Vector3(),ray=new THREE.Raycaster(),direction=V(),origin=V(),up=new THREE.Vector3(0,1,0),coarseQuery=matchMedia('(pointer:coarse)');
  const hoseSegments=[];let crate=null,handModel=null,unrestore=null;
  injectStyle('party-style',CSS);
  const hud=document.createElement('div');hud.className='party-hud kw-float';hud.hidden=true;hud.setAttribute('role','status');
  const title=document.createElement('span'),meter=document.createElement('span'),actions=document.createElement('span');
  title.className='party-title';meter.className='party-meter';actions.className='party-actions';hud.append(title,meter,actions);document.body.append(hud);
  const take=document.createElement('button'),use=document.createElement('button'),put=document.createElement('button'),back=document.createElement('button');
  for(const b of [take,use,put,back]){b.type='button';b.hidden=true;b.className='party-touch kw-float';document.body.append(b);}
  take.textContent='Взять';use.textContent='Глоток';put.textContent='Бросить';back.textContent='На место';
  const active=()=>!!getWalk()?.active||!!getSeats()?.active;
  const selfId=()=>network?(typeof network.selfId==='function'?network.selfId():network.selfId):'solo';
  const held=()=>state?.items.find(i=>i.owner===selfId()&&i.status==='held');
  const pose=()=>({id:'solo',x:camera.position.x,y:Math.max(0,camera.position.y-(getWalk()?.eyeHeight||1.68)),z:camera.position.z,eyeY:camera.position.y});
  const worldBusy=()=>!!getDoors()?.target||!!getSeats()?.target;
  function clearHand(){handRoot.traverse(o=>{if(o.userData.partyHeldMaterial)o.material.dispose();});handRoot.clear();handModel=null;}
  function snapshot(){return sim?.snapshot()||null;}
  function accept(next,context={}){
    if(!next)return;state=next;players=context.players||players;
    if(!ready)return;
    const h=held();
    if(h?.id!==heldId){
      if(h){getVM()?.setWeapon('none');getTV()?.hold(false);getPaper()?.drop();effects.sound('take');}
      heldId=h?.id||null;clearHand();
      if(h){handModel=h.kind==='hookah'?models.mouthpiece():models[h.kind]();const hands=models.hands();hands.position.y=.14;handRoot.add(handModel,hands);
        handRoot.traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.material.depthTest=false;o.material.depthWrite=false;o.userData.partyHeldMaterial=true;o.renderOrder=900;}});}
    }
    for(const item of state.items){
      const prior=seenAction.get(item.id),key=item.action?`${item.action.kind}:${item.action.at}:${item.action.actorId}`:null;
      if(key&&key!==prior&&state.time-item.action.at<item.action.duration){
        if(item.action.actorId===selfId()||camera.position.distanceTo(new THREE.Vector3().fromArray(item.position))<9)effects.sound(item.action.kind,item.action.actorId===selfId()?1:.35);
        if(item.kind==='beer'&&item.sips===spec.rules.sips&&item.action.actorId===selfId())effects.sound('empty',.6);
      }
      seenAction.set(item.id,key);
      const old=seenBreak.get(item.id);
      if(old!==undefined&&item.breakSerial>old){effects.shatter(item.position,item.breakSerial*173+item.id.length);effects.sound('break',Math.max(.08,1-camera.position.distanceTo(new THREE.Vector3().fromArray(item.position))/18));}
      seenBreak.set(item.id,item.breakSerial||0);
    }
  }
  function traceCollision(from,to,item){
    origin.fromArray(from);direction.fromArray(to).sub(origin);const length=direction.length();if(length<1e-6)return null;
    ray.set(origin,direction.multiplyScalar(1/length));ray.far=length+.025;ray.layers.set(0);
    const roots=scene.children.filter(o=>o!==world&&o!==handRoot&&o!==remoteRoot&&!o.userData.networkEntity&&!o.userData.networkAvatar&&!o.userData.networkEffect&&!o.userData.viewmodel);
    const hit=ray.intersectObjects(roots,true).find(h=>visible(h.object)&&!h.object.userData.passLight&&!h.object.userData.impact&&!h.object.userData.shard);
    return hit?{point:hit.point.toArray(),normal:hit.face?.normal?.clone().transformDirection(hit.object.matrixWorld).toArray()}:null;
  }
  async function command(verb,id=held()?.id||aimed?.id){
    if(!ready||pending||(!active()&&verb!=='return')||!id)return{ok:false};
    const item=state.items.find(x=>x.id===id);if(!item)return{ok:false};
    const version=generation;pending=true;renderHUD();
    camera.getWorldDirection(direction);const payload={kind:'party',verb,id,direction:direction.toArray()};
    try{
      const result=network?await network.request(payload):sim.command(pose(),verb,id,payload.direction);
      if(version!==generation)return{ok:false};
      if(!network)accept(sim.snapshot());
      if(result?.ok&&verb==='take')getVM()?.setWeapon('none');
      return result;
    }finally{if(version===generation){pending=false;renderHUD();requestRender();}}
  }
  function setNetwork(adapter){
    generation++;pending=false;
    if(adapter&&!network)savedSolo=sim?.snapshot();
    network=adapter||null;players=[];heldId=null;clearHand();
    if(!adapter&&sim){if(savedSolo)sim.restore(savedSolo);savedSolo=null;seenAction.clear();seenBreak.clear();accept(sim.snapshot());}
  }
  function updateHomes(){
    if(!ready||(network&&!network.isHost?.()))return;
    const anchors=getAnchors?.();
    for(const def of spec.items){const anchor=anchors?.[def.anchor];if(!anchor?.cur||!anchor.def)continue;
      const {cur,def:base}=anchor,src=def.home||def.position;
      // Store authored coordinates once; changes to spec carry resolved homes to the host.
      def.home??=[...src];const dx=src[0]-base.x,dz=src[2]-base.z,rot=cur.r-base.r,c=Math.cos(rot),s=Math.sin(rot);
      const pos=[cur.x+dx*c+dz*s,src[1]+(def.kind==='hookah'?0:cur.y-base.y),cur.z-dx*s+dz*c];
      if(pos.some((v,i)=>Math.abs(v-def.position[i])>1e-5)){def.position=pos;sim.setHome(def.id,pos);}
    }
  }
  function aim(){
    aimed=null;if(!active())return;
    ray.setFromCamera(new THREE.Vector2(0,0),camera);ray.far=spec.rules.reach;ray.layers.set(0);
    const candidates=[];
    for(const item of state.items)if(item.status==='ready'&&objects.get(item.id)?.visible)candidates.push(objects.get(item.id));
    if(state.items.some(i=>i.kind==='beer'&&i.status==='ready'))candidates.push(crate);
    const h=ray.intersectObjects(candidates,true)[0];if(!h)return;
    let root=h.object;while(root&&root.parent!==world)root=root.parent;
    const id=root===crate?state.items.find(i=>i.kind==='beer'&&i.status==='ready')?.id:root?.userData.partyId;
    if(!id)return;
    const target=state.items.find(i=>i.id===id);const obstruction=traceCollision(camera.position.toArray(),h.point.toArray(),target);
    if(!obstruction||camera.position.distanceTo(new THREE.Vector3().fromArray(obstruction.point))>=h.distance-.06)aimed=target;
  }
  function renderHUD(){
    const h=held(),can=active()&&!pipe?.photo,coarse=coarseQuery.matches;
    const remaining=h?.kind==='beer'?spec.rules.sips-h.sips:null;
    const busy=pending||!!(h?.action&&state.time-h.action.at<h.action.duration);
    const key=[can,h?.id,aimed?.id,remaining,busy,coarse].join(':');if(key===uiKey)return;uiKey=key;
    hud.hidden=!can||!(h||aimed);title.textContent=NAMES[(h||aimed)?.kind]||'';
    meter.textContent=remaining===null?'':`${'●'.repeat(Math.max(0,remaining))}${'○'.repeat(h.sips)}  ${remaining} / ${spec.rules.sips}`;
    actions.textContent=h?(h.kind==='beer'?(remaining?'ЛКМ / E — глоток · Q — бросить · X — на место':'Пусто! Q — бросить с треском · X — на место'):'ЛКМ — затяжка · Q — вернуть'):'E — взять';
    take.hidden=!can||!coarse||!aimed||!!h;use.hidden=put.hidden=!can||!coarse||!h;back.hidden=!can||!coarse||h?.kind!=='beer';
    for(const b of [take,use,put,back])b.disabled=busy;
    use.textContent=h?.kind==='beer'?(remaining?'Глоток':'Пусто'):'Затяжка';use.disabled=busy||remaining===0;put.textContent=h?.kind==='beer'?'Бросить':'Вернуть';
    document.body.classList.toggle('party-held',!!h);document.body.classList.toggle('party-aimed',!!aimed&&!h);
  }
  function paintBottle(g,item){
    const fill=g.userData.fill;if(fill){const fraction=1-item.sips/spec.rules.sips;fill.scale.y=Math.max(.015,fraction);fill.position.y=.055+.075*fraction;fill.visible=fraction>0;}
    if(g.userData.cap)g.userData.cap.visible=item.sips===0&&!item.owner;
  }
  function actionProgress(item){const a=item.action;return a?Math.max(0,Math.min(1,(state.time-a.at)/a.duration)):1;}
  function positionHeld(root,item,local){
    const progress=actionProgress(item),doing=!!item.action&&progress<1,lift=doing?Math.sin(Math.PI*Math.min(1,progress*1.2)):0;
    if(local){
      const bob=getWalk()?.moving?Math.sin(actionClock*8)*.012:Math.sin(actionClock*1.6)*.002;
      root.position.set(.22-lift*.19,-.36+lift*.22+bob,-.48-lift*.05).applyQuaternion(camera.quaternion).add(camera.position);
      root.quaternion.copy(camera.quaternion);root.rotateX(doing?.06+lift*1.18:.06);root.rotateZ(-.12-lift*.10);
    }else{
      const p=players.find(p=>p.id===item.owner);if(!p){root.visible=false;return;}
      const grip=network?.gripForPlayer?.(item.owner);
      if(grip){
        grip.updateWorldMatrix(true,false);grip.getWorldQuaternion(root.quaternion);grip.getWorldPosition(root.position);
        root.position.add(new THREE.Vector3(0,item.kind==='beer'?-.13:item.kind==='vape'?-.055:-.10,0).applyQuaternion(root.quaternion));
        root.visible=true;return;
      }
      const yaw=p.lookYaw??p.yaw??0;root.position.set(p.x,(p.eyeY??p.y+1.68)-.65+lift*.35,p.z);
      root.position.x+=Math.cos(yaw)*.24-Math.sin(yaw)*.25;root.position.z-=Math.sin(yaw)*.24+Math.cos(yaw)*.25;
      root.rotation.set(lift*1.3,yaw,-.1);root.visible=true;
    }
  }
  function updateHose(item){
    const base=objects.get(item.id);if(!base)return;
    const start=base.position.clone().add(new THREE.Vector3(.04,.34,0));
    const h=item.owner===selfId()?handRoot:remoteProps.get(item.id);
    const end=item.status==='held'&&h?.visible?h.position.clone():base.position.clone().add(new THREE.Vector3(.17,.16,.02));
    const mid=start.clone().add(end).multiplyScalar(.5);mid.y=Math.max(.055,Math.min(start.y,end.y)-.27);
    let prev=start;
    for(let i=0;i<hoseSegments.length;i++){
      const t=(i+1)/hoseSegments.length,p=start.clone().multiplyScalar((1-t)**2).addScaledVector(mid,2*(1-t)*t).addScaledVector(end,t*t);
      const segment=hoseSegments[i],delta=p.clone().sub(prev);segment.position.copy(p).add(prev).multiplyScalar(.5);segment.scale.set(1,delta.length(),1);segment.quaternion.setFromUnitVectors(up,delta.normalize());prev=p;
    }
  }
  function update(dt){
    if(!ready)return false;actionClock+=dt;
    updateHomes();
    if(!network){sim.step(dt,[pose()]);accept(sim.snapshot());}
    else if(state)state={...state,time:state.time+dt};
    if(!state)return false;
    const h=held();
    if(h&&!active()&&!pending)command('return',h.id);
    if(h&&!network&&(getPaper()?.held||getTV()?.status?.held))command('return',h.id);
    pickClock-=dt;if(pickClock<=0){pickClock=.10;aim();}
    handRoot.visible=!!h&&active()&&!pipe?.photo;
    if(h&&handRoot.visible){positionHeld(handRoot,h,true);if(h.kind==='beer')paintBottle(handModel,h);}
    for(const item of state.items){
      const o=objects.get(item.id);if(!o)continue;
      o.visible=item.kind==='hookah'||item.status==='ready'||item.status==='flying';o.position.fromArray(item.position);
      if(item.kind==='beer'){paintBottle(o,item);if(item.status==='flying'){o.rotation.set(actionClock*11,actionClock*6,actionClock*4);}else o.rotation.set(0,0,0);}
      if(item.kind==='hookah')o.userData.restTip.visible=item.status!=='held';
      const remote=item.status==='held'&&item.owner!==selfId();let prop=remoteProps.get(item.id);
      if(remote&&!prop){prop=item.kind==='hookah'?models.mouthpiece():models[item.kind]();remoteProps.set(item.id,prop);remoteRoot.add(prop);}
      if(prop){prop.visible=remote;if(remote){positionHeld(prop,item,false);if(item.kind==='beer')paintBottle(prop,item);}}
      if(item.kind==='hookah')updateHose(item);
      const a=item.action,progress=actionProgress(item);
      if(a?.kind==='puff'&&progress>.25&&progress<1){
        const previous=smokeTimes.get(item.id)||0;
        if(actionClock-previous>.05){
          smokeTimes.set(item.id,actionClock);
          if(item.owner===selfId()){
            camera.getWorldDirection(direction);origin.copy(camera.position).addScaledVector(direction,.38);origin.y-=.08;
          }else{const p=players.find(x=>x.id===item.owner);if(!p)continue;direction.set(-Math.sin(p.lookYaw??p.yaw),.08,-Math.cos(p.lookYaw??p.yaw));origin.set(p.x,(p.eyeY??p.y+1.68)-.08,p.z).addScaledVector(direction,.22);}
          effects.puff(origin,direction,item.kind==='vape'?1.2:1);
        }
      }
    }
    renderHUD();return effects.update(dt,camera)||!!h||state.items.some(i=>i.status==='flying'||i.action&&actionProgress(i)<1);
  }
  const stop=e=>{e.preventDefault();e.stopImmediatePropagation();};
  function onKey(e){
    if(typing(e)||e.metaKey||e.ctrlKey||e.altKey||!active()||!ready)return;
    const h=held();
    if(e.code==='KeyE'&&!e.repeat&&aimed&&!h){command('take',aimed.id);stop(e);}
    else if(h&&(e.code==='KeyQ'||e.code==='KeyX')){if(!e.repeat)command(e.code==='KeyQ'&&h.kind==='beer'?'throw':'return',h.id);stop(e);}
    else if(h&&e.code==='KeyE'&&!worldBusy()&&!getSeats()?.active){if(!e.repeat)command(h.kind==='beer'?'sip':'puff',h.id);stop(e);}
    else if(h&&/^Digit[1-5]$/.test(e.code)&&!e.repeat)command('return',h.id);
  }
  function onPointer(e){
    if(e.target!==canvas||!active()||!ready||e.button!==0||e.pointerType==='touch')return;
    const h=held();if(h){command(h.kind==='beer'?'sip':'puff',h.id);stop(e);}
  }
  take.onclick=()=>command('take',aimed?.id);use.onclick=()=>{const h=held();if(h)command(h.kind==='beer'?'sip':'puff',h.id);};
  put.onclick=()=>{const h=held();if(h)command(h.kind==='beer'?'throw':'return',h.id);};back.onclick=()=>command('return');
  window.addEventListener('keydown',onKey,true);window.addEventListener('pointerdown',onPointer,true);
  const loading=fetch('spec/party.json').then(r=>{if(!r.ok)throw Error('party_config');return r.json();}).then(data=>{
    if(disposed)return;spec=data;const floorAt=createPartyGround({plan,site});sim=createPartySimulation({spec,collision:traceCollision,floorAt});models=createPartyModels(THREE,spec);effects=createPartyEffects({THREE,scene,spec,floorAt,getSound:()=>getVM()?.sound});
    crate=models.crate();world.add(crate);
    for(const def of spec.items){
      const o=models[def.kind]();o.position.fromArray(def.position);o.userData.partyId=def.id;
      if(def.kind==='beer'){o.userData.breakable='glass';assignNetworkObjectIds(o,'party:'+def.id);o.userData.networkId='party:'+def.id;
        o.traverse(mesh=>{if(mesh.isMesh)shotHandlers.set(mesh,()=>{if(!network){sim.breakItem(def.id);accept(sim.snapshot());}return true;});});}
      else{o.userData.networkEntity=true;}
      world.add(o);objects.set(def.id,o);
      if(def.kind==='hookah')for(let i=0;i<14;i++){const segment=new THREE.Mesh(models.geometry('CylinderGeometry',[.008,.008,1,8]),models.material(0x244b54));segment.userData.networkEntity=true;world.add(segment);hoseSegments.push(segment);}
    }
    ready=true;accept(network&&state?state:sim.snapshot());
    unrestore=onRestore(()=>{if(!network){sim.reset();effects.clear();seenBreak.clear();accept(sim.snapshot());}});requestRender();
  });
  return {ready:loading,snapshot,setNetwork,applyNetworkSnapshot:accept,command,traceCollision,update,clearEffects(){effects?.clear();},
    get spec(){return spec;},get held(){return held();},get target(){return aimed;},get debug(){return{ready,pending,state,effects:effects?.debug,worldItems:objects.size};},
    dispose(){disposed=true;generation++;window.removeEventListener('keydown',onKey,true);window.removeEventListener('pointerdown',onPointer,true);unrestore?.();
      for(const e of [hud,take,use,put,back])e.remove();effects?.dispose();models?.dispose();
      handRoot.traverse(o=>{if(o.userData.partyHeldMaterial)o.material.dispose();});world.removeFromParent();handRoot.removeFromParent();remoteRoot.removeFromParent();document.body.classList.remove('party-held','party-aimed');}
  };
}
const CSS=`
.party-hud{position:fixed;z-index:8;left:50%;bottom:calc(var(--hud-bottom,76px) + 12px);transform:translateX(-50%);padding:10px 15px;border-radius:14px;background:#17362fe8;color:#fff3d6;box-shadow:0 4px 18px #0003;display:flex;align-items:center;gap:13px;max-width:min(660px,88vw);font:12px/1.45 system-ui;pointer-events:none;backdrop-filter:blur(8px)}
.party-hud[hidden],.party-touch[hidden]{display:none!important}.party-title{font-weight:750;white-space:nowrap}.party-meter{color:#f7ca65;white-space:nowrap;font-weight:700;letter-spacing:1px}.party-actions{opacity:.85}.party-touch{position:fixed;z-index:9;border:1px solid #ffffff60;background:#17362fef;color:#fff3d6;border-radius:15px;padding:13px 18px;right:16px;bottom:calc(var(--hud-bottom,76px) + 70px);font:600 14px system-ui;touch-action:manipulation}.party-touch:nth-last-child(3){right:120px}.party-touch:nth-last-child(2){bottom:calc(var(--hud-bottom,76px) + 124px)}.party-touch:last-child{right:120px;bottom:calc(var(--hud-bottom,76px) + 124px)}.party-touch:disabled{opacity:.55}body.party-aimed .kd-hint,body.party-aimed .ks-hint{visibility:hidden}
@media(max-width:650px){.party-hud{bottom:calc(var(--hud-bottom,76px) + 8px);gap:6px;flex-wrap:wrap;justify-content:center;padding:8px 12px}.party-actions{width:100%;text-align:center;font-size:11px}}
`;
