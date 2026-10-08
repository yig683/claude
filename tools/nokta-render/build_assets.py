"""Turns the 512 px icon renders into the files the Nokta mod ships.

in : <renders>/<body>-<color>-<accessory>-<mood>.png   (RGBA, from batch_icons.py)
out: <mod>/assets/icons/<key>.png      224 px RGBA (the pane's SVG, kitty images)
     <mod>/assets/icons-s/<key>.png    96 px RGBA (the band's small avatar)
     <mod>/assets/raster.json          {width, height, rgba{key: base64}, disc{key: [cx, cy, r]}}
                                       small RGBA pictures for the terminal's half-block cells, and
                                       the largest disc wholly inside each silhouette (vector fallback)

usage: python build_assets.py <renders dir> <mod dir> [--cells N] [--png N] [--small N] [--preview DIR]
"""
import base64
import glob
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

PNG_SIZE = 224
SMALL_SIZE = 96
CELLS = 24


def arg(flag, default):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


def downscale(im, size):
    """RGBA downscale in two steps; Pillow resamples RGBA premultiplied, so edges stay clean."""
    mid = im.resize((size * 4, size * 4), Image.LANCZOS)
    return mid.resize((size, size), Image.BOX)


def crisp(im, amount):
    """A little local contrast so eyes and mouth survive the shrink to a couple of dozen pixels."""
    rgb = im.convert('RGB')
    blur = rgb.filter(__import__('PIL.ImageFilter', fromlist=['GaussianBlur']).GaussianBlur(1.2))
    a = np.asarray(rgb).astype(np.float32)
    b = np.asarray(blur).astype(np.float32)
    out = np.clip(a + (a - b) * amount, 0, 255).astype(np.uint8)
    res = Image.fromarray(out, 'RGB').convert('RGBA')
    res.putalpha(im.getchannel('A'))
    return res


def disc_of(im):
    """Largest disc inside the silhouette: [cx, cy, r] as fractions of the picture."""
    alpha = np.asarray(im.getchannel('A')).astype(np.float32) / 255.0
    solid = alpha > 0.92
    dist = ndimage.distance_transform_edt(solid)
    y, x = np.unravel_index(int(np.argmax(dist)), dist.shape)
    h, w = solid.shape
    return [round((x + 0.5) / w, 4), round((y + 0.5) / h, 4), round(float(dist[y, x]) * 0.9 / w, 4)]


def main():
    src, mod = sys.argv[1], sys.argv[2]
    cells = int(arg('--cells', CELLS))
    png = int(arg('--png', PNG_SIZE))
    small_px = int(arg('--small', SMALL_SIZE))
    preview = arg('--preview', None)
    icons = os.path.join(mod, 'assets', 'icons')
    icons_s = os.path.join(mod, 'assets', 'icons-s')
    os.makedirs(icons, exist_ok=True)
    os.makedirs(icons_s, exist_ok=True)
    if preview:
        os.makedirs(preview, exist_ok=True)
    pack = {'width': cells, 'height': cells, 'rgba': {}, 'disc': {}}
    files = sorted(f for f in glob.glob(os.path.join(src, '*.png')) if '.tmp.' not in f)
    total = 0
    for path in files:
        key = os.path.basename(path)[:-4]
        im = Image.open(path).convert('RGBA')
        big = downscale(im, png)
        big.save(os.path.join(icons, key + '.png'), optimize=True)
        downscale(im, small_px).save(os.path.join(icons_s, key + '.png'), optimize=True)
        total += os.path.getsize(os.path.join(icons, key + '.png'))
        pack['disc'][key] = disc_of(big)
        small = crisp(downscale(im, cells), 0.9)
        pack['rgba'][key] = base64.b64encode(small.tobytes()).decode('ascii')
        if preview:
            # what the terminal will show: one square pixel per half block, magnified
            small.resize((cells * 8, cells * 8), Image.NEAREST).save(os.path.join(preview, key + '.png'))
    with open(os.path.join(mod, 'assets', 'raster.json'), 'w') as f:
        json.dump(pack, f, separators=(',', ':'))
    print('%d icons, png total %.1f KB (avg %.1f KB), raster.json %.1f KB' % (
        len(files), total / 1024, total / 1024 / max(1, len(files)),
        os.path.getsize(os.path.join(mod, 'assets', 'raster.json')) / 1024))


if __name__ == '__main__':
    main()
