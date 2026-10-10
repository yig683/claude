// The shader that draws Nokta: the model of the Blender renders (tools/nokta-render/nk_char.py, nk_props.py) as
// signed distance fields, sphere traced, in the camera and the studio light of nk_shot.py (a 90 mm lens, six soft
// lights and a bright world). One pass over a full-screen triangle, four samples a pixel.
//
// What stands in the scene: a body (ball, cloud, rabbit or pillow-triangle), two arms joined to it by a smooth
// union, an accessory (glasses, a beret, a bow tie), and a face: glossy beads (or glowing ovals) for eyes with
// lids, brows and a mouth painted on the skin, blush, and the rabbit's nose and inner ears.
// Pure code: strings and numbers only. The browser parts (canvas, WebGL context) live in hero.ts.
import type { NoktaAccessory, NoktaBody } from '../types'
import { LIGHTS, STUDIO } from './hero-lights'
import { ACC_SLOTS, ACCESSORY_INDEX, BODY_INDEX, hexLinear, NP, NSLOT, P, SLOT } from './hero-slots'

const f6 = (x: number): string => x.toFixed(6)
const v3 = (a: readonly number[]): string => `vec3(${a.map(f6).join(', ')})`
const v2 = (a: readonly number[]): string => `vec2(${a.map(f6).join(', ')})`
/** '#rrggbb' as plain 0..1 values (not linear): for what is drawn as it is, with no light on it. */
const plain = (hex: string): string => v3([1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255))

/** The rectangles of the studio's lights as constants the mirror reflection reads. */
const studioConsts = (): string =>
  (Object.entries(STUDIO) as [string, (typeof STUDIO)[keyof typeof STUDIO]][])
    .map(([name, l]) => {
      const n = name.toUpperCase()
      return `const vec3 LP_${n} = ${v3(l.pos)};\nconst vec3 LX_${n} = ${v3(l.x)};\nconst vec3 LY_${n} = ${v3(l.y)};\nconst vec3 LN_${n} = ${v3(l.dir)};\nconst vec2 LH_${n} = ${v2(l.half)};\nconst float LW_${n} = ${f6(l.w)};`
    })
    .join('\n')

export const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

const defines = (): string => {
  const slots = Object.entries(SLOT)
    .filter(([k]) => k !== "acc0")
    .map(([k, v]) => `#define U_${k.toUpperCase()} uU[${v}]`)
    .join('\n')
  const acc = Array.from({ length: ACC_SLOTS }, (_, i) => `#define U_ACC${i} uU[${SLOT.acc0 + i}]`).join('\n')
  const params = Object.entries(P)
    .map(([k, v]) => `#define P_${k.toUpperCase()} uP[${v}]`)
    .join('\n')
  return `${slots}\n${acc}\n${params}`
}

/** The look a program is made for. */
export type Spec = { body: NoktaBody; accessory: NoktaAccessory }

/**
 * The shader. Given a look it holds that look's body and accessory only (they are constants, and what the look does not
 * need is not built): the first build of a program on a machine can take twenty seconds when all four bodies and all
 * the accessories are in it, and two to four when only one is. Given none it holds them all, choosing from the
 * numbers it is handed (what the tools use).
 */
export function fragSource(spec?: Spec): string {
  const bodyKind = spec === undefined ? 'int(U_VIEW.w + 0.5)' : String(BODY_INDEX[spec.body])
  const accKind = spec === undefined ? 'int(U_STYLE.x + 0.5)' : String(ACCESSORY_INDEX[spec.accessory])
  return `#version 300 es
precision highp float;
uniform vec2 uRes;
// samples to a pixel: 4 (two across) or 1 (a slow card); a loop, so that the program holds the drawing of a sample once
uniform int uSamples;
uniform vec4 uU[${NSLOT}];
uniform float uP[${NP}];
out vec4 fragColor;
${defines()}

const vec3 L_KEY = ${v3(LIGHTS.key.dir)};
const vec3 L_FILL = ${v3(LIGHTS.fill.dir)};
const vec3 L_RIML = ${v3(LIGHTS.rimL.dir)};
const vec3 L_RIMR = ${v3(LIGHTS.rimR.dir)};
const vec3 L_TOP = ${v3(LIGHTS.top.dir)};
const vec3 L_BOUNCE = ${v3(LIGHTS.bounce.dir)};
const vec3 C_KEY = ${v3(LIGHTS.key.col)};
const vec3 C_FILL = ${v3(LIGHTS.fill.col)};
const vec3 C_RIML = ${v3(LIGHTS.rimL.col)};
const vec3 C_RIMR = ${v3(LIGHTS.rimR.col)};
const vec3 C_BOUNCE = ${v3(LIGHTS.bounce.col)};
const vec3 NOSEC = ${v3(hexLinear('#C9666B'))};
const vec3 INNERC = ${v3(hexLinear('#F6B1AE'))};
const vec3 EYE0 = ${v3(hexLinear('#5A2616'))};
const vec3 EYE1 = ${v3(hexLinear('#1C0B06'))};
const vec3 EYE2 = ${v3(hexLinear('#070403'))};
// the glowing eyes: ivory, a little warmer below, as the render shows them (nk_scene.eye_material 'glow'); no light on them
const vec3 GLOW0 = ${plain('#FFE5C1')};
const vec3 GLOW1 = ${plain('#FDF4E4')};
${studioConsts()}

// where the point being drawn is in the studio, and the way the camera looks at it: what a mirror needs
vec3 gPw = vec3(0.0);
vec3 gRd = vec3(0.0, 1.0, 0.0);

float c01(float x) { return clamp(x, 0.0, 1.0); }
float smooth2(float a, float b, float x) { float t = c01((x - a) / (b - a)); return t * t * (3.0 - 2.0 * t); }
float wrap(float x, float k) { return c01((x + k) / (1.0 + k)); }

mat3 rotXYZ(vec3 e) {
  float cx = cos(e.x), sx = sin(e.x), cy = cos(e.y), sy = sin(e.y), cz = cos(e.z), sz = sin(e.z);
  mat3 Rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
  mat3 Ry = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
  mat3 Rz = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0);
  return Rz * Ry * Rx;
}

float smin(float a, float b, float k) {
  float h = c01(0.5 + 0.5 * (b - a) / k);
  return b * (1.0 - h) + a * h - k * h * (1.0 - h);
}
float smax(float a, float b, float k) { return -smin(-a, -b, k); }

float sdEll(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k1 < 1e-8 ? -min(r.x, min(r.y, r.z)) : k0 * (k0 - 1.0) / k1;
}

float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a;
  float l2 = dot(ba, ba);
  float rr = r1 - r2;
  float a2 = l2 - rr * rr;
  float il2 = 1.0 / l2;
  vec3 pa = p - a;
  float y = dot(pa, ba);
  float z = y - l2;
  vec3 v = pa * l2 - ba * y;
  float x2 = dot(v, v);
  float y2 = y * y * l2;
  float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = c01(dot(pa, ba) / dot(ba, ba));
  return length(pa - ba * h) - r;
}

float sdTorusN(vec3 p, vec3 c, vec3 n, float R, float r) {
  vec3 q = p - c;
  float qa = dot(q, n);
  float qp = length(q - n * qa);
  return length(vec2(qp - R, qa)) - r;
}

float tri2d(vec2 p, vec2 A, vec2 B, vec2 C) {
  vec2 e0 = B - A, e1 = C - B, e2 = A - C;
  vec2 v0 = p - A, v1 = p - B, v2 = p - C;
  vec2 pq0 = v0 - e0 * c01(dot(v0, e0) / dot(e0, e0));
  vec2 pq1 = v1 - e1 * c01(dot(v1, e1) / dot(e1, e1));
  vec2 pq2 = v2 - e2 * c01(dot(v2, e2) / dot(e2, e2));
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}

// ---------------------------------------------------------------- the bodies

int bodyKind() { return ${bodyKind}; }

float bodyShape(vec3 p) {
  int kind = bodyKind();
  vec3 s = U_SCALE.xyz;
  float ms = min(s.x, min(s.y, s.z));
  if (kind == 1) {
    vec3 q = p / s;
    float d = length(q - vec3(0.0, 0.0, 0.10)) - 0.86;
    d = smin(d, length(q - vec3(-0.98, 0.02, -0.12)) - 0.56, 0.20);
    d = smin(d, length(q - vec3(0.98, 0.02, -0.12)) - 0.56, 0.20);
    d = smin(d, length(q - vec3(-0.58, 0.00, 0.80)) - 0.52, 0.20);
    d = smin(d, length(q - vec3(0.10, 0.00, 1.02)) - 0.50, 0.20);
    d = smin(d, length(q - vec3(0.66, 0.00, 0.74)) - 0.47, 0.20);
    d = smin(d, length(q - vec3(-0.50, -0.05, -0.62)) - 0.44, 0.20);
    d = smin(d, length(q - vec3(0.50, -0.05, -0.62)) - 0.44, 0.20);
    d = smin(d, length(q - vec3(0.00, 0.10, -0.55)) - 0.50, 0.20);
    return smax(d, -(q.z + 1.02), 0.16) * ms;
  }
  if (kind == 2) {
    float d = sdEll(p, vec3(1.0, 0.92, 0.92) * s);
    float sw = U_STYLE.y;
    d = smin(d, sdRoundCone(p, vec3(-0.42, 0.12, 0.66), vec3(-0.63 + sw, 0.15, 1.52 - abs(sw) * 0.1), 0.265, 0.20), 0.17);
    d = smin(d, sdRoundCone(p, vec3(0.42, 0.12, 0.66), vec3(0.63 + sw, 0.15, 1.52 - abs(sw) * 0.1), 0.265, 0.20), 0.17);
    return d;
  }
  if (kind == 3) {
    vec3 q = p / s;
    float d2 = tri2d(q.xz, vec2(0.0, 0.92), vec2(0.98, -0.74), vec2(-0.98, -0.74)) - 0.58;
    float wx = d2 + 0.36;
    float wy = abs(q.y) - 0.18 + 0.36;
    return (length(max(vec2(wx, wy), 0.0)) + min(max(wx, wy), 0.0) - 0.36) * ms;
  }
  return sdEll(p, vec3(1.0, 0.96, 0.95) * s);
}

float mapBody(vec3 p) {
  float d = bodyShape(p);
  if (U_ARMLS.w > 0.001 || U_ARMLH.w > 0.001) d = smin(d, sdRoundCone(p, U_ARMLS.xyz, U_ARMLH.xyz, U_ARMLS.w, U_ARMLH.w), 0.11);
  if (U_ARMRS.w > 0.001 || U_ARMRH.w > 0.001) d = smin(d, sdRoundCone(p, U_ARMRS.xyz, U_ARMRH.xyz, U_ARMRS.w, U_ARMRH.w), 0.11);
  return d;
}

// the inner ears of the rabbit: a pink patch standing a little proud of the front of each ear (nk_char.body_field.inner)
float mapInner(vec3 p) {
  if (bodyKind() != 2) return 1e9;
  float sw = U_STYLE.y;
  float d = 1e9;
  for (int i = 0; i < 2; i++) {
    float sx = i == 0 ? -1.0 : 1.0;
    vec3 a = vec3(sx * 0.42, 0.12, 0.66);
    vec3 b = vec3(sx * 0.63 + sw, 0.15, 1.52 - abs(sw) * 0.1);
    float r1 = 0.265;
    float r2 = 0.20;
    float ya = a.y - r1 * 0.93;
    float yb = b.y - r2 * 0.93;
    vec3 a2 = vec3(a.x, ya, a.z + 0.22);
    vec3 b2 = vec3(b.x, yb, b.z - 0.20);
    float ym = (ya + yb) * 0.5;
    float yy = (p.y - ym) * 2.6 + ym;
    d = min(d, sdRoundCone(vec3(p.x, yy, p.z), a2, b2, r1 * 0.52, r2 * 0.46) / 2.6);
  }
  return d;
}

// ---------------------------------------------------------------- the accessories

int accKind() { return ${accKind}; }

float mapAcc(vec3 p) {
  int k = accKind();
  if (k == 1) {
    float d = sdTorusN(p, U_ACC0.xyz, U_ACC1.xyz, U_ACC0.w, 0.0155);
    d = min(d, sdTorusN(p, U_ACC2.xyz, U_ACC3.xyz, U_ACC2.w, 0.0155));
    d = min(d, min(sdCapsule(p, U_ACC4.xyz, U_ACC5.xyz, 0.0125), sdCapsule(p, U_ACC5.xyz, U_ACC6.xyz, 0.0125)));
    d = min(d, min(sdCapsule(p, U_ACC7.xyz, U_ACC8.xyz, 0.0125), sdCapsule(p, U_ACC8.xyz, U_ACC9.xyz, 0.0125)));
    d = min(d, min(sdCapsule(p, U_ACC10.xyz, U_ACC11.xyz, 0.0125), sdCapsule(p, U_ACC11.xyz, U_ACC12.xyz, 0.0125)));
    return d;
  }
  if (k == 2) {
    float c = cos(U_ACC0.w);
    float s = sin(U_ACC0.w);
    vec3 q = p - U_ACC0.xyz;
    vec3 ql = vec3(c * q.x - s * q.z, q.y, s * q.x + c * q.z);
    float d1 = (length(ql / vec3(0.8, 0.8, 0.3)) - 1.0) * 0.30;
    vec3 q2 = p - U_ACC1.xyz;
    vec3 ql2 = vec3(c * q2.x - s * q2.z, q2.y, s * q2.x + c * q2.z);
    return min(d1, sdEll(ql2, vec3(0.045, 0.045, 0.085)));
  }
  if (k == 3) {
    vec3 q = p - U_ACC0.xyz;
    vec3 ql = vec3(dot(q, U_ACC1.xyz), dot(q, U_ACC2.xyz), dot(q, U_ACC3.xyz));
    ql.x /= 1.15;
    ql.z /= 1.15;
    vec3 w = vec3(ql.x, ql.y * 2.2, ql.z);
    float d = min(sdRoundCone(w, vec3(-0.05, 0.0, 0.0), vec3(-0.30, 0.0, 0.0), 0.04, 0.17), sdRoundCone(w, vec3(0.05, 0.0, 0.0), vec3(0.30, 0.0, 0.0), 0.04, 0.17));
    float knot = length(vec3(ql.x, ql.y * 1.6, ql.z)) - 0.06;
    return smin(d, knot, 0.04) / 2.2;
  }
  return 1e9;
}

float map(vec3 p) {
  float d = mapBody(p);
  if (accKind() > 0) d = min(d, mapAcc(p));
  if (bodyKind() == 2) d = min(d, mapInner(p));
  return d;
}

float segD(vec2 p, vec2 a, vec2 b) {
  vec2 d = b - a;
  float t = c01(dot(p - a, d) / max(dot(d, d), 1e-9));
  return length(a + d * t - p);
}

// the first hit of a ray with an ellipsoid whose frame is (ax, ay, az) and radii rad; t, the unit-sphere point and the normal come back
float hitEll(vec3 ro, vec3 rd, vec3 c, vec3 ax, vec3 ay, vec3 az, vec3 rad, out vec3 pl, out vec3 nrm) {
  vec3 o = ro - c;
  vec3 ol = vec3(dot(o, ax), dot(o, ay), dot(o, az)) / rad;
  vec3 dl = vec3(dot(rd, ax), dot(rd, ay), dot(rd, az)) / rad;
  float a = dot(dl, dl);
  float b = dot(ol, dl);
  float cc = dot(ol, ol) - 1.0;
  float h = b * b - a * cc;
  pl = vec3(0.0);
  nrm = vec3(0.0, -1.0, 0.0);
  if (h < 0.0) return -1.0;
  float t = (-b - sqrt(h)) / a;
  pl = ol + dl * t;
  vec3 nl = pl / rad;
  nrm = normalize(ax * nl.x + ay * nl.y + az * nl.z);
  return t;
}

// the painted part of the face: blush, brows, mouth and closed-eye arcs; dc is how much of the pixel is a line
vec3 paintFace(vec3 p, vec3 col, float px, out float dc) {
  dc = 0.0;
  vec2 uv = p.xz;
  vec2 look = U_FACE0.yz * 0.05;
  float ex = U_LAYOUT.x;
  float ey = U_LAYOUT.y;
  // cheeks: a soft ellipse about each blush centre (the empties of nk_char.build_body)
  for (int s = 0; s < 2; s++) {
    vec3 c = s == 0 ? U_CHEEKL.xyz : U_CHEEKR.xyz;
    vec3 q = (p - c) / vec3(0.17, 0.22, 0.17);
    col = mix(col, U_BLUSH.rgb, U_FACE3.x * smooth2(1.0, 0.0, length(q)));
  }
  if (U_FACE6.w > 0.01) {
    for (int s = 0; s < 2; s++) {
      float sx = s == 0 ? -1.0 : 1.0;
      float inner = s == 0 ? U_FACE1.x : U_FACE1.y;
      float dv = s == 0 ? U_FACE1.z : U_FACE1.w;
      float dmin = 1e9;
      vec2 prev = vec2(0.0);
      float prevRad = 0.0;
      for (int i = 0; i <= 10; i++) {
        float t = float(i) / 10.0 * 2.0 - 1.0;
        vec2 b = vec2(sx * ex + sx * 0.15 * t * cos(inner) + look.x, U_LAYOUT.z + dv - t * 0.15 * sin(inner) + 0.025 * (1.0 - t * t) + look.y);
        if (i > 0) dmin = min(dmin, segD(uv, prev, b) - prevRad);
        prev = b;
        prevRad = 0.046 * P_BROWTHICK * (0.6 + 0.4 * (1.0 - t * t));
      }
      float a = c01(0.5 - dmin / px) * U_FACE6.w;
      col = mix(col, U_LINE.rgb, a);
      dc = max(dc, a);
    }
  }
  // the mouth as a stroke: one curve that is a smile, flat, a smirk or a wave depending on four numbers
  if (U_FACE4.y > 0.01) {
    float amp = U_FACE2.x;
    float w = U_FACE2.y;
    float skew = U_FACE2.z;
    float wavy = U_FACE2.w;
    float v0 = U_FACE4.x;
    float dmin = 1e9;
    vec2 prev = vec2(0.0);
    for (int i = 0; i <= 14; i++) {
      float t = float(i) / 14.0 * 2.0 - 1.0;
      float vv = v0 + amp * (t * t - 0.5) * mix(1.0, 0.5 + 0.5 * t, skew) + 0.02 * skew * t + wavy * sin(t * 4.712389);
      vec2 b = vec2(w * t, vv);
      if (i > 0) dmin = min(dmin, segD(uv, prev, b) - 0.034 * (0.62 + 0.38 * (1.0 - t * t)));
      prev = b;
    }
    float a = c01(0.5 - dmin / px) * U_FACE4.y;
    col = mix(col, U_LINE.rgb, a);
    dc = max(dc, a);
  }
  // the open mouth: a dark D with a tongue and a lip line round it
  if (U_FACE4.z > 0.01) {
    float w = U_FACE5.x;
    float dep = U_FACE5.y;
    float v0 = U_FACE5.z;
    float s = uv.x / w;
    float sc = clamp(s, -1.0, 1.0);
    float top = v0 + 0.10 * dep * (sc * sc - 0.5);
    float bot = top - dep * pow(max(1.0 - sc * sc, 0.0), 0.75);
    float inside = c01(0.5 + min(top - uv.y, uv.y - bot) / px) * c01(0.5 + (1.0 - abs(s)) * w / px) * U_FACE4.z;
    // (the render has the cavity just under the skin: it shows as the skin gone a little darker, the more so lower down)
    float depthK = c01((top - uv.y) / max(top - bot, 1e-4));
    col = mix(col, col * mix(0.90, 0.78, depthK), inside);
    float dl = 1e9;
    vec2 pt = vec2(0.0);
    vec2 pb = vec2(0.0);
    for (int i = 0; i <= 14; i++) {
      float t = float(i) / 14.0 * 2.0 - 1.0;
      float tp = v0 + 0.10 * dep * (t * t - 0.5);
      vec2 bt = vec2(w * t, tp);
      vec2 bb = vec2(w * t, tp - dep * pow(max(1.0 - t * t, 0.0), 0.75));
      float rad = 0.02 * (0.5 + 0.5 * (1.0 - t * t));
      if (i > 0) dl = min(dl, min(segD(uv, pt, bt), segD(uv, pb, bb)) - rad);
      pt = bt;
      pb = bb;
    }
    float lip = c01(0.5 - dl / px) * U_FACE4.z;
    col = mix(col, U_LINE.rgb, lip);
    dc = max(dc, lip);
  }
  // the round mouth: a small dark O with a ring
  if (U_FACE4.w > 0.01) {
    float w = U_FACE6.x;
    float dep = U_FACE6.y;
    float v0 = U_FACE6.z;
    vec2 q = vec2(uv.x, uv.y - v0) / vec2(w, dep);
    float r = length(q);
    float rm = min(w, dep);
    float inside = c01(0.5 - (r - 1.0) * rm / px) * U_FACE4.w;
    col = mix(col, col * 0.86, inside);
    float ring = c01(0.5 - (abs(r - 1.0) * rm - 0.02) / px) * U_FACE4.w;
    col = mix(col, U_LINE.rgb, ring);
    dc = max(dc, ring);
  }
  // closed eyes drawn as arcs: ^ when happy (arcH above 0), U when asleep (below 0)
  if (U_FACE3.y > 0.01) {
    float h = U_FACE3.w;
    for (int s = 0; s < 2; s++) {
      float sx = s == 0 ? -1.0 : 1.0;
      vec2 c0 = vec2(sx * ex + look.x, ey + look.y);
      float dmin = 1e9;
      vec2 prev = vec2(0.0);
      float prevRad = 0.0;
      for (int i = 0; i <= 14; i++) {
        float t = float(i) / 14.0 * 2.0 - 1.0;
        vec2 b = vec2(c0.x + U_LAYOUT2.x * U_FACE3.z * 1.05 * t, c0.y + h * (1.0 - t * t) - h * 0.3);
        if (i > 0) dmin = min(dmin, segD(uv, prev, b) - prevRad);
        prev = b;
        prevRad = 0.034 * (0.55 + 0.45 * sqrt(1.0 - t * t + 1e-3));
      }
      float a = c01(0.5 - dmin / px) * U_FACE3.y;
      col = mix(col, U_LINE.rgb, a);
      dc = max(dc, a);
    }
  }
  return col;
}

vec3 tone(vec3 x) {
  // Khronos PBR neutral, the view transform of the renders
  float startCompression = 0.8 - 0.04;
  float desaturation = 0.15;
  float xm = min(x.r, min(x.g, x.b));
  float offset = xm < 0.08 ? xm - 6.25 * xm * xm : 0.04;
  x -= offset;
  float peak = max(x.r, max(x.g, x.b));
  if (peak < startCompression) return x;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  x *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(x, vec3(newPeak), g);
}

vec3 srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// a studio light seen in the mirror of a surface: how much of the blurred spot the reflected ray makes on the light's
// rectangle lies inside it, 0 to 1 (p the point, r the reflected ray, blur the tangent of how far the mirror smears)
float rectRefl(vec3 p, vec3 r, vec3 lp, vec3 lx, vec3 ly, vec3 ln, vec2 hs, float blur) {
  float dn = dot(r, ln);
  if (dn > -1e-4) return 0.0;
  float t = dot(lp - p, ln) / dn;
  if (t <= 0.0) return 0.0;
  vec3 q = p + r * t - lp;
  float b = max(blur * t, 1e-3);
  return c01(0.5 + 0.5 * (hs.x - abs(dot(q, lx))) / b) * c01(0.5 + 0.5 * (hs.y - abs(dot(q, ly))) / b);
}

// what a mirror at p with the normal n shows of the studio: the six lights as rectangles, each as bright as it was, and a pale world
vec3 studio(vec3 p, vec3 n, float blur) {
  vec3 r = reflect(gRd, n);
  vec3 s = vec3(P_WORLD) * vec3(0.9, 0.88, 0.85);
  s += LW_KEY * C_KEY * rectRefl(p, r, LP_KEY, LX_KEY, LY_KEY, LN_KEY, LH_KEY, blur);
  s += LW_FILL * C_FILL * rectRefl(p, r, LP_FILL, LX_FILL, LY_FILL, LN_FILL, LH_FILL, blur);
  s += LW_RIML * C_RIML * rectRefl(p, r, LP_RIML, LX_RIML, LY_RIML, LN_RIML, LH_RIML, blur);
  s += LW_RIMR * C_RIMR * rectRefl(p, r, LP_RIMR, LX_RIMR, LY_RIMR, LN_RIMR, LH_RIMR, blur);
  s += LW_TOP * rectRefl(p, r, LP_TOP, LX_TOP, LY_TOP, LN_TOP, LH_TOP, blur);
  s += LW_BOUNCE * C_BOUNCE * rectRefl(p, r, LP_BOUNCE, LX_BOUNCE, LY_BOUNCE, LN_BOUNCE, LH_BOUNCE, blur);
  return s;
}

// the mirror part of a glossy surface: k looking straight on, more at a slant
vec3 envRefl(vec3 n, vec3 viewW, float k, float blur) {
  if (k <= 0.0) return vec3(0.0);
  float f = pow(1.0 - c01(dot(n, viewW)), 5.0);
  return k * (1.0 + P_ENVF * f) * studio(gPw, n, blur);
}

// the studio light on a surface: normal in world space, view direction, colour of the surface, how open the sky is,
// how much of the pixel is a painted line (those take no light from under the skin)
vec3 lightBase(vec3 nw, vec3 viewW, vec3 albedo, float ao, float dc) {
  float kw = wrap(dot(nw, L_KEY), P_KEYWRAP);
  vec3 diff = vec3(P_AMBIENT) * vec3(P_AMBR, P_AMBG, P_AMBB) * ao;
  diff += P_KEY * kw * C_KEY;
  diff += P_FILL * wrap(dot(nw, L_FILL), P_FILLWRAP) * C_FILL;
  diff += P_RIML * wrap(dot(nw, L_RIML), P_RIMWRAP) * C_RIML + P_RIMR * wrap(dot(nw, L_RIMR), P_RIMWRAP) * C_RIMR;
  diff += P_TOP * wrap(dot(nw, L_TOP), 0.5);
  diff += P_BOUNCE * wrap(dot(nw, L_BOUNCE), 0.5) * C_BOUNCE;
  float fres = pow(1.0 - c01(dot(nw, viewW)), P_SHEENPOW);
  vec3 col = albedo * diff;
  float add = 1.0 - 0.9 * dc;
  col += vec3(P_SSSR, P_SSSG, P_SSSB) * P_SSS * c01(kw * 1.15 - kw * kw) * U_TINT.rgb * add;
  col += U_TINT.rgb * P_SHEEN * fres * add;
  // a painted line is matte: the shine of the skin does not lie on it
  float shine = 1.0 - P_LINEMATTE * dc;
  vec3 hk = normalize(L_KEY + viewW);
  col += vec3(P_SPEC) * pow(c01(dot(nw, hk)), P_SPECEXP) * C_KEY * shine;
  col += vec3(P_COAT) * pow(c01(dot(nw, hk)), P_COATEXP) * shine;
  vec3 hl = normalize(L_RIML + viewW);
  vec3 hr = normalize(L_RIMR + viewW);
  col += vec3(P_RIMSPEC) * (pow(c01(dot(nw, hl)), P_RIMSPECEXP) * C_RIML + pow(c01(dot(nw, hr)), P_RIMSPECEXP) * C_RIMR) * shine;
  return col;
}

// the skin: lit, and the studio mirrored in it as far as the look is glossy
vec3 lightBody(vec3 nw, vec3 viewW, vec3 albedo, float ao, float dc) {
  return lightBase(nw, viewW, albedo, ao, dc) + envRefl(nw, viewW, P_ENV * (1.0 - P_LINEMATTE * dc), P_ENVBLUR);
}

// glossy metal (the frame of glasses) and soft cloth (a beret, a bow tie)
vec3 lightMetal(vec3 nw, vec3 viewW, vec3 albedo, float ao) {
  return lightBase(nw, viewW, albedo, ao, 1.0) + envRefl(nw, viewW, P_ENVMETAL, 0.06);
}

vec3 lightCloth(vec3 nw, vec3 viewW, vec3 albedo, float ao) {
  vec3 col = lightBase(nw, viewW, albedo, ao, 1.0);
  float fres = pow(1.0 - c01(dot(nw, viewW)), 2.0);
  col += mix(vec3(1.0), albedo, 0.45) * 0.3 * fres;
  return col;
}

vec4 sampleAt(vec2 frag) {
  // the camera: a 90 mm lens on a 36 mm sensor, five times the half width away and a little above (nk_shot.fit_fixed)
  float cx = U_VIEW.x;
  float cz = U_VIEW.y;
  float half_ = U_VIEW.z;
  float dist = half_ * 5.0;
  vec3 camPos = vec3(cx, -dist, cz + dist * 0.1);
  vec3 target = vec3(cx, 0.0, cz);
  vec3 fwd = normalize(target - camPos);
  vec3 right = normalize(cross(fwd, vec3(0.0, 0.0, 1.0)));
  vec3 up = cross(right, fwd);
  vec2 ndc = vec2(frag.x / uRes.x * 2.0 - 1.0, 1.0 - frag.y / uRes.y * 2.0);
  vec3 rdW = normalize(fwd + right * (ndc.x * 0.2) + up * (ndc.y * 0.2));
  mat3 R = rotXYZ(U_ROT.xyz);
  mat3 Rt = transpose(R);
  vec3 ro = Rt * (camPos - U_LOC.xyz);
  vec3 rd = Rt * rdW;
  float b = dot(ro, rd);
  float c = dot(ro, ro) - 5.0;
  float h = b * b - c;
  if (h < 0.0) return vec4(0.0);
  float t = -b - sqrt(h);
  float tFar = -b + sqrt(h);
  bool hit = false;
  for (int i = 0; i < 80; i++) {
    float d = map(ro + rd * t);
    if (d < 0.0007) { hit = true; break; }
    t += d;
    if (t > tFar) break;
  }
  if (!hit) return vec4(0.0);
  float tb = t;
  vec3 p = ro + rd * t;
  float e = 0.0015;
  vec3 n = normalize(
    vec3(1.0, -1.0, -1.0) * map(p + vec3(e, -e, -e)) +
    vec3(-1.0, -1.0, 1.0) * map(p + vec3(-e, -e, e)) +
    vec3(-1.0, 1.0, -1.0) * map(p + vec3(-e, e, -e)) +
    vec3(1.0, 1.0, 1.0) * map(p + vec3(e, e, e)));
  vec3 viewW = -rdW;
  float px = 2.0 * half_ / uRes.x * 0.9;
  gPw = R * p + U_LOC.xyz;
  gRd = rdW;

  // which stuff it is: the body, an accessory, a pink inner ear
  int stuff = 0;
  float db = mapBody(p);
  if (accKind() > 0 && mapAcc(p) < db - 0.0004) stuff = accKind() == 1 ? 1 : 2;
  else if (bodyKind() == 2 && mapInner(p) < db - 0.0004) stuff = 3;

  // the eyes (beads), their lids, the nose and the glints are real ellipsoids in front of the surface
  int what = 0;      // 0 body, 1 eye, 2 lid, 3 glint, 4 nose
  vec3 eyeN = vec3(0.0);
  vec3 eyePl = vec3(0.0);
  float tBest = tb + 0.004;
  if (stuff == 0) {
    if (U_FACE5.w > 0.5) {
      for (int s = 0; s < 2; s++) {
        vec4 e0 = s == 0 ? U_EYEL0 : U_EYER0;
        vec4 e1 = s == 0 ? U_EYEL1 : U_EYER1;
        vec4 e2 = s == 0 ? U_EYEL2 : U_EYER2;
        vec3 ax = e1.xyz;
        vec3 az = e2.xyz;
        vec3 ay = -cross(ax, az);
        vec3 rad = vec3(e0.w, e1.w, e2.w);
        vec3 pl, nr;
        float te = hitEll(ro, rd, e0.xyz, ax, ay, az, rad, pl, nr);
        if (te > 0.0 && te < tBest) {
          tBest = te;
          what = 1;
          eyeN = nr;
          eyePl = pl;
          // glints: two small flat ellipsoids laid on the bead (nk_char.Face.eye); glowing eyes have none
          if (U_SSSC.w < 0.5) {
            for (int g = 0; g < 2; g++) {
              vec3 dloc = normalize(g == 0 ? vec3(-0.40, -0.86, 0.46) : vec3(0.46, -0.84, -0.40));
              float size = rad.x * (g == 0 ? 0.30 : 0.135) * P_GLINT;
              float tt = 1.0 / length(dloc / rad);
              vec3 pg = dloc * tt;
              vec3 ng = normalize(pg / (rad * rad));
              vec3 pw = ax * pg.x + ay * pg.y + az * pg.z;
              vec3 nw0 = normalize(ax * ng.x + ay * ng.y + az * ng.z);
              vec3 gc = e0.xyz + pw + nw0 * (size * 0.12);
              vec3 t1 = normalize(cross(vec3(0.0, 0.0, 1.0), nw0));
              vec3 t2 = cross(nw0, t1);
              vec3 pl2, nr2;
              float tg = hitEll(ro, rd, gc, t1, t2, nw0, vec3(size, size * 0.92, size * 0.30), pl2, nr2);
              if (tg > 0.0 && tg < te + 0.02) { what = 3; }
            }
          }
        }
      }
      if (U_FACE0.w > 0.001) {
        for (int s = 0; s < 2; s++) {
          vec4 e0 = s == 0 ? U_LIDL0 : U_LIDR0;
          vec4 e1 = s == 0 ? U_LIDL1 : U_LIDR1;
          vec4 e2 = s == 0 ? U_LIDL2 : U_LIDR2;
          vec3 ax = e1.xyz;
          vec3 az = e2.xyz;
          vec3 ay = -cross(ax, az);
          vec3 pl, nr;
          float tl = hitEll(ro, rd, e0.xyz, ax, ay, az, vec3(e0.w, e1.w, e2.w), pl, nr);
          if (tl > 0.0 && tl < tBest) {
            tBest = tl;
            what = 2;
            eyeN = nr;
          }
        }
      }
    }
    if (U_STYLE.z > 0.5) {
      vec3 ax = U_NOSE1.xyz;
      vec3 az = U_NOSE2.xyz;
      vec3 ay = -cross(ax, az);
      vec3 pl, nr;
      float tn = hitEll(ro, rd, U_NOSE0.xyz, ax, ay, az, vec3(U_NOSE0.w, U_NOSE1.w, U_NOSE2.w), pl, nr);
      if (tn > 0.0 && tn < tBest) {
        tBest = tn;
        what = 4;
        eyeN = nr;
      }
    }
  }

  float ao = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float hh = 0.02 + 0.16 * float(i) / 4.0;
    ao += (hh - map(p + n * hh)) * sca;
    sca *= 0.8;
  }
  ao = c01(1.0 - P_AO * 2.2 * ao);

  vec3 col;
  bool isPlain = false;
  if (what == 3) {
    col = vec3(1.0) * 3.0;
  } else if (what == 1) {
    vec3 nw = R * eyeN;
    float k = c01((eyePl.z + 0.95) / 1.5);
    if (U_SSSC.w > 0.5) {
      // a glowing oval: its colour is what shows, the same in any light
      col = mix(GLOW0, GLOW1, c01((eyePl.z + 1.0) * 0.5)) * P_GLOW;
      isPlain = true;
    } else {
      vec3 base = k < 0.3 ? mix(EYE0, EYE1, k / 0.3) : mix(EYE1, EYE2, (k - 0.3) / 0.7);
      float kw = wrap(dot(nw, L_KEY), 0.3);
      col = base * (P_EYELIGHT + 0.6 * kw) * 1.2;
      vec3 hk = normalize(L_KEY + viewW);
      col += vec3(P_EYESPEC) * pow(c01(dot(nw, hk)), 90.0) * C_KEY;
      vec3 hf = normalize(L_FILL + viewW);
      col += vec3(P_EYESPEC * 0.4) * pow(c01(dot(nw, hf)), 60.0) * C_FILL;
      gPw = R * (ro + rd * tBest) + U_LOC.xyz;
      col += envRefl(nw, viewW, P_EYEENV, P_EYEBLUR);
    }
  } else if (what == 2) {
    vec3 nw = R * eyeN;
    col = lightBody(nw, viewW, U_BASE.rgb, ao, 0.0);
  } else if (what == 4) {
    vec3 nw = R * eyeN;
    col = lightBody(nw, viewW, NOSEC, ao, 1.0);
  } else if (stuff == 1) {
    col = lightMetal(R * n, viewW, U_ACCMETAL.rgb, ao);
  } else if (stuff == 2) {
    col = lightCloth(R * n, viewW, U_ACCCLOTH.rgb, ao);
  } else if (stuff == 3) {
    col = lightBody(R * n, viewW, INNERC, ao, 0.0);
  } else {
    vec3 nw = R * n;
    float dc;
    vec3 albedo = paintFace(p, U_BASE.rgb, px, dc);
    col = lightBody(nw, viewW, albedo, ao, dc);
  }

  // the lenses of glasses: clear glass, a flat mirror for the lights of the studio
  if (accKind() == 1 && what != 3) {
    for (int s = 0; s < 2; s++) {
      vec3 lc = s == 0 ? U_ACC0.xyz : U_ACC2.xyz;
      vec3 ln = s == 0 ? U_ACC1.xyz : U_ACC3.xyz;
      float lr = s == 0 ? U_ACC0.w : U_ACC2.w;
      float dn = dot(rd, ln);
      if (abs(dn) > 1e-4) {
        float tl = dot(lc - ro, ln) / dn;
        if (tl > 0.0 && tl < tb) {
          vec3 lp = ro + rd * tl - lc;
          if (length(lp) < lr - 0.012) {
            gPw = R * (ro + rd * tl) + U_LOC.xyz;
            vec3 nwl = R * (dn > 0.0 ? -ln : ln);
            vec3 veil = envRefl(nwl, viewW, P_LENS, 0.004);
            col += isPlain ? srgb(veil) : veil;
          }
        }
      }
    }
  }

  // (what is drawn as it is, the glowing eyes, is in the colours of the picture already)
  if (isPlain) return vec4(min(col, vec3(1.0)), 1.0);
  col *= exp2(P_EXPOSURE) * P_GAIN;
  col = srgb(tone(col));
  return vec4(col, 1.0);
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec4 acc = vec4(0.0);
  for (int k = 0; k < uSamples; k++) {
    vec2 at = uSamples > 1 ? (vec2(float(k - (k / 2) * 2), float(k / 2)) + 0.5) / 2.0 - 0.5 : vec2(0.0);
    vec4 c = sampleAt(frag + at);
    acc += vec4(c.rgb * c.a, c.a);
  }
  float a = acc.a / float(uSamples);
  fragColor = a > 0.0 ? vec4(acc.rgb / acc.a, a) : vec4(0.0);
}
`
}
