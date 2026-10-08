"""Packs the rendered sprites into assets/props.json: { "<name>": { "half": scene units across half the picture, "w": base64 WebP } }.

usage: python build_props.py <sprites dir> <mod dir> [--quality 88]
(each sprite is packed at the size it is drawn at: a bubble 128 px, a speck of confetti 32)
"""
import base64
import io
import json
import os
import sys

from PIL import Image


def arg(flag, default):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


PX = {'bubble': 128, 'bang': 96, 'ask': 96, 'dot': 48, 'confa': 32, 'confb': 32, 'confc': 32, 'confd': 32}


def main():
    src, mod = sys.argv[1], sys.argv[2]
    quality = int(arg('--quality', 88))
    manifest = json.load(open(os.path.join(src, 'manifest.json')))
    pack = {}
    for name, half in sorted(manifest.items()):
        px = PX.get(name, 72)
        im = Image.open(os.path.join(src, name + '.png')).convert('RGBA')
        im = im.resize((px * 4, px * 4), Image.LANCZOS).resize((px, px), Image.BOX)
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=quality, method=6, alpha_quality=100)
        pack[name] = {'half': half, 'w': base64.b64encode(buf.getvalue()).decode('ascii')}
    os.makedirs(os.path.join(mod, 'assets'), exist_ok=True)
    target = os.path.join(mod, 'assets', 'props.json')
    with open(target, 'w') as f:
        json.dump(pack, f, separators=(',', ':'))
    print('%d sprites, %.0f KB' % (len(pack), os.path.getsize(target) / 1024))


if __name__ == '__main__':
    main()
