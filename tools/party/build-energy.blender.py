"""Original six PET energy bottles. Blender authoring source, SI scale, +Y glTF up.
blender -b --python tools/party/build-energy.blender.py
Labels: ChatGPT Images masters and prompts in tools/party/generated-labels/. Fixed geometry budget, no downloaded assets.
"""
import bpy,json,math
from pathlib import Path
R=Path(__file__).resolve().parents[2];S=json.loads((R/'web/spec/party.json').read_text())['energy'];OUT=R/'web/models/party/energy';OUT.mkdir(exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def linear(c):return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in c)
def mat(name,color,metal=0,rough=.4,texture=None):
 m=bpy.data.materials.new(name);m.use_nodes=True;b=m.node_tree.nodes.get('Principled BSDF');rgb=linear([int(color[i:i+2],16)/255 for i in [1,3,5]]);b.inputs['Base Color'].default_value=(*rgb,1);b.inputs['Metallic'].default_value=metal;b.inputs['Roughness'].default_value=rough;m.diffuse_color=(*rgb,1)
 if texture:
  tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(texture))
  width,height=tex.image.size;factor=min(1,960/max(width,height))
  if factor<1:tex.image.scale(round(width*factor),round(height*factor));tex.image.update()
  m.node_tree.links.new(tex.outputs['Color'],b.inputs['Base Color'])
 return m
silver=mat('energy_brushed_silver','#c9d8cf',.86,.25);dark=mat('energy_cap_groove','#1b2825',.2,.38)
def lathe(name,profile,material,parent,n=32,uv=False):
 angle=lambda j:math.pi-1.3+j*2.6/n if uv else j*2*math.pi/n
 verts=[(r*math.cos(angle(j)),r*math.sin(angle(j)),z) for z,r in profile for j in range(n+1)]
 faces=[(i*(n+1)+j,i*(n+1)+j+1,(i+1)*(n+1)+j+1,(i+1)*(n+1)+j) for i in range(len(profile)-1) for j in range(n)]
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);o.parent=parent;mesh.materials.append(material)
 for p in mesh.polygons:p.use_smooth=True
 if uv:
  layer=mesh.uv_layers.new(name='UVMap')
  for p in mesh.polygons:
   for li in p.loop_indices:
    vi=mesh.loops[li].vertex_index;ring,j=divmod(vi,n+1);layer.data[li].uv=(j/n,ring/(len(profile)-1))
 return o
for index,v in enumerate(S['variants']):
 parent=bpy.data.objects.new('energy_'+v['id'],None);bpy.context.collection.objects.link(parent)
 body=mat('energy_pet_'+v['id'],v['color'],.27,.26);cap=mat('energy_cap_'+v['id'],v['ink'],.12,.4)
 # Rounded PET foot, raised collar, reinforcing bottom ribs, sloped shoulder.
 profile=[(0,0),(.002,.022),(.006,.030),(.009,.031),(.013,.0285),(.017,.031),(.021,.029),(.027,.031),(.155,.031),(.160,.030),(.168,.026),(.179,.016),(.184,.012),(.194,.012),(.195,0)]
 lathe('energy_pet_body',profile,body,parent)
 label=mat('energy_label_'+v['id'],'#ffffff',.15,.38,R/'tools/party/generated-labels'/ (v['id']+'.png'))
 lathe('energy_label',[(.029,.03125),(.154,.03125)],label,parent,48,True)
 for z in [.182,.187,.191]:lathe('energy_thread',[(z,.012),(z+.001,.0135),(z+.002,.012)],silver,parent)
 lathe('energy_tamper_ring',[(.185,.013),(.186,.014),(.189,.014),(.190,.013)],cap,parent)
 lathe('energy_twist_cap',[(.19,.0135),(.192,.014),(.202,.014),(.205,.012),(.205,0)],cap,parent)
 for tooth in range(24):
  a=tooth*math.pi*2/24;bpy.ops.mesh.primitive_cube_add(size=1,location=(math.cos(a)*.014,math.sin(a)*.014,.197));o=bpy.context.object;o.name='cap_knurl';o.scale=(.001,.001,.008);o.rotation_euler[2]=a;o.parent=parent;o.data.materials.append(cap)
 # Clear embossed volume tick marks on reverse; label illustration faces -Y.
 for tick in range(5):
  bpy.ops.mesh.primitive_cube_add(size=1,location=(0,.0317,.04+tick*.022));o=bpy.context.object;o.name='volume_tick';o.scale=(.007 if tick%2 else .011,.0006,.001);o.parent=parent;o.data.materials.append(silver)
# Collapse tiny manufactured details into one mesh per material. Four draw units
# per bottle rather than dozens of separate knurls and tick marks.
for parent in [o for o in bpy.data.objects if o.type=='EMPTY']:
 groups={}
 for child in list(parent.children):
  if child.type=='MESH':groups.setdefault(child.data.materials[0],[]).append(child)
 for material,objects in groups.items():
  if len(objects)<2:continue
  bpy.ops.object.select_all(action='DESELECT')
  for o in objects:o.select_set(True)
  bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
  merged=bpy.context.object;merged.name='energy_twist_cap' if material.name.startswith('energy_cap_') else 'energy_metal'
bpy.ops.export_scene.gltf(filepath=str(OUT/'library.glb'),export_format='GLB',export_yup=True,export_apply=True,export_animations=False,export_extras=True,export_image_format='JPEG',export_jpeg_quality=90)
tri=sum(len(p.vertices)-2 for o in bpy.data.objects if o.type=='MESH' for p in o.data.polygons)
(OUT/'manifest.json').write_text(json.dumps({'version':1,'source':'tools/party/build-energy.blender.py','recipe':'web/spec/party.json#energy','labels':'tools/party/generated-labels/generation.json','variants':[v['id'] for v in S['variants']],'triangles':tri,'bytes':(OUT/'library.glb').stat().st_size,'units':'metres','up':'Y','provenance':'Original ChatGPT Images packaging, recipe and prompts under tools/party/generated-labels. Original deterministic Blender geometry.'},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'triangles':tri,'bytes':(OUT/'library.glb').stat().st_size}))
