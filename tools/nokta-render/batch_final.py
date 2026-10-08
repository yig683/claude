"""Resumable batch renderer for the Nokta character system.

usage: python batch_final.py [--preview] [--force] [name ...]
  --preview  small, fast renders into out/preview/ (composition check)
  default    final renders into out/final/ (skips files that already exist)
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nk_shot as SH  # noqa: E402
import nk_char as C  # noqa: E402
import nk_scene as S  # noqa: E402

BG = dict(nokta='#E7E1D7', bulut='#DCE2E8', tavsan='#DDE1D3', ucgen='#E6E1DA')
STATE_BG = dict(sleep='#D8DFEA', work='#E3E5DA', ask='#E8E1D8', approve='#EDE3D5', happy='#F1E7CF', worry='#DADFE4',
                neutral='#E7E1D7')
BODY_VIEW = dict(nokta=((0.0, 0.10), 1.62), bulut=((0.0, 0.28), 1.80), tavsan=((0.0, 0.40), 1.88), ucgen=((0.0, 0.12), 1.76))
STATE_VIEW = dict(sleep=((0.45, 0.42), 1.9), work=((0.70, 0.22), 1.95), ask=((0.30, 0.38), 1.9),
                  approve=((0.28, 0.22), 1.9), happy=((0.0, 0.50), 1.9), worry=((0.12, 0.25), 1.9))
COLOR_BG = dict(clay='#E7E1D7', sky='#E7E1D7', sage='#E7E1D7', kraft='#E7E1D7', ink='#E7E1D7')


def J(name, **kw):
    kw['name'] = name
    return kw


JOBS = [
    J('hero', body='nokta', state='neutral', res=1200, spp=128, quality='final', view=BODY_VIEW['nokta'], bg=BG['nokta'], hover=0.15),
    J('group', kind='group', res=(2400, 1000), spp=96, quality='final'),
    J('body_bulut', body='bulut', state='neutral', res=900, spp=96, quality='final', view=BODY_VIEW['bulut'], bg=BG['bulut'], hover=0.15),
    J('body_tavsan', body='tavsan', state='neutral', res=900, spp=96, quality='final', view=BODY_VIEW['tavsan'], bg=BG['tavsan'], hover=0.15),
    J('body_ucgen', body='ucgen', state='neutral', res=900, spp=96, quality='final', view=BODY_VIEW['ucgen'], bg=BG['ucgen'], hover=0.15),
] + [
    J('state_' + st, body='nokta', state=st, res=900, spp=72, quality='mid', view=STATE_VIEW[st], bg=STATE_BG[st], hover=0.15)
    for st in ('sleep', 'work', 'ask', 'approve', 'happy', 'worry')
] + [
    J('color_' + c, body='nokta', state='neutral', color=c, res=700, spp=64, quality='mid', view=BODY_VIEW['nokta'], bg=COLOR_BG[c], hover=0.15)
    for c in ('clay', 'sky', 'sage', 'kraft', 'ink')
] + [
    J('acc_' + a, body='nokta', state='neutral', accessory=a, res=800, spp=72, quality='mid', view=((0.0, 0.25), 1.62), bg=BG['nokta'], hover=0.15)
    for a in ('glasses', 'beret', 'bowtie')
] + [
    J('icon_' + st, body='nokta', state=st, res=512, spp=48, quality='mid', view=((0.0, 0.04), 1.42), transparent=True,
      pose='down', extras=False, hover=0.0, yaw=-0.06)
    for st in ('approve', 'ask', 'work', 'happy', 'sleep', 'neutral', 'worry')
]


def group_scene(res, spp, quality):
    k = 2.4
    SH.studio(res[0], res[1], spp, bg='#E7E1D7', target=(0.5, 0.0, 0.35), lscale=k)
    lineup = [
        dict(body='tavsan', state='neutral', x=-4.25, y=0.5, yaw=0.30, hover=0.28),
        dict(body='nokta', state='approve', x=-1.40, y=-0.5, yaw=0.05, hover=0.12),
        dict(body='bulut', state='neutral', x=2.00, y=-0.1, yaw=-0.22, hover=0.20),
        dict(body='ucgen', state='neutral', x=5.20, y=0.5, yaw=-0.32, hover=0.12),
    ]
    for c in lineup:
        C.build_character(body=c['body'], state=c['state'], quality=quality, hover=c['hover'], yaw=c['yaw'], loc=(c['x'], c['y']),
                          extras=False)
    half_w = 6.2
    SH.fit_fixed((0.50, 0.66), half=half_w)


def run(job, preview):
    outdir = os.path.join(HERE, 'out', 'preview' if preview else 'final')
    os.makedirs(outdir, exist_ok=True)
    out = os.path.join(outdir, job['name'] + '.png')
    div = 3 if preview else 1
    spp = 24 if preview else job['spp']
    quality = 'preview' if preview else job['quality']
    res = job['res']
    res = (max(160, res[0] // div), max(160, res[1] // div)) if isinstance(res, tuple) else (max(160, res // div),) * 2
    t0 = time.time()
    if job.get('kind') == 'group':
        group_scene(res, spp, quality)
    else:
        tr = job.get('transparent', False)
        SH.studio(res[0], res[1], spp, transparent=tr, bg=job.get('bg', '#E7E1D7'),
                  world_strength=0.75 if tr else 0.045, exposure=0.1 if tr else 0.0)
        C.build_character(body=job['body'], state=job['state'], color=job.get('color'), accessory=job.get('accessory'), quality=quality,
                          hover=job.get('hover', 0.15), yaw=job.get('yaw', -0.10), pose=job.get('pose'), extras=job.get('extras', True))
        SH.fit_fixed(job['view'][0], half=job['view'][1])
    print('[build] %s %.1fs' % (job['name'], time.time() - t0), flush=True)
    S.render(out + '.tmp.png', job['name'])
    os.replace(out + '.tmp.png', out)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    preview = '--preview' in sys.argv
    force = '--force' in sys.argv
    todo = [j for j in JOBS if (not args or j['name'] in args)]
    for job in todo:
        outdir = os.path.join(HERE, 'out', 'preview' if preview else 'final')
        if os.path.exists(os.path.join(outdir, job['name'] + '.png')) and not force:
            print('[skip] %s' % job['name'], flush=True)
            continue
        try:
            run(job, preview)
        except Exception as e:  # keep the batch going
            import traceback
            traceback.print_exc()
            print('[FAILED] %s: %s' % (job['name'], e), flush=True)
    print('[done]', flush=True)
