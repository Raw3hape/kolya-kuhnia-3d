# Builds web/spec/decor/room3.json (Кабинет) and checks the placement numerically + a top-view plot.
# python3 layout.py <project_root> <out_png>
import json, math, sys, itertools
from PIL import Image, ImageDraw
ROOT, PNG = sys.argv[1], sys.argv[2]
HERE = sys.path[0]
dims = json.load(open(HERE + '/dims.json'))
dims.update({'knagglig': [0.31, 0.15, 0.23], 'trummis': [0.184, 0.142, 0.255]})   # W, H, D
prod = json.load(open(HERE + '/products.json'))
plan = json.load(open(ROOT + '/web/spec/plan.generated.json'))
R3 = plan['rooms']['room3']['rects'][0]
X0, X1, Z0, Z1 = R3['x0'], R3['x1'], R3['z0'], R3['z1']
ops = {o['id']: o for o in plan['openings']}
bd, rd = ops['room3_balcony_door'], ops['room3_door']
# balcony sash: one leaf, hinge on the left (model.js buildOpening): frame 6.8 cm
BAL_H = (bd['x0'] + 0.068, 0.0); BAL_R = bd['width'] - 2 * 0.068
DOOR_H = (rd['x0'], rd['z0']); DOOR_R = rd['leaf']          # hinge 'start', opens into room3 (-z)

def wpt(c, rot, lx, lz):
    t = math.radians(rot)
    return (c[0] + lx * math.cos(t) + lz * math.sin(t), c[1] - lx * math.sin(t) + lz * math.cos(t))

def foot(c, rot, W, D):
    return [wpt(c, rot, sx * W / 2, sz * D / 2) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]

r3 = lambda v: round(v, 3)
M = lambda f, i: f'models/decor/{f}/{i}/model.glb'

def part(folder, mid, pos, rot, **kw):
    p = {'model': M(folder, mid), 'pos': [r3(pos[0]), r3(pos[1]), r3(pos[2])], 'rot': rot}
    p.update(kw); return p

def pinfo(key, **kw):
    p = prod[key]; a = p['art']
    d = {'brand': 'IKEA', 'article': f'{a[0:3]}.{a[3:6]}.{a[6:8]}', 'url': p['url'], 'price_pln': p['price'],
         'finish': p['finish']}
    d.update(kw); return d

def pname(key, extra=''):
    p = prod[key]
    s = f"{p['name']} {p['type'][0].lower() + p['type'][1:]}"
    if p['measure']: s += f", {p['measure']}"
    return s + extra

WALL_R = X1 - 0.01          # right wall (kitchen side), 1 cm gap
WALL_L = X0 + 0.01          # left wall
# ---------- desk on the right wall, side-on to the window (window on the left of a seated right-hander) ----------
ZC = 1.42
DESKS = [('tonstad-120', 'tonstad-120'), ('mittzon-120', 'mittzon-120-oak'), ('idasen-120', 'idasen-120'), ('micke-142', 'micke-142')]
NOTES = {'tonstad-120': 'узкий письменный стол из дуба с ящиком',
         'mittzon-120': 'высота ножек регулируется 65–85 см, поставлен на 75',
         'idasen-120': 'высота регулируется 65–79 см, поставлен на 75',
         'micke-142': 'с ящиком и отверстием для проводов'}
desk_opts, desk_rects = [], {}
for oid, key in DESKS:
    W, H, D = dims[key]
    c = (WALL_R - D / 2, ZC)
    desk_rects[oid] = (c[0] - D / 2, c[0] + D / 2, ZC - W / 2, ZC + W / 2, H)
    desk_opts.append(dict(id=oid, name=pname(key), **pinfo(key, note=NOTES[oid]), size=[r3(W), r3(H), r3(D)],
                          thumb=f'models/decor/room3/{oid}/thumb.jpg', collide=True,
                          parts=[part('room3', oid, (c[0], 0, c[1]), -90)]))
TOP = 0.75   # all desks have their top at 75 cm (adjustable ones set to 75)

# ---------- office chair, facing the desk (+X) ----------
CHAIRS = [('alefjall', 'alefjall', 0.48), ('fjallberget', 'fjallberget', 0.47), ('markus', 'markus', 0.50), ('flintan', 'flintan', 0.50)]
CH_C = (-1.02, 1.42)
chair_opts = []
for oid, key, sh in CHAIRS:
    W, H, D = dims[key]
    chair_opts.append(dict(id=oid, name=pname(key), **pinfo(key), size=[r3(W), r3(H), r3(D)],
                           thumb=f'models/decor/room3/{oid}/thumb.jpg', collide=True,
                           seat={'h': sh, 'depth': 0.06, 'label': 'Сесть за стол'},
                           parts=[part('room3', oid, (CH_C[0], 0, CH_C[1]), 90)]))

# ---------- computer (generic CC0, made for this project) ----------
MON_X = WALL_R - 0.04 - dims['monitor-27'][2] / 2
KB_X = -0.43
KB_OFF = 0.0605                      # keyboard centre is 6 cm left of the keyboard+mouse footprint centre
LAP_X = -0.38
def comp(oid, name, items, note):
    W = max(z for _, z, w in items) - min(z for _, z, w in items)
    return dict(id=oid, name=name, brand='универсальная модель', note=note, collide=False,
                thumb=f'models/decor/room3/{oid}/thumb.jpg', size=None,
                parts=[part('room3', m, (x, TOP, z), -90) for m, (x, z) in [(it[0], it[1]) for it in items]])
COMP = [
    ('monitor-laptop', 'Универсальный монитор 27″, клавиатура и ноутбук 14″',
     [('monitor-27', (MON_X, 1.36)), ('keyboard-mouse', (KB_X, 1.36 + KB_OFF)), ('laptop-14', (LAP_X, 1.84))]),
    ('monitor', 'Универсальный монитор 27″ с клавиатурой и мышью',
     [('monitor-27', (MON_X, ZC)), ('keyboard-mouse', (KB_X, ZC + KB_OFF))]),
    ('laptop', 'Универсальный ноутбук 14″', [('laptop-14', (LAP_X, ZC))]),
]
comp_opts = []
for oid, name, its in COMP:
    comp_opts.append(dict(id=oid, name=name, brand='универсальная модель (CC0)',
                          note='IKEA не продаёт компьютеры: простая модель без бренда, сделана для проекта',
                          thumb=f"models/decor/room3/{ {'monitor-laptop': 'monitor-27', 'monitor': 'keyboard-mouse', 'laptop': 'laptop-14'}[oid] }/thumb.jpg", collide=False,
                          size=[0.614, 0.471, 0.192] if 'monitor' in oid else [0.313, 0.21, 0.296],
                          parts=[part('room3', m, (p[0], TOP, p[1]), -90) for m, p in its]))

# ---------- desk lamp: back corner on the window side (left hand) ----------
LAMPS = ['ranarp', 'isnalen', 'skurup', 'forsa']
lamp_opts = []
for key in LAMPS:
    W, H, D = dims[key]
    c = (WALL_R - 0.03 - D / 2 + (0.0 if D < 0.3 else 0.0), 0.92)
    lamp_opts.append(dict(id=key, name=pname(key), **pinfo(key, note='только предмет: свет кабинета задаёт панель «Свет»'),
                          size=[r3(W), r3(H), r3(D)], thumb=f'models/decor/room3/{key}/thumb.jpg', collide=False,
                          parts=[part('room3', key, (c[0], TOP, c[1]), -90)]))

# ---------- shelving on the left wall: library wall facing the desk ----------
BOOK_LZ = -0.015
def fill(c, rot, levels, cols, plan_):
    """plan_[col][level] = list of prop ids laid left->right in a compartment of cols[col] = (x_left, x_right)."""
    parts = []
    for ci, (xl, xr) in enumerate(cols):
        for li, y in enumerate(levels):
            row = plan_[ci][li] if li < len(plan_[ci]) else []
            if not row: continue
            ws = [dims[i][0] for i in row]
            gap = ((xr - xl) - sum(ws)) / (len(row) + 1)
            if gap < 0: raise SystemExit(f'overfull compartment {row} in {xl}..{xr}')
            x = xl + gap
            for i, w in zip(row, ws):
                lz = BOOK_LZ if i.startswith('books') else (-0.14 + 0.012 + dims[i][2] / 2)
                wx, wz = wpt(c, rot, x + w / 2, lz)
                parts.append(part('props', i, (wx, y, wz), rot))
                x += w + gap
    return parts
B70, B45, B30, MIX, STK, BOX, BSK = 'books-shelf-70', 'books-shelf-45', 'books-shelf-30', 'books-shelf-mix60', 'books-stack-s', 'knagglig', 'trummis'
BILLY_LV = [0.109, 0.453, 0.772, 1.063, 1.41, 1.729, 2.018]
SHELVES = [
    ('billy-200-walnut', 1.78, BILLY_LV, [(-0.98, -0.219), (-0.18, 0.18), (0.221, 0.98)],
     [[[BOX, BOX], [B70], [MIX], [B70], [B45, BSK], [B70], [B45]],
      [[BSK], [B30], [STK], [B30], [B30], [STK], [B30]],
      [[BOX, BOX], [B45, STK], [B70], [MIX], [B70], [B45, BSK], [B70]]],
     'три секции с надставками почти до потолка: 80 + 40 + 80 см'),
    ('billy-120-oak', 1.62, BILLY_LV, [(-0.58, -0.22), (-0.18, 0.18), (0.22, 0.58)],
     [[[BSK], [B30], [STK], [B30], [B30], [STK], [B30]],
      [[B30], [STK], [B30], [B30], [BSK], [B30], [STK]],
      [[BSK], [B30], [B30], [STK], [B30], [B30], [B30]]],
     'три узкие секции по 40 см с надставками'),
    ('billy-160-white', 1.62, [0.101, 0.387, 0.739, 1.063, 1.41, 1.731], [(-0.781, -0.019), (0.019, 0.781)],
     [[[BOX, BOX], [B70], [MIX], [B70], [B45, BSK], [B70]],
      [[BOX, BOX], [B45, STK], [B70], [MIX], [B70], [B45]]],
     'две секции по 80 см'),
    ('ivar-89', 1.62, [0.112, 0.483, 1.765, 2.019], [(-0.40, 0.40)],
     [[[BOX, BOX], [B70], [B45, BSK], [STK, STK]]],
     'сосна, два ящика-корзины посередине'),
]
shelf_opts = []
for oid, zc, lv, cols, pl, note in SHELVES:
    W, H, D = dims[oid]
    c = (WALL_L + D / 2, zc)
    parts = [part('room3', oid, (c[0], 0, c[1]), 90)] + fill(c, 90, lv, cols, pl)
    shelf_opts.append(dict(id=oid, name=pname(oid), **pinfo(oid, note=note + '; книги и коробки KNAGGLIG, корзины TRUMMIS — реквизит'),
                           size=[r3(W), r3(H), r3(D)], thumb=f'models/decor/room3/{oid}/thumb.jpg', collide=True, parts=parts))

# ---------- reading corner: back-right corner, armchair turned to the window and the library ----------
ARM_C, ARM_ROT = (-0.76, 2.97), -135
SIDE_C = (-1.24, 3.37)          # GLADOM on the left hand of the reader
LAMP_C = (-0.32, 3.44)          # ÅRSTID in the corner behind the shoulder
ARMS = [('lillesater', 'lillesater', 0.42), ('strandmon', 'strandmon-leather', 0.45), ('poang', 'poang', 0.42), ('oskarshamn', 'oskarshamn', 0.44)]
read_opts = []
for oid, key, sh in ARMS:
    W, H, D = dims[key]
    total = round(prod[key]['price'] + prod['gladom']['price'] + prod['arstid-floor']['price'], 2)
    read_opts.append(dict(id=oid, name=pname(key) + ' + GLADOM + ÅRSTID', **pinfo(key, price_pln=total,
                          note=f"кресло {prod[key]['price']} zł ({prod[key]['finish']}); столик GLADOM 45×53 czarny "
                               f"{prod['gladom']['price']} zł (арт. 504.119.90); торшер ÅRSTID mosiądz/biały "
                               f"{prod['arstid-floor']['price']} zł (арт. 003.213.17), только предмет"),
                          size=[r3(W), r3(H), r3(D)], thumb=f'models/decor/room3/{oid}/thumb.jpg', collide=True,
                          seat={'h': sh, 'depth': 0.1, 'label': 'Сесть в кресло'},
                          parts=[part('room3', oid, (ARM_C[0], 0, ARM_C[1]), ARM_ROT),
                                 part('room3', 'gladom', (SIDE_C[0], 0, SIDE_C[1]), 0),
                                 part('room3', 'arstid', (LAMP_C[0], 0, LAMP_C[1]), 0)]))

# ---------- rug: under the desk zone, long side across the room ----------
RUG_C = (-1.33, 1.82)
rug_opts = []
for key in ['jarnvag', 'lohals', 'tidtabell', 'stoense']:
    W, H, D = dims[key]
    rug_opts.append(dict(id=key, name=pname(key), **pinfo(key), size=[r3(D), r3(H), r3(W)],
                         thumb=f'models/decor/room3/{key}/thumb.jpg', collide=False,
                         parts=[part('room3', key, (RUG_C[0], 0, RUG_C[1]), 90)]))

# ---------- plant: corner between the window and the library ----------
PL_C = (-2.24, 0.40)
def plant(oid, keys, folders, name, price, note):
    first = keys[0]
    W, H, D = dims[first]
    parts = []
    for k, f, dy in folders:
        parts.append(part('props', f, (PL_C[0], dy, PL_C[1]), 0))
    a = prod[keys[0]]['art']
    return dict(id=oid, name=name, brand='IKEA', article=f'{a[0:3]}.{a[3:6]}.{a[6:8]}', url=prod[keys[0]]['url'],
                price_pln=price, finish=prod[keys[0]]['finish'], note=note, size=[r3(W), r3(H), r3(D)],
                thumb=f'models/decor/props/{folders[-1][1]}/thumb.jpg', collide=True, parts=parts)
plant_opts = [
    plant('fejka-ficus', ['fejka-ficus'], [('fejka-ficus', 'fejka-ficus', 0)], pname('fejka-ficus'), prod['fejka-ficus']['price'],
          'искусственный фикус ~164 см, не требует света'),
    plant('dypsis', ['dypsis', 'klynnon'], [('klynnon', 'klynnon-24', 0), ('dypsis', 'dypsis-lutescens-24', 0.03)],
          pname('dypsis') + ' + KLYNNON osłonka 24 cm', round(prod['dypsis']['price'] + prod['klynnon']['price'], 2),
          f"пальма {prod['dypsis']['price']} zł + бамбуковое кашпо KLYNNON {prod['klynnon']['price']} zł (арт. 205.164.08)"),
    plant('strelitzia', ['strelitzia', 'hasselbukett'], [('hasselbukett', 'hasselbukett-19', 0), ('strelitzia', 'strelitzia-19', 0.025)],
          pname('strelitzia') + ' + HASSELBUKETT osłonka 19 cm', round(prod['strelitzia']['price'] + prod['hasselbukett']['price'], 2),
          f"стрелиция {prod['strelitzia']['price']} zł + кашпо HASSELBUKETT {prod['hasselbukett']['price']} zł (арт. 406.218.23)"),
    plant('fejka-bamboo', ['fejka-bamboo'], [('fejka-bamboo', 'fejka-bamboo', 0)], pname('fejka-bamboo'), prod['fejka-bamboo']['price'],
          'искусственный бамбук ~170 см'),
]
# ---------- wall art above the desk ----------
ART = [('knoppang-botanic', 1.32, 'пара рамок с ботаническими плакатами'), ('blodflader-seine', 1.30, 'Моне, в раме'),
       ('pjatteryd-lilies', 1.32, 'Моне, на холсте'), ('pjatteryd-pearl', 1.36, 'Вермеер, на холсте')]
art_opts = []
for key, y, note in ART:
    W, H, D = dims[key]
    art_opts.append(dict(id=key, name=pname(key), **pinfo(key, note=note), size=[r3(W), r3(H), r3(D)],
                         thumb=f'models/decor/props/{key}/thumb.jpg', collide=False,
                         parts=[part('props', key, (X1 - 0.004 - D / 2, y, ZC), -90)]))

NONE = {'id': 'none', 'name': 'Нет'}
zone = {'zone': 'room3', 'title': 'Кабинет', 'room': 'room3', 'slots': [
    {'id': 'desk', 'label': 'Стол', 'default': 'tonstad-120', 'options': [NONE] + desk_opts},
    {'id': 'chair', 'label': 'Рабочее кресло', 'default': 'alefjall', 'options': [NONE] + chair_opts},
    {'id': 'computer', 'label': 'Компьютер', 'default': 'monitor-laptop', 'options': [NONE] + comp_opts},
    {'id': 'lamp', 'label': 'Настольная лампа', 'default': 'ranarp', 'options': [NONE] + lamp_opts},
    {'id': 'shelving', 'label': 'Стеллаж', 'default': 'billy-200-walnut', 'options': [NONE] + shelf_opts},
    {'id': 'reading', 'label': 'Кресло для чтения', 'default': 'lillesater', 'options': [NONE] + read_opts},
    {'id': 'rug', 'label': 'Ковёр', 'default': 'jarnvag', 'options': [NONE] + rug_opts},
    {'id': 'plant', 'label': 'Растение', 'default': 'fejka-ficus', 'options': [NONE] + plant_opts},
    {'id': 'art', 'label': 'Картина', 'default': 'knoppang-botanic', 'options': [NONE] + art_opts},
]}
json.dump(zone, open(ROOT + '/web/spec/decor/room3.json', 'w'), ensure_ascii=False, indent=1)

# ================= checks =================
def model_of(p): return p['model'].split('/')[-2]
DM = {'room3/strandmon': 'strandmon-leather', 'room3/mittzon-120': 'mittzon-120-oak', 'room3/arstid': 'arstid-floor',
      'props/dypsis-lutescens-24': 'dypsis', 'props/klynnon-24': 'klynnon', 'props/strelitzia-19': 'strelitzia',
      'props/hasselbukett-19': 'hasselbukett'}
def pdims(p):
    k = '/'.join(p['model'].split('/')[-3:-1]); return dims[DM.get(k, k.split('/')[1])]
def pfoot(p):
    W, H, D = pdims(p); return foot((p['pos'][0], p['pos'][2]), p['rot'], W, D)
def pt_seg(p, a, b):
    ax, az = a; bx, bz = b; px, pz = p
    dx, dz = bx - ax, bz - az; t = max(0, min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
    return math.hypot(px - ax - t * dx, pz - az - t * dz)
def poly_dist(P, Q):
    # 0 if overlapping (SAT for convex quads), else min edge distance
    def axes(Pg): return [(-(Pg[(i + 1) % len(Pg)][1] - Pg[i][1]), Pg[(i + 1) % len(Pg)][0] - Pg[i][0]) for i in range(len(Pg))]
    sep = False
    for ax in axes(P) + axes(Q):
        a = [x * ax[0] + z * ax[1] for x, z in P]; b = [x * ax[0] + z * ax[1] for x, z in Q]
        if max(a) < min(b) or max(b) < min(a): sep = True; break
    if not sep: return 0.0
    return min(min(pt_seg(p, Q[i], Q[(i + 1) % 4]) for p in P for i in range(4)),
               min(pt_seg(q, P[i], P[(i + 1) % 4]) for q in Q for i in range(4)))
def sector_hit(poly, hinge, r, qx, qz, samples=60):
    """distance margin of polygon to a door sector (quarter disc) — negative = intrudes."""
    hx, hz = hinge; worst = 9
    pts = [(poly[i][0] + (poly[(i + 1) % 4][0] - poly[i][0]) * t / samples, poly[i][1] + (poly[(i + 1) % 4][1] - poly[i][1]) * t / samples)
           for i in range(4) for t in range(samples)]
    for x, z in pts:
        if (x - hx) * qx >= -0.001 and (z - hz) * qz >= -0.001:
            worst = min(worst, math.hypot(x - hx, z - hz) - r)
    return worst
log = []
def chk(name, ok, val=''):
    log.append(('OK  ' if ok else 'FAIL') + f' {name} {val}')

slots = {s['id']: s for s in zone['slots']}
for s in zone['slots']:
    for o in s['options'][1:]:
        for i, p in enumerate(o['parts']):
            F = pfoot(p); xs = [x for x, z in F]; zs = [z for x, z in F]
            plantish = s['id'] == 'plant'
            tol = 0.12 if plantish else 0.002
            if p['pos'][1] < 0.3 or s['id'] in ('computer', 'lamp'):
                inside = min(xs) >= X0 - tol and max(xs) <= X1 + tol and min(zs) >= Z0 - tol and max(zs) <= Z1 + tol
                if i == 0 or s['id'] != 'shelving':
                    chk(f'in room  {s["id"]}:{o["id"]}:{model_of(p)}', inside, f'x {min(xs):.3f}..{max(xs):.3f} z {min(zs):.3f}..{max(zs):.3f}')
                if p['pos'][1] < 0.3 and s['id'] != 'rug':
                    mb = sector_hit(F, BAL_H, BAL_R, 1, 1); md = sector_hit(F, DOOR_H, DOOR_R, 1, -1)
                    if plantish and i > 0: continue
                    chk(f'swings   {s["id"]}:{o["id"]}:{model_of(p)}', mb > 0.02 and md > 0.02, f'balcony {mb:+.3f} door {md:+.3f}')
        if s['id'] == 'rug':
            F = pfoot(o['parts'][0])
            mb = sector_hit(F, BAL_H, BAL_R, 1, 1); md = sector_hit(F, DOOR_H, DOOR_R, 1, -1)
            chk(f'rug swings {o["id"]}', mb > 0.0 and md > 0.0, f'balcony {mb:+.3f} door {md:+.3f}')
# desk-top items on every desk
for d in slots['desk']['options'][1:]:
    x0, x1, z0, z1, H = desk_rects[d['id']]
    chk(f'desk top {d["id"]}', abs(H - TOP) < 0.006, f'H={H}')
    for s in ('computer', 'lamp'):
        for o in slots[s]['options'][1:]:
            for p in o['parts']:
                W, Hh, D = pdims(p)
                base_d = D if model_of(p) not in ('ranarp', 'skurup', 'forsa', 'isnalen') else 0.18   # lamp base only
                F = foot((p['pos'][0] if model_of(p) not in ('ranarp', 'skurup', 'forsa', 'isnalen') else X1 - 0.03 - 0.09, p['pos'][2]), p['rot'], W if base_d == D else 0.17, base_d)
                xs = [x for x, z in F]; zs = [z for x, z in F]
                chk(f'on desk  {d["id"]} {s}:{o["id"]}:{model_of(p)}', min(xs) >= x0 - 0.005 and max(xs) <= x1 + 0.005 and min(zs) >= z0 - 0.005 and max(zs) <= z1 + 0.005,
                    f'x {min(xs):.3f}..{max(xs):.3f} (desk {x0:.3f}..{x1:.3f}) z {min(zs):.3f}..{max(zs):.3f} (desk {z0:.3f}..{z1:.3f})')
# desk-top items must not overlap each other
for o in slots['computer']['options'][1:]:
    for l in slots['lamp']['options'][1:]:
        Fl = foot((X1 - 0.03 - 0.09, l['parts'][0]['pos'][2]), -90, 0.17, 0.18)
        dmin = min(poly_dist(pfoot(p), Fl) for p in o['parts'])
        chk(f'lamp base vs {o["id"]}:{l["id"]}', dmin > 0.01, f'{dmin:.3f}')
# floor items vs each other (all option combos)
floor_slots = ['desk', 'chair', 'shelving', 'reading', 'plant']
for a, b in itertools.combinations(floor_slots, 2):
    worst = 9
    for oa in slots[a]['options'][1:]:
        for ob in slots[b]['options'][1:]:
            pa = [p for p in oa['parts'] if p['pos'][1] < 0.3][:3 if a == 'reading' else 1]
            pb = [p for p in ob['parts'] if p['pos'][1] < 0.3][:3 if b == 'reading' else 1]
            for p in pa:
                for q in pb:
                    worst = min(worst, poly_dist(pfoot(p), pfoot(q)))
    lim = 0.0 if {a, b} == {'desk', 'chair'} or 'plant' in (a, b) else 0.05
    chk(f'gap {a}<->{b}', worst > lim or ({a, b} == {'desk', 'chair'}), f'min {worst:.3f}')
# walkway: library front to office-chair back, and library to reading corner
lib_front = max(x for o in slots['shelving']['options'][1:] for x, z in pfoot(o['parts'][0]))
chair_back = min(x for o in slots['chair']['options'][1:] for x, z in pfoot(o['parts'][0]))
arm_minx = min(x for o in slots['reading']['options'][1:] for p in o['parts'] for x, z in pfoot(p))
chk('walkway library -> office chair (>=0.80)', chair_back - lib_front >= 0.80, f'{chair_back - lib_front:.3f}')
chk('walkway library -> reading corner (>=0.80)', arm_minx - lib_front >= 0.80, f'{arm_minx - lib_front:.3f}')
desk_end = max(r[3] for r in desk_rects.values())
arm_minz = min(z for o in slots['reading']['options'][1:] for z in [zz for xx, zz in pfoot(o['parts'][0])])
chk('desk end -> armchair', arm_minz - desk_end > 0.1, f'{arm_minz - desk_end:.3f}')
print('\n'.join(l for l in log if l.startswith('FAIL')) or 'ALL CHECKS PASS')
print(f'{sum(l.startswith("OK") for l in log)} ok, {sum(l.startswith("FAIL") for l in log)} fail')
for l in log:
    if 'walkway' in l or 'gap' in l or 'desk end' in l or 'rug swings jarnvag' in l: print(l)
open(PNG.replace('.png', '.log'), 'w').write('\n'.join(log))

# ================= plot =================
S, PAD = 220, 40
Wpx = int((X1 - X0) * S) + 2 * PAD; Hpx = int((Z1 - Z0) * S) + 2 * PAD
img = Image.new('RGB', (Wpx, Hpx), (250, 249, 246)); g = ImageDraw.Draw(img)
T = lambda x, z: (PAD + (x - X0) * S, PAD + (z - Z0) * S)
g.rectangle([T(X0, Z0), T(X1, Z1)], outline=(60, 60, 60), width=3)
g.line([T(bd['x0'], 0), T(bd['x1'], 0)], fill=(80, 140, 220), width=7)
g.line([T(rd['x0'], Z1), T(rd['x1'], Z1)], fill=(160, 110, 60), width=7)
def arc(h, r, a0, a1, col):
    pts = [T(h[0] + r * math.cos(math.radians(a)), h[1] + r * math.sin(math.radians(a))) for a in range(a0, a1 + 1, 3)]
    g.line([T(*h)] + pts + [T(*h)], fill=col, width=2)
arc(BAL_H, BAL_R, 0, 90, (80, 140, 220)); arc(DOOR_H, DOOR_R, 270, 360, (160, 110, 60))
cols = {'desk': (190, 150, 100), 'chair': (170, 90, 50), 'computer': (40, 40, 40), 'lamp': (230, 200, 120),
        'shelving': (110, 70, 50), 'reading': (200, 190, 160), 'rug': (220, 200, 170), 'plant': (80, 150, 80), 'art': (90, 90, 160)}
order = ['rug', 'shelving', 'desk', 'chair', 'reading', 'plant', 'computer', 'lamp', 'art']
for sid in order:
    s = slots[sid]
    for o in s['options'][1:]:
        default = o['id'] == s['default']
        for p in o['parts']:
            if sid == 'shelving' and p is not o['parts'][0] and not default: continue
            F = [T(*q) for q in pfoot(p)]
            if default: g.polygon(F, fill=cols[sid], outline=(30, 30, 30))
            else: g.polygon(F, outline=cols[sid])
g.text((PAD, 8), 'room3 top view: z down = into the flat; window wall on top. filled = defaults, outlines = other options', fill=(0, 0, 0))
img.save(PNG)
