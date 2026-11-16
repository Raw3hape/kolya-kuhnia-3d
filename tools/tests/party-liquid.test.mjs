import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {liquidSamples,fillPlane,radiusAt} from '../../web/js/party-liquid.js';
const recipe=JSON.parse(fs.readFileSync(new URL('../../web/spec/party-visuals.json',import.meta.url)));
const profile=recipe.bottle.inner,samples=liquidSamples(profile,recipe.bottle.samples);
test('five sips visibly drain a contained bottle volume without refilling on tilt',()=>{
 const heights=[0,1,2,3,4].map(s=>fillPlane(samples,[0,1,0],recipe.bottle.initialFill*(1-s/5)));
 assert(heights.every((h,i)=>h>profile[0][0]&&h<profile.at(-1)[0]&&(!i||h<heights[i-1]-.005)));
 for(let i=0;i<samples.length;i+=3)assert(Math.hypot(samples[i],samples[i+2])<=radiusAt(profile,samples[i+1])+1e-7);
 for(const normal of [[1,0,0],[0,0,-1],[Math.SQRT1_2,Math.SQRT1_2,0]]){
  const fill=.43,h=fillPlane(samples,normal,fill);let submerged=0;
  for(let i=0;i<samples.length;i+=3)if(normal[0]*samples[i]+normal[1]*samples[i+1]+normal[2]*samples[i+2]<=h)submerged++;
  assert(Math.abs(submerged/(samples.length/3)-fill)<.01,'tilting preserves the same water volume');
 }
});
