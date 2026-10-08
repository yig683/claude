"""Renders the small 3D things that float around Nokta (the typing bubble, the "!" and "?", the z, sparks, hearts,
a sweat drop, confetti) as transparent sprites under the same studio light as the characters.

usage: python batch_sprites.py [--size 160] [--spp 48] [--only name]
out:   out/sprites/<name>.png
"""
import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nk_shot as SH  # noqa: E402
import nk_scene as S  # noqa: E402
import nk_props as PR  # noqa: E402
from nk_sdf import smin, sphere, ellipsoid, round_cone, rot_xyz, extract  # noqa: E402

CORAL = '#E07B57'
GOLD = '#E6B450'
SKY = '#8DB0CF'
SAGE = '#9DBB8A'


def ball(color, r=0.22):
    def f(P):
        return sphere(P, (0, 0, 0), r)
    V, F, N = extract(f, (-r * 1.3,) * 3, (r * 1.3,) * 3, r / 18.0, refine=2)
    return S.mesh_object('ball', V, F, N, PR.gloss_material('ball_' + color, color, rough=0.25, coat=0.6, sss=0.2), S.empty('root'))


def bubble():
    root = S.empty('bubble')
    mat = PR.gloss_material('bubble', '#FBF8F2', rough=0.22, coat=0.5, sss=0.15)
    PR._rbox('pill', (0, 0, 0), (0.62, 0.09, 0.30), 0.285, mat, root, 0.007)

    def tail(P):
        return round_cone(P, (-0.30, 0, -0.18), (-0.50, 0, -0.52), 0.13, 0.03)
    V, F, N = extract(tail, (-0.7, -0.2, -0.7), (-0.1, 0.2, 0.0), 0.008, refine=2)
    S.mesh_object('tail', V, F, N, mat, root)
    return root


def heart(color='#FF5C7A'):
    root = S.empty('heart')

    def f(P):
        x, y, z = P
        l = ellipsoid((x, y, z), (-0.20, 0, 0.17), (0.31, 0.20, 0.34), rot_xyz(0, 0.45, 0))
        r = ellipsoid((x, y, z), (0.20, 0, 0.17), (0.31, 0.20, 0.34), rot_xyz(0, -0.45, 0))
        tip = round_cone((x, y, z), (0, 0, -0.30), (0, 0, 0.12), 0.03, 0.34)
        return smin(smin(l, r, 0.07), tip, 0.10)
    V, F, N = extract(f, (-0.75, -0.4, -0.65), (0.75, 0.4, 0.75), 0.009, refine=2)
    S.mesh_object('heart', V, F, N, PR.gloss_material('heart_' + color, color, rough=0.2, coat=0.7, sss=0.3), root)
    return root


def make(name):
    root = S.empty('prop')
    if name == 'dot':
        ball(CORAL, 0.2)
        return 0.34
    if name == 'bubble':
        bubble()
        return 0.82
    if name == 'bang':
        PR.glyph('!', (0, 0, 0), size=1.5, color='#E0603A', parent=root, bevel=0.06, extrude=0.1)
        return 0.7
    if name == 'ask':
        PR.glyph('?', (0, 0, 0), size=1.5, color='#5C94D6', parent=root, bevel=0.06, extrude=0.1)
        return 0.7
    if name == 'z':
        PR.glyph('z', (0, 0, 0), size=1.4, color='#9AB4DC', parent=root, bevel=0.06, extrude=0.1)
        return 0.62
    if name == 'spark':
        PR.sparkle((0, 0, 0), r=0.36, color='#FFD98A', parent=root)
        return 0.46
    if name == 'heart':
        heart('#FF5C7A')
        return 0.55
    if name == 'heart2':
        heart('#FF93AB')
        return 0.55
    if name == 'drop':
        PR.sweat_drop((0, 0, -0.18), r=0.24, parent=root, tilt=0.0)
        return 0.5
    if name.startswith('conf'):
        color = {'confa': CORAL, 'confb': GOLD, 'confc': SKY, 'confd': SAGE}[name]
        ob = PR.confetti(1, 3, ((0, 0), (0, 0), (0, 0)), [color], parent=root, size=0.1)[0]
        ob.rotation_euler = (0.3, 0.5, 0.6)
        return 0.2
    raise ValueError(name)


NAMES = ['dot', 'bubble', 'bang', 'ask', 'z', 'spark', 'heart', 'heart2', 'drop', 'confa', 'confb', 'confc', 'confd']

if __name__ == '__main__':
    size = int(sys.argv[sys.argv.index('--size') + 1]) if '--size' in sys.argv else 160
    spp = int(sys.argv[sys.argv.index('--spp') + 1]) if '--spp' in sys.argv else 48
    only = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
    out = os.path.join(HERE, 'out', 'sprites')
    os.makedirs(out, exist_ok=True)
    manifest_path = os.path.join(out, 'manifest.json')
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    for name in NAMES:
        if only and only != name:
            continue
        path = os.path.join(out, name + '.png')
        t0 = time.time()
        SH.studio(size, size, spp, transparent=True, world_strength=0.75, exposure=0.1)
        half = make(name)
        SH.fit_fixed((0.0, 0.0), half=half)
        S.render(path + '.tmp.png', name)
        os.replace(path + '.tmp.png', path)
        manifest[name] = half
        json.dump(manifest, open(manifest_path, 'w'), indent=1)
        print('[sprite] %s %.1fs half=%.2f' % (name, time.time() - t0, half), flush=True)
    print('[done]', flush=True)
