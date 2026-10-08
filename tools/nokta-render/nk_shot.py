"""Studio rig + shot helpers."""
import nk_scene as S


def studio(w, h, samples, transparent=False, bg='#E6E2DA', floor_z=-1.28, target=(0.0, 0.0, 0.05),
           cam_dist=9.0, cam_h=0.9, lens=90.0, exposure=0.0, power=0.38, back_y=9.0, fstop=None, cam_x=0.0, lscale=1.0, world_strength=0.045):
    S.reset()
    S.setup_render(w, h, samples=samples, transparent=transparent, exposure=exposure)
    S.world('#E6E1D9', world_strength)
    t = target
    k = lscale
    pw = power * k * k

    def L(name, pos, tgt, p, col, sx, sy):
        S.area_light(name, (pos[0] * k + tgt[0], pos[1] * k, pos[2] * k), tgt, p * pw, col, sx * k, sy * k)
    L('key', (-4.6, -7.2, 7.0), t, 2900, '#FFF6EC', 6.5, 5.0)
    L('fill', (6.5, -6.0, 1.8), t, 330, '#EAF0FF', 7.0, 6.0)
    L('rimL', (-4.4, 3.6, 2.8), t, 1000, '#FFEEDD', 1.6, 5.0)
    L('rimR', (4.4, 3.4, 3.2), t, 1000, '#E6EEFF', 1.6, 5.0)
    L('top', (0.0, -0.6, 6.8), t, 320, '#FFFFFF', 4.0, 4.0)
    L('bounce', (0.0, -4.0, -0.9), t, 90, '#FFE4D2', 6.0, 2.0)
    if not transparent:
        by = back_y * k
        S.area_light('wallL', (-6.0 * k + t[0], 3.5 * k, 6.0 * k), (t[0], by, 1.5), 700 * pw, '#FFF4E8', 7.0 * k, 4.5 * k)
        S.area_light('wallR', (6.0 * k + t[0], 3.5 * k, 6.0 * k), (t[0], by, 1.5), 700 * pw, '#F2F5FF', 7.0 * k, 4.5 * k)
        S.cyclorama(bg, floor_z=floor_z, back_y=by, radius=7.0 * k, width=60.0 * k)
    S.camera((cam_x, -cam_dist, t[2] + cam_h), t, lens=lens, fstop=fstop)


def fit_camera(group, fill=0.68, elev=0.10, lens=90.0, sensor=36.0, shift=(0.0, 0.0)):
    import bpy
    from mathutils import Vector
    bpy.context.view_layer.update()
    pts = []
    for ob in group.children_recursive:
        if ob.type in ('MESH', 'CURVE', 'FONT'):
            for c in ob.bound_box:
                pts.append(ob.matrix_world @ Vector(c))
    xs = [p.x for p in pts]
    zs = [p.z for p in pts]
    cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
    s = max((max(xs) - min(xs)) / 2, (max(zs) - min(zs)) / 2)
    D = s / ((sensor / 2) / lens * fill)
    cam = bpy.context.scene.camera
    cam.location = (cx + shift[0], -D, cz + D * elev + shift[1])
    S.aim(cam, (cx + shift[0], 0.0, cz + shift[1]))
    return D


def fit_fixed(center, half=1.8, elev=0.10, lens=90.0, sensor=36.0):  # half = half-width of the frame in scene units
    """Fixed framing so every shot in a series has identical scale."""
    cx, cz = center
    D = half / ((sensor / 2) / lens)
    cam = S.bpy.context.scene.camera
    cam.location = (cx, -D, cz + D * elev)
    S.aim(cam, (cx, 0.0, cz))
    return D
