"""Resumable renderer for the Claude Code mod's character icons (transparent, square).

Matrix: body x colour x accessory x state (nokta: 5 colours x 4 accessories; the others: their own colour, none). Output: out/icons/<body>-<color>-<acc>-<state>.png
usage: python batch_icons.py [--preview] [--only substring]
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nk_shot as SH  # noqa: E402
import nk_char as C  # noqa: E402
import nk_scene as S  # noqa: E402

STATES = ['neutral', 'work', 'ask', 'approve', 'happy', 'worry', 'sleep']
# state -> pose override for icons (props are off, so the pointing arm of 'work' would point at nothing)
POSE = {'work': 'down'}
VIEW = {
    'nokta': ((0.10, 0.20), 1.78),
    'bulut': ((0.0, 0.25), 2.08),
    'tavsan': ((0.0, 0.45), 2.02),
    'ucgen': ((0.0, 0.18), 1.90),
}
DEFAULT_COLOR = {'nokta': 'clay', 'bulut': 'sky', 'tavsan': 'peach', 'ucgen': 'ink'}


def jobs():
    out = []
    for st in STATES:  # the primary character first
        out.append(('nokta', 'clay', 'none', st))
    for b in ('bulut', 'tavsan', 'ucgen'):
        for st in STATES:
            out.append((b, DEFAULT_COLOR[b], 'none', st))
    for c in ('sky', 'sage', 'kraft', 'ink'):
        for st in STATES:
            out.append(('nokta', c, 'none', st))
    for a in ('glasses', 'beret', 'bowtie'):
        for st in STATES:
            out.append(('nokta', 'clay', a, st))
    # every colour wears every accessory: the mod lets the person pick any pair
    for a in ('glasses', 'beret', 'bowtie'):
        for c in ('sky', 'sage', 'kraft', 'ink'):
            for st in STATES:
                out.append(('nokta', c, a, st))
    return out


def run(job, preview, outdir):
    body, color, acc, st = job
    name = '%s-%s-%s-%s' % job
    path = os.path.join(outdir, name + '.png')
    res = 192 if preview else 512
    spp = 16 if preview else 48
    t0 = time.time()
    SH.studio(res, res, spp, transparent=True, world_strength=0.75, exposure=0.1)
    C.build_character(body=body, color=color, state=st, accessory=None if acc == 'none' else acc,
                      quality='preview' if preview else 'mid', hover=0.0, yaw=-0.06, pose=POSE.get(st), extras=False)
    SH.fit_fixed(VIEW[body][0], half=VIEW[body][1])
    print('[build] %s %.1fs' % (name, time.time() - t0), flush=True)
    S.render(path + '.tmp.png', name)
    os.replace(path + '.tmp.png', path)


if __name__ == '__main__':
    preview = '--preview' in sys.argv
    only = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
    outdir = os.path.join(HERE, 'out', 'icons_preview' if preview else 'icons')
    os.makedirs(outdir, exist_ok=True)
    todo = jobs()
    for j in todo:
        name = '%s-%s-%s-%s' % j
        if only and only not in name:
            continue
        if os.path.exists(os.path.join(outdir, name + '.png')):
            print('[skip] ' + name, flush=True)
            continue
        try:
            run(j, preview, outdir)
        except Exception as e:  # keep going
            import traceback
            traceback.print_exc()
            print('[FAILED] %s: %s' % (name, e), flush=True)
    print('[done]', flush=True)
