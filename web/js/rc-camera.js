// DOM-free orbit intent shared by mouse, click-drag trackpad and multitouch.
// It never sees or mutates the avatar camera. Angles are radians; SI distance.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function createRCOrbit(settings){
 let time=0,azimuth=null,pitch=settings.pitch,distance=settings.distance,manualUntil=0,pinch=0;const pointers=new Map();
 const manual=()=>{manualUntil=time+settings.manualSeconds;};
 function reset(){azimuth=null;pitch=settings.pitch;distance=settings.distance;manualUntil=0;pointers.clear();pinch=0;}
 function down(id,x,y){if(!Number.isFinite(x)||!Number.isFinite(y))return false;pointers.set(id,{x,y});if(pointers.size===2){const[a,b]=[...pointers.values()];pinch=Math.hypot(a.x-b.x,a.y-b.y);}return true;}
 function look(dx,dy){if(!Number.isFinite(dx)||!Number.isFinite(dy))return false;azimuth=(azimuth??0)-dx*settings.sensitivity;pitch=clamp(pitch+dy*settings.sensitivity,settings.minPitch,settings.maxPitch);manual();return true;}
 function move(id,x,y){const previous=pointers.get(id);if(!previous||!Number.isFinite(x)||!Number.isFinite(y))return false;pointers.set(id,{x,y});if(pointers.size>=2){const[a,b]=[...pointers.values()],next=Math.hypot(a.x-b.x,a.y-b.y);if(pinch>1&&next>1)distance=clamp(distance*pinch/next,settings.minDistance,settings.maxDistance);pinch=next;manual();}else look(x-previous.x,y-previous.y);return true;}
 function up(id){const had=pointers.delete(id);pinch=0;return had;}
 function cancel(){pointers.clear();pinch=0;}
 function zoom(delta){if(!Number.isFinite(delta))return false;distance=clamp(distance*Math.exp(clamp(delta,-100,100)*settings.zoomSensitivity),settings.minDistance,settings.maxDistance);manual();return true;}
 function step(dt,heading){if(!Number.isFinite(dt)||!Number.isFinite(heading)||dt<0)return snapshot();time+=Math.min(dt,.1);azimuth??=heading;if(time>manualUntil&&!pointers.size){const k=1-Math.exp(-settings.recenterResponse*Math.min(dt,.1));azimuth+=Math.atan2(Math.sin(heading-azimuth),Math.cos(heading-azimuth))*k;pitch+=(settings.pitch-pitch)*k;}return snapshot();}
 function snapshot(){return{azimuth,pitch,distance,dragging:pointers.size>0,pointers:pointers.size,manual:time<=manualUntil};}
 return{down,move,up,look,zoom,step,cancel,reset,snapshot};
}
