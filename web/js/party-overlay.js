// Correct depth between fingers, glass and liquid; one small geometry pass over
// the existing raster frame. No full-screen transmission buffer or extra RT.
import {warmRasterPrograms} from './shader-warmup.js';
export function createPartyOverlay({THREE,renderer,scene,camera,pipe,root,active}){
 const overlayScene=new THREE.Scene();overlayScene.add(root);
 const hemi=new THREE.HemisphereLight(0xe6eef2,0x7a6c58,1),key=new THREE.DirectionalLight(0xffedda,1),rim=new THREE.DirectionalLight(0xd9e7f0,1);
 overlayScene.add(hemi,key,rim,key.target,rim.target);
 const offset=new THREE.Vector3();
 function lighting(){
  const exposure=Math.max(.001,renderer.toneMappingExposure),k=1/exposure;
  hemi.intensity=1.35*k;key.intensity=2.6*k;rim.intensity=.9*k;overlayScene.environment=scene.environment;overlayScene.environmentIntensity=.55*k;overlayScene.environmentRotation.copy(scene.environmentRotation);
  key.target.position.copy(root.position);key.position.copy(root.position).add(offset.set(-.6,.9,.5).applyQuaternion(camera.quaternion));rim.target.position.copy(root.position);rim.position.copy(root.position).add(offset.set(.6,.3,-.7).applyQuaternion(camera.quaternion));
 }
 const detach=pipe.addOverlay({active,draw(){
  lighting();
  const ac=renderer.autoClear;renderer.autoClear=false;
  try{renderer.clearDepth();renderer.render(overlayScene,camera);}finally{renderer.autoClear=ac;}
 }});
 return {scene:overlayScene,warm(object,cancelled){lighting();return warmRasterPrograms(renderer,object,camera,overlayScene,{cancelled});},dispose(){detach();root.removeFromParent();}};
}
