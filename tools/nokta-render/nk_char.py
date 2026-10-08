"""Nokta character family: SDF bodies, 3D face rig, arms, states, accessories."""
import math
import numpy as np
from mathutils import Matrix, Vector

import nk_scene as S
import nk_props as PR
from nk_sdf import (smin, smax, sphere, ellipsoid, capsule, round_cone, pillow_triangle, rot_xyz,
                    extract, surface_hits, normals_at)

UP = np.array([0.0, 0.0, 1.0])

# base colours tuned for rendering (they read a touch lighter than the final look)
PALETTE = {
    'clay':  dict(base='#E07B57', blush='#F26F7E', sss=(1.0, 0.36, 0.2), eye='bead', line='#4A2015', tint='#FFB08F'),
    'sky':   dict(base='#A8C4DA', blush='#F4A992', sss=(0.55, 0.78, 1.0), eye='bead', line='#2F3B4A', tint='#DCEBF7'),
    'sage':  dict(base='#A8BC93', blush='#F0A68C', sss=(0.7, 1.0, 0.55), eye='bead', line='#33402B', tint='#DDEBCB'),
    'kraft': dict(base='#D6BE92', blush='#EC9E80', sss=(1.0, 0.6, 0.35), eye='bead', line='#4A3321', tint='#F5E6C8'),
    'peach': dict(base='#F4C7B1', blush='#F29478', sss=(1.0, 0.45, 0.3), eye='bead', line='#5A2C1E', tint='#FFE0D2'),
    'ink':   dict(base='#4B4742', blush='#D9764F', sss=(0.5, 0.5, 0.5), eye='glow', line='#FFEBD2', tint='#8A857C',
                  rough=0.34, coat=0.55, sheen=0.5, sss_w=0.1),
}


def _unit(v):
    v = np.asarray(v, np.float64)
    return v / (np.linalg.norm(v) + 1e-12)


def frame1(n):
    """Tangent frame at a surface normal: returns (right, up)."""
    n = _unit(n)
    r = _unit(np.cross(UP, n))
    u = np.cross(n, r)
    return r, u


# ============================================================================ bodies
def _swing(arm, ang):
    """The hand of an arm turned about its shoulder by `ang` radians in the picture plane (x right, z up)."""
    if not ang:
        return arm
    sx, sy, sz = arm['s']
    hx, hy, hz = arm['h']
    dx, dz = hx - sx, hz - sz
    c, si = math.cos(ang), math.sin(ang)
    out = dict(arm)
    out['h'] = (sx + dx * c - dz * si, hy, sz + dx * si + dz * c)
    return out


def arm_set(body, pose, wave=0.0, sway=0.0):
    """Arm presets as lists of dict(s=shoulder, h=hand, r0, r1). `wave` turns the raised hand of 'wave',
    `sway` the two hands of 'cheer' (towards each other when positive): the poses an animation moves between."""
    if body in ('nokta', 'tavsan', 'bulut'):
        X = {'nokta': 0.86, 'tavsan': 0.84, 'bulut': 1.02}[body]
        Z0 = {'nokta': -0.12, 'tavsan': -0.18, 'bulut': -0.2}[body]
        hang = lambda sx: dict(s=(sx * (X - 0.02), -0.08, Z0 - 0.22), h=(sx * (X + 0.17), -0.18, Z0 - 0.42), r0=0.19, r1=0.178)
        raise_r = dict(s=(X * 0.92, 0.0, Z0 + 0.12), h=(X + 0.40, -0.30, Z0 + 0.74), r0=0.20, r1=0.235)
        raise_l = dict(s=(-X * 0.92, 0.0, Z0 + 0.12), h=(-(X + 0.40), -0.30, Z0 + 0.74), r0=0.20, r1=0.235)
        poses = {
            'down': [hang(-1), hang(1)],
            'wave': [hang(-1), _swing(raise_r, wave)],
            'cheer': [_swing(raise_l, -sway), _swing(raise_r, sway)],
            'think': [hang(-1), dict(s=(X * 0.86, -0.12, Z0 + 0.1), h=(0.55, -0.98, Z0 - 0.38), r0=0.2, r1=0.15)],
            'work': [hang(-1), dict(s=(X * 0.9, -0.05, Z0 + 0.05), h=(X + 0.46, -0.28, Z0 + 0.34), r0=0.20, r1=0.22)],
            'worry': [dict(s=(-X * 0.86, -0.1, Z0), h=(-0.72, -0.9, Z0 + 0.1), r0=0.2, r1=0.15),
                      dict(s=(X * 0.86, -0.1, Z0), h=(0.72, -0.9, Z0 + 0.1), r0=0.2, r1=0.15)],
            'sleep': [hang(-1), hang(1)],
        }
        return poses[pose]
    if body == 'ucgen':
        hang = lambda sx: dict(s=(sx * 0.66, 0.0, -0.40), h=(sx * 1.02, -0.26, -0.80), r0=0.22, r1=0.14)
        raise_r = dict(s=(0.55, 0.0, -0.3), h=(1.18, -0.28, 0.35), r0=0.21, r1=0.15)
        raise_l = dict(s=(-0.55, 0.0, -0.3), h=(-1.18, -0.28, 0.35), r0=0.21, r1=0.15)
        poses = {'down': [], 'wave': [_swing(raise_r, wave)], 'cheer': [_swing(raise_l, -sway), _swing(raise_r, sway)],
                 'think': [], 'work': [], 'worry': [], 'sleep': []}
        return poses[pose]
    raise ValueError(body)


def body_field(body, arms, squash=1.0, ear_flop=False):
    """Returns (field f, bounds lo, hi, extras dict)."""
    extras = {}

    def with_arms(f0):
        def f(P):
            d = f0(P)
            for a in arms:
                d = smin(d, round_cone(P, a['s'], a['h'], a['r0'], a['r1']), 0.11)
            return d
        return f

    if body == 'nokta':
        def f0(P):
            return ellipsoid(P, (0, 0, 0), (1.0, 0.96, 0.95 * squash))
        return with_arms(f0), (-1.95, -1.6, -1.45), (1.95, 1.2, 1.7), extras

    if body == 'bulut':
        lobes = [((0.0, 0.0, 0.10), 0.86),
                 ((-0.98, 0.02, -0.12), 0.56), ((0.98, 0.02, -0.12), 0.56),
                 ((-0.58, 0.0, 0.80), 0.52), ((0.10, 0.0, 1.02), 0.50), ((0.66, 0.0, 0.74), 0.47),
                 ((-0.50, -0.05, -0.62), 0.44), ((0.50, -0.05, -0.62), 0.44), ((0.0, 0.10, -0.55), 0.50)]

        def f0(P):
            d = sphere(P, *lobes[0])
            for c, r in lobes[1:]:
                d = smin(d, sphere(P, c, r), 0.20)
            return smax(d, -(P[2] + 1.02), 0.16)
        return with_arms(f0), (-2.2, -1.6, -1.5), (2.2, 1.4, 1.9), extras

    if body == 'tavsan':
        def ear(sx, flop):
            if not flop:
                return [((sx * 0.42, 0.12, 0.66), (sx * 0.63, 0.15, 1.52), 0.265, 0.20)]
            return [((sx * 0.42, 0.12, 0.66), (sx * 0.58, 0.10, 1.22), 0.26, 0.22),
                    ((sx * 0.58, 0.10, 1.22), (sx * 1.00, -0.18, 1.50), 0.22, 0.17)]
        ears = ear(-1, False) + ear(1, ear_flop)
        extras['ears'] = ears

        def f0(P):
            d = ellipsoid(P, (0, 0, 0), (1.0, 0.92, 0.92 * squash))
            for a, b, r1, r2 in ears:
                d = smin(d, round_cone(P, a, b, r1, r2), 0.17)
            return d

        def inner(P):
            d = None
            for a, b, r1, r2 in ears:
                ya = a[1] - r1 * 0.93
                yb = b[1] - r2 * 0.93
                a2 = (a[0], ya, a[2] + 0.22)
                b2 = (b[0], yb, b[2] - 0.20)
                ym = (ya + yb) / 2
                yy = (P[1] - ym) * 2.6 + ym
                dd = round_cone((P[0], yy, P[2]), a2, b2, r1 * 0.52, r2 * 0.46)
                d = dd if d is None else np.minimum(d, dd)
            return d
        extras['inner_field'] = inner
        return with_arms(f0), (-2.1, -1.6, -1.45), (2.1, 1.2, 2.1), extras

    if body == 'ucgen':
        A, B, C = (0.0, 0.92), (0.98, -0.74), (-0.98, -0.74)

        def f0(P):
            return pillow_triangle(P, A, B, C, corner=0.58, half_depth=0.18, bevel=0.36)
        return with_arms(f0), (-2.0, -1.2, -1.5), (2.0, 1.2, 1.9), extras
    raise ValueError(body)


def face_layout(body):
    """Face-plane layout (u right, v up), in body units."""
    return {
        'nokta': dict(ex=0.40, ey=0.05, mx=0.0, my=-0.18, brow=0.41, cheek=(0.66, -0.13), rx=0.138, rz=0.190, ry=0.098),
        'bulut': dict(ex=0.36, ey=0.20, mx=0.0, my=-0.06, brow=0.52, cheek=(0.58, 0.00), rx=0.105, rz=0.145, ry=0.088),
        'tavsan': dict(ex=0.36, ey=0.02, mx=0.0, my=-0.28, brow=0.34, cheek=(0.60, -0.18), rx=0.104, rz=0.144, ry=0.086),
        'ucgen': dict(ex=0.34, ey=-0.02, mx=0.0, my=-0.30, brow=0.17, cheek=(0.56, -0.20), rx=0.118, rz=0.162, ry=0.092),
    }[body]


# ============================================================================ face rig
class Face:
    def __init__(self, f, layout, mats, parent, style='bead'):
        self.f, self.L, self.m, self.parent, self.style = f, layout, mats, parent, style
        self.objs = []

    def hits(self, u, v):
        return surface_hits(self.f, u, v, y_start=-2.3, y_end=0.9, step=0.012)

    def project(self, uv, offset=0.0):
        uv = np.asarray(uv, np.float64)
        P, N, ok = self.hits(uv[:, 0], uv[:, 1])
        return P + N * offset, N, ok

    # ---- eyes
    def eye(self, name, u, v, rx, ry, rz, glints=True, look=(0.0, 0.0), roll=0.0, embed=0.30):
        P, N, ok = self.hits([u], [v])
        p, n = P[0], N[0]
        r, up = frame1(n)
        if roll:
            c, s = math.cos(roll), math.sin(roll)
            r, up = r * c + up * s, up * c - r * s
        center = p - n * (ry * embed)
        fr = S.basis(r, n, up)
        eye_ob = S.ellipsoid_object(name, center, fr, (rx, ry, rz), self.m['eye'], self.parent)
        self.objs.append(eye_ob)
        if glints and self.style == 'bead':
            M3 = np.array([r, -n, up]).T  # columns = local x,y,z in world

            def put(dloc, size, mat):
                d = _unit(dloc)
                t = 1.0 / math.sqrt((d[0] / rx) ** 2 + (d[1] / ry) ** 2 + (d[2] / rz) ** 2)
                pl = d * t
                nl = _unit([pl[0] / rx ** 2, pl[1] / ry ** 2, pl[2] / rz ** 2])
                pw = M3 @ pl
                nw = _unit(M3 @ nl)
                t1 = _unit(np.cross(UP, nw))
                t2 = np.cross(nw, t1)
                R = Matrix(((t1[0], t2[0], nw[0], 0), (t1[1], t2[1], nw[1], 0), (t1[2], t2[2], nw[2], 0), (0, 0, 0, 1)))
                pos = Vector(center) + Vector(pw) + Vector(nw) * (size * 0.12)
                ob = S.ellipsoid_object(name + '_g', pos, R, (size, size * 0.92, size * 0.30), mat, self.parent, 24, 12)
                self.objs.append(ob)
            lx, lz = look
            put((-0.40 + lx, -0.86, 0.46 + lz), rx * 0.30, self.m['glint'])
            put((0.46 + lx, -0.84, -0.40 + lz), rx * 0.135, self.m['glint'])
        return eye_ob

    def nose(self, u, v, r):
        P, N, ok = self.hits([u], [v])
        p, n = P[0], N[0]
        rr, up = frame1(n)
        mat = S.line_material('nose', '#C9666B', 0.4)
        ob = S.ellipsoid_object('nose', p - n * (r * 0.1), S.basis(rr, n, up), (r * 1.25, r * 0.8, r * 0.9), mat, self.parent)
        self.objs.append(ob)

    def lid(self, name, u, v, rx, ry, rz, amount=0.5, tilt=0.0, embed=0.30):
        """Body-coloured eyelid cap covering the top `amount` of the eye (0..1)."""
        P, N, ok = self.hits([u], [v])
        p, n = P[0], N[0]
        r, up = frame1(n)
        c, s = math.cos(tilt), math.sin(tilt)
        r2, up2 = r * c + up * s, up * c - r * s
        center = p - n * (ry * embed) + up2 * (rz * (1.0 - amount))
        fr = S.basis(r2, n, up2)
        ob = S.ellipsoid_object(name, center, fr, (rx * 1.10, ry * 1.12, rz * 1.02), self.m['body'], self.parent)
        self.objs.append(ob)
        return ob

    # ---- arcs / lines
    def line(self, name, uv, radii, mat=None, offset=-0.004):
        P, N, ok = self.project(uv, offset)
        ob = S.tube(name, P, radii, mat or self.m['line'], self.parent)
        self.objs.append(ob)
        return ob

    def arc_eye(self, name, u, v, w, h, kind='happy', thick=0.034):
        """Closed-eye arcs: 'happy' = ^ shape, 'sleep' = U shape."""
        t = np.linspace(-1, 1, 28)
        sgn = 1.0 if kind == 'happy' else -1.0
        uv = np.stack([u + w * t, v + sgn * h * (1 - t ** 2) - sgn * h * 0.3], 1)
        rad = thick * (0.55 + 0.45 * np.sqrt(1 - t ** 2 + 1e-3))
        return self.line(name, uv, rad)

    def brow(self, name, u, v, w=0.15, inner_up=0.0, curve=0.025, thick=0.046):
        s = 1.0 if u > 0 else -1.0
        t = np.linspace(-1, 1, 22)
        uu = u + s * w * t * math.cos(inner_up)
        vv = v - t * w * math.sin(inner_up) + curve * (1 - t ** 2)
        rad = thick * (0.6 + 0.4 * (1 - t ** 2))
        return self.line(name, np.stack([uu, vv], 1), rad, self.m['brow'])

    def mouth_smile(self, u0, v0, w, a, thick=0.034, kind='smile'):
        t = np.linspace(-1, 1, 36)
        if kind == 'smile':
            vv = v0 + a * (t ** 2 - 0.5)
        elif kind == 'flat':
            vv = v0 + 0.0 * t + 0.004
        elif kind == 'smirk':
            vv = v0 + a * (np.clip(t, -1, 1) ** 2 - 0.5) * (0.5 + 0.5 * t) + 0.02 * t
        elif kind == 'wavy':
            vv = v0 + a * np.sin(t * math.pi * 1.5)
        else:
            raise ValueError(kind)
        rad = thick * (0.62 + 0.38 * (1 - t ** 2))
        return self.line('mouth', np.stack([u0 + w * t, vv], 1), rad)

    def patch(self, name, uv_grid, offset, mat):
        """Surface-conforming patch from an (nu, nv, 2) grid of face-plane coordinates."""
        g = np.asarray(uv_grid, np.float64)
        nu, nv = g.shape[:2]
        P, N, ok = self.project(g.reshape(-1, 2), offset)
        faces = []
        for i in range(nu - 1):
            for j in range(nv - 1):
                a = i * nv + j
                faces.append((a, a + 1, a + nv + 1, a + nv))
        ob = S.mesh_object(name, P, faces, N, mat, self.parent)
        self.objs.append(ob)
        return ob

    def mouth_open(self, u0, v0, w, depth, tongue=True):
        """D-shaped open mouth: dark cavity patch, tongue and a soft lip line."""
        ss = np.linspace(-1, 1, 44)
        tt = np.linspace(0, 1, 18)
        grid = np.zeros((len(ss), len(tt), 2))
        for i, s in enumerate(ss):
            top = v0 + 0.10 * depth * (s ** 2 - 0.5)
            bot = top - depth * (1 - s ** 2) ** 0.75
            for j, t in enumerate(tt):
                grid[i, j] = (u0 + w * s, bot + (top - bot) * t)
        self.patch('mouth_cavity', grid, -0.012, self.m['mouth'])
        if tongue:
            ss2 = np.linspace(-0.62, 0.62, 30)
            g2 = np.zeros((len(ss2), 14, 2))
            for i, s in enumerate(ss2):
                top = v0 + 0.10 * depth * (s ** 2 - 0.5)
                bot = top - depth * (1 - s ** 2) ** 0.75
                hgt = (top - bot) * (0.46 * math.sqrt(max(0.0, 1 - (s / 0.66) ** 2)))
                for j in range(14):
                    g2[i, j] = (u0 + w * s, bot + hgt * j / 13.0)
            self.patch('tongue', g2, -0.004, self.m['tongue'])
        t = np.linspace(-1, 1, 40)
        top_uv = np.stack([u0 + w * t, v0 + 0.10 * depth * (t ** 2 - 0.5)], 1)
        bot_uv = np.stack([u0 + w * t, v0 + 0.10 * depth * (t ** 2 - 0.5) - depth * (1 - t ** 2) ** 0.75], 1)
        rad = 0.02 * (0.5 + 0.5 * (1 - t ** 2))
        self.line('lip_top', top_uv, rad, offset=0.001)
        self.line('lip_bot', bot_uv, rad, offset=0.001)

    def mouth_o(self, u0, v0, rw, rh):
        th = np.linspace(0, 2 * math.pi, 40)
        ring = np.stack([u0 + rw * np.cos(th), v0 + rh * np.sin(th)], 1)
        grid = np.zeros((12, 40, 2))
        for i in range(12):
            k = i / 11.0
            grid[i] = np.stack([u0 + rw * k * np.cos(th), v0 + rh * k * np.sin(th)], 1)
        self.patch('mouth_o', grid, -0.01, self.m['mouth'])
        self.line('mouth_o_ring', ring, 0.02, offset=0.0)


# ============================================================================ builder
FACE_STATES = {
    # eyes: open | happy | sleep | wide | focus ; brow: (inner_up_l, inner_up_r, dv_l, dv_r) ; mouth: (kind, ...)
    'neutral':  dict(eyes='open', look=(0, 0), brow=(0.03, 0.03, 0.0, 0.0), mouth=('smile', 0.46, 0.13), pose='down', cheer=0.55),
    'sleep':    dict(eyes='sleep', brow=(-0.10, -0.10, -0.02, -0.02), mouth=('o', 0.05, 0.065), pose='sleep', cheer=0.5, tilt=0.14),
    'work':     dict(eyes='focus', look=(0.85, -0.10), brow=(-0.20, -0.20, -0.02, -0.02), mouth=('smirk', 0.30, 0.09), pose='work', cheer=0.55, tilt=-0.10),
    'ask':      dict(eyes='wide', look=(0.25, 0.30), brow=(0.0, 0.0, 0.02, 0.11), mouth=('o', 0.06, 0.075), pose='down', cheer=0.5, tilt=-0.16),
    'approve':  dict(eyes='wide', look=(0, 0), brow=(0.25, 0.25, 0.05, 0.05), mouth=('smile', 0.26, 0.10), pose='wave', cheer=0.6),
    'happy':    dict(eyes='happy', brow=(0.0, 0.0, 0.0, 0.0), mouth=('open', 0.46, 0.34), pose='cheer', cheer=0.8),
    'worry':    dict(eyes='open', look=(0, -0.10), brow=(0.55, 0.55, 0.06, 0.06), mouth=('wavy', 0.28, 0.05), pose='down', cheer=0.4, tilt=0.08),
    'love':     dict(eyes='happy', brow=(0.0, 0.0, 0.0, 0.0), mouth=('open', 0.34, 0.20), pose='down', cheer=0.9, tilt=0.0),
}


def build_body(body='nokta', color=None, pose='down', quality='preview', squash=1.0, ear_flop=False, blush=0.62,
               yaw=-0.10, roll=0.03, pitch=0.0, tilt=0.0, hover=0.0, loc=(0.0, 0.0), wave=0.0, sway=0.0):
    """The body of a character (mesh, material, arms, blush): everything that does not change with the face."""
    cfg = {'nokta': 'clay', 'bulut': 'sky', 'tavsan': 'peach', 'ucgen': 'ink'}
    color = color or cfg[body]
    pal = PALETTE[color]
    group = S.empty('char_%s_%s' % (body, color))
    layout = face_layout(body)
    arms = arm_set(body, pose, wave=wave, sway=sway)
    f, lo, hi, ex = body_field(body, arms, squash=squash, ear_flop=ear_flop)

    # blush empties (children of group): elliptical falloff via empty scale
    cu, cv = layout['cheek']
    blush_obs = []
    for sx in (-1, 1):
        P, N, ok = surface_hits(f, [sx * cu], [cv], y_start=-2.3, y_end=0.9, step=0.012)
        e = S.empty('blush_%d' % sx, tuple(P[0] - 0.02 * N[0]), (0.17, 0.22, 0.17), group)
        blush_obs.append((e, pal['blush'], blush))

    body_mat = S.clay_material('body_' + color, pal['base'], sss_radius=pal['sss'], blushes=blush_obs, tint_hex=pal['tint'],
                               roughness=pal.get('rough', 0.42), coat=pal.get('coat', 0.18), sheen=pal.get('sheen', 0.22),
                               sss_weight=pal.get('sss_w', 0.40))
    h = {'preview': 0.016, 'mid': 0.011, 'final': 0.0085}[quality]
    V, F, N = extract(f, lo, hi, h, refine=3)
    body_ob = S.mesh_object('body', V, F, N, body_mat, group)
    if 'inner_field' in ex:
        inner_mat = S.clay_material('inner_ear', '#F6B1AE', sss_radius=(1.0, 0.5, 0.4), sss_weight=0.6, roughness=0.55,
                                    coat=0.05, sheen=0.1, bump=0.0)
        Vi, Fi, Ni = extract(ex['inner_field'], (-1.3, -0.5, 0.3), (1.3, 0.3, 1.8), h * 0.8, refine=2)
        S.mesh_object('inner_ears', Vi, Fi, Ni, inner_mat, group)

    mats = dict(
        eye=S.eye_material('eye', pal['eye']),
        glint=S.emissive_material('glint', '#FFFFFF', 10.0),
        line=S.line_material('line', pal['line']),
        brow=S.line_material('brow', pal['line'], 0.5),
        mouth=S.line_material('mouth', '#3A0F0B', 0.35),
        tongue=S.line_material('tongue', '#E4776F', 0.45),
        body=body_mat,
    )
    group.rotation_euler = (pitch, roll + tilt * 0.5, yaw)
    group.location = (loc[0], loc[1], hover)
    return dict(group=group, field=f, body=body_ob, mats=mats, palette=pal, layout=layout, extras=ex, name=body)


def build_face(ctx, st):
    """Eyes, brows and mouth for a face state `st` (a FACE_STATES entry, possibly with `lid`): the part an animation changes."""
    f, layout, group, pal = ctx['field'], ctx['layout'], ctx['group'], ctx['palette']
    before = {c.name for c in group.children}
    face = Face(f, layout, ctx['mats'], group, style=pal['eye'])
    if ctx['name'] == 'tavsan':
        face.nose(0.0, layout['my'] + 0.15, 0.052)
    L = layout
    rx, ry, rz = L['rx'], L['ry'], L['rz']
    ex_, ey_ = L['ex'], L['ey']
    lx, lz = st.get('look', (0, 0))
    lookshift = (0.05 * lx, 0.05 * lz)
    eyes = st['eyes']
    for sx in (-1, 1):
        u, v = sx * ex_ + lookshift[0], ey_ + lookshift[1]
        if eyes in ('open', 'wide', 'focus'):
            k = {'open': 1.0, 'wide': 1.12, 'focus': 0.95}[eyes]
            face.eye('eye%d' % sx, u, v, rx * k, ry, rz * k, glints=True, look=(0.0, 0.0))
            lid = st.get('lid', 0.16 if eyes == 'focus' else 0.0)
            if lid > 0:
                face.lid('lid%d' % sx, u, v, rx * k, ry, rz * k, amount=lid, tilt=sx * (0.10 if eyes == 'focus' else 0.0))
        elif eyes in ('happy', 'sleep'):
            face.arc_eye('eyearc%d' % sx, u, v, rx * 1.05, 0.085 if eyes == 'happy' else 0.05, kind=eyes)
    # brows
    bl_up, br_up, bl_dv, br_dv = st['brow']
    brow_eyes = st.get('brow_as', eyes)
    for sx, up_, dv in ((-1, bl_up, bl_dv), (1, br_up, br_dv)):
        if brow_eyes in ('open', 'wide', 'focus'):
            face.brow('brow%d' % sx, sx * ex_ + lookshift[0], L['brow'] + dv, inner_up=up_)
        elif brow_eyes == 'sleep':
            face.brow('brow%d' % sx, sx * ex_, L['brow'] - 0.04, inner_up=-0.12, curve=0.03)
    # mouth
    m = st['mouth']
    if m[0] == 'open':
        face.mouth_open(L['mx'], L['my'] + 0.10, m[1] * 0.5, m[2] * 0.36)
    elif m[0] == 'o':
        face.mouth_o(L['mx'], L['my'], m[1], m[2])
    else:
        face.mouth_smile(L['mx'], L['my'], m[1] * 0.5, m[2], kind=m[0])
    # everything this expression added to the character, the end caps of its lines included
    face.objs = [c for c in group.children if c.name not in before]
    return face


def clear_face(face):
    """Removes what build_face made, so the next expression can be built on the same body.
    (Mesh data is left to Blender: some of it is shared between objects.)"""
    import bpy
    for ob in face.objs:
        bpy.data.objects.remove(ob, do_unlink=True)
    face.objs.clear()


def build_character(body='nokta', color=None, state='neutral', accessory=None, quality='preview',
                    yaw=-0.10, roll=0.03, pitch=0.0, hover=0.0, squash=1.0, ear_flop=False, extras=True, pose=None, loc=(0.0, 0.0)):
    st = FACE_STATES[state]
    ctx = build_body(body=body, color=color, pose=pose or st['pose'], quality=quality, squash=squash, ear_flop=ear_flop,
                     blush=0.62 if state != 'happy' else 0.8, yaw=yaw, roll=roll, pitch=pitch, tilt=st.get('tilt', 0.0),
                     hover=hover, loc=loc)
    face = build_face(ctx, st)
    group = ctx['group']
    if extras:
        add_state_props(group, body, state, face)
    if accessory:
        add_accessory(group, body, accessory, face)
    return dict(group=group, face=face, field=ctx['field'], body=ctx['body'], mats=ctx['mats'], palette=ctx['palette'],
                state=st, extras=ctx['extras'])


WIDTH = {'nokta': 1.0, 'bulut': 1.22, 'tavsan': 1.0, 'ucgen': 1.05}
TOP = {'nokta': 0.95, 'bulut': 1.5, 'tavsan': 0.95, 'ucgen': 1.0}


def add_state_props(group, body, state, face):
    w = WIDTH[body]
    top = TOP[body]
    pearl = '#FBF6EC'
    if state == 'sleep':
        for (x, z, sz) in ((1.18, 1.00, 1.00), (1.50, 1.42, 0.76), (1.76, 1.80, 0.55)):
            PR.glyph('z', (x * w, -0.15, z + (top - 0.95)), size=sz, rot=(0, -0.18, 0), color='#8DB0CF', parent=group, bevel=0.05, extrude=0.08)
    elif state == 'ask':
        PR.glyph('?', (1.18 * w, -0.12, 1.05 + (top - 0.95)), size=1.25, rot=(0, 0.18, 0), color='#C95F3D', parent=group, bevel=0.05, extrude=0.08)
    elif state == 'work':
        PR.window_panel((1.78 * w, -0.45, 0.28), rot=(0, 0, -0.38), scale=1.25, parent=group)
    elif state == 'happy':
        for (x, z, r, t) in ((-1.45, 1.45, 0.17, 0.2), (1.50, 1.62, 0.2, 0.0), (-0.70, 2.05, 0.11, 0.3), (0.62, 2.12, 0.13, 0.1)):
            PR.sparkle((x * w, -0.3, z + (top - 0.95)), r=r * 1.5, color='#FFD98A', parent=group, tilt=t)
        PR.confetti(11, 11, ((-1.1 * w, 1.1 * w), (-0.5, 0.1), (1.45 + (top - 0.95), 2.15 + (top - 0.95))),
                    ['#E07B57', '#8DB0CF', '#9DBB8A', '#E6B450', '#F4C7B1', '#4B4742'], parent=group, size=0.105)
    elif state == 'worry':
        P, N, ok = face.hits([0.66], [0.56])
        PR.sweat_drop(tuple(P[0] + N[0] * 0.05), r=0.12, parent=group, tilt=0.22)


def add_accessory(group, body, name, face, frame='#23201D', cloth='#2B2926'):
    """Glasses, a beret or a bow tie; `frame` is the glasses' metal, `cloth` the beret's and bow tie's stuff."""
    if name == 'glasses':
        PR.glasses(face, group, frame_hex=frame)
    elif name == 'beret':
        PR.beret(group, top=TOP[body] - 0.04, color=cloth)
    elif name == 'bowtie':
        PR.bowtie(face, group, color=cloth, v=-0.55 if body == 'nokta' else -0.62)
    else:
        raise ValueError(name)
