import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRCSimulation} from '../../web/js/rc-state.js';
const spec=JSON.parse(readFileSync(new URL('../../web/spec/rc.json',import.meta.url))),site=JSON.parse(readFileSync(new URL('../../web/spec/site.json',import.meta.url)));
function fixture(index=0){const sim=createRCSimulation({spec,site}),id=`rc-${index}`,p={id:'driver',x:spec.table.position[0],z:spec.table.position[2]};assert(sim.command(p,'take',id).ok);let seq=0;return{sim,id,p,pose:()=>sim.pose(id),drive(frames,input={throttle:1,steer:0,brake:false},packetEvery=1){const samples=[];for(let i=0;i<frames;i++){if(i%packetEvery===0)assert(sim.command(p,'input',id,{...input,seq:++seq}).ok);sim.step(spec.physics.fixedStep);samples.push(sim.pose(id));}return samples;}};}
test('every design progressively accelerates to the doubled forward speed and remains controllable at that speed',()=>{
 assert.equal(spec.physics.maxSpeed,24);
 for(let i=0;i<spec.designs.length;i++){const f=fixture(i);try{
  f.drive(30,{throttle:0,steer:0,brake:false});const curve=f.drive(360);
  assert(curve[0].driveThrottle>0&&curve[0].driveThrottle<.1,'first motor impulse must be gentle');
  assert(curve[5].driveThrottle<curve[17].driveThrottle&&curve[17].driveThrottle<1,'held throttle builds progressively');
  assert(curve[29].speed<curve[59].speed&&curve[59].speed<curve[119].speed,'speed must grow over time');
  assert(curve[29].speed<spec.physics.maxSpeed*.25,'no jump to maximum speed');
  assert(curve.at(-1).speed>spec.physics.maxSpeed*.98);
  assert(Math.max(...curve.map(c=>c.speed))<spec.physics.maxSpeed+.2,'limiter must stay effective');
  const turn=f.drive(60,{throttle:1,steer:.8,brake:false});assert(turn.every(c=>1-2*(c.quaternion[0]**2+c.quaternion[2]**2)>.65),'high-speed steering must keep chassis upright');
 }finally{f.sim.dispose();}}
});
test('motor ramp follows physics time rather than input packet rate',()=>{const a=fixture(),b=fixture();try{const x=a.drive(120,undefined,1),y=b.drive(120,undefined,2);for(let i=0;i<x.length;i++){assert.equal(x[i].driveThrottle,y[i].driveThrottle);assert.deepEqual(x[i].position,y[i].position);}}finally{a.sim.dispose();b.sim.dispose();}});
test('snapshot correction preserves ramp progress; brake, stale input and controller transitions clear stored torque',()=>{const f=fixture(),copy=createRCSimulation({spec,site});try{
 f.drive(6);const s=f.sim.snapshot();assert(copy.restore(s));assert.equal(copy.pose(f.id).driveThrottle,f.pose().driveThrottle);copy.step(spec.physics.fixedStep);assert(Math.abs(copy.pose(f.id).driveThrottle-(f.pose().driveThrottle+spec.physics.throttleRiseRate*spec.physics.fixedStep))<.0002);
 f.drive(1,{throttle:1,steer:0,brake:true});assert.equal(f.pose().driveThrottle,0);
 f.drive(12);for(let i=0;i<30;i++)f.sim.step(spec.physics.fixedStep);assert.equal(f.pose().driveThrottle,0,'lost packets must not leave residual motor demand');
 f.drive(6);assert(f.sim.command(f.p,'pause',f.id).ok);assert.equal(f.pose().driveThrottle,0);assert(f.sim.command(f.p,'drive',f.id).ok);assert.equal(f.pose().driveThrottle,0);
 f.drive(6);assert(f.sim.transfer(f.p.id,'friend',f.id).ok);assert.equal(f.pose().driveThrottle,0);
 const legacy=f.sim.snapshot();delete legacy.cars[0].driveThrottle;assert(copy.restore(legacy));assert.equal(copy.pose(f.id).driveThrottle,0);
 }finally{f.sim.dispose();copy.dispose();}});
