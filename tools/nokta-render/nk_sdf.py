"""Signed-distance-field modelling helpers (numpy) + marching-cubes mesh extraction.

All primitives take P = (x, y, z) arrays (any broadcastable shape) and return a field that is
negative inside. Z is up, the character's front faces -Y.
"""
import numpy as np
from skimage import measure


def _L(x, y, z):
    return np.sqrt(x * x + y * y + z * z)


def smin(a, b, k):
    """Polynomial smooth minimum (smooth union)."""
    k = max(float(k), 1e-6)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1.0 - h) + a * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def local(P, c, R=None):
    x = P[0] - c[0]
    y = P[1] - c[1]
    z = P[2] - c[2]
    if R is None:
        return x, y, z
    return (R[0][0] * x + R[1][0] * y + R[2][0] * z,
            R[0][1] * x + R[1][1] * y + R[2][1] * z,
            R[0][2] * x + R[1][2] * y + R[2][2] * z)


def sphere(P, c, r):
    return _L(P[0] - c[0], P[1] - c[1], P[2] - c[2]) - r


def ellipsoid(P, c, r, R=None):
    x, y, z = local(P, c, R)
    k0 = _L(x / r[0], y / r[1], z / r[2])
    k1 = _L(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2]))
    d = k0 * (k0 - 1.0) / np.maximum(k1, 1e-8)
    return np.where(k1 < 1e-8, -min(r), d)


def capsule(P, a, b, r):
    a = np.asarray(a, np.float32)
    b = np.asarray(b, np.float32)
    ba = b - a
    pax = P[0] - a[0]
    pay = P[1] - a[1]
    paz = P[2] - a[2]
    h = np.clip((pax * ba[0] + pay * ba[1] + paz * ba[2]) / float(ba @ ba), 0.0, 1.0)
    return _L(pax - ba[0] * h, pay - ba[1] * h, paz - ba[2] * h) - r


def round_cone(P, a, b, r1, r2):
    """Tapered capsule (iq sdRoundCone, arbitrary endpoints)."""
    a = np.asarray(a, np.float64)
    b = np.asarray(b, np.float64)
    ba = b - a
    l2 = float(ba @ ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pax = P[0] - a[0]
    pay = P[1] - a[1]
    paz = P[2] - a[2]
    y = pax * ba[0] + pay * ba[1] + paz * ba[2]
    z = y - l2
    vx = pax * l2 - ba[0] * y
    vy = pay * l2 - ba[1] * y
    vz = paz * l2 - ba[2] * y
    x2 = vx * vx + vy * vy + vz * vz
    y2 = y * y * l2
    z2 = z * z * l2
    k = np.sign(rr) * rr * rr * x2
    d1 = np.sqrt(x2 + z2) * il2 - r2
    d2 = np.sqrt(x2 + y2) * il2 - r1
    d3 = (np.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1
    return np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))


def plane_y(P, y0):
    return P[1] - y0


def box_round(P, c, hs, r, R=None):
    x, y, z = local(P, c, R)
    qx = np.abs(x) - hs[0] + r
    qy = np.abs(y) - hs[1] + r
    qz = np.abs(z) - hs[2] + r
    out = _L(np.maximum(qx, 0), np.maximum(qy, 0), np.maximum(qz, 0))
    return out + np.minimum(np.maximum(qx, np.maximum(qy, qz)), 0.0) - r


def tri2d(x, y, A, B, C):
    """2D signed distance of triangle ABC (iq)."""
    A = np.asarray(A, np.float64)
    B = np.asarray(B, np.float64)
    C = np.asarray(C, np.float64)
    e0, e1, e2 = B - A, C - B, A - C
    v0 = (x - A[0], y - A[1])
    v1 = (x - B[0], y - B[1])
    v2 = (x - C[0], y - C[1])

    def pq(v, e):
        t = np.clip((v[0] * e[0] + v[1] * e[1]) / (e @ e), 0.0, 1.0)
        return v[0] - e[0] * t, v[1] - e[1] * t

    p0, p1, p2 = pq(v0, e0), pq(v1, e1), pq(v2, e2)
    s = np.sign(e0[0] * e2[1] - e0[1] * e2[0])
    d0 = p0[0] ** 2 + p0[1] ** 2
    d1 = p1[0] ** 2 + p1[1] ** 2
    d2 = p2[0] ** 2 + p2[1] ** 2
    c0 = s * (v0[0] * e0[1] - v0[1] * e0[0])
    c1 = s * (v1[0] * e1[1] - v1[1] * e1[0])
    c2 = s * (v2[0] * e2[1] - v2[1] * e2[0])
    dx = np.minimum(np.minimum(d0, d1), d2)
    dy = np.minimum(np.minimum(c0, c1), c2)
    return -np.sqrt(dx) * np.sign(dy)


def pillow_triangle(P, A, B, C, corner, half_depth, bevel):
    """Rounded, puffy triangular pillow in the XZ plane, depth along Y."""
    d2 = tri2d(P[0], P[2], A, B, C) - corner
    wx = d2 + bevel
    wy = np.abs(P[1]) - half_depth + bevel
    out = np.sqrt(np.maximum(wx, 0) ** 2 + np.maximum(wy, 0) ** 2)
    return out + np.minimum(np.maximum(wx, wy), 0.0) - bevel


def rot_xyz(rx=0.0, ry=0.0, rz=0.0):
    """Rotation matrix local->world, XYZ euler (radians)."""
    cx, sx = np.cos(rx), np.sin(rx)
    cy, sy = np.cos(ry), np.sin(ry)
    cz, sz = np.cos(rz), np.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def _eval(f, V):
    return f((V[:, 0], V[:, 1], V[:, 2]))


def gradient(f, V, e=1.5e-3):
    gx = _eval(f, V + np.array([e, 0, 0])) - _eval(f, V - np.array([e, 0, 0]))
    gy = _eval(f, V + np.array([0, e, 0])) - _eval(f, V - np.array([0, e, 0]))
    gz = _eval(f, V + np.array([0, 0, e])) - _eval(f, V - np.array([0, 0, e]))
    return np.stack([gx, gy, gz], 1) / (2 * e)


def normals_at(f, V):
    g = gradient(f, V)
    return g / (np.linalg.norm(g, axis=1, keepdims=True) + 1e-12)


def extract(f, lo, hi, h, refine=3, flip_check=True):
    """Marching cubes over [lo,hi] with voxel size h. Returns verts, faces, normals (float64)."""
    xs = np.arange(lo[0], hi[0] + h, h, dtype=np.float32)
    ys = np.arange(lo[1], hi[1] + h, h, dtype=np.float32)
    zs = np.arange(lo[2], hi[2] + h, h, dtype=np.float32)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
    vol = np.asarray(f((X, Y, Z)), dtype=np.float32)
    verts, faces, _, _ = measure.marching_cubes(vol, 0.0, spacing=(h, h, h))
    verts = verts.astype(np.float64) + np.array(lo, dtype=np.float64)
    for _ in range(refine):  # Newton projection onto the exact iso-surface
        d = _eval(f, verts)
        g = gradient(f, verts)
        verts = verts - (d / (np.sum(g * g, axis=1) + 1e-12))[:, None] * g
    n = normals_at(f, verts)
    if flip_check:
        v0, v1, v2 = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
        fn = np.cross(v1 - v0, v2 - v0)
        agree = np.sum(np.einsum('ij,ij->i', fn, n[faces[:, 0]]) > 0)
        if agree < len(faces) / 2:
            faces = faces[:, ::-1]
    return verts, faces.astype(np.int64), n


def surface_hits(f, u, v, y_start=-4.0, y_end=2.0, step=0.01, bisect=24):
    """Orthographic frontal hits: ray from (u, y_start, v) along +Y, first sign change of f.
    Returns points (N,3), normals (N,3) and a boolean hit mask."""
    u = np.atleast_1d(np.asarray(u, np.float64))
    v = np.atleast_1d(np.asarray(v, np.float64))
    n = len(u)
    ys = np.arange(y_start, y_end, step)
    hit_y = np.full(n, np.nan)
    prev = f((u, np.full(n, ys[0]), v))
    for y0, y1 in zip(ys[:-1], ys[1:]):
        cur = f((u, np.full(n, y1), v))
        cross = (prev > 0) & (cur <= 0) & np.isnan(hit_y)
        if cross.any():
            lo = np.full(n, y0)
            hi = np.full(n, y1)
            for _ in range(bisect):
                mid = 0.5 * (lo + hi)
                fm = f((u, mid, v))
                inside = fm <= 0
                hi = np.where(inside & cross, mid, hi)
                lo = np.where(~inside & cross, mid, lo)
            hit_y = np.where(cross, 0.5 * (lo + hi), hit_y)
        prev = cur
        if not np.isnan(hit_y).any():
            break
    ok = ~np.isnan(hit_y)
    P = np.stack([u, np.where(ok, hit_y, 0.0), v], 1)
    N = normals_at(f, P)
    return P, N, ok
