"""Packs the rendered animation frames into the files the Nokta mod loads: one JSON per look.

in : <frames>/<body>-<color>-<accessory>/<mood>-<frame>.png      (RGBA, from batch_anim.py)
out: <mod>/assets/looks/<look>.json
       { "half": 1.78,                     scene units across half the picture (a body is about 1 unit wide)
         "box": [x0, y0, x1, y1],           the silhouette of neutral-open, as fractions of the picture
         "disc": [cx, cy, r],               the largest disc wholly inside that silhouette (where a plain face sits)
         "frames": { "<mood>-<frame>": { "h": base64 WebP (hero), "s": base64 WebP (small), "c": base64 RGBA 32x32, cropped to the figure } } }

usage: python build_looks.py <frames dir> <mod dir> [--hero 320] [--small 96] [--cells 32] [--quality 86] [--only substring]
"""
import base64
import glob
import io
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

# every picture the mod's director may ask for (motion.ts FRAMES): a look without all of them is not packed
FRAMES = {
    'neutral': ['open', 'half', 'shut', 'left', 'right'],
    'work': ['mid', 'left', 'right', 'half', 'shut'],
    'ask': ['open', 'half', 'shut'],
    'approve': ['w0', 'w1', 'w2'],
    'happy': ['a', 'b'],
    'worry': ['a', 'b', 'shut'],
    'sleep': ['a', 'b'],
    'love': ['a', 'b'],
}
NEEDED = {'%s-%s' % (mood, frame) for mood, frames in FRAMES.items() for frame in frames}

HALF = {'nokta': 1.78, 'bulut': 2.08, 'tavsan': 2.02, 'ucgen': 1.90}  # batch_anim.VIEW


def arg(flag, default):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


def downscale(im, size):
    """RGBA downscale in two steps; Pillow resamples RGBA premultiplied, so edges stay clean."""
    mid = im.resize((size * 4, size * 4), Image.LANCZOS)
    return mid.resize((size, size), Image.BOX)


def crisp(im, amount, radius=1.2):
    """A little local contrast so eyes and mouth survive the shrink to a couple of dozen pixels."""
    rgb = im.convert('RGB')
    blur = rgb.filter(ImageFilter.GaussianBlur(radius))
    a = np.asarray(rgb).astype(np.float32)
    b = np.asarray(blur).astype(np.float32)
    out = np.clip(a + (a - b) * amount, 0, 255).astype(np.uint8)
    res = Image.fromarray(out, 'RGB').convert('RGBA')
    res.putalpha(im.getchannel('A'))
    return res


def webp(im, quality):
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=quality, method=6, alpha_quality=100)
    return base64.b64encode(buf.getvalue()).decode('ascii')


def union_box(images):
    """The square around every pose of a look, with a margin: one crop for all of its frames, so they stay in step."""
    x0 = y0 = 10 ** 9
    x1 = y1 = 0
    for im in images:
        alpha = np.asarray(im.getchannel('A'))
        ys, xs = np.where(alpha > 128)
        x0, y0, x1, y1 = min(x0, xs.min()), min(y0, ys.min()), max(x1, xs.max() + 1), max(y1, ys.max() + 1)
    side = max(x1 - x0, y1 - y0) * 1.06
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, h = images[0].size
    left = max(0, min(w - side, cx - side / 2))
    top = max(0, min(h - side, cy - side / 2))
    return (int(round(left)), int(round(top)), int(round(left + side)), int(round(top + side)))


def disc_of(im):
    """Largest disc inside the silhouette: [cx, cy, r] as fractions of the picture, a little smaller than it could be."""
    solid = np.asarray(im.getchannel('A')).astype(np.float32) / 255.0 > 0.92
    dist = ndimage.distance_transform_edt(solid)
    y, x = np.unravel_index(int(np.argmax(dist)), dist.shape)
    h, w = solid.shape
    return [round((x + 0.5) / w, 4), round((y + 0.5) / h, 4), round(float(dist[y, x]) * 0.9 / w, 4)]


def silhouette(im):
    alpha = np.asarray(im.getchannel('A')).astype(np.float32) / 255.0
    ys, xs = np.where(alpha > 0.5)
    h, w = alpha.shape
    return [round(float(xs.min()) / w, 4), round(float(ys.min()) / h, 4), round(float(xs.max() + 1) / w, 4), round(float(ys.max() + 1) / h, 4)]


def main():
    src, mod = sys.argv[1], sys.argv[2]
    hero = int(arg('--hero', 320))
    small = int(arg('--small', 96))
    cells = int(arg('--cells', 32))
    quality = int(arg('--quality', 86))
    only = arg('--only', None)
    out_dir = os.path.join(mod, 'assets', 'looks')
    os.makedirs(out_dir, exist_ok=True)
    total = 0
    for folder in sorted(glob.glob(os.path.join(src, '*'))):
        name = os.path.basename(folder)
        if only and only not in name:
            continue
        files = sorted(f for f in glob.glob(os.path.join(folder, '*.png')) if '.tmp.' not in f)
        if not files:
            continue
        have = {os.path.basename(f)[:-4] for f in files}
        if not NEEDED <= have:
            print('%s: skipped, %d of %d pictures so far' % (name, len(have & NEEDED), len(NEEDED)))
            continue
        body = name.split('-')[0]
        pack = {'half': HALF[body], 'box': None, 'disc': None, 'frames': {}}
        images = {os.path.basename(path)[:-4]: Image.open(path).convert('RGBA') for path in files}
        crop = union_box(list(images.values()))
        for key, im in images.items():
            big = im if im.size == (hero, hero) else downscale(im, hero)
            if key == 'neutral-open':
                pack['box'] = silhouette(big)
                pack['disc'] = disc_of(big)
            pack['frames'][key] = {
                'h': webp(big, quality),
                's': webp(downscale(im, small), quality),
                'c': base64.b64encode(crisp(downscale(im.crop(crop), cells), 1.8, 1.0).tobytes()).decode('ascii'),
            }
        target = os.path.join(out_dir, name + '.json')
        with open(target, 'w') as f:
            json.dump(pack, f, separators=(',', ':'))
        size = os.path.getsize(target)
        total += size
        print('%s: %d frames, %.0f KB' % (name, len(pack['frames']), size / 1024))
    print('total %.1f MB' % (total / 1048576))


if __name__ == '__main__':
    main()
