"""Original RC garage v1, seed 20261116; Blender -> glTF SI (+Z nose).
Run: blender -b --python tools/rc/build.py
No downloads. Recipe web/spec/rc.json. Static meshes merged by material;
wheel_FL/FR/RL/RR are independent suspension/spin pivots.
"""
import bpy, math, json, os, hashlib, sys
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
S=json.load(open(os.path.join(ROOT,'web/spec/rc.json')))
OUT=os.path.join(ROOT,'tools/rc/.staging');os.makedirs(OUT,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
def mat(name,c,metal=0,rough=.4):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;return m
def rgb(h):return tuple((int(h[i:i+2],16)/255)**2.2 for i in (1,3,5))
M={k:mat(k,rgb(c),metal,rough) for k,c,metal,rough in [('rubber','#202731',0,.8),('steel','#9dacb5',.8,.24),('dark','#293541',.25,.4),('glass','#142d40',.55,.15),('light','#fff4b8',.1,.2),('red','#f63846',.1,.25),('wood','#a7764f',0,.55),('black','#121c23',0,.5)]}
for n in ['light','red']:
 p=M[n].node_tree.nodes.get('Principled BSDF');p.inputs['Emission Color'].default_value=(*M[n].diffuse_color[:3],1);p.inputs['Emission Strength'].default_value=.25
current=[]
def box(name,pos,size,material,bevel=.015):
 bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material)
 if bevel:mod=o.modifiers.new('edge highlights','BEVEL');mod.width=bevel;mod.segments=2;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 current.append(o);return o
def cyl(name,pos,r,depth,material,axis='Z',vertices=16):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth,location=pos);o=bpy.context.object;o.name=name
 if axis=='X':o.rotation_euler[1]=math.pi/2
 elif axis=='Y':o.rotation_euler[0]=math.pi/2
 o.data.materials.append(material);current.append(o);return o
def rod(name,a,b,r,material):
 d=Vector(b)-Vector(a);o=cyl(name,(Vector(a)+Vector(b))/2,r,d.length,material,vertices=10);o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return o
def text(name,value,pos,size,material,rot=(0,0,0)):
 cu=bpy.data.curves.new(name,'FONT');cu.body=value;cu.size=size;cu.align_x='CENTER';cu.extrude=.0005;cu.resolution_u=2;o=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(o);o.location=pos;o.rotation_euler=rot;o.data.materials.append(material);current.append(o);return o
def parent(name,objs):
 p=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(p)
 for o in objs:o.parent=p
 return p
def merge(objs,name):
 mesh=[]
 for o in objs:
  if o.type=='FONT':bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False)
  if o.type=='MESH':mesh.append(o)
 if not mesh:return None
 bpy.ops.object.select_all(action='DESELECT')
 for o in mesh:o.select_set(True)
 bpy.context.view_layer.objects.active=mesh[0];bpy.ops.object.join();o=bpy.context.object;o.name=name;return o
sys.path.insert(0,os.path.dirname(__file__))
from upgrade_helpers import install
install(globals())
cars=[];manifest=[]
for idx,d in enumerate(S['designs']):
 current=[];bodymat=mat(d['id']+'_paint',rgb(d['color']),.35,.24);accent=mat(d['id']+'_livery',rgb(d['accent']),.18,.3)
 w=d['width'];L=d['length'];h=d['roof'];r=d['wheel'];front=-L/2;back=L/2;typ=d['type']
 chassis=box('lower chassis',(0,0,.19 if typ=='formula' else .22),(w*(.44 if typ=='formula' else .6 if typ=='buggy' else .91),L*.88,.045 if typ=='formula' else .15),M['dark'])
 if typ=='formula':
  shell('tapered formula monocoque',[[-.5,.055,.23],[-.32,.12,.29],[-.13,.19,.37],[.05,.22,.41],[.29,.18,.43],[.43,.12,.36]],w,L,bodymat);box('cockpit inset',(0,.12,.415),(.26,.32,.04),M['black'],.03)
  for sign in [-1,1]:box('sidepod',(sign*w*.32,L*.08,.27),(.19,L*.48,.14),bodymat)
  box('front wing',(0,front+.05,.2),(w,.13,.045),accent,.007);box('halo headrest',(0,.19,.41),(.29,.22,.12),M['dark']);cyl('driver helmet',(0,.06,.48),.075,.08,accent)
 elif typ=='buggy':
  shell('wedge buggy hood',[[-.43,.22,.32],[-.29,.4,.43],[-.08,.29,.4]],w,L,bodymat);box('rear engine',(0,.4,.37),(w*.65,.3,.2),M['dark'])
  for sign in [-1,1]:
   rod('cage A',(sign*.26,-.2,.37),(sign*.22,-.1,.68),.018,M['dark']);rod('cage roof',(sign*.22,-.1,.68),(sign*.22,.28,.68),.018,M['dark']);rod('cage C',(sign*.22,.28,.68),(sign*.29,.45,.36),.018,M['dark'])
  for yy in [-.1,.28]:rod('roll bar cross',(-.22,yy,.68),(.22,yy,.68),.018,M['dark'])

  for sign in [-1,1]:
   box('buggy bucket seat',(sign*.115,.13,.4),(.17,.24,.18),M['black'],.025)
   for side in [-1,1]:rod('seat harness',(sign*.115+side*.03,.01,.47),(sign*.115+side*.03,.19,.52),.009,bodymat)
 else:
  shell('sculpted body shell',d['profile'],w,L,bodymat)
  prototype_canopy(w,L,h,bodymat) if typ=='prototype' else glazed_cabin(d,w,L,h,bodymat)
  if typ=='pickup':
   box('cargo bed',(0,L*.28,.48),(w*.73,L*.29,.024),M['dark'],.003)
   for sign in [-1,1]:box('bed rails',(sign*w*.42,L*.28,.53),(.06,L*.34,.13),bodymat)
  if typ=='prototype':
   for sign in [-1,1]:box('aero blade',(sign*w*.43,.23,.3),(.12,.48,.045),accent,.004)
 # common details: bumpers, grille slats, skid plate, racing stripes, fasteners.
 for yy in [front+.025,back-.025]:box('bumper',(0,yy,.24),(w*.92,.075,.09),M['dark'],.01)
 box('front grille',(0,front+.035,.38),(w*.43,.03,.1),M['black'],.005)
 for xx in range(-3,4):box('grille metal fin',(xx*.045,front+.015,.38),(.012,.012,.075),M['steel'],.002)
 for sign in [-1,1]:
  box('tail light',(sign*w*.35,back-.015,.39),(.12,.025,.04),M['red'],.004)
  cyl('exhaust tip',(sign*w*.34,back+.025,.24),.023,.13,M['steel'],'Y')
  box('sill stripe',(sign*w*.475,0,.3),(.018,L*.66,.035),accent,.002)
  for yy in [-.47,.47]:cyl('hood latch',(sign*w*.3,yy,.455),.014,.008,M['steel'],vertices=10)
 if typ not in ['formula','buggy','van']:
  for xx in [-.095,.095]:box('hood racing stripe',(xx,-L*.3,.454),(.07,L*.23,.005),accent,.001)
 if d.get('lights',0):
  for sign in [-1,1]:
   box('headlight housing',(sign*w*.32,front+.03,.4),(.16,.045,.09),M['dark'],.008);box('headlight lens',(sign*w*.32,front+.003,.403),(.13,.012,.055),M['light'],.005)
 if d.get('lights',0)>2:
  for xx in [-.19,-.065,.065,.19]:cyl('rally spotlight',(xx,front+.06,.52),.047,.045,M['light'],'Y')
 if d.get('spoiler'):
  for sign in [-1,1]:box('wing stay',(sign*w*.3,L*.33,.54),(.024,.06,.2),M['dark'],.003)
  box('rear spoiler',(0,L*.35,.65 if typ!='formula' else .56),(w*.98,.16,.028),accent,.004)
 if d.get('rack'):
  for sign in [-1,1]:box('roof rack',(sign*w*.31,.04,h+.055),(.024,L*.52,.025),M['dark'],.004)
  for yy in [-.28,.1,.28]:box('rack cross',(0,yy,h+.055),(w*.7,.023,.025),M['dark'],.003)
 if d.get('spare'):
  cyl('spare tire',(0,back+.09,.55),.17,.11,M['rubber'],'Y');cyl('spare rim',(0,back+.153,.55),.09,.015,M['steel'],'Y')
 # Detailed vehicle-specific forms informed by ChatGPT Images references.
 for sign in [-1,1]:
  for yy in [-S['physics']['wheelbase']/2,S['physics']['wheelbase']/2]:
   if typ not in ['formula','buggy']:wheel_arch('flared arch',sign*w*.485,yy,r,r,.02,M['dark'] if typ in ['jeep','pickup'] else bodymat,typ in ['rally','jeep','drift'])
   rod('suspension wishbone',(sign*.15,yy,.27),(sign*.33,yy,r),.009,M['steel'])
   rod('shock damper',(sign*.25,yy,.4),(sign*.31,yy,r+.01),.012,M['steel'])
   if typ in ['buggy','jeep','rally','formula']:coil('coilover spring',(sign*.25,yy,.38),(sign*.30,yy,r+.05),.022,accent,4)
 if typ in ['gt','drift','prototype']:
  box('front carbon splitter',(0,front-.025,.19),(w*1.05,.19,.025),M['dark'],.005)
  for sign in [-1,1]:
   rod('splitter support',(sign*w*.34,front+.045,.34),(sign*w*.39,front-.095,.205),.006,M['steel'])
   box('side air scoop',(sign*w*.48,.19,.36),(.024,.22,.09),M['black'],.008)
   box('side skirt',(sign*w*.49,.05,.21),(.065,L*.6,.035),M['dark'],.005)
   box('wing endplate',(sign*w*.49,L*.35,.66),(.022,.22,.12),bodymat,.008)
  box('rear diffuser',(0,back-.04,.21),(w*.83,.2,.04),M['dark'],.005)
  for xx in [-.23,-.115,0,.115,.23]:box('diffuser vertical fin',(xx,back-.025,.23),(.012,.22,.08),M['dark'],.003)
 if typ in ['rally','drift']:
  for sign in [-1,1]:
   for yy in [-L*.29,-L*.33,-L*.37]:box('sport hood louvre',(sign*.15,yy,.465),(.13,.02,.011),M['black'],.003)
 if typ=='rally':
  box('roof scoop',(0,-L*.055,h+.045),(.2,.18,.075),bodymat,.018);box('roof scoop opening',(0,-L*.15,h+.04),(.15,.015,.044),M['black'],.007)
  box('rally skid plate',(0,front-.012,.22),(w*.72,.023,.13),M['steel'],.007)
  for sign in [-1,1]:
   for yy in [-L*.29,-L*.33,-L*.37]:box('hood louvre',(sign*.15,yy,.463),(.14,.025,.012),M['black'],.004)
   torus('red tow hook',(sign*.24,front-.035,.22),.025,.006,M['red'],'Y',16)
   box('mudflap',(sign*.34,.59,.12),(.14,.015,.18),M['dark'],.003)
 if typ=='jeep':
  box('cream front grille',(0,front-.018,.4),(w*.79,.023,.17),accent,.014)
  for sign in [-1,1]:
   cyl('round LED headlight housing',(sign*w*.32,front-.036,.41),.062,.022,M['dark'],'Y',24)
   torus('round LED halo',(sign*w*.32,front-.05,.41),.043,.006,M['light'],'Y')
  box('roof LED light bar',(0,-L*.24,h+.09),(w*.60,.045,.045),M['dark'],.008)
  for xx in [-.18,-.12,-.06,0,.06,.12,.18]:box('roof LED',(xx,-L*.258,h+.09),(.034,.008,.025),M['light'],.004)
  luggage=mat('jeep_luggage',rgb('#75724c'),0,.8)
  box('expedition luggage',(-.13,.05,h+.145),(.25,.27,.16),luggage,.02)
  box('red fuel can',(.19,.12,h+.14),(.12,.16,.17),M['red'],.012)
  cyl('luggage roll',(.16,-.12,h+.13),.06,.22,M['wood'],'X')
  for xx in [-.22,-.07]:box('luggage strap',(xx,.05,h+.229),(.02,.28,.008),M['dark'],.002)
 if typ=='jeep':
  for xx in [-.18,-.12,-.06,0,.06,.12,.18]:box('seven slot grille',(xx,front-.006,.39),(.026,.02,.095),M['black'],.01)
  rod('snorkel stalk',(w*.45,-.3,.42),(w*.45,-.23,h+.08),.025,M['dark']);box('snorkel intake',(w*.45,-.21,h+.08),(.07,.1,.04),M['dark'],.01)
 if typ=='classic':
  # Chrome period roof rack and side cooling grilles from the image reference.
  for sign in [-1,1]:
   rod('chrome roof rail',(sign*w*.30,-L*.18,h+.08),(sign*w*.30,L*.23,h+.08),.009,M['steel'])
   for yy in [-L*.17,L*.22]:rod('rack support',(sign*w*.30,yy,h+.01),(sign*w*.30,yy,h+.08),.007,M['steel'])
   for zzz in [.47,.495,.52]:box('side cooling vent',(sign*w*.471,L*.33,zzz),(.008,.10,.012),M['black'],.003)
  for yy in [-L*.18,-L*.05,L*.09,L*.23]:rod('rack chrome crossbar',(-w*.30,yy,h+.08),(w*.30,yy,h+.08),.008,M['steel'])
 if typ=='classic':
  for sign in [-1,1]:cyl('round chrome lamp',(sign*w*.30,front-.015,.405),.065,.025,M['steel'],'Y',24);cyl('round headlamp',(sign*w*.30,front-.031,.405),.052,.008,M['light'],'Y',24)
  for xx in [-.2,-.14,-.08,-.02,.04,.10,.16,.22]:box('rear engine vent',(xx,back+.006,.4),(.025,.012,.07),M['black'],.004)
  for yy in [front-.015,back+.015]:box('chrome bumper',(0,yy,.27),(w*.93,.035,.04),M['steel'],.012)
 if typ=='pickup':
  for sign in [-1,1]:
   cyl('pickup round lamp',(sign*w*.31,front-.023,.41),.063,.02,M['steel'],'Y',24)
   torus('pickup LED halo',(sign*w*.31,front-.035,.41),.046,.006,M['light'],'Y')
   rod('pickup roof bar',(sign*.24,-.1,h+.01),(sign*.24,-.1,h+.11),.014,M['dark'])
   rod('shovel handle',(sign*w*.49,.17,.54),(sign*w*.49,.52,.54),.012,M['wood'])
   box('shovel blade',(sign*w*.49,.55,.54),(.025,.105,.08),M['steel'],.01)
  for xx in [-.18,-.06,.06,.18]:cyl('pickup roof spotlight',(xx,-.11,h+.11),.046,.034,M['light'],'Y')
  cyl('bed spare tire',(0,L*.32,.60),.16,.1,M['rubber'],'Y',24)
  cyl('bed spare rim',(0,L*.32+.06,.60),.095,.01,M['steel'],'Y',16)
  box('cargo fuel can',(.23,L*.28,.56),(.10,.13,.16),M['red'],.015)
 if typ=='pickup':
  for xx in [-.2,-.1,0,.1,.2]:box('ribbed bed floor',(xx,L*.29,.487),(.018,L*.28,.012),M['steel'],.002)
  box('pickup toolbox',(0,L*.12,.53),(w*.7,.15,.11),M['steel'],.015)
  for sign in [-1,1]:rod('bed roll hoop',(sign*w*.3,L*.14,.46),(sign*w*.3,L*.14,.73),.018,M['dark'])
  rod('bed hoop cross',(-w*.3,L*.14,.73),(w*.3,L*.14,.73),.018,M['dark'])
 if typ=='van':
  box('full cargo compartment',(0,L*.235,(.46+h)/2),(w*.77,L*.49,h-.46),bodymat,.032)
  box('roof racing stripe',(0,L*.2,h+.008),(.13,L*.5,.009),accent,.002)
  for sign in [-1,1]:
   box('sliding door rail',(sign*w*.478,.15,.55),(.012,.48,.012),M['steel'],.003)
   box('parcel side graphic',(sign*w*.391,L*.22,.63),(.014,.30,.13),accent,.008)
   for yy in [L*.03,L*.43]:box('cargo panel seam',(sign*w*.392,yy,.63),(.007,.009,.26),M['dark'],.003)
   box('roof spoiler stay',(sign*w*.29,L*.36,h+.045),(.025,.04,.08),M['dark'],.003)
   for zzz in [.53,.69]:box('barn door hinge',(sign*w*.30,back+.012,zzz),(.035,.018,.045),M['steel'],.004)
  box('roof cargo spoiler',(0,L*.37,h+.09),(w*.91,.14,.022),M['dark'],.006)
  for xx in [-.16,0,.16]:box('amber roof marker',(xx,-L*.275,h+.029),(.036,.035,.019),M['light'],.007)
  box('rear barn door seam',(0,back+.006,.62),(.008,.015,.29),M['dark'],0)
 if typ=='prototype':
  box('mint roof airbox',(0,L*.18,h+.05),(.14,.16,.085),accent,.018)
  box('roof intake opening',(0,L*.12,h+.05),(.105,.015,.05),M['black'],.006)
  mesh('dorsal fin',[(0,L*.17,.49),(0,L*.20,.67),(0,L*.40,.56),(0,L*.45,.47)],[(0,1,2,3)],accent)
  for sign in [-1,1]:
   wheel_arch('rear mint aero arch',sign*w*.493,S['physics']['wheelbase']/2,r,r+.006,.02,accent)
   mesh('front mint canard',[(sign*w*.49,front-.07,.19),(sign*w*.25,front-.1,.19),(sign*w*.38,front+.15,.23)],[(0,1,2)],accent)
   box('deep rear tunnel',(sign*w*.22,back-.01,.29),(.24,.10,.11),M['black'],.025)
 if typ=='prototype':
  box('continuous front LED',(0,front-.02,.35),(w*.74,.02,.018),M['light'],.004);box('rear light bar',(0,back+.018,.38),(w*.83,.022,.021),M['red'],.006)
 if typ=='formula':
  for sign in [-1,1]:
   rod('cockpit halo upright',(sign*.19,-.12,.37),(sign*.16,-.03,.56),.016,M['dark']);rod('cockpit halo top',(sign*.16,-.03,.56),(sign*.16,.2,.54),.016,M['dark'])
   box('formula wing endplate',(sign*w*.48,front+.045,.26),(.025,.23,.17),bodymat,.004)
  rod('halo cross',(-.16,-.03,.56),(.16,-.03,.56),.016,M['dark'])
 if typ=='buggy':
  for sign in [-1,1]:rod('diagonal cage cross',(sign*.22,-.1,.68),(-sign*.29,.45,.36),.013,M['dark'])
  for xx in [-.20,-.10,0,.10,.20]:cyl('buggy lightbar',(xx,-.14,.72),.035,.035,M['light'],'Y')
  for xx in [-.17,-.06,.06,.17]:cyl('exposed engine cylinder',(xx,.46,.44),.034,.16,M['steel'])
 if typ not in ['buggy','formula']:
  for sign in [-1,1]:
   box('race door panel',(sign*w*.48,0,.35),(.008,.34,.14),accent,.003)
   text('door race number',d['number'],(sign*w*.489,-.01,.315),.105,M['dark'] if typ in ['rally','classic','pickup'] else M['light'],(math.pi/2,0,sign*math.pi/2))
 # Aerial and visible electronics make the object read as an RC model.
 rod('flex antenna',(.2,.26,h-.05),(.21,.33,h+.26),.004,M['dark']);cyl('antenna cap',(.21,.33,h+.26),.012,.018,accent)
 text('race number',d['number'],(0,-L*.23,.46 if typ!='formula' else .35),.15,accent)
 # Body batches remain separate from moving wheels.
 body=merge(current,'body');root=parent('rc_'+d['id'],[body]);wheels=[]
 for wi,(sign,frontSign) in enumerate([(-1,1),(1,1),(-1,-1),(1,-1)]):
  current=[];x=sign*S['physics']['track']/2;y=-frontSign*S['physics']['wheelbase']/2;z=r
  cyl('tire carcass',(x,y,z),r,.12,M['rubber'],'X',24)
  rim=accent if typ=='rally' else M['steel'] if typ in ['classic','pickup','jeep'] else M['dark']
  cyl('brake disc',(x+sign*.066,y,z),r*.51,.007,M['steel'],'X',24)
  torus('rim outer lip',(x+sign*.077,y,z),r*.66,.011,rim,'X')
  torus('rim inner lip',(x+sign*.075,y,z),r*.52,.006,rim,'X')
  spokes=10 if typ=='rally' else 5 if typ in ['drift','classic'] else 8
  for k in range(spokes):
   a=k*math.tau/spokes
   rod('rim spoke',(x+sign*.081,y+math.sin(a)*r*.18,z+math.cos(a)*r*.18),(x+sign*.081,y+math.sin(a)*r*.64,z+math.cos(a)*r*.64),.009,rim)
  cyl('wheel hub',(x+sign*.084,y,z),r*.21,.015,M['steel'],'X',16)
  for k in range(18):
   a=k*math.tau/18
   for side in [-1,1]:
    o=box('tire tread block',(x+side*.033,y+math.sin(a)*r,z+math.cos(a)*r),(.057,.031,.017),M['rubber'],0);o.rotation_euler[0]=-a
  for k in range(5):
   a=k*math.tau/5;cyl('lug bolt',(x+sign*.096,y+math.sin(a)*r*.14,z+math.cos(a)*r*.14),.005,.01,M['dark'],'X',6)
  wheel=merge(current,['wheel_FL','wheel_FR','wheel_RL','wheel_RR'][wi]);bpy.context.scene.cursor.location=(x,y,z);bpy.context.view_layer.objects.active=wheel;bpy.ops.object.origin_set(type='ORIGIN_CURSOR');wheel.parent=root;wheels.append(wheel)
 cars.append(root)
 tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in root.children if o.type=='MESH');manifest.append({'id':d['id'],'node':root.name,'triangles':tris,'wheelNodes':[w.name for w in wheels],'length':L,'width':w,'height':h+.27,'features':d.get('features',[]),'reference':'tools/rc/concepts/'+d['id']+'.jpg'})
# One controller template, clone geometry per colour at runtime.
current=[]
box('handset',(0,0,.045),(.148,.09,.065),M['dark'],.018)
for x in [-.05,.05]:
 cyl('stick gimbal',(x,-.005,.082),.021,.009,M['black']);rod('stick',(x,-.005,.08),(x,-.005,.105),.005,M['steel']);cyl('stick cap',(x,-.005,.108),.011,.009,M['rubber'])
box('controller display',(0,.011,.08),(.038,.029,.004),M['glass'],.003)
for x in [-.05,.05]:box('trigger',(x,.044,.055),(.025,.018,.015),M['steel'],.004)
rod('controller aerial',(0,.035,.07),(0,.05,.2),.003,M['dark']);cyl('controller led',(.059,-.025,.08),.004,.004,M['light'],vertices=8)
controller=parent('controller',[merge(current,'controller_body')])
# First-person two-hand grip: continuous bevelled palms, four articulated fingers,
# thumbs on the gimbals, jersey cuffs and short forearms (remote avatars use rig).
current=[]
skin=mat('controller_hand_skin',rgb('#c68d67'),0,.68);sleeve=mat('controller_sleeve',rgb('#304b4e'),0,.9)
for sign in [-1,1]:
 rod('sleeve forearm',(sign*.23,.20,-.06),(sign*.115,.058,.027),.041,sleeve)
 rod('jersey cuff',(sign*.128,.076,.015),(sign*.108,.045,.034),.039,M['dark'])
 palm=box('gripping palm',(sign*.1,.025,.047),(.065,.084,.035),skin,.015);palm.rotation_euler[1]=sign*.18
 for fi in range(4):
  yy=-.009+fi*.019
  rod('finger proximal',(sign*.105,yy,.048),(sign*.078,yy,.033),.009,skin)
  rod('finger curled',(sign*.078,yy,.033),(sign*.066,yy,.047),.008,skin)
 rod('thumb',(sign*.085,.022,.06),(sign*.05,-.005,.106),.011,skin)
 box('thumb nail',(sign*.05,-.009,.111),(.011,.012,.003),M['light'],.003)
hands=parent('controller_hands',[merge(current,'controller_hands_mesh')])
current=[];tw,th,td=S['table']['size']
box('table top',(0,0,th-.022),(tw,td,.044),M['wood'],.018)
for x in [-tw/2+.06,tw/2-.06]:
 for y in [-td/2+.055,td/2-.055]:box('table leg',(x,y,th/2-.02),(.045,.045,th-.07),M['dark'],.008)
box('table front badge',(0,-td/2-.004,th-.047),(.42,.012,.06),M['dark'],.004)
text('club badge','DZIK RC CLUB',(0,-td/2-.012,th-.06),.035,M['light'],(math.pi/2,0,0))
table=parent('rc_table',[merge(current,'table_body')])
# Move roots apart only for source inspection, exporting origin-local templates.
for root in cars+[controller,hands,table]:root.location=(0,0,0)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'garage.glb'),export_format='GLB',export_yup=True,export_apply=True,export_cameras=False,export_lights=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'tools/rc/garage.blend'))
raw=open(os.path.join(OUT,'garage.glb'),'rb').read();json.dump({'version':1,'seed':20261116,'generator':'tools/rc/build.py','recipe':'web/spec/rc.json','asset':'garage.glb','sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'cars':manifest},open(os.path.join(OUT,'manifest.json'),'w'),indent=2)
print('RC_MANIFEST',len(raw),sum(x['triangles'] for x in manifest))
