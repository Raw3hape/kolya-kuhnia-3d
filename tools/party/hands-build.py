"""Author continuous bare-hand prop grips. Blender, metres, deterministic recipe.
blender -b --python tools/party/hands-build.py -- [--render]
The three static grip meshes share materials; no runtime skinning or downloaded assets.
"""
import bpy, math, sys, json
from pathlib import Path
from mathutils import Vector, Matrix
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'web/models/party/hands.glb'
RECIPE=ROOT/'web/spec/party-grips.json'
EVIDENCE=ROOT/'output/playwright/party-realism/hands'
if '--staging' in sys.argv:OUT=EVIDENCE/'hands.raw.glb'
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
T=lambda p:Vector((p[0],-p[2],p[1]))
def mat(name,color,roughness):
 m=bpy.data.materials.new(name);m.use_nodes=True
 b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1);b.inputs['Roughness'].default_value=roughness
 return m
skin=mat('warm natural skin',(0.49,.267,.175),.56)
nail=mat('natural nail plates',(.48,.30,.23),.38)
cloth=mat('graphite cotton sleeve',(.052,.065,.074),.89)
# Small reusable normal tile: surface pores without a large skin-color download.
size=128
img=bpy.data.images.new('skin_micro_normal',width=size,height=size,alpha=False)
img.colorspace_settings.name='Non-Color'
values=[]
for y in range(size):
 for x in range(size):
  a=.022*math.sin(x*1.77+y*2.13)+.012*math.sin(x*.53-y*1.63)
  b=.022*math.cos(x*1.63-y*1.83)+.012*math.cos(x*.67+y*.51)
  values.extend([.5+a,.5+b,.998,1])
img.pixels=values
img.pack()
nodes=skin.node_tree.nodes;tex=nodes.new('ShaderNodeTexImage');tex.image=img
normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.22
skin.node_tree.links.new(tex.outputs['Color'],normal.inputs['Color']);skin.node_tree.links.new(normal.outputs['Normal'],nodes.get('Principled BSDF').inputs['Normal'])
vc=skin.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='AnatomicalTint'
skin.node_tree.links.new(vc.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
all_roots=[];manifest=[]

def sphere(center,radii,collection):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,location=T(center))
 o=bpy.context.object;o.scale=(radii[0],radii[2],radii[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);collection.append(o);return o

def link(a,b,r1,r2,collection):
 a,b=T(a),T(b);v=b-a
 bpy.ops.mesh.primitive_cone_add(vertices=24,radius1=r1,radius2=r2,depth=v.length,location=(a+b)/2)
 o=bpy.context.object;o.rotation_quaternion=v.to_track_quat('Z','Y');o.rotation_mode='QUATERNION';o.rotation_quaternion=v.to_track_quat('Z','Y')
 collection.append(o)

def forearm(center,sections,collection):
 # Elliptical sections blend directly into the palm; no separate wrist ball.
 centers=[Vector(center)+Vector(section['offset']) for section in sections]
 vertices=[];faces=[];count=24
 for i,(c,section) in enumerate(zip(centers,sections)):
  axis=(centers[min(i+1,len(centers)-1)]-centers[max(0,i-1)]).normalized()
  x=Vector((1,0,0));x=(x-axis*x.dot(axis)).normalized();y=axis.cross(x).normalized()
  rx,ry=section['radii']
  for j in range(count):
   angle=j*math.tau/count;vertices.append(T(c+x*(math.cos(angle)*rx)+y*(math.sin(angle)*ry)))
 for i in range(len(centers)-1):
  for j in range(count):faces.append((i*count+j,i*count+(j+1)%count,(i+1)*count+(j+1)%count,(i+1)*count+j))
 faces.append(tuple(reversed(range(count))));faces.append(tuple((len(centers)-1)*count+j for j in range(count)))
 mesh=bpy.data.meshes.new('tapered anatomical forearm');mesh.from_pydata(vertices,[],faces);mesh.update()
 obj=bpy.data.objects.new('palm wrist transition',mesh);scene.collection.objects.link(obj);collection.append(obj)
 return centers[1],centers[-1]

def join(objects,name):
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=name;return o

def finger(path,radii,skin_parts,nails,normal):
 for i,p in enumerate(path):sphere(p,(radii[i],radii[i]*1.02,radii[i]),skin_parts)
 for i in range(len(path)-1):link(path[i],path[i+1],radii[i],radii[i+1],skin_parts)
 p0,p1=Vector(path[-2]),Vector(path[-1]);t=(p1-p0).normalized();n=Vector(normal);n=(n-t*n.dot(t)).normalized();x=t.cross(n).normalized();n=x.cross(t).normalized()
 c=p1-t*.004+n*(radii[-1]-.0003)
 o=sphere(c,(radii[-1]*.72,.008,.0012),nails)
 # Sphere is built in Blender axes; orient its long axis along distal phalanx.
 xb,yb,zb=T(x),T(t),T(n)
 # Current ellipsoid's long axis is Blender Z, thin axis Blender Y.
 basis=Matrix((xb,-zb,yb)).transposed().to_4x4()
 o.rotation_mode='QUATERNION';o.rotation_quaternion=basis.to_quaternion()
 return o

authoring=json.loads((ROOT/'tools/party/hands.recipe.json').read_text())
recipes=authoring['grips']

for kind,recipe in recipes.items():
 parts=[];nails=[]
 center=recipe['center'];cx,cy,cz=center
 sphere(center,recipe['palm'],parts)
 # Thenar / hypothenar masses preserve the palm contour while a loft supplies a slim wrist.
 sphere((cx-.001,cy-.021,cz+.007),(.014,.022,.024),parts)
 sphere((cx+.002,cy+.014,cz+.001),(.016,.023,.037),parts)
 wrist,end=forearm(center,authoring['anatomy']['forearmSections'],parts)
 for i,(p,r,n) in enumerate(recipe['fingers']):
  finger(p,r,parts,nails,n)
  if i<4:sphere((p[0][0]+.008,p[0][1],p[0][2]+.007),(.008,.010,.010),parts)
 hand=join(parts,kind+'_hand')
 hand.data.remesh_voxel_size=authoring['mesh']['voxelSize'];hand.data.remesh_voxel_adaptivity=.0
 bpy.ops.object.voxel_remesh()
 smooth=hand.modifiers.new('skin transition','SMOOTH');smooth.factor=.52;smooth.iterations=5;bpy.ops.object.modifier_apply(modifier=smooth.name)
 tris=sum(len(p.vertices)-2 for p in hand.data.polygons)
 if tris>authoring['mesh']['handTriangles']:
  dec=hand.modifiers.new('web topology budget','DECIMATE');dec.ratio=authoring['mesh']['handTriangles']/tris;bpy.ops.object.modifier_apply(modifier=dec.name)
 for p in hand.data.polygons:p.use_smooth=True
 hand.data.materials.clear();hand.data.materials.append(skin)
 colors=hand.data.color_attributes.new(name='AnatomicalTint',type='BYTE_COLOR',domain='POINT')
 joints=[Vector(p) for path,rs,no in recipe['fingers'] for p in path[1:]]
 for v in hand.data.vertices:
  b=hand.matrix_world@v.co;point=Vector((b.x,b.z,-b.y));distance=min((point-p).length for p in joints)
  blush=.10*math.exp(-distance*distance/.00018)
  colors.data[v.index].color=(.49,.267*(.99-blush),.175*(.98-blush*1.3),1)
 # Generated UVs only carry the small seamless micro-normal tile.
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.1,island_margin=.004);bpy.ops.object.mode_set(mode='OBJECT')
 n=join(nails,kind+'_nails');n.data.materials.append(nail)
 nt=sum(len(p.vertices)-2 for p in n.data.polygons)
 if nt>authoring['mesh']['nailTriangles']:
  nd=n.modifiers.new('nail topology budget','DECIMATE');nd.ratio=authoring['mesh']['nailTriangles']/nt;bpy.context.view_layer.objects.active=n;bpy.ops.object.modifier_apply(modifier=nd.name)
 for p in n.data.polygons:p.use_smooth=True
 root=bpy.data.objects.new('grip_'+kind,None);scene.collection.objects.link(root)
 for o in [hand,n]:o.parent=root
 # Cloth cuff masks the forearm cut and supplies a convincing garment thickness.
 a=Vector(end);direction=(a-Vector(wrist)).normalized();c=a-direction*.023
 cuff_parts=[]
 link(c-direction*.028,c+direction*.028,.032,.034,cuff_parts)
 cuff=join(cuff_parts,kind+'_cuff');cuff.data.materials.append(cloth);cuff.parent=root
 bevel=cuff.modifiers.new('soft sewn edge','BEVEL');bevel.width=.0025;bevel.segments=3
 bpy.context.view_layer.objects.active=cuff;bpy.ops.object.modifier_apply(modifier=bevel.name)
 for p in cuff.data.polygons:p.use_smooth=True
 all_roots.append(root)
 manifest.append({'kind':kind,'root':root.name,'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons)for o in root.children),'vertices':sum(len(o.data.vertices)for o in root.children),'socket':[0,recipe['gripY'],0]})
# Export without studio helpers. Each preset is at identity around a common prop-space origin.
bpy.ops.object.select_all(action='DESELECT')
for root in all_roots:
 root.select_set(True)
 for o in root.children:o.select_set(True)
OUT.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUT),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_apply=True,export_materials='EXPORT',export_extras=True)
RECIPE.write_text(json.dumps({'version':authoring['version'],'asset':'models/party/hands.glb','_about':'Grips are authored around prop bottom at identity. Metres, glTF +Y up. Static meshes share skin and nail materials; no runtime skeletal work.', 'presets':{p['kind']:{'node':p['root'],'position':[0,0,0],'rotation':[0,0,0],'scale':1,'socket':p['socket']}for p in manifest}},indent=2)+'\n')
EVIDENCE.mkdir(parents=True,exist_ok=True)
(EVIDENCE/'manifest.json').write_text(json.dumps({'version':authoring['version'],'bytes':OUT.stat().st_size,'presets':manifest},indent=2))
# Optional one studio contact sheet, generated in a single bounded renderer.
if '--render' in sys.argv:
 for index,root in enumerate(all_roots):
  root.location.x=index*.24
  # Contact proxy uses the actual item dimensions, excluded from GLB.
  y=recipes[list(recipes)[index]]['gripY']
  if index==0:
   bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=.030,depth=.170,location=T((index*.24,.095,0)))
   proxy=bpy.context.object;proxy.name='beer contact proxy';proxy.data.materials.append(mat('amber glass proxy',(.105,.20,.092),.14))
   bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=.012,depth=.051,location=T((index*.24,.212,0)));bpy.context.object.data.materials.append(proxy.data.materials[0])
  elif index==1:
   bpy.ops.mesh.primitive_cube_add(size=1,location=T((index*.24,.047,0)));o=bpy.context.object;o.scale=(.010,.006,.047);o.data.materials.append(mat('blue grey aluminium',(.17,.22,.245),.25));bev=o.modifiers.new('device radius','BEVEL');bev.width=.003;bev.segments=4
  else:
   bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=.0065,depth=.19,location=T((index*.24,.095,0)));bpy.context.object.data.materials.append(mat('mouthpiece aluminium',(.17,.18,.18),.24))
 bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.145));bpy.context.object.data.materials.append(mat('studio',(.20,.21,.215),.9))
 world=bpy.data.worlds.new('soft studio');scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.5,.54,.57,1);world.node_tree.nodes['Background'].inputs[1].default_value=.32
 for loc,power,size in [((.1,-.4,1.5),70,1.4),((1.2,.4,.8),35,1),((-.8,1,.6),20,1.2)]:
  bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.data.energy=power;l.data.shape='DISK';l.data.size=size;l.rotation_euler=(Vector((.28,0,.05))-l.location).to_track_quat('-Z','Y').to_euler()
 bpy.ops.object.camera_add(location=(.90,-1.35,.88));cam=bpy.context.object;cam.rotation_euler=(T((.28,.05,.03))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=.91;scene.camera=cam
 scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
 scene.render.resolution_x=1500;scene.render.resolution_y=650;scene.render.resolution_percentage=100
 scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.filepath=str(EVIDENCE/'grips.png');bpy.ops.render.render(write_still=True)
print('PARTY_HANDS',json.dumps({'bytes':OUT.stat().st_size,'presets':manifest}))
