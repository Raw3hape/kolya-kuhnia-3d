// Original Blender-authored prop library, shared immutable geometry/textures.
// World and first-person materials are separate so room lighting never patches
// a held model's shader. Only liquid state is allocated per bottle instance.
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {assetUrl,track,retry} from './loading.js';
import {createBottleLiquid} from './party-liquid.js';

export async function createPartyModels(THREE, spec) {
  const [recipe,labelSpec]=await Promise.all(['party-visuals','party-labels'].map(name=>retry(()=>fetch(`spec/${name}.json`).then(r=>{if(!r.ok)throw Error('party_visual_config:'+name);return r.json();}))));
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),url=assetUrl(recipe.asset);
  const gltf=await track(retry(()=>loader.loadAsync(url)),{label:'Стекло, кальян и предметы',url});
  const source=gltf.scene,templates=new Map(),worldMaterials=new Map(),heldMaterials=new Map(),controllers=new Set(),labelGeometries=new Map();
  const labels=new Map(labelSpec.labels.map((entry,index)=>[entry.id,{...entry,index}]));
  for(const item of spec.items.filter(i=>i.kind==='beer'))if(!labels.has(item.id))throw Error('party_label_missing:'+item.id);
  for(const [kind,entry] of Object.entries(recipe.models)){
    const template=source.getObjectByName(entry.node);if(!template)throw Error('party_model_missing:'+kind);templates.set(kind,template);
  }
  const materialFor=(source,held)=>{
    const cache=held?heldMaterials:worldMaterials;
    if(!cache.has(source)){
      const m=source.clone();
      if(m.name==='bottle_glass'){
        m.color.set(recipe.bottle.glassTint);m.opacity=recipe.bottle.glassOpacity;
        m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`float partyFresnel=pow(1.-abs(dot(normal,normalize(vViewPosition))),3.);diffuseColor.a=mix(${recipe.bottle.glassOpacity.toFixed(3)},${recipe.bottle.glassRimOpacity.toFixed(3)},partyFresnel);\n#include <opaque_fragment>`);};
        m.customProgramCacheKey=()=> 'party-glass-fresnel-v2';
      }
      if(m.transparent){m.depthWrite=false;m.side=THREE.FrontSide;}
      cache.set(source,m);
    }
    return cache.get(source);
  };
  function labelGeometry(source,label){
    let variants=labelGeometries.get(source);if(!variants){variants=new Map();labelGeometries.set(source,variants);}
    if(!variants.has(label.id)){
      const geometry=source.clone(),uv=source.getAttribute('uv'),values=new Float32Array(uv.count*2);
      const [w,h]=labelSpec.cellPixels,g=labelSpec.gutterPixels,col=label.index%labelSpec.columns,row=Math.floor(label.index/labelSpec.columns);
      for(let i=0;i<uv.count;i++){values[i*2]=(col*w+g+uv.getX(i)*(w-2*g))/(w*labelSpec.columns);values[i*2+1]=(row*h+g+uv.getY(i)*(h-2*g))/(h*labelSpec.rows);}
      geometry.setAttribute('uv',new THREE.BufferAttribute(values,2));variants.set(label.id,geometry);
    }
    return variants.get(label.id);
  }
  function create(kind,{held=false,id}={}){
    const root=templates.get(kind).clone(true);root.name='party_'+kind;
    const label=kind==='beer'?(id===undefined?labels.values().next().value:labels.get(id)):null;
    if(kind==='beer'&&!label)throw Error('party_label_missing:'+id);
    root.traverse(o=>{if(o.isMesh){
      const original=Array.isArray(o.material)?o.material:[o.material];
      if(label&&original.some(m=>m.name===labelSpec.material))o.geometry=labelGeometry(o.geometry,label);
      o.material=Array.isArray(o.material)?o.material.map(m=>materialFor(m,held)):materialFor(o.material,held);
      o.castShadow=!held&&kind!=='beer'&&!(Array.isArray(o.material)?o.material.some(m=>m.transparent):o.material.transparent);
      o.receiveShadow=!held;o.frustumCulled=!held;
      const materials=Array.isArray(o.material)?o.material:[o.material];
      if(materials.some(m=>m.name==='bottle_glass'))o.renderOrder=12;
    }});
    if(kind==='beer'){
      root.userData.labelId=label.id;root.userData.labelTitle=label.title;
      const volume=root.getObjectByName('beer_liquid');if(!volume)throw Error('party_liquid_missing');
      const controller=createBottleLiquid({THREE,root,volume,spec:recipe.bottle});controllers.add(controller);
      root.userData.liquid=controller;root.userData.cap=root.getObjectByName('beer_cap');
      root.userData.release=()=>{controller.dispose();controllers.delete(controller);};controller.update(1);
    }
    if(kind==='hookah')root.userData.restTip=root.getObjectByName('hookah_rest_tip');
    if(held)root.userData.viewmodel=true;
    return root;
  }
  function dispose(){
    for(const c of controllers)c.dispose();controllers.clear();
    const geometries=new Set(),materials=new Set([...worldMaterials.values(),...heldMaterials.values()]),textures=new Set();
    source.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});
    for(const variants of labelGeometries.values())for(const g of variants.values())geometries.add(g);labelGeometries.clear();
    for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();
    worldMaterials.clear();heldMaterials.clear();templates.clear();
    source.clear();
  }
  return {recipe,labels,create,beer:o=>create('beer',o),vape:o=>create('vape',o),mouthpiece:o=>create('mouthpiece',o),hookah:o=>create('hookah',o),crate:()=>{const o=create('crate');o.position.fromArray(spec.crate.position);return o;},release:o=>o?.userData.release?.(),dispose};
}
