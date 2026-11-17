"""DZIK RC CLUB art v2: sculpted bodies, true wheel wells, neutral wheel rigs.
blender -b --python tools/rc/build.py -- --out tools/rc/.art-staging/v2
The recipe contains FINAL SI vehicle dimensions/sockets. Authoring style details
use modelScale once. No downloads, no changes to published web/models/rc here.
"""
import bpy,bmesh,math,json,sys,hashlib,struct
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(Path(__file__).parent))
from upgrade_helpers import Artist,sculpted_shell,cabin,tire,interpolated,prototype_canopy
ARGS=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
OUT=ROOT/(ARGS[ARGS.index('--out')+1] if '--out' in ARGS else 'tools/rc/.art-staging/v2');OUT.mkdir(parents=True,exist_ok=True)
SPEC_BYTES=(ROOT/'web/spec/rc.json').read_bytes();S=json.loads(SPEC_BYTES);SCALE=S['modelScale'];bpy.ops.wm.read_factory_settings(use_empty=True)
def rgb(h):
 values=[int(h[i:i+2],16)/255 for i in (1,3,5)];return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values)
def mat(name,color,metal=0,rough=.4,alpha=1,coat=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*rgb(color),1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;p.inputs['Alpha'].default_value=alpha;p.inputs['Coat Weight'].default_value=coat;p.inputs['Coat Roughness'].default_value=.18;m.diffuse_color=(*rgb(color),alpha)
 if alpha<1:m.surface_render_method='DITHERED';m.use_transparency_overlap=False
 return m
M={k:mat(k,c,metal,rough,alpha)for k,c,metal,rough,alpha in [
 ('rubber','#171d23',0,.79,1),('steel','#b7c5ce',.86,.21,1),('dark','#263440',.48,.34,1),('glass','#41667b',.12,.14,.56),('mirror','#afc9d5',.92,.09,1),('light','#f9f3d4',.15,.20,1),('red','#bf253c',.25,.21,1),('wood','#976540',0,.55,1),('black','#080f18',.04,.48,1),('leather','#343340',0,.76,1),('bronze','#806940',.84,.25,1)]}
for n in ['light','red']:
 p=M[n].node_tree.nodes.get('Principled BSDF');p.inputs['Emission Color'].default_value=(*M[n].diffuse_color[:3],1);p.inputs['Emission Strength'].default_value=.13
A=Artist(M,SCALE)
def empty(name,pos=(0,0,0)):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.location=pos;return o

def hood_height(d,y):
 bulge=max([max(0,1-((y-q['base'][1])/(q['r']*1.2))**2)*.018 for q in d.get('artWheels',[])]or[0])
 return interpolated(d['profile'],y/d['length'])[1]+bulge+.030

def signature_details(a,d,w,L,h,paint,accent,wheels):
 M=a.M;t=d['type'];front=-L/2;back=L/2
 # Real fascia layers: a dark radiator mouth surrounded by radiused painted skins.
 if t not in ['formula','buggy']:
  a.box('Recessed radiator mouth',(0,front-.005,.29),(w*.43,.023,.115),M['black'],.013)
  for xx in [-.15,-.10,-.05,0,.05,.10,.15]:a.box('Radiator mesh vanes',(xx,front-.019,.29),(.012,.007,.083),M['dark'],.0015)
  for sign in [-1,1]:
   if t in ['gt','prototype']:
    xa,xb=sign*w*.22,sign*w*.47
    a.mesh('Sculpted nose shoulder',[(xa,front-.027,.205),(xb,front+.005,.212),(xb,front+.12,.22),(xa,front+.10,.22),(xa,front-.027,.296),(xb,front+.005,.334),(xb,front+.12,.371),(xa,front+.10,.346)],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],paint,.013,True)
   else:a.box('Bumper shoulder',(sign*w*.35,front+.013,.275),(w*.24,.10,.11),paint,.025)
   a.box('Rear bumper insert',(sign*w*.29,back-.006,.24),(w*.39,.075,.07),M['dark'],.014)
   a.box('Tail lamp gasket',(sign*w*.35,back+.004,.375),(.15,.024,.067),M['black'],.009)
   a.box('Segmented tail lamp',(sign*w*.35,back+.019,.377),(.127,.009,.040),M['red'],.007)
   for k in [-1,0,1]:a.box('Tail lens etching',(sign*w*.35+k*.026,back+.024,.377),(.0015,.003,.034),M['dark'],0)
   a.cyl('Rolled exhaust outlet',(sign*w*.32,back+.026,.237),.023,.10,M['steel'],'Y',24);a.cyl('Exhaust dark bore',(sign*w*.32,back+.08,.237),.017,.003,M['black'],'Y',20)
 if t in ['rally','classic','jeep','pickup']:
  for sign in [-1,1]:
   for wheel in [q for q in wheels if (q['base'][0]>0)==(sign>0)]:a.arch('Radiused flared wheel arch',wheel,w,paint if t in ['rally','classic'] else M['dark'],t in ['rally','jeep','pickup'])
 elif t not in ['formula','buggy']:
  for wheel in wheels:a.arch('Integrated sport wheel arch',wheel,w,paint,t=='drift')
 # Livery follows the bonnet surface, rather than floating over a guessed plane.
 if t not in ['formula','buggy','van']:
  for sign in [-1,1]:
   verts=[]
   for k in range(9):
    yy=(-.45+.25*k/8)*L;zz=hood_height(d,yy)
    for x in [sign*.065,sign*.125]:verts.append((x,yy,zz+.0018))
   a.mesh('Conforming bonnet racing stripe',verts,[(k*2,k*2+1,k*2+3,k*2+2)for k in range(8)],accent)
 if t not in ['formula','buggy']:
  for sign in [-1,1]:
   # Between the axle cavities, bordered race plates and intentional panel seams.
   a.box('Door number surround',(sign*w*.474,0,.347),(.010,.25,.126),M['black'],.008)
   a.box('Door number plate',(sign*w*.482,0,.347),(.004,.232,.109),accent,.006)
   a.text('Door race number',d['number'],(sign*w*.488,-.005,.310),.095,M['black']if sum(v*c for v,c in zip(rgb(d['accent']),[.2126,.7152,.0722]))>.35 else M['light'],(math.pi/2,0,sign*math.pi/2))
   for yy in [-.16*L,.17*L]:a.curve('Stamped door panel gap',[(sign*w*.478,yy,.29),(sign*w*.478,yy,.414),(sign*w*.44,yy+.02,.446)],.0018,M['black'])
   a.box('Sculpted rocker',(sign*w*.472,0,.223),(.046,L*.58,.051),M['dark'],.008)
 # A large, conforming number plate remains legible from the balcony.
 if t!='van':
  yy=-L*(.30 if t=='formula'else .37);verts=[]
  for k in range(7):
   y0=yy-.108+k*.216/6
   for x0 in [-.125,.125]:verts.append((x0,y0,hood_height(d,y0)+.001))
  a.mesh('Bonnet race number field',verts,[(k*2,k*2+1,k*2+3,k*2+2)for k in range(6)],accent)
  bright=sum(v*c for v,c in zip(rgb(d['accent']),[.2126,.7152,.0722]))>.35
  number=a.text('Large bonnet race number',d['number'],(0,yy-.046,0),.132,M['black']if bright else M['light']);number.data.offset=.0013*a.scale
  bpy.ops.object.select_all(action='DESELECT');number.select_set(True);bpy.context.view_layer.objects.active=number;bpy.ops.object.convert(target='MESH')
  # Long glyph strokes need interior vertices before conforming to a curved
  # bonnet; otherwise a planar stroke cuts through the curved paint decal.
  bm=bmesh.new();bm.from_mesh(number.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bmesh.ops.subdivide_edges(bm,edges=list(bm.edges),cuts=3,use_grid_fill=True);bm.to_mesh(number.data);bm.free();number.data.update()
  for vertex in number.data.vertices:
   world=number.matrix_world@vertex.co;vertex.co.z+=(hood_height(d,world.y/a.scale)+.004)*a.scale
 # Discrete RC shell clips, aerial and servo-electronics details anchor scale.
 for sign in [-1,1]:
  for yy in [-L*.34,L*.32]:
   z=hood_height(d,yy)+.004 if t not in ['formula','buggy'] else .32
   a.cyl('Countersunk body clip seat',(sign*w*.24,yy,z),.010,.004,M['steel'],segments=16)
   a.torus('RC shell retaining clip',(sign*w*.24,yy,z+.004),.009,.0016,M['dark'],segments=12)
 a.rod('Flexible receiver aerial',(.19,L*.22,h-.025),(.20,L*.27,h+.19),.0028,M['black'],8);a.cyl('Aerial rubber tip',(.20,L*.27,h+.19),.006,.013,accent,segments=12)
 if t in ['gt','drift','prototype']:
  # Lower air tunnels, front splitter and actual vertical diffuser vanes.
  a.box('Carbon front splitter',(0,front-.035,.177),(w*1.025,.20,.025),M['dark'],.009)
  for sign in [-1,1]:
   a.rod('Titanium splitter stay',(sign*w*.34,front+.015,.29),(sign*w*.41,front-.105,.187),.004,M['steel'],8)
   a.box('Rocker aerodynamic blade',(sign*w*.49,.05,.202),(.052,L*.57,.027),accent,.006)
   a.mesh('Sculpted side air scoop',[(sign*w*.475,.11,.293),(sign*w*.478,.11,.411),(sign*w*.48,.31,.418),(sign*w*.483,.25,.295)],[(0,1,2,3)],M['black'])
  a.box('Rear diffuser plane',(0,back-.035,.197),(w*.82,.24,.022),M['dark'],.004)
  for xx in [-w*.30,-w*.15,0,w*.15,w*.30]:a.mesh('Rear diffuser vane',[(xx,back-.16,.18),(xx,back+.07,.19),(xx,back+.07,.275),(xx,back-.12,.22)],[(0,1,2,3)],M['dark'])
 if d.get('spoiler'):
  span=w*.97;wing_y=L*.37;wing_z=.66 if t!='formula' else .49;stay_z=.43 if t!='formula'else .30
  for sign in [-1,1]:a.mesh('Swan neck rear wing support',[(sign*w*.29,wing_y-.04,stay_z),(sign*w*.29,wing_y+.04,stay_z),(sign*w*.29,wing_y+.01,wing_z-.02),(sign*w*.29,wing_y-.05,wing_z-.02)],[(0,1,2,3)],M['dark'])
  # A curved aerofoil section, not one thick board.
  verts=[]
  for xx in [-span/2,span/2]:
   for yy,zz in [(-.10,0),(-.055,.018),(.055,.012),(.10,-.008),(.055,-.016),(-.06,-.012)]:verts.append((xx,wing_y+yy,wing_z+zz))
  a.mesh('Extruded rear aerofoil',verts,[(0,5,4,3,2,1),(6,7,8,9,10,11)]+[(j,(j+1)%6,(j+1)%6+6,j+6)for j in range(6)],accent,.003,True)
  for sign in [-1,1]:a.box('Wing endplate',(sign*span/2,wing_y,wing_z+.018),(.014,.225,.094),paint,.008)
 if t=='rally':
  a.box('Gravel skid shield',(0,front-.025,.22),(w*.72,.023,.13),M['steel'],.009)
  for xx in [-.19,-.065,.065,.19]:
   a.cyl('Deep rally lamp bucket',(xx,front-.045,.485),.052,.074,M['black'],'Y',32);a.torus('Chrome rally lamp bezel',(xx,front-.087,.485),.045,.006,M['steel'],'Y',32);a.cyl('Prismatic rally lens',(xx,front-.091,.485),.040,.005,M['light'],'Y',32)
   for xoff in [-.018,0,.018]:a.rod('Rally lens flute',(xx+xoff,front-.095,.454),(xx+xoff,front-.095,.515),.0016,M['steel'],6)
  a.box('Rally roof scoop',(0,-L*.035,h+.033),(.19,.17,.065),paint,.024);a.box('Scoop dark intake',(0,-L*.096,h+.029),(.137,.012,.031),M['black'],.007)
  for sign in [-1,1]:
   a.torus('Red recovery eye',(sign*w*.25,front-.044,.225),.022,.005,M['red'],'Y',20)
   for k in range(4):a.box('Bonnet cooling louvre',(sign*.19,-L*(.285+k*.022),hood_height(d,-L*(.285+k*.022))+.003),(.105,.012,.007),M['black'],.003)
   rear=next(q for q in wheels if q['id']==('RR' if sign>0 else 'RL'));a.box('Flexible rear mudflap',(rear['base'][0],rear['base'][1]+rear['r']+.025,.10),(.13,.012,.16),M['rubber'],.002)
 elif t in ['gt','prototype']:
  for sign in [-1,1]:
   a.mesh('Swept headlamp inset',[(sign*w*.22,front-.012,.333),(sign*w*.44,front+.018,.355),(sign*w*.42,front+.09,.408),(sign*w*.20,front+.05,.377)],[(0,1,2,3)],M['black'])
   a.curve('LED blade',[(sign*w*.23,front-.015,.354),(sign*w*.40,front+.012,.373),(sign*w*.39,front+.032,.389)],.0065,M['light'])
   a.curve('Hood crease',[(sign*w*.25,front+.03,.393),(sign*w*.33,-L*.28,.447),(sign*w*.30,-L*.19,.452)],.0018,M['dark'])
  if t=='prototype':
   a.mesh('Dorsal stabiliser',[(0,.14*L,.48),(0,.17*L,h+.095),(0,.42*L,.56),(0,.45*L,.42)],[(0,1,2,3)],accent)
   a.box('Roof ram intake',(0,.11*L,h+.027),(.13,.17,.058),accent,.022)
   for sign in [-1,1]:a.mesh('Floating nose canard',[(sign*w*.49,front-.07,.20),(sign*w*.22,front-.10,.20),(sign*w*.39,front+.12,.238)],[(0,1,2)],accent)
 elif t=='drift':
  for sign in [-1,1]:
   a.box('Projector headlamp housing',(sign*w*.32,front-.010,.398),(.20,.045,.071),M['black'],.008)
   for off in [-.052,.012]:a.cyl('Twin projector',(sign*w*.32+off,front-.035,.402),.023,.006,M['light'],'Y',24)
  a.box('Exposed front intercooler',(0,front-.026,.274),(w*.42,.015,.10),M['steel'],.004)
  for k in range(7):a.box('Intercooler cooling row',(0,front-.035,.239+k*.012),(w*.38,.004,.003),M['dark'],0)
 elif t in ['classic','pickup']:
  for sign in [-1,1]:
   a.cyl('Period round chrome lamp',(sign*w*.31,front-.018,.406),.062,.028,M['steel'],'Y',32);a.cyl('Optical glass headlight',(sign*w*.31,front-.035,.406),.051,.007,M['light'],'Y',32)
  for yy in [front-.015,back+.012]:a.box('Rolled chrome bumper',(0,yy,.255),(w*.89,.038,.044),M['steel'],.014)
  if t=='classic':
   for xx in [-.18,-.12,-.06,0,.06,.12,.18]:a.box('Rear engine ventilation slot',(xx,back+.007,.372),(.025,.010,.067),M['black'],.006)
   for sign in [-1,1]:a.rod('Period roof rail',(sign*w*.31,-L*.16,h+.061),(sign*w*.31,L*.20,h+.061),.007,M['steel'])
   for yy in [-L*.16,-L*.04,L*.08,L*.20]:a.rod('Roof rack crossrail',(-w*.31,yy,h+.061),(w*.31,yy,h+.061),.006,M['steel'])
  else:
   # Open cargo well, ribbed floor and rear hoop are actual separate volumes.
   a.box('Open pickup bed floor',(0,L*.30,.47),(w*.69,L*.30,.023),M['dark'],.005)
   for xx in [-.24,-.16,-.08,0,.08,.16,.24]:a.box('Pressed bed floor rib',(xx,L*.30,.485),(.012,L*.27,.010),M['steel'],.003)
   for sign in [-1,1]:
    a.box('Cargo bed inner wall',(sign*w*.37,L*.30,.53),(.035,L*.30,.11),paint,.008)
    a.rod('Bed roll hoop upright',(sign*w*.29,L*.14,.47),(sign*w*.29,L*.14,.72),.016,M['dark'])
    a.rod('Hoop diagonal brace',(sign*w*.29,L*.14,.65),(sign*w*.29,L*.33,.49),.011,M['dark'])
   a.rod('Bed roll hoop top',(-w*.29,L*.14,.72),(w*.29,L*.14,.72),.016,M['dark'])
   a.box('Bed aluminium toolbox',(0,L*.13,.51),(w*.61,.14,.10),M['steel'],.018)
   a.cyl('Pickup spare tire',(0,L*.33,.57),.15,.10,M['rubber'],'Y',32);a.cyl('Pickup spare rim',(0,L*.33+.055,.57),.085,.012,M['steel'],'Y',24)
 elif t=='jeep':
  a.box('Ivory seven slot grille',(0,front-.019,.405),(w*.78,.033,.177),accent,.019)
  for xx in [-.18,-.12,-.06,0,.06,.12,.18]:a.box('Jeep grille aperture',(xx,front-.038,.401),(.025,.009,.112),M['black'],.012)
  for sign in [-1,1]:
   a.cyl('Jeep light bucket',(sign*w*.32,front-.044,.413),.063,.018,M['black'],'Y',32);a.torus('Round daytime running halo',(sign*w*.32,front-.055,.413),.043,.005,M['light'],'Y',32);a.cyl('Jeep central projector',(sign*w*.32,front-.058,.413),.022,.004,M['glass'],'Y',24)
   a.rod('Roof basket side',(sign*w*.33,-L*.24,h+.071),(sign*w*.33,L*.25,h+.071),.012,M['dark'])
   a.rod('Roof basket raised side',(sign*w*.33,-L*.24,h+.15),(sign*w*.33,L*.25,h+.15),.010,M['dark'])
   for yy in [-L*.23,0,L*.24]:a.rod('Basket upright',(sign*w*.33,yy,h+.07),(sign*w*.33,yy,h+.15),.007,M['dark'])
  for yy in [-L*.23,-L*.10,L*.05,L*.24]:a.rod('Roof basket crossbar',(-w*.33,yy,h+.071),(w*.33,yy,h+.071),.010,M['dark'])
  luggage=mat('jeep canvas luggage','#798466',0,.84);a.box('Canvas expedition case',(-.13,.08,h+.14),(.27,.31,.14),luggage,.026)
  for xx in [-.22,-.06]:a.box('Cargo tie down',(xx,.08,h+.213),(.016,.32,.006),M['black'],.001)
  a.cyl('Rolled sleeping mat',(.16,.05,h+.13),.059,.25,M['wood'],'Y',24);a.box('Roof fuel can',(.17,.20,h+.16),(.10,.14,.16),M['red'],.014)
  a.rod('Snorkel body',(w*.46,-.30,.40),(w*.46,-.23,h+.045),.023,M['dark']);a.box('Snorkel intake',(w*.46,-.21,h+.061),(.07,.09,.033),M['dark'],.011)
  a.cyl('Rear spare tire',(0,back+.072,.56),.169,.115,M['rubber'],'Y',32);a.cyl('Rear spare rim',(0,back+.137,.56),.098,.013,M['steel'],'Y',24)
 elif t=='van':
  a.box('Radiused van cargo shell',(0,L*.235,(.452+h)/2),(w*.78,L*.49,h-.452),paint,.042)
  for sign in [-1,1]:
   a.box('Sliding door inset',(sign*w*.397,L*.17,.626),(.008,L*.31,.23),accent,.013)
   a.box('Sliding door upper track',(sign*w*.406,L*.16,.735),(.009,L*.34,.014),M['steel'],.004)
   for yy in [L*.02,L*.39]:a.box('Cargo panel shut line',(sign*w*.40,yy,.62),(.003,.003,.27),M['black'],0)
   a.box('Van LED headlamp',(sign*w*.31,front-.018,.408),(.16,.022,.052),M['light'],.014)
   for yy in [L*.08,L*.35]:a.box('Rear cargo hinge',(sign*w*.29,back+.012,.55+(yy/L-.08)*.7),(.036,.017,.041),M['steel'],.005)
  a.box('Twin rear door seam',(0,back+.01,.63),(.003,.006,.32),M['black'],0)
  for xx in [-.14,0,.14]:a.box('Amber cab roof marker',(xx,-L*.30,h+.017),(.029,.037,.019),M['light'],.007)

cars=[];manifest=[]
for original in S['designs']:
 d=dict(original);d['length']/=SCALE;d['width']/=SCALE;d['roof']/=SCALE;d['wheel']/=SCALE
 if 'profile' in d:d['profile']=[[t,hw,top/SCALE]for t,hw,top in d['profile']]
 w,L,h=d['width'],d['length'],d['roof'];typ=d['type'];A.begin(SCALE)
 paint=mat(d['id']+'_clearcoat_paint',d['color'],.43,.24,coat=.65);accent=mat(d['id']+'_satin_livery',d['accent'],.19,.30,coat=.35)
 wheels=[]
 for v in original['vehicle']['wheels']:
  position=v['position'];wheels.append({**v,'base':(position[0]/SCALE,-position[2]/SCALE,position[1]/SCALE),'r':v['radius']/SCALE,'width':v['width']/SCALE,'spokes':12 if typ in ['gt','prototype']else 10 if typ=='rally'else 5 if typ in ['drift','classic']else 8})
 d['artWheels']=wheels
 # The central chassis is narrow enough to expose tire steering clearance.
 A.box('Pressed central chassis',(0,0,.205),(w*(.40 if typ=='formula'else .53 if typ=='buggy'else .64),L*.86,.075),M['dark'],.018)
 if typ=='formula':
  d['profile']=[[-.50,.045,.222],[-.37,.095,.28],[-.18,.18,.35],[.02,.215,.39],[.27,.18,.42],[.43,.11,.31],[.50,.085,.26]]
  sculpted_shell(A,d,w,L,paint,[])
  for sign in [-1,1]:
   A.box('Formula radiator sidepod',(sign*w*.29,L*.10,.268),(.20,L*.46,.14),paint,.046)
   A.mesh('Sidepod air intake',[(sign*w*.18,-.10*L,.27),(sign*w*.40,-.10*L,.27),(sign*w*.39,-.10*L,.35),(sign*w*.19,-.10*L,.35)],[(0,1,2,3)],M['black'])
  A.box('Carbon cockpit well',(0,.08,.395),(.30,.32,.032),M['black'],.04)
  A.sphere('Driver helmet',(0,.07,.458),(.066,.068,.079),accent);A.sphere('Dark helmet visor',(0,.010,.468),(.058,.020,.027),M['glass'])
  for sign in [-1,1]:
   A.rod('Cockpit halo upright',(sign*.17,-.13,.365),(sign*.145,-.035,.54),.013,M['dark']);A.rod('Halo rail',(sign*.145,-.035,.54),(sign*.145,.20,.52),.013,M['dark']);A.box('Formula front wing endplate',(sign*w*.47,-L*.44,.26),(.014,.22,.15),paint,.006)
  A.rod('Halo crossbar',(-.145,-.035,.54),(.145,-.035,.54),.013,M['dark'])
  for k in range(3):A.box('Front wing aero element',(0,-L*.46+k*.052,.18+k*.018),(w*.95,.07,.018),accent if k==1 else M['dark'],.006)
 elif typ=='buggy':
  d['profile']=[[-.45,.22,.28],[-.30,.37,.37],[-.10,.25,.36],[.12,.20,.32],[.42,.22,.30]]
  sculpted_shell(A,d,w,L,paint,[])
  for sign in [-1,1]:
   points=[(sign*.28,-.24,.30),(sign*.22,-.14,.64),(sign*.22,.27,.67),(sign*.29,.47,.31)]
   for j in range(3):A.rod('Welded space frame',points[j],points[j+1],.0155,M['dark'])
   A.rod('Cage triangulation',points[1],(-sign*.29,.47,.31),.011,M['dark'])
   A.box('Buggy bucket seat',(sign*.105,.10,.38),(.17,.23,.18),M['black'],.035)
   for off in [-.027,.027]:A.rod('Buggy orange harness',(sign*.105+off,.015,.45),(sign*.105+off,.17,.50),.007,accent)
  for yy,zz in [(-.14,.64),(.27,.67)]:A.rod('Tubular roof crossbar',(-.22,yy,zz),(.22,yy,zz),.015,M['dark'])
  A.box('Exposed engine block',(0,.43,.35),(.32,.22,.15),M['dark'],.02)
  for xx in [-.12,-.04,.04,.12]:
   A.cyl('Machined engine cylinder',(xx,.44,.43),.031,.14,M['steel'],segments=20)
   A.rod('Tuned exhaust header',(xx,.45,.38),(xx,.58,.32),.013,M['steel'])
  for xx in [-.18,-.09,0,.09,.18]:A.cyl('Buggy roof LED pod',(xx,-.17,.68),.030,.027,M['light'],'Y',24)
 else:
  sculpted_shell(A,d,w,L,paint,wheels)
  prototype_canopy(A,d,w,L,h,paint,accent) if typ=='prototype' else cabin(A,d,w,L,h,paint,accent)
 signature_details(A,d,w,L,h,paint,accent,wheels)
 for q in wheels:
  x,y,z=q['base'];sign=1 if x>0 else -1
  A.rod('Lower suspension wishbone',(sign*w*.16,y-.065,.23),(x,y,z),.010,M['steel']);A.rod('Rear suspension wishbone',(sign*w*.16,y+.065,.23),(x,y,z),.010,M['steel'])
  top=(sign*w*.32,y,.405);bottom=(x*.93,y,z+.025);A.rod('Damper polished shaft',bottom,top,.009,M['steel']);A.coil('Coilover spring',bottom,top,.018,accent,4)
 body=A.merge(original['vehicle']['bodyNode']);A.origin(body,(0,0,0));root=empty('rc_'+d['id']);body.parent=root;body.location=(0,0,0)
 rig=[]
 for q in wheels:
  A.begin(SCALE)
  rim=accent if typ=='rally'else M['bronze']if typ=='drift'else M['steel']if typ in ['classic','pickup']else M['dark'];tire(A,q,rim,typ in ['jeep','pickup','buggy'])
  wheel_mesh=A.merge(d['id']+'_wheel_geometry_'+q['id']);si=(q['position'][0],-q['position'][2],q['position'][1]);A.origin(wheel_mesh,si)
  pivot=empty(q['node'],si);pivot['rcWheelId']=q['id'];pivot['rcWheelPivot']=True;pivot.parent=root;wheel_mesh.parent=pivot;wheel_mesh.location=(0,0,0);wheel_mesh.rotation_euler=(0,0,0);wheel_mesh.scale=(1,1,1)
  rig.append({'id':q['id'],'node':q['node'],'position':[round(pivot.location.x,6),round(pivot.location.z,6),round(-pivot.location.y,6)],'radius':q['radius'],'width':q['width'],'axle':[1,0,0],'bindQuaternion':[0,0,0,1],'scale':[1,1,1]})
 cars.append(root);bpy.context.view_layer.update()
 objs=[o for o in root.children_recursive if o.type=='MESH'];tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons)for o in objs)
 coords=[o.matrix_world@Vector(c)for o in objs for c in o.bound_box];bounds={'min':[min(p[i]for p in coords)for i in range(3)],'max':[max(p[i]for p in coords)for i in range(3)]}
 manifest.append({'id':d['id'],'node':root.name,'triangles':tris,'wheelNodes':[q['node']for q in wheels],'wheelRig':rig,'vehicle':original['vehicle'],'length':original['length'],'width':original['width'],'height':bounds['max'][2]-bounds['min'][2],'boundsBlender':bounds,'features':d.get('features',[]),'reference':'tools/rc/concepts/'+d['id']+'.jpg','meshCount':len(objs),'rootOrigin':'ground-contact centre','nose':[0,0,1],'up':[0,1,0]})
# Controller and table retain their established physical hand/socket contract.
A.begin(1)
A.box('Controller precision handset',(0,0,.045),(.148,.09,.065),M['dark'],.018)
for x in [-.05,.05]:
 A.cyl('Gimbal ring',(x,-.005,.082),.021,.009,M['black']);A.rod('Stick',(x,-.005,.08),(x,-.005,.105),.005,M['steel']);A.cyl('Knurled thumb pad',(x,-.005,.108),.011,.009,M['rubber'])
A.box('Controller screen',(0,.011,.080),(.038,.029,.004),M['glass'],.003)
for x in [-.05,.05]:A.box('Shoulder trigger',(x,.044,.055),(.025,.018,.015),M['steel'],.004)
A.rod('Controller aerial',(0,.035,.07),(0,.05,.20),.003,M['dark']);A.cyl('Link LED',(.059,-.025,.08),.004,.004,M['light'],segments=8)
controller=empty('controller');controller_mesh=A.merge('controller_body');A.origin(controller_mesh,(0,0,0));controller_mesh.parent=controller
A.begin(1);skin=mat('controller_hand_skin','#c68d67',0,.68);sleeve=mat('controller_sleeve','#304b4e',0,.9)
for sign in [-1,1]:
 A.rod('Sleeved forearm',(sign*.23,.20,-.06),(sign*.115,.058,.027),.041,sleeve)
 A.rod('Jersey cuff',(sign*.128,.076,.015),(sign*.108,.045,.034),.039,M['dark'])
 palm=A.box('Continuous gripping palm',(sign*.1,.025,.047),(.065,.084,.035),skin,.015);palm.rotation_euler[1]=sign*.18
 for fi in range(4):
  yy=-.009+fi*.019;A.rod('Finger',(sign*.105,yy,.048),(sign*.078,yy,.033),.009,skin);A.rod('Curled fingertip',(sign*.078,yy,.033),(sign*.066,yy,.047),.008,skin)
 A.rod('Thumb',(sign*.085,.022,.06),(sign*.05,-.005,.106),.011,skin);A.box('Thumb nail',(sign*.05,-.009,.111),(.011,.012,.003),M['light'],.003)
hands=empty('controller_hands');hand_mesh=A.merge('controller_hands_mesh');A.origin(hand_mesh,(0,0,0));hand_mesh.parent=hands
A.begin(1);tw,th,td=S['table']['size'];A.box('Table timber slab',(0,0,th-.022),(tw,td,.044),M['wood'],.018)
for x in [-tw/2+.06,tw/2-.06]:
 for y in [-td/2+.055,td/2-.055]:A.box('Table powdercoat leg',(x,y,th/2-.02),(.045,.045,th-.07),M['dark'],.008)
A.box('Club plaque',(0,-td/2-.004,th-.047),(.42,.012,.06),M['dark'],.004);A.text('Club name','DZIK RC CLUB',(0,-td/2-.012,th-.06),.035,M['light'],(math.pi/2,0,0))
table=empty('rc_table');table_mesh=A.merge('table_body');A.origin(table_mesh,(0,0,0));table_mesh.parent=table
# Publish only to owned staging. Empty wheel names are namespace-local in GLB;
# Blender itself requires globally unique names, hence the explicit normalization.
asset=OUT/'garage.glb';bpy.ops.export_scene.gltf(filepath=str(asset),export_format='GLB',export_yup=True,export_apply=True,export_cameras=False,export_lights=False,export_extras=True,export_texcoords=False)
raw=asset.read_bytes();length=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+length]);tail=raw[20+length:]
for node in g['nodes']:
 extras=node.get('extras',{})
 if extras.get('rcWheelPivot'):
  # Canonical globally unique names are prescribed by the recipe.
  node['name']=next(w['node']for d in S['designs']for w in d['vehicle']['wheels']if node['name']==w['node'])
encoded=json.dumps(g,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);asset.write_bytes(struct.pack('<III',0x46546c67,2,12+8+len(encoded)+len(tail))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+tail)
# Keep the inspectable authoring source useful when opened by an artist.
# Runtime templates were already exported at their local origin above.
for index,car in enumerate(cars):car.location=((index%5-2)*2.7,(index//5-.5)*4.0,0)
controller.location=(0,4.8,0);hands.location=(0,4.8,0);table.location=(2.0,4.8,0)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'garage.blend'))
raw=asset.read_bytes();(OUT/'manifest.json').write_text(json.dumps({'version':2,'seed':20261116,'generator':'tools/rc/build.py','recipe':'web/spec/rc.json','asset':'garage.glb','sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'modelScale':SCALE,'sourceSpecSha256':hashlib.sha256(SPEC_BYTES).hexdigest(),'units':'metres','coordinateSystem':{'up':'+Y','nose':'+Z','wheelAxle':'+X','origin':'ground-contact centre'},'cars':manifest},indent=2)+'\n')
print('RC_MANIFEST',len(raw),sum(c['triangles']for c in manifest))
