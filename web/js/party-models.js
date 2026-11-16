// Small original procedural props. Shared geometries/materials, no downloaded assets.
export function createPartyModels(THREE, spec) {
  const resources = new Set(), mats = new Map(), geo = new Map();
  const own = o => (resources.add(o), o);
  const material = (color, metalness = 0, roughness = .5) => {
    const key = `${color}:${metalness}:${roughness}`;
    if (!mats.has(key)) mats.set(key, own(new THREE.MeshStandardMaterial({ color, metalness, roughness })));
    return mats.get(key);
  };
  const geometry = (type, args) => {
    const key = type + args.join(',');
    if (!geo.has(key)) geo.set(key, own(new THREE[type](...args)));
    return geo.get(key);
  };
  const mesh = (g, m, parent, name, p = [0,0,0]) => {
    const o = new THREE.Mesh(g, m); o.name = name; o.position.fromArray(p); parent.add(o); return o;
  };
  const cylinder = (parent, name, top, bottom, height, color, y, x = 0, z = 0, metal = 0) =>
    mesh(geometry('CylinderGeometry', [top,bottom,height,16]), material(color,metal,.32), parent,name,[x,y,z]);
  const sphere = (parent,name,r,color,p,scale=[1,1,1]) => {
    const o = mesh(geometry('SphereGeometry',[r,16,10]),material(color),parent,name,p); o.scale.fromArray(scale); return o;
  };
  function label(text, sub, color = '#f4d46e') {
    const c = document.createElement('canvas'); c.width=256; c.height=128;
    const ctx=c.getContext('2d'); ctx.fillStyle=color;ctx.fillRect(0,0,256,128);
    ctx.strokeStyle='#223b23';ctx.lineWidth=5;ctx.strokeRect(5,5,246,118);
    ctx.fillStyle='#193822';ctx.textAlign='center';ctx.font='900 27px sans-serif';ctx.fillText(text,128,49);
    ctx.font='bold 17px sans-serif';ctx.fillText(sub,128,82);ctx.font='20px sans-serif';ctx.fillText('★  ★  ★',128,108);
    const map=own(new THREE.CanvasTexture(c));map.colorSpace=THREE.SRGBColorSpace;
    return own(new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide}));
  }
  const beerLabel=label('КАБАН','ЛАГЕР · 5 ГЛОТКОВ');
  const ledMaterial=own(new THREE.MeshBasicMaterial({color:0x86f6ff}));
  function beer() {
    const g=new THREE.Group();g.name='party_beer';
    cylinder(g,'glass_body',.036,.039,.19,0x286537,.13);
    cylinder(g,'shoulder',.016,.036,.054,0x317845,.252);
    cylinder(g,'neck',.014,.016,.073,0x286537,.31);
    cylinder(g,'lip',.018,.018,.009,0x174b2c,.351);
    cylinder(g,'cap',.019,.019,.012,0xd9ac42,.36);
    const l=mesh(geometry('CylinderGeometry',[.0395,.0395,.093,20,1,true]),beerLabel,g,'label',[0,.135,0]);l.rotation.y=Math.PI;
    const fill=cylinder(g,'liquid',.007,.007,.15,0xffb62e,.13,.035,0);
    g.userData.fill=fill;g.userData.cap=g.getObjectByName('cap');return g;
  }
  function vape() {
    const g=new THREE.Group();g.name='party_vape';
    const body=mesh(geometry('BoxGeometry',[.038,.108,.024]),material(0x517e9b,.65,.25),g,'body',[0,.054,0]);
    cylinder(g,'mouthpiece',.006,.009,.045,0x272c32,.126);
    const led=mesh(geometry('SphereGeometry',[.004,8,6]),ledMaterial,g,'led',[0,.082,.013]);
    g.userData.led=led;body.rotation.z=.08;return g;
  }
  function mouthpiece() {
    const g=new THREE.Group();g.name='party_hookah_mouthpiece';
    cylinder(g,'grip',.013,.015,.20,0xe4bb66,.10,0,0,.65);
    cylinder(g,'tip',.007,.010,.08,0x272d34,.235);return g;
  }
  function hookah() {
    const g=new THREE.Group();g.name='party_hookah';
    cylinder(g,'foot',.14,.16,.035,0xd6ae64,.02,0,0,.55);
    sphere(g,'teal_glass',.14,0x267b8a,[0,.15,0],[1,1.1,1]);
    cylinder(g,'gold_stem',.022,.035,.39,0xcba158,.40,0,0,.8);
    cylinder(g,'tray',.13,.12,.018,0xdab875,.61,0,0,.75);
    cylinder(g,'bowl',.055,.025,.075,0x9b573f,.66);
    for(let i=0;i<3;i++) {
      const coal=mesh(geometry('BoxGeometry',[.025,.022,.025]),material(0x442823),g,'coal_'+i,[Math.cos(i*2.1)*.022,.711,Math.sin(i*2.1)*.022]);
      coal.material=own(new THREE.MeshStandardMaterial({color:0x492c24,emissive:0xf05513,emissiveIntensity:.6,roughness:1}));
    }
    const tip=mouthpiece();tip.position.set(.16,.09,0);tip.rotation.z=-.7;g.add(tip);
    g.userData.restTip=tip;return g;
  }
  function crate() {
    const g=new THREE.Group();g.name='party_beer_crate';
    const [w,h,d]=spec.crate.size;
    const box=(name,size,pos)=>mesh(geometry('BoxGeometry',size),material(0x6e8f37),g,name,pos);
    box('bottom',[w,.025,d],[0,.013,0]);
    for(const z of [-d/2,d/2])for(const y of [.07,h-.035])box('slat',[w,.07,.022],[0,y,z]);
    for(const x of [-w/2,w/2]){box('end',[.023,h,d],[x,h/2,0]);}
    for(const x of [-w/2,w/2])for(const z of [-d/2,d/2])box('post',[.03,h,.03],[x,h/2,z]);
    const sign=mesh(geometry('PlaneGeometry',[.33,.11]),beerLabel,g,'crate_label',[0,.13,d/2+.014]);
    sign.rotation.y=0;g.position.fromArray(spec.crate.position);return g;
  }
  function hands() {
    const g=new THREE.Group();g.name='party_hands';
    const arm=sphere(g,'sleeve',.065,0x7391a4,[.035,-.08,.12],[.75,1.1,1.9]);arm.rotation.x=-.5;
    sphere(g,'hand',.05,0xe7b08c,[.008,.025,.018],[.75,1.2,.7]);
    for(let i=0;i<3;i++)sphere(g,'finger_'+i,.014,0xe7b08c,[-.026,.01+i*.024,.037],[1.5,.7,1]);
    return g;
  }
  return {beer,vape,hookah,mouthpiece,crate,hands,material,geometry,dispose(){for(const r of resources)r.dispose?.();resources.clear();}};
}
