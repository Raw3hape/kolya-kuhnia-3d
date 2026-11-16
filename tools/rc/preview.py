"""Bounded EEVEE contact sheet from original Blender authoring source."""
import bpy,math,os,json
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'tools/rc/garage.blend'))
S=json.load(open(os.path.join(ROOT,'web/spec/rc.json')))
for i,d in enumerate(S['designs']):bpy.data.objects['rc_'+d['id']].location=((i%5-2)*2.12,(i//5-.5)*2.9,0)
for name in ['controller','controller_hands','rc_table']:
 o=bpy.data.objects.get(name)
 if o:
  o.hide_render=True
  for c in o.children:c.hide_render=True
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.02));ground=bpy.context.object;m=bpy.data.materials.new('preview floor');m.diffuse_color=(.035,.052,.065,1);ground.data.materials.append(m)
world=bpy.data.worlds.new('preview world');world.use_nodes=True;world.node_tree.nodes.get('Background').inputs[0].default_value=(.23,.28,.35,1);world.node_tree.nodes.get('Background').inputs[1].default_value=.65;bpy.context.scene.world=world
for pos,power,size in [((0,-7,9),2100,9),((-8,1,6),1400,7),((7,6,7),2400,8)]:
 bpy.ops.object.light_add(type='AREA',location=pos);l=bpy.context.object;l.data.energy=power;l.data.shape='DISK';l.data.size=size;l.rotation_euler=(Vector((0,0,0))-l.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(4,-10,12));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,.2))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=13.8;bpy.context.scene.camera=cam
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.resolution_x=1440;scene.render.resolution_y=900;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='JPEG';scene.render.image_settings.quality=87;scene.render.filepath=os.path.join(ROOT,'tools/rc/garage-preview.jpg');scene.view_settings.view_transform='AgX'
bpy.ops.render.render(write_still=True)
