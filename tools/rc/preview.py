"""Bounded studio proof for the source or staged RC garage. No game changes.
blender -b --python tools/rc/preview.py -- --source tools/rc/.art-staging/v2/garage.blend --out tools/rc/.art-staging/v2/contact.jpg
Add --id rally for a close three-quarter; --side for wheel alignment proof.
"""
import bpy,math,json,sys
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parents[2];args=sys.argv[sys.argv.index('--')+1:]if'--'in sys.argv else[]
def arg(key,default):return args[args.index(key)+1]if key in args else default
source=R/arg('--source','tools/rc/garage.blend');dest=R/arg('--out','tools/rc/garage-preview.jpg');dest.parent.mkdir(parents=True,exist_ok=True);selected=arg('--id','');side='--side'in args
bpy.ops.wm.open_mainfile(filepath=str(source));S=json.loads((R/'web/spec/rc.json').read_text());cars=[bpy.data.objects.get('rc_'+d['id'])for d in S['designs']]
for i,o in enumerate(cars):
 shown=not selected or o.name=='rc_'+selected
 for q in [o]+list(o.children_recursive):q.hide_render=not shown
 if shown:o.location=(0,0,0)if selected else((i%5-2)*2.67,(i//5-.5)*3.95,0)
for name in ['controller','controller_hands','rc_table']:
 o=bpy.data.objects.get(name)
 if o:
  for q in[o]+list(o.children_recursive):q.hide_render=True
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.018));ground=bpy.context.object;m=bpy.data.materials.new('Studio slate');m.diffuse_color=(.052,.068,.085,1);m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.052,.068,.085,1);bs.inputs['Roughness'].default_value=.63;ground.data.materials.append(m)
world=bpy.data.worlds.new('Soft studio');world.use_nodes=True;world.node_tree.nodes.get('Background').inputs[0].default_value=(.25,.29,.36,1);world.node_tree.nodes.get('Background').inputs[1].default_value=.45;bpy.context.scene.world=world
for pos,power,size in [((1,-6,8),2200,7),((-7,-2,5),1600,6),((6,6,6),2800,6)]:
 bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,.3))-o.location).to_track_quat('-Z','Y').to_euler()
campos=(3.5,-4.7,2.5)if selected else(4,-14,14)
if side:campos=(5,-.001,1.05)
bpy.ops.object.camera_add(location=campos);cam=bpy.context.object;target=Vector((0,0,.47 if selected else .15));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=3.05 if selected else 17.2;bpy.context.scene.camera=cam
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=20;scene.cycles.use_denoising=True;scene.render.resolution_x=1280 if selected else 1600;scene.render.resolution_y=850 if selected else 1000;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='JPEG';scene.render.image_settings.quality=89;scene.render.filepath=str(dest);scene.view_settings.view_transform='AgX';bpy.ops.render.render(write_still=True)
print('RC_PREVIEW',str(dest))

if '--batch' in args:
 for design in ['rally','gt','buggy','prototype']:
  for o in cars:
   shown=o.name=='rc_'+design
   for q in[o]+list(o.children_recursive):q.hide_render=not shown
   if shown:o.location=(0,0,0)
  cam.location=(3.5,-4.7,2.5);cam.rotation_euler=(Vector((0,0,.48))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=3.05;scene.render.resolution_x=1100;scene.render.resolution_y=760;scene.render.filepath=str(dest.parent/(design+'-close.jpg'));bpy.ops.render.render(write_still=True)
 # Orthographic wheel/arch contact proof, with the camera normal to axle X.
 for o in cars:
  for q in[o]+list(o.children_recursive):q.hide_render=o.name!='rc_rally'
 cam.location=(5,0,.72);cam.rotation_euler=(Vector((0,0,.45))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=2.5;scene.render.filepath=str(dest.parent/'wheel-side.jpg');bpy.ops.render.render(write_still=True)
