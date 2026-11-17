"""RC garage art primitives and a small surface modeller. Blender only.
All authored coordinates enter in recipe units and are scaled exactly once by
Artist.scale. Vehicle sockets arrive in final SI and bypass this conversion.
"""
import bpy, math, bmesh
from mathutils import Vector

class Artist:
 def __init__(self,materials,scale=1):self.M=materials;self.scale=scale;self.items=[]
 def begin(self,scale=None):
  self.items=[]
  if scale is not None:self.scale=scale
 def finish(self,o,name,material,bevel=0,smooth=False):
  o.name=name
  if material:o.data.materials.append(material)
  if bevel:
   mod=o.modifiers.new('Manufactured edge radii','BEVEL');mod.width=bevel*self.scale;mod.segments=3 if bevel>.012 else 2 if bevel>.003 else 1
   bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
  if o.type=='MESH':
   for p in o.data.polygons:p.use_smooth=smooth
  self.items.append(o);return o
 def box(self,name,pos,size,material,bevel=.008):
  bpy.ops.mesh.primitive_cube_add(size=1,location=Vector(pos)*self.scale);o=bpy.context.object;o.dimensions=Vector(size)*self.scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  return self.finish(o,name,material,bevel)
 def cyl(self,name,pos,r,depth,material,axis='Z',segments=24):
  bpy.ops.mesh.primitive_cylinder_add(vertices=segments,radius=r*self.scale,depth=depth*self.scale,location=Vector(pos)*self.scale);o=bpy.context.object
  if axis=='X':o.rotation_euler[1]=math.pi/2
  elif axis=='Y':o.rotation_euler[0]=math.pi/2
  o=self.finish(o,name,material,smooth=True)
  for p in o.data.polygons:
   if len(p.vertices)>4:p.use_smooth=False
  return o
 def rod(self,name,a,b,r,material,segments=12):
  delta=Vector(b)-Vector(a);o=self.cyl(name,(Vector(a)+Vector(b))/2,r,delta.length,material,segments=segments);o.rotation_euler=delta.to_track_quat('Z','Y').to_euler();return o
 def mesh(self,name,verts,faces,material,bevel=0,smooth=False):
  data=bpy.data.meshes.new(name);data.from_pydata([tuple(Vector(v)*self.scale)for v in verts],[],faces);data.update()
  bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(data);bm.free()
  o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);return self.finish(o,name,material,bevel,smooth)
 def torus(self,name,pos,major,minor,material,axis='Z',segments=32):
  bpy.ops.mesh.primitive_torus_add(major_segments=segments,minor_segments=6,location=Vector(pos)*self.scale,major_radius=major*self.scale,minor_radius=minor*self.scale);o=bpy.context.object
  if axis=='X':o.rotation_euler[1]=math.pi/2
  elif axis=='Y':o.rotation_euler[0]=math.pi/2
  return self.finish(o,name,material,smooth=True)
 def sphere(self,name,pos,size,material):
  bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=1,location=Vector(pos)*self.scale);o=bpy.context.object;o.scale=Vector(size)*self.scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return self.finish(o,name,material,smooth=True)
 def text(self,name,value,pos,size,material,rot=(0,0,0)):
  cu=bpy.data.curves.new(name,'FONT');cu.body=value;cu.size=size*self.scale;cu.align_x='CENTER';cu.extrude=.00035*self.scale;cu.resolution_u=2;o=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(o);o.location=Vector(pos)*self.scale;o.rotation_euler=rot;o.data.materials.append(material);self.items.append(o);return o
 def curve(self,name,points,r,material,cyclic=False):
  cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=1;cu.bevel_depth=r*self.scale;cu.bevel_resolution=1;cu.use_fill_caps=True
  spline=cu.splines.new('POLY');spline.points.add(len(points)-1)
  for p,v in zip(spline.points,points):p.co=(*[x*self.scale for x in v],1)
  spline.use_cyclic_u=cyclic;o=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(o);o.data.materials.append(material);self.items.append(o);return o
 def coil(self,name,a,b,r,material,turns=5):
  delta=Vector(b)-Vector(a);axis=delta.normalized();u=axis.cross(Vector((1,0,0)))
  if u.length<.01:u=axis.cross(Vector((0,1,0)))
  u.normalize();v=axis.cross(u);pts=[]
  for k in range(turns*10+1):
   t=k/(turns*10);pts.append(Vector(a)+delta*t+r*(u*math.cos(t*turns*math.tau)+v*math.sin(t*turns*math.tau)))
  return self.curve(name,pts,.0035,material)
 def merge(self,name,objects=None):
  objects=list(self.items if objects is None else objects);meshes=[]
  for o in objects:
   if o.type in ['FONT','CURVE']:
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');o=bpy.context.object
   if o.type=='MESH':
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.transform_apply(location=False,rotation=True,scale=True);meshes.append(o)
  bpy.ops.object.select_all(action='DESELECT')
  for o in meshes:o.select_set(True)
  bpy.context.view_layer.objects.active=meshes[0];bpy.ops.object.join();o=bpy.context.object;o.name=name
  return o
 def origin(self,o,si_point):
  bpy.context.scene.cursor.location=si_point;bpy.context.view_layer.objects.active=o;bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
 def cut_wells(self,body,wheels,body_width):
  # Four independent wheel cavities, not a through-car cylinder. The central
  # engine/chassis volume stays intact and the tire has real steering clearance.
  for wheel in wheels:
   x,y,z=wheel['base'];sign=1 if x>0 else -1
   cutter=self.cyl('temporary wheel cavity',(sign*body_width*.48,y,z),wheel['r']+.027,body_width*.45,None,'X',40)
   modifier=body.modifiers.new('True wheel well '+wheel['id'],'BOOLEAN');modifier.operation='DIFFERENCE';modifier.solver='EXACT';modifier.object=cutter;bpy.context.view_layer.objects.active=body;bpy.ops.object.modifier_apply(modifier=modifier.name)
   self.items.remove(cutter);bpy.data.objects.remove(cutter,do_unlink=True)
 def arch(self,name,wheel,body_width,paint,bolts=False):
  x,y,z=wheel['base'];sign=1 if x>0 else -1;r=wheel['r'];n=24
  inner=r+.03;outer=r+.071;xa=sign*body_width*.455;xb=sign*max(body_width*.513,abs(x)+wheel['width']*.48)
  verts=[]
  for k in range(n+1):
   angle=.03+k/n*(math.pi-.06)
   for xx,rr in [(xa,inner),(xb,inner),(xb,outer),(xa,outer)]:verts.append((xx,y+math.cos(angle)*rr,z+math.sin(angle)*rr))
  faces=[]
  for k in range(n):
   for j in range(4):faces.append((k*4+j,k*4+(j+1)%4,(k+1)*4+(j+1)%4,(k+1)*4+j))
  faces.extend([(3,2,1,0),tuple(n*4+j for j in range(4))]);self.mesh(name,verts,faces,paint,.0018,True)
  if bolts:
   for k in range(7):
    angle=.15+k/6*(math.pi-.3);self.cyl('Recessed arch fastener',(xb+sign*.002,y+math.cos(angle)*(outer-.011),z+math.sin(angle)*(outer-.011)),.0045,.004,self.M['steel'],'X',8)

def interpolated(profile,t):
 for i in range(len(profile)-1):
  a,b=profile[i],profile[i+1]
  if a[0]<=t<=b[0]:
   f=(t-a[0])/(b[0]-a[0]);f=f*f*(3-2*f);return(a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f)
 return tuple(profile[0][1:] if t<profile[0][0] else profile[-1][1:])

def sculpted_shell(a,d,w,L,paint,wheels):
 profile=d['profile'];verts=[];sections=28
 for i in range(sections+1):
  t=-.5+i/sections;hw,top=interpolated(profile,t);half=w*hw
  # Fender crowns rise over the actual axle; bonnet and waist remain flowing.
  bulge=max([max(0,1-((t*L-w['base'][1])/(w['r']*1.2))**2)*.018 for w in wheels]or[0])
  top+=bulge;bottom=min(.175,top-.12);rocker=min(.235,top-.06)
  verts.extend([(half*.86,t*L,bottom),(half*.97,t*L,rocker),(half,t*L,top-.045),(half*.97,t*L,top-.009),(half*.79,t*L,top+.017),(half*.42,t*L,top+.025),(0,t*L,top+.027),(-half*.42,t*L,top+.025),(-half*.79,t*L,top+.017),(-half*.97,t*L,top-.009),(-half,t*L,top-.045),(-half*.97,t*L,rocker),(-half*.86,t*L,bottom)])
 count=13;faces=[tuple(reversed(range(count)))]
 for i in range(sections):
  for j in range(count):faces.append((i*count+j,i*count+(j+1)%count,(i+1)*count+(j+1)%count,(i+1)*count+j))
 faces.append(tuple(sections*count+j for j in range(count)));body=a.mesh('Sculpted continuous body',verts,faces,paint,smooth=True);a.cut_wells(body,wheels,w)
 return body

def cabin(a,d,w,L,h,paint,accent):
 M=a.M;front,roof_front,roof_back,rear=d['cabin'];base=.454;wb=w*.393;wr=w*d.get('roofWidth',.32)
 A=(-wb,front*L,base);B=(-wr,roof_front*L,h);C=(-wr,roof_back*L,h);D=(-wb,rear*L,base)
 mirror=lambda p:(-p[0],p[1],p[2])
 a.mesh('Inset laminated windshield',[A,mirror(A),mirror(B),B],[(0,1,2,3)],M['glass'])
 a.mesh('Rear screen',[D,C,mirror(C),mirror(D)],[(0,1,2,3)],M['glass'])
 for sign in [-1,1]:
  points=[(p[0]*sign,p[1],p[2])for p in [A,B,C,D]]
  a.mesh('Quarter and door glass',points,[(0,1,2,3)],M['glass'])
  for p0,p1 in [(A,B),(B,C),(C,D),(D,A)]:
   aa=(p0[0]*sign,p0[1],p0[2]);bb=(p1[0]*sign,p1[1],p1[2]);a.rod('Window rubber seal',aa,bb,.0145,M['black']);a.rod('Painted cabin frame',aa,bb,.009,paint)
  mid=(roof_front+roof_back)*.52*L;a.rod('Solid B pillar',(sign*wr,mid,h),(sign*wb,mid,base),.013,paint)
  a.box('Flush door pull',(sign*w*.477,(rear+front)*L*.35,.405),(.016,.081,.014),M['steel'],.004)
  arm=a.rod('Mirror cast arm',(sign*w*.39,front*L+.04,.473),(sign*w*.515,front*L+.06,.49),.009,M['black'])
  mirror_body=a.sphere('Aerodynamic wing mirror',(sign*w*.515,front*L+.06,.495),(.038,.033,.024),paint)
  a.box('Mirror optical face',(sign*w*.515,front*L+.096,.495),(.06,.002,.031),M['mirror'],.004)
 # Crowned, genuinely curved roof with a clean character line, no flat roof cube.
 verts=[];nx=12;ny=5
 for j in range(ny+1):
  yy=(roof_front+(roof_back-roof_front)*j/ny)*L
  for i in range(nx+1):
   x=-wr+2*wr*i/nx;verts.append((x,yy,h+.022*(1-(x/wr)**2)+.006*math.sin(j/ny*math.pi)))
 roof=a.mesh('Pressed crowned roof',verts,[(j*(nx+1)+i,j*(nx+1)+i+1,(j+1)*(nx+1)+i+1,(j+1)*(nx+1)+i)for j in range(ny)for i in range(nx)],accent if d['type']=='jeep' else paint,smooth=True)
 solid=roof.modifiers.new('Roof gauge','SOLIDIFY');solid.thickness=.012*a.scale;bpy.context.view_layer.objects.active=roof;bpy.ops.object.modifier_apply(modifier=solid.name)
 for sign in [-1,1]:
  a.rod('Wiper linkage',(sign*w*.18,front*L-.006,.466),(sign*w*.12,front*L+.095,.503),.004,M['black']);a.rod('Wiper blade',(sign*w*.12-.033,front*L+.095,.503),(sign*w*.12+.04,front*L+.095,.503),.004,M['dark'])
 # A legible cabin below the glass: deep seats, instruments and steering wheel.
 seat_y=(roof_front+roof_back)*L*.25+.04
 for sign in [-1,1]:
  a.box('Bucket seat bolster',(sign*w*.18,seat_y,.35),(.19,.25,.07),M['black'],.024)
  seat=a.box('Reclined seat back',(sign*w*.18,seat_y+.10,.45),(.19,.045,.23),M['dark'],.022);seat.rotation_euler[0]=-.17
  a.box('Head restraint',(sign*w*.18,seat_y+.11,.575),(.10,.055,.075),M['black'],.025)
  for dx in [-.028,.028]:a.rod('Fabric harness',(sign*w*.18+dx,seat_y-.035,.40),(sign*w*.18+dx,seat_y+.071,.532),.007,accent)
 dashboard_y=front*L+.06;a.box('Dashboard',(0,dashboard_y,.421),(w*.70,.09,.079),M['dark'],.017)
 for xx in [-w*.17,w*.17]:a.cyl('Instrument dial',(xx,dashboard_y+.05,.439),.022,.005,M['glass'],'Y',20)
 steering=(-w*.18,dashboard_y+.12,.464);a.torus('Steering wheel',steering,.047,.0055,M['black'],'Y',24)
 for angle in [0,math.tau/3,math.tau*2/3]:a.rod('Steering spoke',steering,(steering[0]+math.cos(angle)*.041,steering[1],steering[2]+math.sin(angle)*.041),.004,M['steel'])

def tire(a,wheel,rim,offroad):
 M=a.M;x,y,z=wheel['base'];r=wheel['r'];width=wheel['width'];sign=1 if x>0 else -1
 # Rounded sidewall and real hollow bead, rather than a solid unshaped cylinder.
 cr=r-(.009 if offroad else .0015)
 profile=[(-width*.5,r*.66),(-width*.5,cr*.86),(-width*.39,cr*.965),(-width*.23,cr*.995),(width*.23,cr*.995),(width*.39,cr*.965),(width*.5,cr*.86),(width*.5,r*.66),(width*.38,r*.60),(-width*.38,r*.60)]
 verts=[];n=40
 for xx,rr in profile:
  for j in range(n):
   angle=j/n*math.tau;verts.append((x+xx,y+math.sin(angle)*rr,z+math.cos(angle)*rr))
 faces=[]
 for i in range(len(profile)):
  for j in range(n):faces.append((i*n+j,i*n+(j+1)%n,((i+1)%len(profile))*n+(j+1)%n,((i+1)%len(profile))*n+j))
 a.mesh('Moulded tire with rounded shoulders',verts,faces,M['rubber'],smooth=True)
 # V-shaped contact blocks on the crown, smaller continuous road tread.
 for j in range(24 if offroad else 30):
  angle=j/(24 if offroad else 30)*math.tau
  for side in [-1,1]:
   tread_height=.016 if offroad else .004;contact_radius=r-tread_height*.5
   yy=y+math.sin(angle)*contact_radius;zz=z+math.cos(angle)*contact_radius
   block=a.box('Directional tread', (x+side*width*.23,yy,zz),(width*.43,.029 if offroad else .017,.016 if offroad else .004),M['rubber'],0);block.rotation_euler[0]=-angle;block.rotation_euler[2]=side*.20
 outer=x+sign*width*.507
 a.cyl('Ventilated brake rotor',(x+sign*width*.27,y,z),r*.50,.008,M['steel'],'X',32)
 for j in range(12):
  angle=j/12*math.tau;a.cyl('Rotor drill',(x+sign*width*.325,y+math.sin(angle)*r*.395,z+math.cos(angle)*r*.395),r*.025,.0015,M['black'],'X',6)
 a.box('Brake caliper',(x+sign*width*.34,y+r*.34,z),(.018,r*.17,r*.47),M['red'],.005)
 # Hollow rim barrel keeps the rotor and coloured caliper visible through spokes.
 rim_profile=[(-.035,r*.61),(.003,r*.61),(.006,r*.545),(-.035,r*.545)]
 rv=[];rn=32
 for xx,rr in rim_profile:
  for j in range(rn):
   angle=j/rn*math.tau;rv.append((outer+sign*xx,y+math.sin(angle)*rr,z+math.cos(angle)*rr))
 a.mesh('Hollow forged rim barrel',rv,[(i*rn+j,i*rn+(j+1)%rn,((i+1)%4)*rn+(j+1)%rn,((i+1)%4)*rn+j)for i in range(4)for j in range(rn)],rim,smooth=True)
 a.torus('Diamond cut rim lip',(outer+sign*.004,y,z),r*.615,.009,rim,'X',40)
 spokes=wheel.get('spokes',10)
 for j in range(spokes):
  angle=j/spokes*math.tau;u=Vector((0,math.sin(angle),math.cos(angle)));v=Vector((0,math.cos(angle),-math.sin(angle)));p=Vector((outer+sign*.008,y,z));inner=p+u*r*.18;end=p+u*r*.565
  points=[]
  for depth in [-.005,.005]:
   for q,width0 in [(inner,.013),(end,.008)]:
    for side in [-1,1]:points.append(tuple(q+v*side*width0+Vector((depth,0,0))))
  a.mesh('Forged tapered spoke',points,[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],rim,.001)
 a.cyl('Wheel centre cap',(outer+sign*.014,y,z),r*.18,.014,M['steel'],'X',24)
 for j in range(5):
  angle=j/5*math.tau;a.cyl('Hex wheel nut',(outer+sign*.023,y+math.sin(angle)*r*.122,z+math.cos(angle)*r*.122),.0045,.006,M['dark'],'X',6)
 if offroad:
  for j in range(12):
   angle=j/12*math.tau;a.cyl('Beadlock bolt',(outer+sign*.012,y+math.sin(angle)*r*.615,z+math.cos(angle)*r*.615),.0033,.004,M['steel'],'X',6)
 # Sidewall relief is geometry, not another unique texture per tire.
 a.torus('Sidewall embossed ring',(outer-sign*.002,y,z),r*.84,.0019,M['dark'],'X',40)

def prototype_canopy(a,d,w,L,h,paint,accent):
 # A closed, smoothly lofted teardrop canopy, visibly different from coupe glass.
 profile=[(-.30,.03,.438),(-.23,.72,.505),(-.10,.98,h-.012),(.06,1,h),(.20,.78,.516),(.29,.08,.44)]
 verts=[];n=20
 for t,width,peak in profile:
  for j in range(n+1):
   theta=j/n*math.pi;verts.append((-w*.29*width*math.cos(theta),t*L,.433+(peak-.433)*math.sin(theta)))
 faces=[(i*(n+1)+j,i*(n+1)+j+1,(i+1)*(n+1)+j+1,(i+1)*(n+1)+j)for i in range(len(profile)-1)for j in range(n)]
 a.mesh('Teardrop endurance canopy',verts,faces,a.M['glass'],smooth=True)
 a.curve('Canopy centre spine',[(0,t*L,peak+.003)for t,width,peak in profile],.006,paint)
 for index in [1,4]:
  t,width,peak=profile[index];a.curve('Canopy perimeter bow',[(-w*.29*width*math.cos(j/n*math.pi),t*L,.433+(peak-.433)*math.sin(j/n*math.pi))for j in range(n+1)],.005,paint)
 for sign in [-1,1]:
  a.curve('Canopy carbon sill',[(sign*w*.29*width,t*L,.436)for t,width,peak in profile],.008,a.M['dark'])
  a.box('Endurance bucket seat',(sign*w*.115,.04,.405),(.145,.24,.075),a.M['black'],.022)
 a.sphere('Prototype pilot helmet',(-w*.115,.055,.487),(.042,.049,.049),accent)
 a.sphere('Prototype visor',(-w*.115,.014,.494),(.038,.014,.018),a.M['dark'])
 a.torus('Prototype steering rim',(-w*.115,-.10,.455),.035,.004,a.M['black'],'Y',24)
