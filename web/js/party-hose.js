// One continuous rubber tube; no per-segment draw calls or idle geometry work.
export function createPartyHose({THREE,scene,recipe}){
 const n=recipe.segments,radial=10,positions=new Float32Array((n+1)*(radial+1)*3),normals=new Float32Array(positions.length),indices=[];
 for(let i=0;i<n;i++)for(let j=0;j<radial;j++){const a=i*(radial+1)+j,b=a+radial+1;indices.push(a,b,a+1,a+1,b,b+1);}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setIndex(indices);
 const material=new THREE.MeshStandardMaterial({color:recipe.color,roughness:.7,metalness:.04});
 const mesh=new THREE.Mesh(geometry,material);mesh.name='party_hookah_hose';mesh.userData.networkEntity=true;mesh.userData.rasterOnly=true;mesh.frustumCulled=false;scene.add(mesh);
 const previousA=new THREE.Vector3(Infinity,0,0),previousB=previousA.clone(),middle=new THREE.Vector3(),point=new THREE.Vector3(),tangent=new THREE.Vector3(),u=new THREE.Vector3(),v=new THREE.Vector3(),normal=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
 function update(a,b){
  if(a.distanceToSquared(previousA)<1e-8&&b.distanceToSquared(previousB)<1e-8)return false;
  previousA.copy(a);previousB.copy(b);middle.copy(a).add(b).multiplyScalar(.5);middle.y=Math.max(.035,Math.min(a.y,b.y)-recipe.sag);
  for(let i=0;i<=n;i++){
   const t=i/n,s=1-t;point.copy(a).multiplyScalar(s*s).addScaledVector(middle,2*s*t).addScaledVector(b,t*t);
   tangent.copy(middle).sub(a).multiplyScalar(s).addScaledVector(v.copy(b).sub(middle),t).normalize();
   u.crossVectors(Math.abs(tangent.y)>.95?normal.set(1,0,0):up,tangent).normalize();v.crossVectors(tangent,u).normalize();
   for(let j=0;j<=radial;j++){
    const angle=j/radial*Math.PI*2;normal.copy(u).multiplyScalar(Math.cos(angle)).addScaledVector(v,Math.sin(angle));const k=(i*(radial+1)+j)*3;
    positions[k]=point.x+normal.x*recipe.radius;positions[k+1]=point.y+normal.y*recipe.radius;positions[k+2]=point.z+normal.z*recipe.radius;normals[k]=normal.x;normals[k+1]=normal.y;normals[k+2]=normal.z;
   }
  }
  geometry.attributes.position.needsUpdate=geometry.attributes.normal.needsUpdate=true;return true;
 }
 return {update,dispose(){mesh.removeFromParent();geometry.dispose();material.dispose();}};
}
