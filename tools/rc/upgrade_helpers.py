# Imported by build.py; deterministic sculpted meshes, no external model input.
def install(namespace):
 exec(HELPERS,namespace)
HELPERS=r'''
def mesh(name,verts,faces,material,bevel=0):
 data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update();o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.data.materials.append(material);current.append(o)
 if bevel:
  mod=o.modifiers.new('sculpted edge radius','BEVEL');mod.width=bevel;mod.segments=2;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 return o
def torus(name,pos,major,minor,material,axis='Z',major_segments=24):
 bpy.ops.mesh.primitive_torus_add(major_segments=major_segments,minor_segments=6,location=pos,major_radius=major,minor_radius=minor);o=bpy.context.object;o.name=name
 if axis=='X':o.rotation_euler[1]=math.pi/2
 elif axis=='Y':o.rotation_euler[0]=math.pi/2
 o.data.materials.append(material)
 for p in o.data.polygons:p.use_smooth=True
 current.append(o);return o
def shell(name,profile,width,length,material):
 verts=[]
 for t,hw,top in profile:
  y=t*length;w=hw*width
  verts.extend([(w,y,.21),(w,y,top-.045),(w*.81,y,top),(-w*.81,y,top),(-w,y,top-.045),(-w,y,.21)])
 faces=[tuple(range(5,-1,-1))]
 for i in range(len(profile)-1):
  for j in range(6):faces.append((i*6+j,i*6+(j+1)%6,(i+1)*6+(j+1)%6,(i+1)*6+j))
 faces.append(tuple(range((len(profile)-1)*6,len(profile)*6)))
 return mesh(name,verts,faces,material,.009)
def glazed_cabin(d,w,L,h,paint):
 # Car-specific lower-front, roof-front, roof-back, lower-back fractions.
 a,b,c,e=d['cabin'];wb=w*.39;wr=w*d.get('roofWidth',.315);base=.44
 A=(-wb,a*L,base);B=(-wr,b*L,h);C=(-wr,c*L,h);D=(-wb,e*L,base)
 mirror=lambda p:(-p[0],p[1],p[2])
 mesh('sloped windshield',[A,mirror(A),mirror(B),B],[(0,1,2,3)],M['glass'])
 mesh('sloped rear glass',[D,C,mirror(C),mirror(D)],[(0,1,2,3)],M['glass'])
 for sign in [-1,1]:
  side=lambda p:(p[0]*sign,p[1],p[2])
  pts=[side(p)for p in [A,B,C,D]];mesh('side glazing',pts,[(0,1,2,3)],M['glass'])
  for p0,p1 in [(A,B),(B,C),(C,D),(D,A)]:rod('cabin frame',side(p0),side(p1),.012,paint)
  yy=(b+c)*L*.5;rod('B pillar',(sign*wr,yy,h),(sign*wb,yy,base),.012,paint)
  box('door handle',(sign*w*.475,.07,.412),(.016,.09,.018),M['steel'],.004)
  box('wing mirror',(sign*w*.51,a*L+.05,.49),(.085,.075,.04),paint,.014)
  for y in [a*L+.07,e*L-.07]:box('etched panel gap',(sign*w*.469,y,.345),(.004,.005,.15),M['dark'],0)
 box('curved roof',(0,(b+c)*L*.5,h+.005),(wr*2+.025,(c-b)*L+.028,.034),M.get('light') if d['type']=='jeep' else paint,.015)
 for xx in [-w*.19,w*.19]:
  box('bucket seat cushion',(xx,.05,.39),(.19,.22,.055),M['black'],.02);seat=box('bucket seat back',(xx,.16,.49),(.19,.045,.2),M['black'],.025);seat.rotation_euler[0]=-.15
 # Wiper arms remain visible on the dark glass.
 for sign in [-1,1]:rod('windshield wiper',(sign*w*.18,a*L-.007,.455),(sign*w*.12,a*L+.1,.5),.005,M['dark'])
 return (a,b,c,e)
def prototype_canopy(w,L,h,paint):
 verts=[];segments=24;rings=6
 for j in range(rings+1):
  lat=j/rings*math.pi/2
  for i in range(segments):
   a=i/segments*math.tau;verts.append((w*.29*math.cos(a)*math.cos(lat),L*.02+L*.29*math.sin(a)*math.cos(lat),.425+(h-.425)*math.sin(lat)))
 faces=[]
 for j in range(rings):
  for i in range(segments):faces.append((j*segments+i,j*segments+(i+1)%segments,(j+1)*segments+(i+1)%segments,(j+1)*segments+i))
 o=mesh('endurance bubble canopy',verts,faces,M['glass'])
 for p in o.data.polygons:p.use_smooth=True
 for yy in [-L*.10,L*.15]:rod('canopy rail',(-w*.23,yy,.47),(w*.23,yy,.47),.008,paint)
def wheel_arch(name,x,y,z,r,width,paint,bolted=False):
 # Thick upper arch lip and dark wheel-well liner.
 for offset,material,depth in [(0,M['black'],.018),(.018,paint,.008)]:
  verts=[];n=14
  for k in range(n+1):
   a=math.pi*.05+k/n*math.pi*.90
   for rr in [r+.022+offset,r+.055+offset]:verts.append((x,y+math.cos(a)*rr,z+math.sin(a)*rr))
  mesh(name,verts,[(k*2,k*2+1,k*2+3,k*2+2)for k in range(n)],material)
 if bolted:
  for k in range(7):
   a=math.pi*.12+k/6*math.pi*.76;cyl('arch rivet',(x+(.004 if x>0 else -.004),y+math.cos(a)*(r+.055),z+math.sin(a)*(r+.055)),.006,.008,M['steel'],'X',8)
def coil(name,a,b,r,material,turns=6):
 direction=Vector(b)-Vector(a);axis=direction.normalized();side=axis.cross(Vector((1,0,0)))
 if side.length<.01:side=axis.cross(Vector((0,1,0)))
 side.normalize();other=axis.cross(side);pts=[];n=turns*10
 for k in range(n+1):
  t=k/n;pts.append(Vector(a)+direction*t+r*(side*math.cos(t*turns*math.tau)+other*math.sin(t*turns*math.tau)))
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=1;cu.bevel_depth=.004;cu.bevel_resolution=1
 spline=cu.splines.new('POLY');spline.points.add(len(pts)-1)
 for point,value in zip(spline.points,pts):point.co=(*value,1)
 o=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(o);o.data.materials.append(material);bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False);current.append(o)

'''
