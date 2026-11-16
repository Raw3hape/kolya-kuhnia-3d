// Fixed-stock, deterministic persistent glass. Late join derives identical shards
// from canonical item breakSerial + point. No unbounded entity/event allocation.
export function createPartyLitter({THREE,scene,spec,floorAt}){
 const perBottle=16,capacity=spec.items.filter(i=>i.kind==='beer').length*perBottle;
 const geometry=new THREE.TetrahedronGeometry(.026),material=new THREE.MeshStandardMaterial({color:'#43572d',roughness:.24,metalness:.18,side:THREE.DoubleSide});
 const mesh=new THREE.InstancedMesh(geometry,material,Math.max(1,capacity));mesh.name='party_persistent_glass';mesh.count=0;mesh.frustumCulled=false;mesh.userData.networkEffect=true;mesh.userData.rasterOnly=true;scene.add(mesh);
 const dummy=new THREE.Object3D();let signature='',wasMoving=false;
 function update(state){
  const broken=state.items.filter(i=>i.kind==='beer'&&i.status==='broken'),key=broken.map(i=>i.id+':'+i.breakSerial).join('|');
  const moving=broken.some(i=>state.time-i.brokenAt<1.1);if(key===signature&&!moving&&!wasMoving)return false;signature=key;wasMoving=moving;let index=0;
  for(const item of broken){let seed=(item.breakSerial*173+item.id.length)|0;const random=()=>((seed=Math.imul(seed,1664525)+1013904223|0)>>>0)/4294967296;
   const age=Math.max(0,state.time-item.brokenAt),t=Math.min(1,age/1.1);
   for(let n=0;n<perBottle;n++){
    const angle=random()*Math.PI*2,radius=.055+random()*.27,scale=.45+random()*.85,x=item.position[0]+Math.cos(angle)*radius,z=item.position[2]+Math.sin(angle)*radius;
    const ground=floorAt(x,z),floor=Number.isFinite(ground)?ground+.011:item.position[1]-.025;
    dummy.position.set(item.position[0]+(x-item.position[0])*t,item.position[1]+(floor-item.position[1])*t+Math.sin(t*Math.PI)*(.12+random()*.18),item.position[2]+(z-item.position[2])*t);
    dummy.rotation.set(random()*6.28,random()*6.28,random()*6.28);dummy.scale.set(.4*scale,scale,.15*scale);dummy.updateMatrix();mesh.setMatrixAt(index++,dummy.matrix);
   }
  }
  mesh.count=index;mesh.instanceMatrix.needsUpdate=true;return moving;
 }
 return{update,clear(){mesh.count=0;signature='';wasMoving=false;},get count(){return mesh.count;},dispose(){mesh.removeFromParent();geometry.dispose();material.dispose();}};
}
