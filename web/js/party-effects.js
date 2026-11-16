// Bounded local particle pools and synthesized comic foley; no network particle traffic.
export function createPartyEffects({THREE,scene,spec,glassColor,floorAt=()=>0,getSound}) {
  const smoke=[],shards=[],r=spec.effects;
  const positions=new Float32Array(r.smokeBudget*3),sizes=new Float32Array(r.smokeBudget),alpha=new Float32Array(r.smokeBudget);
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geo.setAttribute('size',new THREE.BufferAttribute(sizes,1));geo.setAttribute('alpha',new THREE.BufferAttribute(alpha,1));
  const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{scale:{value:600}},
    vertexShader:'attribute float size;attribute float alpha;varying float a;uniform float scale;void main(){vec4 p=modelViewMatrix*vec4(position,1.);a=alpha;gl_PointSize=min(190.,size*scale/max(.2,-p.z));gl_Position=projectionMatrix*p;}',
    fragmentShader:'varying float a;void main(){vec2 p=gl_PointCoord*2.-1.;float d=dot(p,p);float wisps=.72+.28*sin(p.x*7.+sin(p.y*8.))*sin(p.y*6.);float cloud=exp(-3.6*d)*(1.-smoothstep(.55,1.,d))*wisps;gl_FragColor=vec4(.79,.84,.87,cloud*a);}' });
  const points=new THREE.Points(geo,mat);points.name='party_smoke';points.frustumCulled=false;points.renderOrder=3;
  points.userData.networkEffect=true;points.userData.rasterOnly=true;scene.add(points);
  const shardGeo=new THREE.TetrahedronGeometry(.022),shardMat=new THREE.MeshStandardMaterial({color:glassColor,metalness:.15,roughness:.2,transparent:true,opacity:.82,depthWrite:false});
  const pieces=new THREE.InstancedMesh(shardGeo,shardMat,r.shardBudget);pieces.name='party_bottle_shards';pieces.count=0;pieces.frustumCulled=false;
  pieces.userData.networkEffect=true;pieces.userData.rasterOnly=true;scene.add(pieces);
  const dummy=new THREE.Object3D();let audio=null;
  function sound(kind,volume=1) {
    if(getSound?.()===false)return;
    try {
      audio??=new (window.AudioContext||window.webkitAudioContext)();audio.resume().catch(()=>{});
      const at=audio.currentTime;
      const tone=(frequency,to,duration,offset,gain,type='sine')=>{
        const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(frequency,at+offset);o.frequency.exponentialRampToValueAtTime(to,at+offset+duration);
        g.gain.setValueAtTime(.001,at+offset);g.gain.exponentialRampToValueAtTime(Math.max(.001,gain*volume),at+offset+.012);g.gain.exponentialRampToValueAtTime(.001,at+offset+duration);
        o.connect(g);g.connect(audio.destination);o.start(at+offset);o.stop(at+offset+duration+.01);
      };
      if(kind==='sip'){tone(170,68,.16,.22,.10);tone(145,60,.18,.49,.08);}
      else if(kind==='empty'){tone(190,85,.28,.1,.07,'triangle');tone(90,42,.19,.38,.06);}
      else if(kind==='puff'){for(let i=0;i<5;i++)tone(90+i*26,50,.12,i*.10,.025,'triangle');}
      else if(kind==='take'){tone(580,900,.07,0,.035,'triangle');tone(1200,1600,.08,.06,.02);}
      else if(kind==='break'){
        for(let i=0;i<9;i++)tone(1500+i*337,360+i*180,.09+i*.018,i*.014,.045,'triangle');
        tone(410,75,.32,.12,.08,'sine');tone(180,510,.13,.33,.055,'triangle');
      }
    }catch{/* Browsers without WebAudio retain the visual interaction. */}
  }
  function puff(origin,direction,strength=1) {
    for(let i=0;i<3;i++){
      if(smoke.length>=r.smokeBudget)smoke.shift();
      smoke.push({p:origin.clone().addScaledVector(direction,.08).add(new THREE.Vector3((Math.random()-.5)*.07,(Math.random()-.5)*.05,(Math.random()-.5)*.07)),v:direction.clone().multiplyScalar(.4+Math.random()*.55).add(new THREE.Vector3((Math.random()-.5)*.45,.10+Math.random()*.17,(Math.random()-.5)*.45)),age:0,life:r.smokeSeconds,size:(.14+Math.random()*.12)*strength});
    }
  }
  function shatter(position,seed=1) {
    let s=seed|0;const random=()=>((s=Math.imul(1664525,s)+1013904223|0)>>>0)/4294967296;
    for(let i=0;i<22;i++){
      if(shards.length>=r.shardBudget)shards.shift();
      shards.push({p:new THREE.Vector3().fromArray(position),v:new THREE.Vector3((random()-.5)*2,random()*2+.5,(random()-.5)*2),spin:random()*8,age:0,scale:.6+random()});
    }
  }
  function update(dt,camera) {
    mat.uniforms.scale.value=innerHeight*.7;
    for(let i=smoke.length-1;i>=0;i--){const p=smoke[i];p.age+=dt;if(p.age>=p.life){smoke.splice(i,1);continue;}p.p.addScaledVector(p.v,dt);p.v.multiplyScalar(Math.exp(-dt*.6));p.v.y+=dt*.035;}
    for(let i=0;i<smoke.length;i++){const p=smoke[i],t=p.age/p.life;positions.set(p.p.toArray(),i*3);sizes[i]=p.size+t*r.smokeSize;alpha[i]=Math.min(1,p.age*8)*(1-t)*.16;}
    geo.setDrawRange(0,smoke.length);for(const a of Object.values(geo.attributes))a.needsUpdate=true;
    for(let i=shards.length-1;i>=0;i--){const p=shards[i];p.age+=dt;if(p.age>=r.shardSeconds){shards.splice(i,1);continue;}p.v.y-=9.8*dt;p.p.addScaledVector(p.v,dt);const floor=floorAt(p.p.x,p.p.z)+.012;if(p.p.y<floor){p.p.y=floor;p.v.y=Math.abs(p.v.y)*.25;p.v.x*=.7;p.v.z*=.7;}}
    shards.forEach((p,i)=>{dummy.position.copy(p.p);dummy.rotation.set(p.age*p.spin,p.age*p.spin*.7,p.age);dummy.scale.setScalar(p.scale*Math.min(1,(r.shardSeconds-p.age)*2));dummy.updateMatrix();pieces.setMatrixAt(i,dummy.matrix);});
    pieces.count=shards.length;pieces.instanceMatrix.needsUpdate=true;
    return smoke.length>0||shards.length>0;
  }
  return {puff,shatter,sound,update,get debug(){return{smoke:smoke.length,shards:shards.length};},clear(){smoke.length=shards.length=0;geo.setDrawRange(0,0);pieces.count=0;},dispose(){points.removeFromParent();pieces.removeFromParent();geo.dispose();mat.dispose();shardGeo.dispose();shardMat.dispose();audio?.close().catch(()=>{});}};
}
