"""GLB из конфигуратора -> сцена Blender (Cycles) -> рендер и .blend.

    blender -b -P blender/render.py -- --glb exports/kitchen-v1-....glb --view living \
        --out renders/living.png [--samples 128] [--res 1920x1080] [--light day|evening] \
        [--sun-az 25] [--date 2026-11-15 --time 14:00] [--context] [--save blender/kitchen.blend]

--date/--time: настоящее солнце Варшавы (местное время с летним, web/spec/site.json): небо поворачивается
    по его азимуту, солнце панорамы срезается и заменяется лампой-солнцем той же энергии на настоящей высоте.
    Без --light режим выбирается сам: солнце выше 2° — day, иначе evening.
--context: окружение из web/spec/site.json, как в браузере (js/site.js): земля, дороги, свой дом вокруг
    квартиры, соседи. Даёт верные тени от верхних этажей и вид из окна.

GLB выгружается кнопкой «Модель GLB для Blender» (локальный сервер кладёт его в exports/).
Ракурсы берутся из web/spec/views.json, проёмы для порталов света — из web/spec/plan.generated.json.
Оси: three.js (x, y, z) -> Blender (x, -z, y).
"""
import argparse
import json
import math
import pathlib
import sys

import bpy
import numpy as np
from mathutils import Vector

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPEC = ROOT / "web" / "spec"


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--glb", required=True)
    p.add_argument("--view", default="living")
    p.add_argument("--out", default="renders/render.png")
    p.add_argument("--samples", type=int, default=128)
    p.add_argument("--res", default="1920x1080")
    p.add_argument("--light", default=None, choices=["day", "overcast", "evening"])
    p.add_argument("--sun-az", type=float, default=None)
    p.add_argument("--date", default="", help="YYYY-MM-DD, местная дата в Варшаве")
    p.add_argument("--time", default="12:00", help="HH:MM, местное время (CET/CEST)")
    p.add_argument("--context", action="store_true", help="окружение из web/spec/site.json")
    p.add_argument("--save", default="")
    return p.parse_args(argv)


def b(v):  # three.js -> Blender
    return Vector((v[0], -v[2], v[1]))


def glass_tint(rgb, keep=0.12):
    """Цвет стекла браузера -> цвет пропускания для Cycles.

    В браузере стекло — тёмная почти прозрачная плёнка (glass #1c2224, opacity 0.12): тёмный base color
    там значит «оттенок отражения». В Cycles base color при Transmission = цвет пропускания, и тёмный
    делает стекло чёрным: комната без неба и солнца, светятся только щели между стеклом и рамой.
    Берём от исходного цвета только оттенок (нормированный к белому) и подмешиваем его слегка.
    """
    peak = max(max(rgb[:3]), 1e-6)
    return tuple((1 - keep) * 0.98 + keep * (c / peak) * 0.98 for c in rgb[:3]) + (1.0,)


def make_thin_glass(m, bsdf):
    """Тонкое оконное стекло: камере и отражениям — настоящее стекло (Principled, Transmission 1),
    теневым лучам — прозрачно с тем же оттенком. Иначе солнце и небо через закрытое окно не светят:
    точечное солнце не проходит через преломление (каустику), в комнату падали бы только полоски из щелей."""
    nt = m.node_tree
    tint = glass_tint(list(bsdf.inputs["Base Color"].default_value))
    for l in list(bsdf.inputs["Base Color"].links) + list(bsdf.inputs["Alpha"].links):
        nt.links.remove(l)
    bsdf.inputs["Base Color"].default_value = tint
    bsdf.inputs["Transmission Weight"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.0
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Alpha"].default_value = 1.0
    bsdf.inputs["IOR"].default_value = 1.5
    out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None) \
        or next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    clear = nt.nodes.new("ShaderNodeBsdfTransparent")
    clear.inputs["Color"].default_value = tint
    path = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(path.outputs["Is Shadow Ray"], mix.inputs["Fac"])
    nt.links.new(bsdf.outputs["BSDF"], mix.inputs[1])
    nt.links.new(clear.outputs["BSDF"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    if hasattr(m, "surface_render_method"):   # для EEVEE/вьюпорта; Cycles это не читает
        m.surface_render_method = "DITHERED"


def fix_materials():
    # Стекло узнаём и по имени материала (glass, bathGlass), и по метке userData.glass на объекте
    glass_mats = {m for m in bpy.data.materials if "glass" in m.name.lower()}
    for o in bpy.data.objects:
        if o.type == "MESH" and o.get("glass"):
            glass_mats.update(s.material for s in o.material_slots if s.material)
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        name = m.name.lower()
        if m in glass_mats:
            make_thin_glass(m, bsdf)
            print(f"glass material {m.name}: tint {tuple(round(c, 3) for c in bsdf.inputs['Base Color'].default_value[:3])}")
        if name.startswith("shadow"):
            m.user_clear()


# ---------- солнце Варшавы (тот же алгоритм NOAA, что sunFor в web/js/site.js) ----------

def _last_sunday(y, month):
    import calendar
    last = calendar.monthrange(y, month)[1]
    return last - (calendar.weekday(y, month, last) + 1) % 7


def warsaw_to_utc(date_iso, hours):
    """Местное время Варшавы -> datetime UTC (летнее время ЕС: последние воскресенья марта и октября, 01:00 UTC)."""
    import datetime as dt
    y, m, d = (int(v) for v in date_iso.split("-"))
    base = dt.datetime(y, m, d, tzinfo=dt.timezone.utc) + dt.timedelta(hours=hours)
    start = dt.datetime(y, 3, _last_sunday(y, 3), 1, tzinfo=dt.timezone.utc)
    end = dt.datetime(y, 10, _last_sunday(y, 10), 1, tzinfo=dt.timezone.utc)
    summer = base - dt.timedelta(hours=2)
    return (summer, "CEST") if start <= summer < end else (base - dt.timedelta(hours=1), "CET")


def solar_position(utc, lat, lon):
    """-> (азимут от севера по часовой, высота с рефракцией, геометрическая высота), градусы."""
    r = math.radians
    jd = utc.timestamp() / 86400 + 2440587.5
    T = (jd - 2451545) / 36525
    L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360
    M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
    e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
    C = (math.sin(r(M)) * (1.914602 - T * (0.004817 + 0.000014 * T))
         + math.sin(r(2 * M)) * (0.019993 - 0.000101 * T) + math.sin(r(3 * M)) * 0.000289)
    omega = 125.04 - 1934.136 * T
    lam = L0 + C - 0.00569 - 0.00478 * math.sin(r(omega))
    eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60
    eps = eps0 + 0.00256 * math.cos(r(omega))
    decl = math.asin(math.sin(r(eps)) * math.sin(r(lam)))
    yv = math.tan(r(eps) / 2) ** 2
    eqt = 4 * math.degrees(yv * math.sin(r(2 * L0)) - 2 * e * math.sin(r(M))
                           + 4 * e * yv * math.sin(r(M)) * math.cos(r(2 * L0))
                           - 0.5 * yv * yv * math.sin(r(4 * L0)) - 1.25 * e * e * math.sin(r(2 * M)))
    minutes = (utc.timestamp() / 60) % 1440
    tst = (minutes + eqt + 4 * lon) % 1440
    ha = r(tst / 4 - 180)
    phi = r(lat)
    cosz = max(-1, min(1, math.sin(phi) * math.sin(decl) + math.cos(phi) * math.cos(decl) * math.cos(ha)))
    el = 90 - math.degrees(math.acos(cosz))
    az = (math.degrees(math.atan2(math.sin(ha), math.cos(ha) * math.sin(phi) - math.tan(decl) * math.cos(phi))) + 180) % 360
    t = math.tan(r(el))
    if el > 85:
        ref = 0
    elif el > 5:
        ref = 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5
    elif el > -0.575:
        ref = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)))
    else:
        ref = -20.772 / t
    return az, el + ref / 3600, el


def sun_for(date_iso, time_hm, site):
    """Солнце в соглашении приложения: az 0 = прямо из окна, + вправо (если смотреть наружу)."""
    h, mnt = (int(v) for v in time_hm.split(":"))
    utc, tz = warsaw_to_utc(date_iso, h + mnt / 60)
    az_abs, el, _ = solar_position(utc, site["lat"], site["lon"])
    az = (az_abs - site["windowBearingDeg"] + 180) % 360 - 180
    return {"az": az, "el": el, "azAbs": az_abs, "tz": tz, "utc": utc}


# ---------- небо ----------

def hdri_sun_energy(img):
    """Срезает солнце панорамы: порог яркости и энергия над ним (освещённость, Вт/м², по каналам).

    Порог — вдвое выше 99.9-го процентиля верхней полусферы: облака и ореол остаются, диск солнца уходит.
    """
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    rgb = px.reshape(h, w, 4)[..., :3]                                # строки снизу вверх
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    clamp = float(2 * np.percentile(lum[h // 2:], 99.9))
    lat = (np.arange(h) + 0.5) / h * math.pi - math.pi / 2
    d_omega = (2 * math.pi / w) * (math.pi / h) * np.cos(lat)[:, None, None]
    excess = np.maximum(rgb - clamp, 0) * d_omega
    return clamp, excess.reshape(-1, 3).sum(0)


def air_mass(el):
    z = 90 - max(el, 0.5)
    return 1 / (math.cos(math.radians(z)) + 0.50572 * (96.07995 - z) ** -1.6364)   # Kasten–Young


def setup_world(light, az, el=None):
    """HDRI-небо, повёрнутое так, чтобы его солнце стояло по азимуту az.

    Положение солнца на панораме записано в web/textures/hdri/<name>.json (tools/hdri_sun.py).
    Без el высоту солнца задаёт сама панорама (день ~44°), отдельной лампы нет: иначе две тени.
    С el (режим --date) солнце панорамы срезается порогом, а его энергия уходит в лампу-солнце
    на настоящей высоте; цвет и сила пересчитаны на толщу воздуха (низкое солнце краснее и слабее).
    """
    hdri = ROOT / "web" / "textures" / "hdri"
    name = light if (hdri / f"{light}.hdr").exists() else ("evening" if light == "evening" else "day")
    sun_uv = json.loads((hdri / f"{name}.json").read_text())
    w = bpy.data.worlds.new("World") if not bpy.context.scene.world else bpy.context.scene.world
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(str(hdri / f"{name}.hdr"))
    # Желаемое направление на солнце (Blender) и его координата u на панораме
    a = math.radians(az)
    u_want = math.atan2(math.cos(a), -math.sin(a)) / (2 * math.pi) + 0.5
    mapping.inputs["Rotation"].default_value[2] = 2 * math.pi * (u_want - sun_uv["u"])
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = {"day": 1.0, "overcast": 0.8, "evening": 0.25}[light]
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], env.inputs["Vector"])
    color = env.outputs["Color"]
    if el is not None and light == "day":
        clamp, e_rgb = hdri_sun_energy(env.image)
        mn = nt.nodes.new("ShaderNodeVectorMath")
        mn.operation = "MINIMUM"
        mn.inputs[1].default_value = (clamp, clamp, clamp)
        nt.links.new(color, mn.inputs[0])
        color = mn.outputs["Vector"]
        if el > 0.5:
            tau = np.array([0.10, 0.17, 0.30])   # оптическая толща ясного неба (R, G, B)
            e_rgb = e_rgb * np.exp(-tau * (air_mass(el) - air_mass(sun_uv["elevation"])))
            strength = float(e_rgb @ np.array([0.2126, 0.7152, 0.0722]))
            L = bpy.data.lights.new("Sun", "SUN")
            L.energy = strength * bg.inputs["Strength"].default_value
            L.color = tuple(float(c) for c in e_rgb / max(e_rgb.max(), 1e-9))
            L.angle = math.radians(0.53)
            ob = bpy.data.objects.new("Sun", L)
            bpy.context.collection.objects.link(ob)
            # направление на солнце: three (sin az cos el, sin el, −cos az cos el) -> Blender (x, −z, y)
            d = Vector((math.sin(a) * math.cos(math.radians(el)), math.cos(a) * math.cos(math.radians(el)), math.sin(math.radians(el))))
            ob.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
            print(f"sun lamp {L.energy:.1f} W/m², color {tuple(round(c, 2) for c in L.color)}, HDRI clamp {clamp:.1f}")
    nt.links.new(color, bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


# ---------- окружение (как buildContext в web/js/site.js) ----------

WIN = {"tile": 2.4, "w": 1.3, "sill": 0.9, "head": 2.2}
COLORS = {"ground": "6c7049", "field": "8c7b5a", "grass": "667444", "dirt": "86745f", "paved": "8d8c88",
          "road": "4a4b4d", "path": "a29d93", "own": "dcd6cc", "neighbour": "cdc8bf", "roof": "7f7c78",
          "balcony": "bdb8b0"}


def srgb(hexstr):
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c) + (1.0,)


def material(name, hexstr, windows=False, vertex_color=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = srgb(hexstr)
    bsdf.inputs["Roughness"].default_value = 0.92
    if windows:
        # Ряды окон по UV (u — метры вдоль фасада / шаг окон, v — этажи): тёмное стекло, чуть блестит
        uv = nt.nodes.new("ShaderNodeUVMap")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(uv.outputs["UV"], sep.inputs[0])

        def band(src, lo, hi):
            fr = nt.nodes.new("ShaderNodeMath"); fr.operation = "FRACT"
            nt.links.new(src, fr.inputs[0])
            g1 = nt.nodes.new("ShaderNodeMath"); g1.operation = "GREATER_THAN"; g1.inputs[1].default_value = lo
            l1 = nt.nodes.new("ShaderNodeMath"); l1.operation = "LESS_THAN"; l1.inputs[1].default_value = hi
            nt.links.new(fr.outputs[0], g1.inputs[0]); nt.links.new(fr.outputs[0], l1.inputs[0])
            mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"
            nt.links.new(g1.outputs[0], mul.inputs[0]); nt.links.new(l1.outputs[0], mul.inputs[1])
            return mul.outputs[0]

        cu = (WIN["tile"] - WIN["w"]) / 2 / WIN["tile"]
        mask = nt.nodes.new("ShaderNodeMath"); mask.operation = "MULTIPLY"
        nt.links.new(band(sep.outputs["X"], cu, 1 - cu), mask.inputs[0])
        nt.links.new(band(sep.outputs["Y"], WIN["sill"] / 3.1, WIN["head"] / 3.1), mask.inputs[1])
        mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
        mix.inputs["A"].default_value = srgb(hexstr)
        if vertex_color:   # цвет дома из site.json (атрибут Col)
            at = nt.nodes.new("ShaderNodeAttribute"); at.attribute_name = "Col"
            nt.links.new(at.outputs["Color"], mix.inputs["A"])
        mix.inputs["B"].default_value = srgb("2f353d")
        nt.links.new(mask.outputs[0], mix.inputs["Factor"])
        nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
        rmix = nt.nodes.new("ShaderNodeMapRange")
        rmix.inputs["To Min"].default_value, rmix.inputs["To Max"].default_value = 0.92, 0.15
        nt.links.new(mask.outputs[0], rmix.inputs["Value"])
        nt.links.new(rmix.outputs["Result"], bsdf.inputs["Roughness"])
    return m


def to_b(x, y, z):   # three.js -> Blender
    return (x, -z, y)


def mesh_object(name, verts, faces, uvs, mat, coll, colors=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    if colors:   # цвет каждой грани (линейный RGBA) -> атрибут Col на углах
        attr = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
        for poly, c in zip(me.polygons, colors):
            for li in poly.loop_indices:
                attr.data[li].color = c
    if uvs:
        layer = me.uv_layers.new(name="UVMap")
        for poly, uv_face in zip(me.polygons, uvs):
            for li, uv in zip(poly.loop_indices, uv_face):
                layer.data[li].uv = uv
    me.validate()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def prisms(items, storey, vbase):
    """[(poly, y0, y1[, цвет[, глухой]])] -> вершины, грани, uv, цвета граней; стены — по грани на ребро,
    крыша и дно — n-угольники. Глухой фасад: вся стена в полосе ниже подоконника (как в site.js)."""
    V, F, U, C = [], [], [], []
    for poly, y0, y1, *col in items:
        if len(poly) < 3 or y1 <= y0:
            continue
        storey_i = (y1 - y0) / 0.25 if len(col) > 1 and col[1] else storey
        ar = sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(poly, poly[1:] + poly[:1]))
        pts = poly if ar > 0 else poly[::-1]   # против часовой в (x, z) three = по часовой в (x, y) Blender
        n0 = len(V)
        for x, z in pts:
            V.append(to_b(x, y0, z))
        for x, z in pts:
            V.append(to_b(x, y1, z))
        n = len(pts)
        run = 0.0
        for i in range(n):
            j = (i + 1) % n
            L = math.dist(pts[i], pts[j])
            F.append((n0 + i, n0 + j, n0 + n + j, n0 + n + i))
            u0, u1 = run / WIN["tile"], (run + L) / WIN["tile"]
            v0, v1 = (y0 - vbase) / storey_i, (y1 - vbase) / storey_i
            U.append([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
            run += L
        F.append(tuple(n0 + n + i for i in range(n)))          # крыша
        U.append([(x / 4, z / 4) for x, z in pts])
        F.append(tuple(n0 + i for i in reversed(range(n))))    # дно
        U.append([(x / 4, z / 4) for x, z in reversed(pts)])
        C += [col[0] if col else (1, 1, 1, 1)] * (n + 2)
    return V, F, U, C


def fix_normals(ob):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()


def strip(line, w, y):
    """Полоса дороги по ломаной со стыками «в ус» (как strip в site.js)."""
    h, n = w / 2, len(line)
    nor = []
    for i in range(n - 1):
        dx, dz = line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]
        L = math.hypot(dx, dz) or 1
        nor.append((-dz / L, dx / L))
    off = []
    for i, p in enumerate(line):
        a, c = nor[max(0, i - 1)], nor[min(n - 2, i)]
        mx, mz = a[0] + c[0], a[1] + c[1]
        ml = math.hypot(mx, mz) or 1
        mx, mz = mx / ml, mz / ml
        k = h / max(0.5, mx * c[0] + mz * c[1])
        off.append(((p[0] + mx * k, p[1] + mz * k), (p[0] - mx * k, p[1] - mz * k)))
    quads = []
    for i in range(n - 1):
        (a, b2), (c, d) = off[i], off[i + 1]
        quads.append([to_b(a[0], y, a[1]), to_b(c[0], y, c[1]), to_b(d[0], y, d[1]), to_b(b2[0], y, b2[1])])
    return quads


def drop_outside(plan, margin=3.0):
    """Убирает из GLB меши целиком вне квартиры с балконом: старые выгрузки несли
    свою «землю» и дома-заглушки, с --context они бы задвоились."""
    b, bal = plan["bounds"], plan["balcony"]
    x0, x1 = min(b["x0"], bal["x0"]) - margin, max(b["x1"], bal["x1"]) + margin
    z0, z1 = min(b["z0"], bal["z0"]) - margin, max(b["z1"], bal["z1"]) + margin
    gone = 0
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            continue
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        xs = [v.x for v in bb]
        zs = [-v.y for v in bb]          # Blender y = −z three
        if max(xs) < x0 or min(xs) > x1 or max(zs) < z0 or min(zs) > z1 or min(v.z for v in bb) < -3:
            bpy.data.objects.remove(o)
            gone += 1
    if gone:
        print(f"removed {gone} stale outside meshes from GLB")


def build_context(site, view_id):
    """То же окружение, что buildContext в браузере. Над квартирой при виде сверху: невидимо, но с тенью."""
    coll = bpy.data.collections.new("context")
    bpy.context.scene.collection.children.link(coll)
    fy = site["floorY"]
    ground = -fy
    st, vb = site.get("storeyH", 3.0), ground + site.get("groundRise", 0.0)
    mats = {k: material(k, v) for k, v in COLORS.items()}
    mats["own"] = material("own", COLORS["own"], windows=True)
    mats["neighbour"] = material("neighbour", COLORS["neighbour"], windows=True, vertex_color=True)

    bpy.ops.mesh.primitive_circle_add(vertices=96, radius=2500, fill_type="NGON", location=(0, 0, ground))
    g = bpy.context.active_object
    g.name = "ground"
    g.data.materials.append(mats["ground"])
    for o in list(g.users_collection):
        o.objects.unlink(g)
    coll.objects.link(g)

    lift = {"field": 0.02, "grass": 0.02, "dirt": 0.02, "paved": 0.03}
    by_kind = {}
    for a_ in site.get("areas", []):
        by_kind.setdefault(a_["kind"], []).append(a_["poly"])
    for kind, polys in by_kind.items():
        V, F = [], []
        for poly in polys:
            n0 = len(V)
            V += [to_b(x, ground + lift[kind], z) for x, z in poly]
            F.append(tuple(range(n0, n0 + len(poly))))
        ob = mesh_object(f"area_{kind}", V, F, None, mats[kind], coll)
        ob.visible_shadow = False

    for kind, test, z_ in (("road", lambda k: k not in ("footway", "cycleway", "path"), 0.04),
                           ("path", lambda k: k in ("footway", "cycleway", "path"), 0.05)):
        V, F = [], []
        for r in site.get("roads", []):
            if not test(r["kind"]) or len(r["line"]) < 2:
                continue
            for q in strip(r["line"], r["w"], ground + z_):
                F.append(tuple(range(len(V), len(V) + 4)))
                V += q
        ob = mesh_object(f"{kind}s", V, F, None, mats[kind], coll)
        ob.visible_shadow = False
        fix_normals(ob)

    def solid(name, items, mat, storey, vbase):
        V, F, U, C = prisms(items, storey, vbase)
        if not F:
            return None
        ob = mesh_object(name, V, F, U, mat, coll, C if any(len(i) > 3 for i in items) else None)
        fix_normals(ob)
        return ob

    mass = site.get("ownMass", [])
    solid("own", [(m["poly"], m["y0"], m["y1"]) for m in mass if m["part"] != "above"], mats["own"], st, vb)
    above = solid("own_above", [(m["poly"], m["y0"], m["y1"]) for m in mass if m["part"] == "above"], mats["own"], st, vb)
    if above and view_id == "top":
        above.visible_camera = False
    solid("own_balconies", [([[b["x0"], b["z0"]], [b["x1"], b["z0"]], [b["x1"], b["z1"]], [b["x0"], b["z1"]]], b["y0"], b["y1"])
                            for b in site.get("ownBalconies", [])], mats["balcony"], 3.0, 0.0)
    solid("neighbours", [(b["poly"], ground, ground + b["h"], srgb(b.get("c", COLORS["neighbour"])), b.get("plain", False)) for b in site.get("neighbours", [])], mats["neighbour"], 3.0, ground)
    far = solid("far", [(b["poly"], ground, ground + b["h"], srgb(b.get("c", COLORS["neighbour"])), b.get("plain", False)) for b in site.get("far", [])], mats["neighbour"], 3.0, ground)
    if far:
        far.visible_shadow = False
    print("context:", len(coll.objects), "objects")


def add_portals(plan):
    for o in plan["openings"]:
        if o["type"] in ("entry", "interior"):   # порталы только в наружных проёмах
            continue
        L = bpy.data.lights.new(f"portal_{o['id']}", "AREA")
        L.shape = "RECTANGLE"
        L.size, L.size_y = o["width"], o["head"] - o["sill"]
        L.cycles.is_portal = True
        ob = bpy.data.objects.new(L.name, L)
        bpy.context.collection.objects.link(ob)
        y = (o["sill"] + o["head"]) / 2
        if o["along"] == "x":
            ob.location = b([(o["x0"] + o["x1"]) / 2, y, -0.02])
            ob.rotation_euler = (math.radians(-90), 0, 0)   # смотрит внутрь (+Z three = -Y Blender)
        else:
            ob.location = b([6.19, y, (o["z0"] + o["z1"]) / 2])
            ob.rotation_euler = (0, math.radians(-90), 0)


def add_camera(view):
    cam = bpy.data.cameras.new("Camera")
    cam.sensor_fit = "VERTICAL"
    cam.angle_y = math.radians(view.get("fov", 60))
    cam.clip_start = 0.05
    cam.clip_end = 5000   # дальние дома окружения (--context) стоят до 2 км
    ob = bpy.data.objects.new("Camera", cam)
    bpy.context.collection.objects.link(ob)
    ob.location = b(view["pos"])
    ob.rotation_euler = (b(view["target"]) - ob.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = ob


def main():
    a = args()
    plan = json.loads((SPEC / "plan.generated.json").read_text())
    views = {v["id"]: v for v in json.loads((SPEC / "views.json").read_text())["views"]}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(pathlib.Path(a.glb).resolve()))
    fix_materials()
    site = json.loads((SPEC / "site.json").read_text()) if (a.date or a.context) else None
    az, el, light = (25 if a.sun_az is None else a.sun_az), None, a.light or "day"
    if a.date:
        sun = sun_for(a.date, a.time, site)
        az = sun["az"] if a.sun_az is None else a.sun_az
        el = sun["el"]
        light = a.light or ("day" if el > 2 else "evening")
        print(f"sun {a.date} {a.time} {sun['tz']}: azimuth {sun['azAbs']:.1f}° (app {sun['az']:+.1f}°), "
              f"elevation {el:.1f}°, light={light}")
    setup_world(light, az, el)
    if a.context:
        drop_outside(plan)
        build_context(site, a.view)
    add_portals(plan)
    add_camera(views[a.view])
    if a.view == "top":   # как в браузере: сверху потолок не виден камере, но тень даёт
        for o in bpy.data.objects:
            if o.name.startswith("ceiling"):
                o.visible_camera = False

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = "GPU"
    except Exception:
        sc.cycles.device = "CPU"
    sc.cycles.samples = a.samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 8
    w, h = (int(x) for x in a.res.split("x"))
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Base Contrast" if "AgX - Base Contrast" in [i.identifier for i in sc.view_settings.bl_rna.properties["look"].enum_items] else "None"
    sc.view_settings.exposure = {"day": 1.5, "overcast": 1.8, "evening": 1.4}[light]
    out = pathlib.Path(a.out)
    out = out if out.is_absolute() else ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)
    sc.render.filepath = str(out)
    if a.save:
        save = pathlib.Path(a.save)
        save = save if save.is_absolute() else ROOT / save
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=str(save), compress=True)
    bpy.ops.render.render(write_still=True)
    print("rendered", out)


main()
