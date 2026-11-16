// Blender energy library: immutable SI geometry and shared world/hand material sets.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl, track, retry } from './loading.js';
export async function createEnergyModels(THREE,spec){
 const loader=new GLTFLoader(),url=assetUrl(spec.energy.asset);
 const gltf=await track(retry(()=>loader.loadAsync(url)),{label:'Польские энергетики',url});
 const templates=new Map(),resources=new Set(),materialSets=[new Map(),new Map()];
 gltf.scene.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){resources.add(m);for(const v of Object.values(m))if(v?.isTexture)resources.add(v);}});
 for(const v of spec.energy.variants){const o=gltf.scene.getObjectByName('energy_'+v.id);if(!o)throw Error('energy_template:'+v.id);templates.set(v.id,o);}
 const defs=new Map(spec.items.filter(i=>i.kind==='energy').map(i=>[i.id,i]));
 const labels=new Map([...defs].map(([id,item])=>{const v=spec.energy.variants.find(v=>v.id===item.variant);return[id,{...v,title:v.title+' · '+v.flavor}];}));
 function create({id,held=false}={}){
  const def=defs.get(id)||defs.values().next().value,model=templates.get(def.variant).clone(true),root=new THREE.Group(),cache=materialSets[held?1:0];
  // Authoring UV centre points -X. Presentation front is +Z for hands and world.
  model.rotation.y=Math.PI/2;root.add(model);
  root.name='energy_'+def.id;root.userData.labelId=def.variant;root.userData.labelTitle=labels.get(def.id).title;root.userData.energy=true;
  root.traverse(o=>{if(!o.isMesh)return;const material=m=>{if(!cache.has(m)){const c=m.clone();if(!held){c.emissive.copy(c.color);c.emissiveMap=c.map;c.emissiveIntensity=spec.energy.shelfGlow;}cache.set(m,c);resources.add(c);}return cache.get(m);};o.material=Array.isArray(o.material)?o.material.map(material):material(o.material);o.castShadow=!held;o.receiveShadow=!held;o.frustumCulled=!held;if(o.name.startsWith('energy_twist_cap')||o.name.startsWith('cap_knurl'))o.userData.energyCap=true;});
  if(held)root.userData.viewmodel=true;
  return root;
 }
 return{create,labels,dispose(){for(const r of resources)r.dispose?.();resources.clear();templates.clear();materialSets.forEach(m=>m.clear());gltf.scene.clear();}};
}
