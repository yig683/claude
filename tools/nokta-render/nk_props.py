"""Story props: glyphs, sparkles, confetti, sweat drop, floating 'computer window', accessories."""
import math
import random
import numpy as np
import bpy
from mathutils import Matrix, Vector

import nk_scene as S
from nk_sdf import (smin, sphere, round_cone, box_round, rot_xyz, extract, local)


def _place(ob, loc, rot=(0, 0, 0), scale=1.0):
    ob.location = loc
    ob.rotation_euler = rot
    ob.scale = (scale,) * 3 if np.isscalar(scale) else scale
    return ob


def gloss_material(name, hex_color, rough=0.28, coat=0.5, sss=0.25, sss_radius=(1.0, 0.5, 0.35), sheen=0.2, emission=0.0):
    return S.clay_material(name, hex_color, sss_radius=sss_radius, sss_scale=0.05, sss_weight=sss, roughness=rough,
                           coat=coat, coat_rough=0.12, sheen=sheen, bump=0.0)


# ---------------------------------------------------------------- glyphs
def glyph(text, loc, size=0.7, rot=(0, 0, 0), color='#FBF6EC', parent=None, font='/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf',
          bevel=0.035, extrude=0.05, rough=0.28):
    cu = bpy.data.curves.new('glyph_' + text, 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.bevel_resolution = 6
    cu.resolution_u = 12
    try:
        cu.font = bpy.data.fonts.load(font)
    except Exception:
        pass
    ob = bpy.data.objects.new('glyph_' + text, cu)
    S.link(ob, parent)
    cu.materials.append(gloss_material('glyph_mat_' + color, color, rough=rough))
    ob.location = loc
    ob.rotation_euler = (math.pi / 2, 0, 0)  # stand upright, facing -Y
    ob.rotation_euler = (math.pi / 2 + rot[0], rot[1], rot[2])
    return ob


# ---------------------------------------------------------------- sparkle (4-point star)
def sparkle(loc, r=0.2, color='#FFE9B8', parent=None, tilt=0.0, voxel=None):
    voxel = voxel or max(r / 22.0, 0.006)

    def f(P):
        x, y, z = P
        p = 0.58
        c, s = math.cos(tilt), math.sin(tilt)
        xr, zr = c * x - s * z, s * x + c * z
        return (np.abs(xr) ** p + (np.abs(y) * 4.2) ** p + np.abs(zr) ** p) - r ** p
    m = r * 1.15
    V, F, N = extract(f, (-m, -m * 0.5, -m), (m, m * 0.5, m), voxel, refine=0)
    mat = gloss_material('sparkle_' + color, color, rough=0.2, coat=0.6, sss=0.2)
    ob = S.mesh_object('sparkle', V, F, N, mat, parent)
    ob.location = loc
    return ob


# ---------------------------------------------------------------- confetti
def confetti(n, seed, region, colors, parent=None, size=0.085):
    rnd = random.Random(seed)
    (x0, x1), (y0, y1), (z0, z1) = region
    mats = [gloss_material('confetti_' + c, c, rough=0.35, coat=0.3, sss=0.1) for c in colors]
    out = []
    for i in range(n):
        ob = bpy.data.objects.new('confetti%d' % i, S.unit_sphere_mesh(24, 12))
        S.link(ob, parent)
        S._obj_mat(ob, rnd.choice(mats))
        ob.location = (rnd.uniform(x0, x1), rnd.uniform(y0, y1), rnd.uniform(z0, z1))
        ob.rotation_euler = (rnd.uniform(0, 6.28), rnd.uniform(0, 6.28), rnd.uniform(0, 6.28))
        s = size * rnd.uniform(0.7, 1.3)
        ob.scale = (s * 1.7, s * 0.55, s * 0.3)
        out.append(ob)
    return out


# ---------------------------------------------------------------- sweat drop
def sweat_drop(loc, r=0.1, parent=None, tilt=0.15):
    def f(P):
        x, y, z = P
        c, s = math.cos(tilt), math.sin(tilt)
        xr, zr = c * x - s * z, s * x + c * z
        d1 = sphere((xr, y, zr), (0, 0, 0), r)
        d2 = round_cone((xr, y, zr), (0, 0, 0.0), (0, 0, r * 2.3), r * 0.98, r * 0.10)
        return smin(d1, d2, r * 0.7)
    m = r * 4.2
    V, F, N = extract(f, (-r * 1.4, -r * 1.4, -r * 1.4), (r * 1.4, r * 1.4, r * 3.6), r / 14.0, refine=2)
    mat = gloss_material('drop', '#8FCBF0', rough=0.15, coat=0.8, sss=0.4, sss_radius=(0.5, 0.8, 1.0))
    ob = S.mesh_object('sweat', V, F, N, mat, parent)
    ob.location = loc
    return ob


# ---------------------------------------------------------------- floating computer window
def _rbox(name, center, half, radius, mat, parent, voxel=0.0075, R=None):
    def f(P):
        return box_round(P, (0, 0, 0), half, radius)
    m = radius + 0.02
    V, F, N = extract(f, (-half[0] - m, -half[1] - m, -half[2] - m), (half[0] + m, half[1] + m, half[2] + m), voxel, refine=2)
    ob = S.mesh_object(name, V, F, N, mat, parent)
    ob.location = center
    return ob


def window_panel(loc, rot=(0, 0, 0), scale=1.0, parent=None, accent='#E07B57'):
    root = S.empty('window', loc, (scale,) * 3, parent)
    root.rotation_euler = rot
    body_m = gloss_material('win_body', '#FBF8F2', rough=0.22, coat=0.5, sss=0.15)
    bar_m = gloss_material('win_bar', '#EAE3D8', rough=0.35, coat=0.3, sss=0.05)
    line_m = gloss_material('win_line', '#D6CEC1', rough=0.4, coat=0.2, sss=0.05)
    acc_m = gloss_material('win_acc', accent, rough=0.3, coat=0.4, sss=0.2)
    _rbox('win_panel', (0, 0, 0), (0.58, 0.028, 0.40), 0.05, body_m, root)
    _rbox('win_topbar', (0, -0.006, 0.325), (0.575, 0.030, 0.07), 0.03, bar_m, root, 0.006)
    for i, c in enumerate(('#E0674A', '#E6B450', '#9DBB8A')):
        d = gloss_material('win_dot%d' % i, c, rough=0.25, coat=0.5, sss=0.1)
        def f(P, r=0.024):
            return sphere(P, (0, 0, 0), r)
        V, F, N = extract(f, (-0.04, -0.04, -0.04), (0.04, 0.04, 0.04), 0.0035, refine=1)
        ob = S.mesh_object('win_dot%d' % i, V, F, N, d, root)
        ob.location = (-0.47 + i * 0.075, -0.036, 0.325)
    bars = [(0.40, 0.14, acc_m), (0.32, 0.03, line_m), (0.44, -0.08, line_m), (0.24, -0.19, line_m), (0.36, -0.30, line_m)]
    for k, (hw, z, m) in enumerate(bars):
        cx = -0.58 + 0.10 + hw
        _rbox('win_bar%d' % k, (cx, -0.030, z), (hw, 0.010, 0.026 if k else 0.034), 0.012, m, root, 0.004)
    return root


# ---------------------------------------------------------------- accessories
def glasses(face, parent, frame_hex='#23201D'):
    """Round glasses sitting in front of the eyes. Uses the face's projected eye centres."""
    L = face.L
    fm = S.metal_material('glasses_frame', frame_hex, rough=0.25, coat=0.8)
    lm = S.glass_material('glasses_lens', '#F4F8FF', ior=1.45, rough=0.0)
    objs = []
    centers = []
    for sx in (-1, 1):
        P, N, ok = face.hits([sx * L['ex']], [L['ey']])
        p, n = P[0], N[0]
        r_, up_ = _frame(n)
        c = p + n * (L['ry'] * 0.95 + 0.07) + np.array([0, 0, 0.012])
        centers.append((c, n, r_, up_))
        rad = L['rz'] * 1.36
        th = np.linspace(0, 2 * math.pi, 56)
        ring = np.array([c + (r_ * math.cos(t) + up_ * math.sin(t)) * rad for t in th])
        objs.append(S.tube('rim%d' % sx, ring, 0.0155, fm, parent, cap_spheres=False))
        # lens disc
        me = bpy.data.meshes.new('lens%d' % sx)
        pts = [tuple(c)] + [tuple(c + (r_ * math.cos(t) + up_ * math.sin(t)) * (rad - 0.004)) for t in th[:-1]]
        faces = [(0, i + 1, (i + 1) % (len(th) - 1) + 1) for i in range(len(th) - 1)]
        me.from_pydata(pts, [], faces)
        me.update()
        ob = bpy.data.objects.new('lens%d' % sx, me)
        S.link(ob, parent)
        me.materials.append(lm)
        objs.append(ob)
    # bridge and temples
    (c0, n0, r0, u0), (c1, n1, r1, u1) = centers
    rad = L['rz'] * 1.36
    a = c0 + r0 * rad
    b = c1 - r1 * rad
    mid = (a + b) / 2 + (n0 + n1) / 2 * 0.012 + np.array([0, 0, 0.03])
    bridge = np.array([a, mid, b])
    objs.append(S.tube('bridge', bridge, 0.0125, fm, parent))
    for sx, (c, n, r_, u_) in zip((-1, 1), centers):
        start = c + (r_ if sx > 0 else -r_) * rad
        back = start + np.array([sx * 0.14, 0.45, 0.02])
        objs.append(S.tube('temple%d' % sx, np.array([start, (start + back) / 2 + np.array([sx * 0.02, 0, 0]), back]), 0.0125, fm, parent))
    return objs


def _frame(n):
    n = np.asarray(n, np.float64)
    n = n / (np.linalg.norm(n) + 1e-12)
    r = np.cross([0, 0, 1.0], n)
    r /= np.linalg.norm(r) + 1e-12
    u = np.cross(n, r)
    return r, u


def beret(parent, color='#2B2926', top=1.0, tilt=(0.0, 0.25), size=1.0):
    """Soft knitted beret perched on the head."""
    def f(P):
        x, y, z = local(P, (0, 0, 0))
        d = ((x / (0.80 * size)) ** 2 + (y / (0.80 * size)) ** 2 + (z / (0.30 * size)) ** 2)
        e = np.sqrt(d)
        d1 = (e - 1.0) * 0.30 * size
        # flat underside
        under = -(z + 0.12 * size)
        return np.maximum(d1, under * 0.9) if False else d1
    V, F, N = extract(f, (-0.95, -0.95, -0.4), (0.95, 0.95, 0.4), 0.014, refine=2)
    mat = S.fabric_material('beret', color, rough=0.9, sheen=1.0, bump=0.025, noise_scale=120.0)
    ob = S.mesh_object('beret', V, F, N, mat, parent)
    ob.location = (-0.10, 0.0, top + 0.02)
    ob.rotation_euler = (tilt[0], tilt[1], 0.0)
    stem = bpy.data.objects.new('beret_stem', S.unit_sphere_mesh(24, 12))
    S.link(stem, parent)
    S._obj_mat(stem, mat)
    stem.scale = (0.045, 0.045, 0.085)
    stem.location = (-0.10 + math.sin(tilt[1]) * 0.30, 0.0, top + 0.02 + 0.30 * math.cos(tilt[1]))
    stem.rotation_euler = (0, tilt[1], 0)
    return [ob, stem]


def bowtie(face, parent, color='#2B2926', v=-0.62):
    P, N, ok = face.hits([0.0], [v])
    p, n = P[0], N[0]
    r_, u_ = _frame(n)
    mat = S.fabric_material('bowtie', color, rough=0.5, sheen=0.8, bump=0.012, noise_scale=300.0, satin=True)

    def f(Q):
        x, y, z = Q
        d = None
        for sx in (-1, 1):
            w = round_cone((x, y * 2.2, z), (sx * 0.05, 0, 0), (sx * 0.30, 0, 0), 0.04, 0.17)
            d = w if d is None else np.minimum(d, w)
        knot = sphere((x, y * 1.6, z), (0, 0, 0), 0.06)
        return smin(d, knot, 0.04)
    V, F, Nn = extract(f, (-0.55, -0.25, -0.30), (0.55, 0.25, 0.30), 0.008, refine=2)
    ob = S.mesh_object('bowtie', V, F, Nn, mat, parent)
    basis = S.basis(r_, n, u_)
    ob.matrix_world = Matrix.Translation(Vector(p + n * 0.035)) @ basis @ Matrix.Diagonal((1.15, 1.0, 1.15, 1.0))
    return [ob]
