"""Renders the animation frames of the Nokta mod from the 3D models.

For every look (body x colour x accessory) and every mood: a handful of key expressions of the same model, such as
open, half-shut and shut eyes, glances left and right, the waving hand in three positions, the cheering arms.
The mod plays them in order and moves them (breathing, bobbing, hopping, tilting): see tools/nokta-render/README.md.

usage: python batch_anim.py [--size 320] [--spp 40] [--only substring] [--shard i/n] [--reverse] [--preview]
out:   out/frames/<body>-<color>-<accessory>/<mood>-<frame>.png   (transparent, square)
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nk_shot as SH  # noqa: E402
import nk_char as C  # noqa: E402
import nk_scene as S  # noqa: E402

DEFAULT_COLOR = {'nokta': 'clay', 'bulut': 'sky', 'tavsan': 'peach', 'ucgen': 'ink'}
VIEW = {
    'nokta': ((0.10, 0.20), 1.78),
    'bulut': ((0.0, 0.25), 2.08),
    'tavsan': ((0.0, 0.45), 2.02),
    'ucgen': ((0.0, 0.18), 1.90),
}


# what an accessory is made of: dark on most bodies, warm and light on the dark one, or it would vanish
ACCESSORY_STUFF = {'ink': dict(frame='#E9DCC8', cloth='#E07B57')}


def F(base, **kw):
    d = dict(C.FACE_STATES[base])
    d.update(kw)
    return d


def plan():
    """mood -> list of (body options, {frame name: face state}); one body build per entry."""
    return {
        'neutral': [(dict(pose='down'), {
            'open': F('neutral'),
            'half': F('neutral', lid=0.55),
            'shut': F('neutral', eyes='sleep', brow_as='open'),
            'left': F('neutral', look=(-1.7, 0.0)),
            'right': F('neutral', look=(1.7, 0.0)),
        })],
        'work': [(dict(pose='down'), {
            'mid': F('work', look=(0.0, -0.25)),
            'left': F('work', look=(-1.5, -0.25)),
            'right': F('work', look=(1.5, -0.25)),
            'half': F('work', look=(0.0, -0.25), lid=0.6),
            'shut': F('work', eyes='sleep', brow_as='focus'),
        })],
        'ask': [(dict(pose='down'), {
            'open': F('ask'),
            'half': F('ask', lid=0.5),
            'shut': F('ask', eyes='sleep', brow_as='wide'),
        })],
        'approve': [(dict(pose='wave', wave=w), {name: F('approve')}) for name, w in (('w0', -0.30), ('w1', 0.0), ('w2', 0.30))],
        'happy': [(dict(pose='cheer', sway=sw, blush=0.8), {name: F('happy', mouth=('open', 0.46, depth))})
                  for name, sw, depth in (('a', 0.20, 0.34), ('b', -0.20, 0.28))],
        'worry': [(dict(pose='down'), {
            'a': F('worry', mouth=('wavy', 0.28, 0.05)),
            'b': F('worry', mouth=('wavy', 0.28, -0.05)),
            'shut': F('worry', eyes='sleep', brow_as='open'),
        })],
        'sleep': [(dict(pose='sleep'), {
            'a': F('sleep'),
            'b': F('sleep', mouth=('o', 0.062, 0.082)),
        })],
        'love': [(dict(pose='down', blush=0.95), {
            'a': F('love'),
            'b': F('love', mouth=('open', 0.38, 0.26)),
        })],
    }


def looks():
    out = [('nokta', 'clay', 'none')]
    out += [(b, DEFAULT_COLOR[b], 'none') for b in ('bulut', 'tavsan', 'ucgen')]
    out += [('nokta', c, 'none') for c in ('sky', 'sage', 'kraft', 'ink')]
    out += [('nokta', 'clay', a) for a in ('glasses', 'beret', 'bowtie')]
    out += [('nokta', c, a) for a in ('glasses', 'beret', 'bowtie') for c in ('sky', 'sage', 'kraft', 'ink')]
    return out


def run(look, size, spp, preview, root):
    body, color, acc = look
    name = '%s-%s-%s' % look
    folder = os.path.join(root, name)
    os.makedirs(folder, exist_ok=True)
    for mood, variants in plan().items():
        for opts, frames in variants:
            todo = {k: v for k, v in frames.items() if not os.path.exists(os.path.join(folder, '%s-%s.png' % (mood, k)))}
            if not todo:
                continue
            t0 = time.time()
            SH.studio(size, size, spp, transparent=True, world_strength=0.75, exposure=0.1)
            kw = dict(opts)
            tilt = C.FACE_STATES[mood if mood in C.FACE_STATES else 'neutral'].get('tilt', 0.0)
            ctx = C.build_body(body=body, color=color, quality='preview' if preview else 'mid', yaw=-0.06, hover=0.0,
                               tilt=tilt, **kw)
            if acc != 'none':
                C.add_accessory(ctx['group'], body, acc,
                                C.Face(ctx['field'], ctx['layout'], ctx['mats'], ctx['group'], style=ctx['palette']['eye']),
                                **ACCESSORY_STUFF.get(color, {}))
            SH.fit_fixed(VIEW[body][0], half=VIEW[body][1])
            print('[build] %s %s %.1fs' % (name, mood, time.time() - t0), flush=True)
            for key, st in todo.items():
                face = C.build_face(ctx, st)
                path = os.path.join(folder, '%s-%s.png' % (mood, key))
                S.render(path + '.tmp.png', '%s %s-%s' % (name, mood, key))
                os.replace(path + '.tmp.png', path)
                C.clear_face(face)


if __name__ == '__main__':
    preview = '--preview' in sys.argv
    size = int(sys.argv[sys.argv.index('--size') + 1]) if '--size' in sys.argv else (192 if preview else 320)
    spp = int(sys.argv[sys.argv.index('--spp') + 1]) if '--spp' in sys.argv else (16 if preview else 40)
    only = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
    shard = [int(x) for x in sys.argv[sys.argv.index('--shard') + 1].split('/')] if '--shard' in sys.argv else [0, 1]
    root = os.path.join(HERE, 'out', 'frames_preview' if preview else 'frames')
    order = list(enumerate(looks()))
    if '--reverse' in sys.argv:
        order.reverse()
    for i, look in order:
        name = '%s-%s-%s' % look
        if only and only not in name:
            continue
        if '--reverse' not in sys.argv and i % shard[1] != shard[0]:
            continue
        try:
            run(look, size, spp, preview, root)
        except Exception as e:  # keep going
            import traceback
            traceback.print_exc()
            print('[FAILED] %s: %s' % (name, e), flush=True)
    print('[done]', flush=True)
