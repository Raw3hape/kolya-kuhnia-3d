"""Original everyday props: Blender -> one reusable GLB library + manifest.
Use props_build.mjs for staged, compressed publication.
blender -b --python tools/party/props.py [-- --out <staging> --render <path.png>]
Metres; authoring Z-up, exported glTF Y-up; templates have a centre-of-footprint pivot.
"""
import bpy, math, json, random, sys
from pathlib import Path
from mathutils import Vector
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RECIPE = json.loads((Path(__file__).with_name('props.recipe.json')).read_text())
args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
OUT = Path(args[args.index('--out')+1]).resolve() if '--out' in args else ROOT/'web/models/party/props'
OUT.mkdir(parents=True,exist_ok=True)
render_path = Path(args[args.index('--render')+1]) if '--render' in args else None
bpy.ops.wm.read_factory_settings(use_empty=True)
rng=random.Random(RECIPE['seed']); materials={}; roots=[]

def linear(h):
 c=[int(h[i:i+2],16)/255 for i in (1,3,5)]
 return [v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in c]

def material(name):
 if name in materials:return materials[name]
 p=RECIPE['materials'][name]; m=bpy.data.materials.new(name);m.use_nodes=True;m.use_backface_culling=True
 bs=m.node_tree.nodes.get('Principled BSDF'); col=linear(p['color'])
 bs.inputs['Base Color'].default_value=(*col,p.get('alpha',1));bs.inputs['Roughness'].default_value=p['roughness'];bs.inputs['Metallic'].default_value=p.get('metalness',0)
 if p.get('alpha',1)<1:
  bs.inputs['Alpha'].default_value=p['alpha'];m.surface_render_method='DITHERED'
 if p.get('speckle') or p.get('grain') or p.get('weave'):
  n=128; yy,xx=np.mgrid[0:n,0:n];noise=np.random.default_rng(RECIPE['seed']+len(materials)).random((n,n))-.5
  modulation=noise*p.get('speckle',.014)
  if p.get('speckle'):modulation-=((noise>.46).astype(float))*p['speckle']*2
  if p.get('grain'):modulation+=.035*np.sin(xx*.14+np.sin(yy*.043)*2)+noise*.025
  if p.get('weave'):modulation+=((xx%4==0)|(yy%4==0))*.045-.014
  # Colour image is deliberately small and repeatable; detail supports the finish, not silhouette.
  pixels=np.ones((n,n,4),dtype=np.float32)
  for channel in range(3):pixels[:,:,channel]=np.clip(col[channel]*(1+modulation),0,1)
  im=bpy.data.images.new(name+'_finish',width=n,height=n,alpha=True);im.pixels.foreach_set(pixels.ravel());im.pack()
  tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im;m.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
 materials[name]=m;return m

def root(name):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);roots.append(o);return o

def attach(o,parent,mat):
 o.parent=parent;o.data.materials.append(material(mat));
 if o.type=='MESH':
  for p in o.data.polygons:p.use_smooth=True
 return o

def lathe(name,profile,mat,parent,ribs=0):
 n=RECIPE['radialSegments'];verts=[];faces=[]
 for j,(r,z) in enumerate(profile):
  for i in range(n):
   a=2*math.pi*i/n;rr=r+(0.00045*math.cos(a*ribs) if ribs and r>.008 else 0);verts.append((rr*math.cos(a),rr*math.sin(a),z))
 for j in range(len(profile)-1):
  for i in range(n):k=j*n+i;ni=j*n+(i+1)%n;faces.append((k,ni,ni+n,k+n))
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);attach(o,parent,mat)
 uv=me.uv_layers.new()
 for poly in me.polygons:
  j=poly.index//n;i=poly.index%n
  vals=[(i/n,j/(len(profile)-1)),((i+1)/n,j/(len(profile)-1)),((i+1)/n,(j+1)/(len(profile)-1)),(i/n,(j+1)/(len(profile)-1))]
  for li,value in zip(poly.loop_indices,vals):uv.data[li].uv=value
 return o

def bevel_box(name,size,at,mat,parent,radius=.002):
 bpy.ops.mesh.primitive_cube_add(size=1,location=at);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 attach(o,parent,mat)
 b=o.modifiers.new('soft manufactured edges','BEVEL');b.width=radius;b.segments=3
 bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=b.name)
 w=o.modifiers.new('weighted corner normals','WEIGHTED_NORMAL');w.keep_sharp=True;bpy.ops.object.modifier_apply(modifier=w.name)
 return o

def line(name,points,radius,mat,parent,resolution=8,bevel_resolution=2):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=resolution;cu.bevel_depth=radius;cu.bevel_resolution=bevel_resolution
 sp=cu.splines.new('BEZIER');sp.bezier_points.add(len(points)-1)
 for p,co in zip(sp.bezier_points,points):p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
 o=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(o);o.parent=parent;o.data.materials.append(material(mat));bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False)
 return o

def disk(name,radius,depth,z,mat,parent,ribs=0):
 p=[[0,z-depth/2],[radius-.001,z-depth/2],[radius,z-depth/2+.001],[radius,z+depth/2-.001],[radius-.001,z+depth/2],[0,z+depth/2]]
 return lathe(name,p,mat,parent,ribs)

def text(name,body,size,at,mat,parent,rotation=(0,0,0)):
 cu=bpy.data.curves.new(name,'FONT');cu.body=body;cu.align_x='CENTER';cu.align_y='CENTER';cu.size=size;cu.extrude=.000015;cu.resolution_u=3
 o=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(o);o.parent=parent;o.location=at;o.rotation_euler=rotation;o.data.materials.append(material(mat));bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False);return o

def cup(name,profile,finish,handle_scale=1,coffee=True):
 p=root(name);lathe(name+'_hollow',RECIPE['profiles'][profile],finish,p)
 s=handle_scale
 line(name+'_handle',[(.037*s,0,.075*s),(.062*s,0,.079*s),(.071*s,0,.060*s),(.066*s,0,.034*s),(.039*s,0,.027*s)],.0044*s,finish,p)
 if coffee:disk('coffee_meniscus',.034*s,.001,.081*s,'coffee',p)
 return p

cup('stoneware_mug','mug','oat_glaze')
cup('espresso_cup','espresso','sage_glaze',.67)
p=root('saucer');lathe('saucer_hollow',RECIPE['profiles']['saucer'],'oat_glaze',p)
p=root('stoneware_bowl');lathe('bowl_hollow',RECIPE['profiles']['bowl'],'sage_glaze',p)
p=root('ramekin');lathe('ramekin_hollow',RECIPE['profiles']['ramekin'],'oat_glaze',p,20)
p=root('ribbed_tumbler');lathe('thick_ribbed_glass',RECIPE['profiles']['tumbler'],'glass',p,16)

for name,content,fill in [('pepper_jar','pepper',.062),('herb_jar','herbs',.051),('salt_jar','salt',.070)]:
 p=root(name);lathe('jar_glass',RECIPE['profiles']['spice'],'glass',p)
 disk('brushed_lid',.024,.009,.0975,'steel',p,24);disk('lid_lower_rim',.025,.002,.093,'steel',p,24)
 lathe('spice_contents',[[0,.007],[.0215,.007],[.0225,fill-.003],[.021,fill],[0,fill+.001]],content,p)
 for i in range(15):
  a=rng.random()*math.tau;r=math.sqrt(rng.random())*.019
  bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.0022,location=(math.cos(a)*r,math.sin(a)*r,fill+.001))
  attach(bpy.context.object,p,content)
 # A small plain paper strip is functional rather than front-facing advertising.
 label=bevel_box('paper_date_label',(.029,.0006,.018),(0,-.0265,.035),'paper',p,.0003)
 text('date_mark','04',.008,(0,-.027,.035),'ink',p,(math.pi/2,0,0))

p=root('sugar_jar');lathe('sugar_glass',RECIPE['profiles']['sugar'],'glass',p)
lathe('sugar_contents',[[0,.007],[.029,.007],[.030,.044],[.026,.047],[0,.047]],'salt',p)
disk('oak_lid',.034,.011,.0795,'wood',p)
line('lid_pull',[(0,0,.086),(.002,0,.092),(.006,0,.094)],.003,'wood',p)

p=root('cork_coaster');disk('rounded_cork',.046,.004,.002,'cork',p)
# Restrained low tray for the handheld device, with a real recessed centre.
p=root('device_tray')
bevel_box('tray_base',(.082,.154,.003),(0,0,.0015),'oat_glaze',p,.006)
for x in [-.039,.039]:bevel_box('tray_raised_side',(.004,.147,.006),(x,0,.005),'oat_glaze',p,.0015)
for y in [-.075,.075]:bevel_box('tray_rounded_end',(.076,.004,.006),(0,y,.005),'oat_glaze',p,.0015)

p=root('linen_napkin')
# A folded hemmed napkin: low grid undulations, thickness and folded edge, not a flat square.
verts=[];faces=[];nx,ny=12,10
for j in range(ny+1):
 for i in range(nx+1):
  x=(i/nx-.5)*.106;y=(j/ny-.5)*.084
  z=.004+.0007*math.sin(i*.9+j*.3)+.001*math.sin(j*.7)
  verts.append((x,y,z))
for j in range(ny):
 for i in range(nx):k=j*(nx+1)+i;faces.append((k,k+1,k+nx+2,k+nx+1))
me=bpy.data.meshes.new('folded_linen');me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new('folded_linen',me);bpy.context.collection.objects.link(o);attach(o,p,'linen')
sol=o.modifiers.new('folded_cloth_thickness','SOLIDIFY');sol.thickness=.003;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=sol.name)
for x in [-.049,.049]:line('stitched_hem',[(x,-.038,.005),(x,0,.0055),(x,.038,.005)],.00035,'paper',p)

p=root('linen_book')
bevel_box('page_block',(.192,.137,.021),(0,0,.0125),'paper',p,.001)
for z in [.0015,.024]:bevel_box('linen_cover',(.204,.147,.003),(0,0,z),'linen',p,.001)
bevel_box('rounded_spine',(.005,.147,.025),(-.101,0,.0125),'linen',p,.0015)
for i in range(8):
 z=.005+i*.0023
 for y in [-.0688,.0688]:bevel_box('page_edge',(.186,.00016,.00015),(0,y,z),'unglazed',p,.00003)
text('cover_title','EVERYDAY',.017,(.004,.015,.0256),'ink',p)
text('cover_subtitle','SPACES',.010,(.004,-.010,.0256),'ink',p)
# Cloth bookmark rests between pages, just peeking out.
bevel_box('bookmark',(.009,.032,.0006),(.040,.080,.012),'sage_glaze',p,.0002)

p=root('keys')
line('steel_keyring',[(math.cos(i*math.tau/12)*.014,math.sin(i*math.tau/12)*.014,.002) for i in range(13)],.0013,'steel',p,resolution=2,bevel_resolution=1)
for i,(at,rot) in enumerate([((.017,-.007,.002),-.4),((.002,-.021,.004),.7)]):
 # Key heads have an actual open centre, a slender shaft and individually cut teeth.
 k=bpy.data.objects.new('key_'+str(i),None);bpy.context.collection.objects.link(k);k.parent=p;k.location=at;k.rotation_euler.z=rot
 line('bow',[(math.cos(a)*.008,math.sin(a)*.010,.001) for a in np.linspace(0,math.tau,13)],.002,'steel',k,resolution=2,bevel_resolution=1)
 bevel_box('shaft',(.006,.027,.002),(0,-.022,.001),'steel',k,.0004)
 for j in range(3):bevel_box('cut_tooth',(.009-j*.001,.003,.002),(.002,-.026-j*.006,.001),'steel',k,.0003)

# Apply transforms and combine only by material within each template, reducing draw calls.
for parent in roots:
 children=[o for o in parent.children_recursive if o.type=='MESH']
 for o in children:
  bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.select_set(False)
 # Join each finish group; 1-3 draw calls per common ceramic object.
 groups={}
 for o in children:
  key=o.data.materials[0].name;groups.setdefault(key,[]).append(o)
 for key,objects in groups.items():
  bpy.ops.object.select_all(action='DESELECT')
  for o in objects:o.select_set(True)
  bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=objects[0];o.name=parent.name+'_'+key
  world=o.matrix_world.copy();o.parent=parent;o.matrix_world=world
  textured=any(node.type=='TEX_IMAGE' for mat in o.data.materials for node in mat.node_tree.nodes)
  if not textured:
   for layer in list(o.data.uv_layers):o.data.uv_layers.remove(layer)
  elif not o.data.uv_layers:
   bpy.context.view_layer.objects.active=o;bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.2,island_margin=.02);bpy.ops.object.mode_set(mode='OBJECT')
 bpy.ops.object.select_all(action='DESELECT')

# Remove emptied authoring helpers after merging, preserving only template roots.
for p in roots:
 for node in list(p.children_recursive):
  if node.type=='EMPTY' and not node.children:bpy.data.objects.remove(node,do_unlink=True)

# Ground every template at its actual lowest surface.
for p in roots:
 zmin=min((o.matrix_world@Vector(v)).z for o in p.children_recursive if o.type=='MESH' for v in o.bound_box)
 for child in p.children:child.location.z-=zmin
 bpy.context.view_layer.update()

bpy.ops.export_scene.gltf(filepath=str(OUT/'library.glb'),export_format='GLB',export_yup=True,export_materials='EXPORT',export_extras=False,export_animations=False,export_apply=True)
manifest={'version':RECIPE['version'],'boundsAxes':'Blender Z-up; exported asset is glTF Y-up','seed':RECIPE['seed'],'generator':'tools/party/props.py','templates':[]}
for p in roots:
 meshes=[o for o in p.children_recursive if o.type=='MESH'];verts=[p.matrix_world.inverted()@(o.matrix_world@Vector(v)) for o in meshes for v in o.bound_box]
 manifest['templates'].append({'id':p.name,'meshes':len(meshes),'triangles':sum(sum(len(f.vertices)-2 for f in o.data.polygons) for o in meshes),'bounds':[list(map(float,(min(v[a] for v in verts) for a in range(3)))),list(map(float,(max(v[a] for v in verts) for a in range(3))))]})
manifest['bytes']=(OUT/'library.glb').stat().st_size
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('PROPS_MANIFEST',json.dumps({'bytes':manifest['bytes'],'templates':len(roots),'triangles':sum(t['triangles'] for t in manifest['templates'])}))

if render_path:
 # Proof render with the same shared material finishes and millimetre-scale details.
 for i,p in enumerate(roots):p.location=((i%5)*.27,(i//5)*.29,0)
 bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object;floor.location.z=-.002;floor.data.materials.append(material('paper'))
 bpy.ops.object.light_add(type='AREA',location=(.3,-.8,1.7));bpy.context.object.data.energy=65;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=1.4
 bpy.ops.object.light_add(type='AREA',location=(1.6,.5,1));bpy.context.object.data.energy=30;bpy.context.object.data.size=1.2
 bpy.ops.object.camera_add(location=(1.35,-1.45,1.7));cam=bpy.context.object;target=Vector((.54,.29,.03));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=1.48;bpy.context.scene.camera=cam
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True;scene.render.resolution_x=1200;scene.render.resolution_y=920;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.filepath=str(render_path);scene.world=bpy.data.worlds.new('Soft studio');scene.world.color=(.20,.20,.20);scene.view_settings.view_transform='AgX';bpy.ops.render.render(write_still=True)
