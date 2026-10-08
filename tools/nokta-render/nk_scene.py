"""Blender (bpy) scene utilities: render setup, studio lighting, backdrop, materials, meshes."""
import math
import time
import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector


# --------------------------------------------------------------------------- colour
def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(h, a=1.0):
    h = h.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (_lin(r), _lin(g), _lin(b), a)


def mix_hex(h1, h2, t):
    a, b = hexc(h1), hexc(h2)
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(3)) + (1.0,)


# --------------------------------------------------------------------------- scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _unit_sphere.clear()
    return bpy.context.scene


def setup_render(w, h, samples=128, transparent=False, exposure=0.0, threads=4, denoise=True):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    cy.device = 'CPU'
    cy.samples = samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.012
    cy.adaptive_min_samples = 24
    cy.use_denoising = denoise
    cy.denoiser = 'OPENIMAGEDENOISE'
    cy.denoising_prefilter = 'ACCURATE'
    cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    cy.max_bounces = 12
    cy.diffuse_bounces = 5
    cy.glossy_bounces = 5
    cy.transmission_bounces = 10
    cy.transparent_max_bounces = 12
    cy.sample_clamp_indirect = 6.0
    cy.sample_clamp_direct = 0.0
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA' if transparent else 'RGB'
    sc.render.image_settings.color_depth = '16'
    sc.render.dither_intensity = 0.6
    sc.view_settings.view_transform = 'Khronos PBR Neutral'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = exposure
    sc.display_settings.display_device = 'sRGB'
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = threads
    return sc


def world(color_hex='#EFE8DD', strength=0.25):
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = hexc(color_hex)
    bg.inputs['Strength'].default_value = strength
    bpy.context.scene.world = w


def link(obj, parent=None):
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def aim(obj, target):
    d = Vector(target) - Vector(obj.location)
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def area_light(name, loc, target, power, color='#FFFFFF', size=3.0, size_y=None, shape='RECTANGLE', spread=None):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.shape = shape
    ld.size = size
    if shape == 'RECTANGLE':
        ld.size_y = size_y if size_y is not None else size
    ld.energy = power
    ld.color = hexc(color)[:3]
    if spread is not None:
        ld.spread = spread
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    link(ob)
    aim(ob, target)
    return ob


def camera(loc, target, lens=85.0, sensor=36.0, fstop=None, focus=None):
    cam = bpy.data.cameras.new('cam')
    cam.lens = lens
    cam.sensor_width = sensor
    cam.sensor_fit = 'AUTO'
    cam.clip_start = 0.1
    cam.clip_end = 300
    ob = bpy.data.objects.new('cam', cam)
    ob.location = loc
    link(ob)
    aim(ob, target)
    if fstop:
        cam.dof.use_dof = True
        cam.dof.aperture_fstop = fstop
        cam.dof.focus_distance = focus if focus else (Vector(loc) - Vector(target)).length
    bpy.context.scene.camera = ob
    return ob


def cyclorama(color_hex, floor_z=-1.2, back_y=7.0, radius=3.0, width=60.0, rough=0.9, name='cyc'):
    """Seamless studio backdrop: floor that sweeps up into a back wall."""
    prof = []
    for y in np.linspace(-40.0, back_y - radius, 12):
        prof.append((y, floor_z))
    for t in np.linspace(0, math.pi / 2, 24)[1:]:
        prof.append((back_y - radius + radius * math.sin(t), floor_z + radius - radius * math.cos(t)))
    for z in np.linspace(floor_z + radius, floor_z + 30.0, 6)[1:]:
        prof.append((back_y, z))
    verts, faces = [], []
    for i, (y, z) in enumerate(prof):
        verts.append((-width / 2, y, z))
        verts.append((width / 2, y, z))
    for i in range(len(prof) - 1):
        a, b, c, d = 2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2
        faces.append((a, b, c, d))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    link(ob)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = hexc(color_hex)
    bsdf.inputs['Roughness'].default_value = rough
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.25
    ob.data.materials.append(m)
    return ob


# --------------------------------------------------------------------------- materials
def _inp(node, name, val):
    if name in node.inputs:
        node.inputs[name].default_value = val


def _new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
    return m, nt, out


SSS_METHOD = 'BURLEY'


def clay_material(name, base_hex, sss_radius=(1.0, 0.42, 0.26), sss_scale=0.12, sss_weight=0.40,
                  roughness=0.42, coat=0.18, coat_rough=0.2, sheen=0.22, blushes=(), bump=0.012,
                  tint_hex=None, spec=0.5, sss_color_hex=None):
    """Soft-touch silicone / clay: subsurface scattering, satin coat, velvet sheen, micro bump.
    blushes: list of (empty_object, colour_hex, strength) -> soft painted-on blush via object-space falloff."""
    m, nt, out = _new_mat(name)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.subsurface_method = SSS_METHOD
    bsdf.distribution = 'MULTI_GGX'
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    base = hexc(base_hex)
    _inp(bsdf, 'Base Color', base)
    _inp(bsdf, 'Roughness', roughness)
    _inp(bsdf, 'Specular IOR Level', spec)
    _inp(bsdf, 'Subsurface Weight', sss_weight)
    _inp(bsdf, 'Subsurface Radius', sss_radius)
    _inp(bsdf, 'Subsurface Scale', sss_scale)
    _inp(bsdf, 'Coat Weight', coat)
    _inp(bsdf, 'Coat Roughness', coat_rough)
    _inp(bsdf, 'Sheen Weight', sheen)
    _inp(bsdf, 'Sheen Roughness', 0.45)
    _inp(bsdf, 'Sheen Tint', mix_hex('#FFFFFF', tint_hex or base_hex, 0.35))
    col_socket = None
    for (emp, bh, strength) in blushes:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        tc.object = emp
        ln = nt.nodes.new('ShaderNodeVectorMath')
        ln.operation = 'LENGTH'
        nt.links.new(tc.outputs['Object'], ln.inputs[0])
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.interpolation_type = 'SMOOTHSTEP'
        mr.clamp = True
        mr.inputs['From Min'].default_value = 1.0
        mr.inputs['From Max'].default_value = 0.0
        mr.inputs['To Min'].default_value = 0.0
        mr.inputs['To Max'].default_value = strength
        nt.links.new(ln.outputs['Value'], mr.inputs['Value'])
        mx = nt.nodes.new('ShaderNodeMixRGB')
        mx.blend_type = 'MIX'
        nt.links.new(mr.outputs['Result'], mx.inputs['Fac'])
        if col_socket is None:
            mx.inputs['Color1'].default_value = base
        else:
            nt.links.new(col_socket, mx.inputs['Color1'])
        mx.inputs['Color2'].default_value = hexc(bh)
        col_socket = mx.outputs['Color']
    if col_socket is not None:
        nt.links.new(col_socket, bsdf.inputs['Base Color'])
    if bump > 0:
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = 260.0
        nz.inputs['Detail'].default_value = 4.0
        nz.inputs['Roughness'].default_value = 0.6
        bp = nt.nodes.new('ShaderNodeBump')
        bp.inputs['Strength'].default_value = 0.35
        bp.inputs['Distance'].default_value = bump
        nt.links.new(nz.outputs['Fac'], bp.inputs['Height'])
        nt.links.new(bp.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def eye_material(name, style='bead', glow_hex='#FFF1D8'):
    """bead: glossy dark-brown eye with warm lower gradient. glow: soft emissive ivory eye."""
    m, nt, out = _new_mat(name)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -0.95
    mr.inputs['From Max'].default_value = 0.55
    mr.clamp = True
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    if style == 'bead':
        cr.elements[0].position = 0.0
        cr.elements[0].color = hexc('#5A2616')
        e1 = cr.elements.new(0.30)
        e1.color = hexc('#1C0B06')
        cr.elements[-1].position = 1.0
        cr.elements[-1].color = hexc('#070403')
        _inp(bsdf, 'Roughness', 0.12)
        _inp(bsdf, 'Coat Weight', 0.35)
        _inp(bsdf, 'Coat Roughness', 0.04)
        _inp(bsdf, 'IOR', 1.45)
        _inp(bsdf, 'Specular IOR Level', 0.35)
        _inp(bsdf, 'Emission Strength', 0.22)
    else:
        cr.elements[0].position = 0.0
        cr.elements[0].color = hexc('#FFD9A0')
        cr.elements[-1].position = 1.0
        cr.elements[-1].color = hexc(glow_hex)
        _inp(bsdf, 'Roughness', 0.25)
        _inp(bsdf, 'Coat Weight', 0.6)
        _inp(bsdf, 'Coat Roughness', 0.05)
        _inp(bsdf, 'Emission Strength', 2.6)
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Emission Color'])
    return m


def line_material(name, hex_color='#3A1A10', rough=0.3):
    m, nt, out = _new_mat(name)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    _inp(bsdf, 'Base Color', hexc(hex_color))
    _inp(bsdf, 'Roughness', max(rough, 0.55))
    _inp(bsdf, 'Specular IOR Level', 0.25)
    return m


def emissive_material(name, hex_color='#FFFFFF', strength=8.0):
    m, nt, out = _new_mat(name)
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = hexc(hex_color)
    em.inputs['Strength'].default_value = strength
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


def glass_material(name, tint_hex='#FFFFFF', ior=1.45, rough=0.02, shadow_clear=True):
    m, nt, out = _new_mat(name)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    _inp(bsdf, 'Base Color', hexc(tint_hex))
    _inp(bsdf, 'Roughness', rough)
    _inp(bsdf, 'IOR', ior)
    _inp(bsdf, 'Transmission Weight', 1.0)
    if shadow_clear:
        lp = nt.nodes.new('ShaderNodeLightPath')
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        mx = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(lp.outputs['Is Shadow Ray'], mx.inputs['Fac'])
        nt.links.new(bsdf.outputs['BSDF'], mx.inputs[1])
        nt.links.new(tr.outputs['BSDF'], mx.inputs[2])
        nt.links.new(mx.outputs['Shader'], out.inputs['Surface'])
    else:
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return m


def fabric_material(name, base_hex, rough=0.8, sheen=1.0, bump=0.02, noise_scale=180.0, satin=False):
    m, nt, out = _new_mat(name)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    _inp(bsdf, 'Base Color', hexc(base_hex))
    _inp(bsdf, 'Roughness', 0.38 if satin else rough)
    _inp(bsdf, 'Sheen Weight', sheen)
    _inp(bsdf, 'Sheen Roughness', 0.3)
    _inp(bsdf, 'Sheen Tint', mix_hex('#FFFFFF', base_hex, 0.5))
    if satin:
        _inp(bsdf, 'Anisotropic', 0.5)
        _inp(bsdf, 'Coat Weight', 0.2)
    if bump > 0:
        nz = nt.nodes.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = noise_scale
        nz.inputs['Detail'].default_value = 8.0
        bp = nt.nodes.new('ShaderNodeBump')
        bp.inputs['Strength'].default_value = 0.6
        bp.inputs['Distance'].default_value = bump
        nt.links.new(nz.outputs['Fac'], bp.inputs['Height'])
        nt.links.new(bp.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def metal_material(name, base_hex='#1B1917', rough=0.22, metallic=0.0, coat=1.0):
    m, nt, out = _new_mat(name)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    _inp(bsdf, 'Base Color', hexc(base_hex))
    _inp(bsdf, 'Roughness', rough)
    _inp(bsdf, 'Metallic', metallic)
    _inp(bsdf, 'Coat Weight', coat)
    _inp(bsdf, 'Coat Roughness', 0.05)
    return m


# --------------------------------------------------------------------------- meshes
def mesh_object(name, V, F, N=None, mat=None, parent=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.asarray(V, np.float64).tolist(), [], np.asarray(F, np.int64).tolist())
    me.update()
    me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), dtype=bool))
    if N is not None:
        me.normals_split_custom_set_from_vertices(np.asarray(N, np.float64).tolist())
    ob = bpy.data.objects.new(name, me)
    link(ob, parent)
    if mat is not None:
        me.materials.append(mat)
    return ob


_unit_sphere = {}


def unit_sphere_mesh(seg=64, rings=32):
    key = (seg, rings)
    if key not in _unit_sphere:
        me = bpy.data.meshes.new('unit_sphere_%d_%d' % key)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
        bm.to_mesh(me)
        bm.free()
        me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), dtype=bool))
        _unit_sphere[key] = me
    return _unit_sphere[key]


def basis(r, n, u):
    """Local frame: X = right, Y = into the surface (-n), Z = up."""
    r, n, u = Vector(r), Vector(n), Vector(u)
    return Matrix(((r.x, -n.x, u.x, 0), (r.y, -n.y, u.y, 0), (r.z, -n.z, u.z, 0), (0, 0, 0, 1)))


def _obj_mat(ob, mat):
    """Assign a material at object level so shared mesh data stays reusable."""
    me = ob.data
    if len(me.materials) == 0:
        me.materials.append(None)
    ob.material_slots[0].link = 'OBJECT'
    ob.material_slots[0].material = mat


def ellipsoid_object(name, center, frame, radii, mat, parent=None, seg=64, rings=32):
    ob = bpy.data.objects.new(name, unit_sphere_mesh(seg, rings))
    S = Matrix.Diagonal((radii[0], radii[1], radii[2], 1.0))
    ob.matrix_world = Matrix.Translation(Vector(center)) @ frame @ S
    link(ob, parent)
    _obj_mat(ob, mat)
    return ob


def tube(name, pts, radii, mat, parent=None, cap_spheres=True, bevel_res=8):
    """Smooth round tube along 3D points with per-point radius."""
    pts = np.asarray(pts, np.float64)
    radii = np.broadcast_to(np.asarray(radii, np.float64), (len(pts),))
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 1.0
    cu.bevel_resolution = bevel_res
    cu.resolution_u = 4
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (p[0], p[1], p[2], 1.0)
        sp.points[i].radius = float(radii[i])
    ob = bpy.data.objects.new(name, cu)
    link(ob, parent)
    cu.materials.append(mat)
    ob.name = name
    if cap_spheres:
        for i in (0, len(pts) - 1):
            s = bpy.data.objects.new(name + '_cap%d' % i, unit_sphere_mesh(24, 12))
            s.scale = (radii[i],) * 3
            s.location = pts[i]
            link(s, parent)
            _obj_mat(s, mat)
    return ob


def empty(name, loc=(0, 0, 0), scale=(1, 1, 1), parent=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = 'PLAIN_AXES'
    ob.empty_display_size = 0.05
    ob.location = loc
    ob.scale = scale
    link(ob, parent)
    return ob


def render(path, label=''):
    sc = bpy.context.scene
    sc.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    dt = time.time() - t
    print('[render] %s -> %s in %.1fs' % (label, path, dt), flush=True)
    return dt
