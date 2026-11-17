// Canonical SI rig adapter shared by the host and browser. The same authored
// wheel sockets feed Blender and cannon-es; mesh/decoder bind transforms stay
// beneath neutral pivot groups and never define a physical axle position.
export const RC_VEHICLE_AXES=Object.freeze({right:0,up:1,forward:2,direction:Object.freeze([0,-1,0]),axle:Object.freeze([-1,0,0])});
const vector=(v)=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const positive=v=>Number.isFinite(v)&&v>0;
export function getRCVehicleLayout(design,rules){
 const v=design?.vehicle;
 if(!v||!vector(v.centerOfMass)||!vector(v.collider?.center)||!vector(v.collider?.halfExtents)||!v.collider.halfExtents.every(positive)||!Array.isArray(v.wheels)||v.wheels.length!==4||!positive(rules?.suspension?.restLength))throw Error('rc_vehicle_layout:'+design?.id);
 const ids=new Set(),nodes=new Set();
 const wheels=v.wheels.map((w,index)=>{
  if(!['FL','FR','RL','RR'].includes(w.id)||ids.has(w.id)||typeof w.node!=='string'||!w.node||nodes.has(w.node)||!vector(w.position)||!positive(w.radius)||!positive(w.width)||typeof w.front!=='boolean'||typeof w.steer!=='boolean'||Math.abs(w.position[1]-w.radius)>.0001)throw Error('rc_wheel_layout:'+design.id+':'+w.id);
  ids.add(w.id);nodes.add(w.node);
  const left=w.id.endsWith('L'),front=w.id.startsWith('F');
  if((w.position[0]<0)!==left||(w.position[2]>0)!==front||w.front!==front)throw Error('rc_wheel_axes:'+design.id+':'+w.id);
  return{...w,index,position:[...w.position],connection:w.position.map((n,i)=>n-v.centerOfMass[i]+(i===1?rules.suspension.restLength:0))};
 });
 return{centerOfMass:[...v.centerOfMass],collider:{center:[...v.collider.center],halfExtents:[...v.collider.halfExtents],offset:v.collider.center.map((n,i)=>n-v.centerOfMass[i])},wheels};
}
export function modelOriginFromChassis(position,quaternion,centerOfMass,out=[]){
 const[x,y,z]=centerOfMass,[qx,qy,qz,qw]=quaternion;
 // q * local * inverse(q), equivalent to Three.Vector3.applyQuaternion.
 const tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x);
 out[0]=position[0]-(x+qw*tx+qy*tz-qz*ty);out[1]=position[1]-(y+qw*ty+qz*tx-qx*tz);out[2]=position[2]-(z+qw*tz+qx*ty-qy*tx);return out;
}
