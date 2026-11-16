"""Original SI-scale interactive household assets; recipe web/spec/party-visuals.json.
blender -b --python tools/party/build_interactive.blender.py [-- --render]
"""
import bpy,math,json,sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
SPEC=json.loads((ROOT/'web/spec/party-visuals.json').read_text())
PUBLISHED=ROOT/'web/models/party/interactive';TEX=PUBLISHED/'textures';OUT=Path(sys.argv[sys.argv.index('--stage')+1]) if '--stage' in sys.argv else PUBLISHED;OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
materials={}
def mat(name,color,rough=.45,metal=0,alpha=1,texture=None):
 m=bpy.data.materials.new(name);m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF')
 values=[int(color[i:i+2],16)/255 for i in (1,3,5)];rgb=tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values);bs.inputs['Base Color'].default_value=(*rgb,1);bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal;bs.inputs['Alpha'].default_value=alpha
 m.diffuse_color=(*rgb,alpha)
 if alpha<1:
  if hasattr(m,'surface_render_method'):m.surface_render_method='DITHERED'
  m.use_transparency_overlap=False
 if texture:
  t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(TEX/texture));m.node_tree.links.new(t.outputs['Color'],bs.inputs['Base Color'])
  if texture=='carrier-print.png':m.node_tree.links.new(t.outputs['Alpha'],bs.inputs['Alpha']);m.surface_render_method='DITHERED'
 materials[name]=m;return m
M={
 'glass':mat('bottle_glass',SPEC['bottle']['glassTint'],.115,0,SPEC['bottle']['glassOpacity']),
 'water':mat('lager_liquid',SPEC['bottle']['liquidColor'],.13,0,SPEC['bottle']['liquidOpacity']),
 'paper':mat('lager_paper','#ffffff',.77,0,1,'lager-label.jpg'),
 'silver':mat('brushed_stainless','#ffffff',.27,.87,1,'brushed-metal.png'),
 'cap':mat('crown_steel','#b1b2aa',.32,.85),
 'dark':mat('anodized_graphite',SPEC['vape']['body'],.32,.75),
 'rubber':mat('soft_black_polymer','#151a1c',.63),
 'coal':mat('charcoal','#191b1d',.95),
 'ceramic':mat('unglazed_clay','#47423a',.78),
 'hookahglass':mat('smoked_borosilicate',SPEC['hookah']['glass'],.14,.02,.34),
 'card':mat('kraft_fibre','#ffffff',.94,0,1,'cardboard.png'),
 'print':mat('carrier_ink','#ffffff',.92,0,.99,'carrier-print.png'),
 'waterClear':mat('hookah_water','#849d9d',.1,0,.38)
}
def root(name):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);return o
def finish(o,name,m,parent,bevel=0):
 o.name=name;o.parent=parent
 if m:o.data.materials.append(m)
 if o.type=='MESH':
  if bevel:
   mod=o.modifiers.new('Manufactured edge radius','BEVEL');mod.width=bevel;mod.segments=3
   bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
  for p in o.data.polygons:p.use_smooth=True
 return o
def box(name,size,pos,m,parent,bevel=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return finish(o,name,m,parent,bevel)
def cylinder(name,r,h,z,m,parent,vertices=48):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=h,location=(0,0,z));return finish(bpy.context.object,name,m,parent,.0007)
def lathe(name,profile,m,parent,n=64,close=False):
 verts=[(r*math.cos(2*math.pi*j/n),r*math.sin(2*math.pi*j/n),h) for h,r in profile for j in range(n)]
 faces=[]
 for i in range(len(profile)-1):
  for j in range(n):faces.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
 if close:faces.extend([tuple(reversed(tuple(range(n)))),tuple((len(profile)-1)*n+j for j in range(n))])
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);finish(o,name,m,parent)
 uv=mesh.uv_layers.new(name='UVMap')
 for poly in mesh.polygons:
  for li in poly.loop_indices:
   vi=mesh.loops[li].vertex_index;ring,j=divmod(vi,n);uv.data[li].uv=(j/n,ring/(len(profile)-1))
 return o
def curved_label(parent):
 n=32;r=.031;verts=[]
 for z in [.040,.126]:
  for i in range(n+1):
   t=(i/n-.5)*2.45;verts.append((r*math.sin(t),-r*math.cos(t),z))
 faces=[(i,i+1,n+2+i,n+1+i) for i in range(n)];mesh=bpy.data.meshes.new('lager_label');mesh.from_pydata(verts,[],faces);mesh.update();uv=mesh.uv_layers.new(name='UVMap')
 for p in mesh.polygons:
  for li in p.loop_indices:
   v=mesh.loops[li].vertex_index;uv.data[li].uv=(v%(n+1)/n,v//(n+1))
 o=bpy.data.objects.new('beer_label',mesh);bpy.context.collection.objects.link(o);finish(o,o.name,M['paper'],parent)
beer=root('beer');profile=SPEC['bottle']['outer']+list(reversed(SPEC['bottle']['inner']))
lathe('beer_glass',profile,M['glass'],beer,SPEC['bottle']['segments'],True)
liq=lathe('beer_liquid',SPEC['bottle']['inner'],M['water'],beer,48,True);liq['partyRole']='liquid'
curved_label(beer)
caproot=root('beer_cap');caproot.parent=beer
# Pressed crown steel with 21 realistic crimped teeth; small relief, not a gear toy.
n=84;verts=[]
for z,r in [( .233,.0154),(.237,.0154),(.240,.0139)]:
 for j in range(n):
  rr=r+(.0007*math.cos(j*math.pi/2) if z<.238 else 0);verts.append((rr*math.cos(j*2*math.pi/n),rr*math.sin(j*2*math.pi/n),z))
faces=[]
for i in range(2):
 for j in range(n):faces.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
faces.append(tuple(2*n+j for j in range(n)));mesh=bpy.data.meshes.new('crown');mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new('crown',mesh);bpy.context.collection.objects.link(o);finish(o,'crown',M['cap'],caproot)
vape=root('vape');v=SPEC['vape'];body=box('vape_body',(v['width'],v['depth'],v['height']),(0,0,v['height']/2),M['dark'],vape,v['radius'])
box('vape_mouthpiece',(.012,.007,v['mouthpieceHeight']),(0,0,v['height']+v['mouthpieceHeight']/2),M['rubber'],vape,.003)
box('vape_seam',(.018,.011,.0008),(0,0,v['height']-.007),M['silver'],vape,.0003)
led=mat('status_led','#b6d0c6',.3);bs=led.node_tree.nodes.get('Principled BSDF');bs.inputs['Emission Color'].default_value=(.25,.45,.36,1);bs.inputs['Emission Strength'].default_value=.1
box('vape_led',(.0015,.0005,.008),(0,-v['depth']/2-.0002,.070),led,vape,.0003)
box('vape_charge_port',(.006,.001,.0018),(0,-.003,.0015),M['rubber'],vape,.0005)
mp=root('mouthpiece');lathe('mouthpiece_body',[(0,.0067),(.008,.0072),(.026,.0064),(.120,.0064),(.145,.0058),(.154,.0048),(.198,.0042),(.200,.0038)],M['dark'],mp,40,True)
for z in [.012,.030,.125]:cylinder('mouthpiece_collar',.007,.003,z,M['silver'],mp,40)
hookah=root('hookah')
hp=[(0,.065),(.003,.085),(.008,.098),(.018,.100),(.055,.097),(.105,.081),(.15,.049),(.174,.025),(.18,.024),(.18,.021),(.173,.022),(.15,.045),(.105,.077),(.055,.093),(.018,.096),(.01,.082),(.008,.065)]
lathe('hookah_vase',hp,M['hookahglass'],hookah,64,True)
lathe('hookah_water',[(.012,.080),(.025,.091),(.055,.091),(.080,.084)],M['waterClear'],hookah,48,True)
lathe('hookah_stem',[(.168,.023),(.178,.026),(.189,.026),(.193,.018),(.202,.016),(.210,.012),(.440,.012),(.448,.018),(.458,.019)],M['silver'],hookah,48,True)
for z in [.182,.20]:cylinder('silicone_seal',.027,.003,z,M['rubber'],hookah,48)
lathe('hookah_tray',[(.449,.018),(.451,.09),(.454,.099),(.461,.101),(.464,.099),(.458,.094),(.456,.018)],M['silver'],hookah,64,False)
lathe('hookah_bowl',[(.458,.014),(.465,.018),(.474,.021),(.492,.030),(.510,.036),(.518,.035),(.520,.031),(.508,.028),(.490,.017)],M['ceramic'],hookah,48,True)
cylinder('hookah_foil',.034,.001,.520,M['cap'],hookah,48)
for i in range(3):
 a=i*2*math.pi/3;o=box('hookah_coal_'+str(i),(.022,.022,.018),(.017*math.cos(a),.017*math.sin(a),.531),M['coal'],hookah,.0018);o.rotation_euler.z=a+.2
port=cylinder('hose_port',.010,.032,0,M['silver'],hookah,32);port.location=(.027,0,.19);port.rotation_euler.y=math.pi/2
valve=cylinder('air_valve',.008,.022,0,M['silver'],hookah,32);valve.location=(-.028,0,.19);valve.rotation_euler.y=-.8
rest=root('hookah_rest_tip');rest.parent=hookah
for child in list(mp.children):
 cp=child.copy();cp.data=child.data;bpy.context.collection.objects.link(cp);cp.parent=rest
rest.location=(.16,-.03,.045);rest.rotation_euler=(0,1.0,0)
crate=root('crate');c=SPEC['crate'];w,d,h,t=c['width'],c['depth'],c['height'],c['wall']
box('carrier_floor',(w,d,t),(0,0,t/2),M['card'],crate,.0012)
for y in [-d/2,d/2]:
 box('carrier_long_wall',(w,t,h),(0,y,h/2),M['card'],crate,.0013)
 # Exposed folded top edge and bottom fold give the carton a manufactured thickness.
 box('carrier_fold',(w,.006,.003),(0,y,h-.003),M['card'],crate,.0006)
for x in [-w/2,w/2]:
 # A real horizontal hand opening, made from four strips rather than a black decal.
 holew=.066;holeh=.025;zh=.124
 box('carrier_end_lower',(t,d,zh-holeh/2),(x,0,(zh-holeh/2)/2),M['card'],crate,.001)
 box('carrier_end_upper',(t,d,h-zh-holeh/2),(x,0,(h+zh+holeh/2)/2),M['card'],crate,.001)
 for y in [-(d+holew)/4,(d+holew)/4]:box('carrier_handle_side',(t,(d-holew)/2,holeh),(x,y,zh),M['card'],crate,.001)
# Separate carton dividers stop glass bottles floating loosely inside a big box.
for x in [-w/4,0,w/4]:box('carrier_divider',(t*.6,d,.092),(x,0,.048),M['card'],crate,.0005)
box('carrier_spine',(w,t*.6,.092),(0,0,.048),M['card'],crate,.0005)
# Screen-printed mark on the front face (alpha, no bright sticker rectangle).
bpy.ops.mesh.primitive_plane_add(size=1,location=(0,-d/2-t*.6,h*.52),rotation=(math.pi/2,0,0));pr=bpy.context.object;pr.scale=(w*.78,h*.54,1);finish(pr,'carrier_print',M['print'],crate)
roots=[beer,vape,mp,hookah,crate]
# Merge manufactured components by finish within each semantic parent. Articulated
# cap/mouthpiece groups and the liquid volume remain independent.
from collections import defaultdict
buckets=defaultdict(list)
for ob in list(bpy.context.scene.objects):
 if ob.type=='MESH' and ob.parent and len(ob.data.materials)==1:buckets[(ob.parent,ob.data.materials[0])].append(ob)
for (parent,material),group in buckets.items():
 if len(group)<2:continue
 bpy.ops.object.select_all(action='DESELECT')
 for ob in group:ob.select_set(True)
 bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join();group[0].name=parent.name+'_'+material.name
for ob in bpy.context.scene.objects:ob.select_set(False)
for r in roots:
 r.select_set(True)
 for ch in r.children_recursive:ch.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'library.raw.glb'),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_apply=True,export_animations=False)
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];tri=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
(OUT/'manifest.json').write_text(json.dumps({'generator':'tools/party/build_interactive.blender.py','units':'metres','nodes':[r.name for r in roots],'triangles':tri,'meshes':len(meshes),'materials':len(materials)},indent=2)+'\n')
print('INTERACTIVE_ASSET',json.dumps({'triangles':tri,'meshes':len(meshes),'materials':len(materials)}))
if '--render' in sys.argv:
 for i,r in enumerate(roots):r.location.x=[-.43,-.18,-.05,.22,.52][i]
 bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.003));floor=bpy.context.object;floor.data.materials.append(mat('preview_floor','#c7c6bc',.8))
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.world.color=(.35,.35,.35)
 def area(pos,power,size):
  data=bpy.data.lights.new('studio_softbox','AREA');data.energy=power;data.shape='DISK';data.size=size;o=bpy.data.objects.new('studio_softbox',data);scene.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((.1,0,.2))-o.location).to_track_quat('-Z','Y').to_euler()
 area((-.6,-1.3,1.7),140,1.5);area((.8,.6,1.4),100,1.2)
 bpy.ops.object.camera_add(location=(1,-1.6,.95));camera=bpy.context.object;camera.rotation_euler=(Vector((.08,0,.21))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=1.32;scene.camera=camera
 scene.render.resolution_x=1200;scene.render.resolution_y=800;scene.render.resolution_percentage=100;scene.render.filepath=str(ROOT/'output/playwright/party-realism/interactive-studio.png');bpy.ops.render.render(write_still=True)
