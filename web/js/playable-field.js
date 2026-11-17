// Geometry-only adapter over the compiled contiguous field. Attribute boundaries
// between meadow and field never become driving barriers. See build_field.py.
import {PLAYABLE_FIELD} from './playable-field.generated.js';
export {PLAYABLE_FIELD};
const finite=Number.isFinite;
function segmentPoint(a,b,x,z){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));return[a[0]+t*dx,a[1]+t*dz];}
function ringDistance(ring,x,z){let d=Infinity;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const p=segmentPoint(ring[j],ring[i],x,z);d=Math.min(d,Math.hypot(x-p[0],z-p[1]));}return d;}
function inRing(ring,x,z){if(ringDistance(ring,x,z)<1e-7)return true;let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function createPlayableField({clearance=0,geometry=PLAYABLE_FIELD}={}){
 const polygons=geometry.polygons,contours=polygons.flatMap(p=>[{kind:'outer',points:p.outer},...p.holes.map(points=>({kind:'obstacle',points}))]);
 const all=polygons.flatMap(p=>p.outer),bounds={x0:Math.min(...all.map(p=>p[0])),x1:Math.max(...all.map(p=>p[0])),z0:Math.min(...all.map(p=>p[1])),z1:Math.max(...all.map(p=>p[1]))};
 function inside(x,z){return finite(x)&&finite(z)&&x>=bounds.x0&&x<=bounds.x1&&z>=bounds.z0&&z<=bounds.z1&&polygons.some(p=>inRing(p.outer,x,z)&&!p.holes.some(h=>inRing(h,x,z)));}
 function safe(x,z,margin=clearance){return inside(x,z)&&contours.every(c=>ringDistance(c.points,x,z)>=margin-1e-7);}
 function nearestSafe(x,z,margin=clearance){
  if(safe(x,z,margin))return[x,z];let best=null,distance=Infinity;
  const add=p=>{const d=(p[0]-x)**2+(p[1]-z)**2;if(d<distance&&safe(...p,margin)){distance=d;best=p;}};
  // Inspect near-edge candidates first; no random resampling or hidden island.
  for(const contour of contours){const r=contour.points;for(let i=0,j=r.length-1;i<r.length;j=i++){const p=segmentPoint(r[j],r[i],x,z);for(let k=0;k<16;k++){const a=k/16*Math.PI*2;add([p[0]+Math.cos(a)*(margin+.02),p[1]+Math.sin(a)*(margin+.02)]);}}}
  if(best)return best;
  const limit=Math.hypot(bounds.x1-bounds.x0,bounds.z1-bounds.z0);
  for(let radius=1;radius<limit;radius+=1){for(let k=0;k<64;k++){const a=k/64*Math.PI*2;add([x+Math.cos(a)*radius,z+Math.sin(a)*radius]);}if(best)return best;}
  return null;
 }
 return{inside,safe,nearestSafe,boundaryDistance:(x,z)=>Math.min(...contours.map(c=>ringDistance(c.points,x,z))),bounds,polygons,polys:polygons.map(p=>p.outer),contours,source:geometry};
}
