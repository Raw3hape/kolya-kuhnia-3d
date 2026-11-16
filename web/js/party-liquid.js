// Gravity-aligned liquid inside an authored hollow volume. Geometry and shader
// share one plane; deterministic volume samples preserve fill as a bottle tilts.
export function radiusAt(profile, y) {
  if(y<profile[0][0]||y>profile.at(-1)[0])return 0;
  for(let i=1;i<profile.length;i++)if(y<=profile[i][0]){
    const [a,ra]=profile[i-1],[b,rb]=profile[i],t=(y-a)/(b-a);return ra+(rb-ra)*t;
  }
  return profile.at(-1)[1];
}
const halton=(i,b)=>{let f=1,r=0;while(i>0){f/=b;r+=f*(i%b);i=Math.floor(i/b);}return r;};
export function liquidSamples(profile,count=384) {
  const bins=256,lo=profile[0][0],hi=profile.at(-1)[0],dy=(hi-lo)/bins,cdf=new Float64Array(bins+1);
  for(let i=0;i<bins;i++)cdf[i+1]=cdf[i]+radiusAt(profile,lo+(i+.5)*dy)**2;
  const total=cdf[bins],out=new Float32Array(count*3);
  for(let i=0;i<count;i++){
    const target=halton(i+1,2)*total;let a=0,b=bins;
    while(a+1<b){const m=(a+b)>>1;if(cdf[m]>target)b=m;else a=m;}
    const y=lo+(a+(target-cdf[a])/(cdf[a+1]-cdf[a]))*dy,r=radiusAt(profile,y)*Math.sqrt(halton(i+1,3)),t=halton(i+1,5)*Math.PI*2;
    out.set([Math.cos(t)*r,y,Math.sin(t)*r],i*3);
  }
  return out;
}
export function fillPlane(samples,normal,fraction,scratch=new Float32Array(samples.length/3)) {
  for(let i=0;i<scratch.length;i++)scratch[i]=normal[0]*samples[i*3]+normal[1]*samples[i*3+1]+normal[2]*samples[i*3+2];
  scratch.sort();const index=Math.max(0,Math.min(scratch.length-1,fraction*(scratch.length-1))),a=Math.floor(index),t=index-a;
  return scratch[a]+((scratch[a+1]??scratch[a])-scratch[a])*t;
}
export function createBottleLiquid({THREE,root,volume,spec}) {
  const samples=liquidSamples(spec.inner,spec.samples),scratch=new Float32Array(samples.length/3),plane=new THREE.Vector4(0,1,0,.15);
  root.updateWorldMatrix(true,true);
  const localMatrix=new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(volume.matrixWorld);
  const liquid=volume.material.clone();liquid.color.set(spec.liquidColor);liquid.opacity=spec.liquidOpacity;liquid.transparent=true;liquid.depthWrite=false;liquid.roughness=.12;
  liquid.onBeforeCompile=shader=>{
    shader.uniforms.partyLiquidPlane={value:plane};
    shader.uniforms.partyLiquidLocal={value:localMatrix};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 partyLiquidPoint;uniform mat4 partyLiquidLocal;').replace('#include <begin_vertex>','#include <begin_vertex>\npartyLiquidPoint=(partyLiquidLocal*vec4(position,1.)).xyz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 partyLiquidPoint;uniform vec4 partyLiquidPlane;').replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(dot(partyLiquidPoint,partyLiquidPlane.xyz)>partyLiquidPlane.w)discard;');
  };
  liquid.customProgramCacheKey=()=> 'party-liquid-plane-v2';volume.material=liquid;volume.renderOrder=10;
  const n=spec.surfaceSegments,positions=new Float32Array((n+1)*3),normals=new Float32Array((n+1)*3),indices=[];
  for(let i=0;i<n;i++)indices.push(0,i+1,(i+1)%n+1);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setIndex(indices);
  const surfaceMaterial=new THREE.MeshStandardMaterial({color:spec.liquidColor,roughness:.08,metalness:.04,transparent:true,opacity:.48,side:THREE.DoubleSide,depthWrite:false});
  const surface=new THREE.Mesh(geometry,surfaceMaterial);surface.name='liquid_free_surface';surface.renderOrder=11;surface.frustumCulled=false;root.add(surface);
  const normal=new THREE.Vector3(0,1,0),target=normal.clone(),q=new THREE.Quaternion(),center=new THREE.Vector3(),u=new THREE.Vector3(),v=new THREE.Vector3(),p=new THREE.Vector3(),lastNormal=normal.clone();
  const middle=(spec.inner[0][0]+spec.inner.at(-1)[0])*.5;let previousFill=-1,initialized=false;
  const inside=(x,y,z)=>{const r=radiusAt(spec.inner,y);return r>0&&x*x+z*z<=r*r;};
  function update(fraction,dt=1/60){
    const fill=Math.max(0,Math.min(1,fraction*spec.initialFill));volume.visible=surface.visible=fill>.001;
    if(!volume.visible){previousFill=fill;return;}
    root.updateWorldMatrix(true,false);root.getWorldQuaternion(q).invert();target.set(0,1,0).applyQuaternion(q);
    if(!initialized){normal.copy(target);initialized=true;}else normal.lerp(target,1-Math.exp(-spec.settleRate*dt)).normalize();
    if(Math.abs(previousFill-fill)<1e-5&&normal.distanceToSquared(lastNormal)<1e-8)return;
    previousFill=fill;lastNormal.copy(normal);
    const level=fillPlane(samples,normal.toArray(),fill,scratch);plane.set(normal.x,normal.y,normal.z,level);
    center.set(0,middle,0).addScaledVector(normal,level-normal.y*middle);
    if(!inside(center.x,center.y,center.z)){
      center.set(0,0,0);let count=0;
      for(let i=0;i<samples.length;i+=3){const d=normal.x*samples[i]+normal.y*samples[i+1]+normal.z*samples[i+2]-level;if(Math.abs(d)<.0035){center.x+=samples[i];center.y+=samples[i+1];center.z+=samples[i+2];count++;}}
      if(count)center.multiplyScalar(1/count);else center.set(0,middle,0);
      center.addScaledVector(normal,level-center.dot(normal));
    }
    u.set(Math.abs(normal.y)>.95?1:0,Math.abs(normal.y)>.95?0:1,0).cross(normal).normalize();v.crossVectors(normal,u).normalize();
    positions.set(center.toArray(),0);normals.set(normal.toArray(),0);
    for(let i=0;i<n;i++){
      const a=i/n*Math.PI*2,dx=u.x*Math.cos(a)+v.x*Math.sin(a),dy=u.y*Math.cos(a)+v.y*Math.sin(a),dz=u.z*Math.cos(a)+v.z*Math.sin(a);
      let lo=0,hi=.30;
      // The inner profile is star-shaped around this in-volume plane centre.
      for(let j=1;j<=40;j++){const t=j*.0075;if(!inside(center.x+dx*t,center.y+dy*t,center.z+dz*t)){hi=t;lo=(j-1)*.0075;break;}}
      for(let j=0;j<11;j++){const t=(lo+hi)*.5;if(inside(center.x+dx*t,center.y+dy*t,center.z+dz*t))lo=t;else hi=t;}
      p.copy(center).addScaledVector(u,Math.cos(a)*lo*.995).addScaledVector(v,Math.sin(a)*lo*.995).addScaledVector(normal,.00012);
      positions.set(p.toArray(),(i+1)*3);normals.set(normal.toArray(),(i+1)*3);
    }
    geometry.attributes.position.needsUpdate=geometry.attributes.normal.needsUpdate=true;geometry.computeBoundingSphere();
  }
  return {update,dispose(){liquid.dispose();geometry.dispose();surfaceMaterial.dispose();surface.removeFromParent();},get debug(){return{plane:plane.toArray(),fill:previousFill,normal:normal.toArray()};}};
}
