// Remote-operator input: returns head-look deltas and optical magnification.
// No camera position, chase distance or vehicle-follow transform exists here.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function createRCViewControls(settings){
 const pointers=new Map();let magnification=settings.initial,pinch=0;
 const snapshot=()=>({magnification,pointers:pointers.size});
 function reset(){pointers.clear();pinch=0;magnification=settings.initial;return snapshot();}
 function cancel(){pointers.clear();pinch=0;}
 function down(id,x,y,type='mouse'){
  if(!Number.isFinite(x)||!Number.isFinite(y)||pointers.size>=2)return false;
  pointers.set(id,{x,y,type});if(pointers.size===2){const[a,b]=[...pointers.values()];pinch=Math.hypot(a.x-b.x,a.y-b.y);}return true;
 }
 function move(id,x,y){
  const previous=pointers.get(id);if(!previous||!Number.isFinite(x)||!Number.isFinite(y))return null;
  pointers.set(id,{x,y,type:previous.type});
  if(pointers.size===2){const[a,b]=[...pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);if(pinch>1&&distance>1)magnification=clamp(magnification*distance/pinch,settings.min,settings.max);pinch=distance;return{zoom:true,magnification};}
  return{dx:x-previous.x,dy:y-previous.y,type:previous.type};
 }
 function up(id){const found=pointers.delete(id);pinch=0;return found;}
 function wheel(delta){if(!Number.isFinite(delta))return false;magnification=clamp(magnification*Math.exp(-clamp(delta,-200,200)*settings.wheelSensitivity),settings.min,settings.max);return true;}
 return{down,move,up,wheel,reset,cancel,snapshot};
}
