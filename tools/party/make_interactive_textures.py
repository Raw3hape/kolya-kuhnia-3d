"""Small original paper/metal textures for the reusable interactive prop library."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
import random,json
OUT=Path(__file__).resolve().parents[2]/'web/models/party/interactive/textures'
OUT.mkdir(parents=True,exist_ok=True)
FONT=Path('/System/Library/Fonts/Supplemental')
def font(name,size):return ImageFont.truetype(str(FONT/name),size)
def paper(base,seed):
 rng=random.Random(seed);im=Image.new('RGB',(512,512));px=im.load()
 for y in range(512):
  for x in range(512):
   n=rng.gauss(0,1.25)+(y%5==0)*.65;px[x,y]=tuple(max(0,min(255,int(v+n))) for v in base)
 return im
ROOT=Path(__file__).resolve().parents[2]
SPEC=json.loads((ROOT/'web/spec/party-visuals.json').read_text())
labels=json.loads((ROOT/'web/spec/party-labels.json').read_text())
sources=json.loads((ROOT/'tools/party/labels/generation.json').read_text())['labels']
w,h=labels['cellPixels'];g=labels['gutterPixels'];cols=labels['columns']
atlas=Image.new('RGB',(w*cols,h*labels['rows']))
for i,label in enumerate(labels['labels']):
 source=next(e for e in sources if e['id']==label['id'])
 art=Image.open(ROOT/'tools/party/labels'/source['source']).convert('RGB').resize((w-2*g,h-2*g),Image.Resampling.LANCZOS)
 # Duplicate edge pixels into the gutter; distant mipmaps never borrow a neighbour's ink.
 tile=ImageOps.expand(art,border=g)
 tile.paste(art.crop((0,0,1,art.height)).resize((g,art.height)),(0,g))
 tile.paste(art.crop((art.width-1,0,art.width,art.height)).resize((g,art.height)),(w-g,g))
 tile.paste(tile.crop((0,g,w,g+1)).resize((w,g)),(0,0))
 tile.paste(tile.crop((0,h-g-1,w,h-g)).resize((w,g)),(0,h-g))
 atlas.paste(tile,((i%cols)*w,(i//cols)*h))
atlas.save(OUT/'lager-label.jpg',quality=92,subsampling=0,optimize=True)
im=paper(tuple(int(SPEC['crate']['color'][i:i+2],16) for i in (1,3,5)),47);d=ImageDraw.Draw(im)
for y in range(0,512,3):d.line((0,y,512,y),fill=(149,127,93),width=1)
im.save(OUT/'cardboard.png',optimize=True)
im=Image.new('RGBA',(512,256),(0,0,0,0));d=ImageDraw.Draw(im);ink=(50,49,39,225)
d.text((30,24),'BROWAR NAD WISŁĄ',font=font('Arial Bold.ttf',26),fill=ink)
d.text((30,76),'8 × 0,33 L',font=font('Arial.ttf',24),fill=ink);d.text((30,122),'SZKŁO ZWROTNE',font=font('Arial.ttf',18),fill=ink)
rng=random.Random(3);x=310
while x<480:
 w=rng.choice([1,2,3]);d.rectangle((x,68,x+w,155),fill=ink);x+=w+rng.choice([2,3,4])
d.rectangle((25,193,486,195),fill=ink)
im.save(OUT/'carrier-print.png',optimize=True)
im=paper((114,119,121),19);d=ImageDraw.Draw(im)
for y in range(512):
 n=random.Random(y).randrange(-4,5);d.line((0,y,512,y),fill=(114+n,119+n,121+n))
im.save(OUT/'brushed-metal.png',optimize=True)
print('interactive textures: one 8-label atlas + three <=512px finish maps')
