// Conjunctival and episcleral vessel network (realism layer L3), grown on the CPU from the conjunctiva's
// `microstructure.vessels` generator and baked into an RGBA texture in globe-surface coordinates:
// (u, v) = s·(cos φ, sin φ), where s is the geodesic distance (mm) from the corneal pole and φ the azimuth
// (+u temporal, +v up). On the scleral sphere s = R·θ; past the silhouette it continues along the fornix
// fillet's arc, so the network runs onto the fillet without a seam and stays on the globe under gaze.
//   R  superficial (conjunctival) vessel coverage
//   G  deep (episcleral) vessel coverage; the shader blurs it through the mip chain
//   B  vessel calibre relative to the widest trunk
// The texture is regenerated only when the parameters change.
import * as THREE from "three";

export interface VesselParams {
  seed: number;
  density: number;            // trunk count, branching rate and mesh density
  width: number;              // trunk calibre scale (x 0.1 mm)
  nasal_bias: number;         // share of extra trunks from the nasal side
  branch_depth: number;       // generations of branching
  taper: number;              // calibre kept per mm of length
  tortuosity: number;         // how much the vessels wander
  limbal_clear_zone: number;  // mm outside the limbus kept free of vessels
  deep_fraction: number;      // deep vessels per superficial trunk
  dilation: number;           // calibre gain per unit of injection
  mesh_width: number;         // mm: width of the perilimbal mesh band outside the clear zone
  mesh_cell: number;          // mm: a branch tip this close to another vessel may join it
  anastomosis: number;        // probability that such a tip joins
  kink_length: number;        // mm between heading changes (zigzag)
  kink_angle: number;         // degrees: size of those heading changes
  min_calibre: number;        // mm: finest vessel drawn
  thick_vessel_width: number; // ratio: width kept by the widest vessels of a hand-refined map (1 = unchanged)
  injection: number;          // appearance.injection of the conjunctiva
}

export interface VesselGeometry {
  scleraR: number;            // scleral sphere radius (mm)
  filletW: number;            // fornix fillet width (radius of its quarter-circle profile, mm)
  limbusR: number;            // limbus radius in the image plane (mm)
  medialX: number;            // medial canthus x (mm)
  lateralX: number;           // lateral canthus x (mm)
}

const RES: [number, number] = [3072, 1536];
const MAX_TRUNK_MM = 0.16;     // calibre that maps to B = 1
// Render calibration (not anatomy), set so that the mean over seeds 1-8 of the L3 vessel checks on gen-brown-01 sits
// near 1 (0.98-1.24x). The surface network must cross the whole fillet and the trunks now run to the limbus at the
// calibre floor, so the image-plane generator's rates gave about 1.5-2x the reference density.
const MESH_FILL = 0.4;     // mesh branches per (mesh_cell)^2 of band, per unit density
const BRANCH_FILL = 0.4;   // scale on the side-branch rate per mm

/** Geodesic distance from the corneal pole of the surface point seen at image radius r (sphere, then fillet). */
export function surfaceS(r: number, g: Pick<VesselGeometry, "scleraR" | "filletW">): number {
  const R = g.scleraR, w = g.filletW;
  if (r < R) return R * Math.asin(r / R);
  return R * Math.PI / 2 + w * Math.acos(Math.min(1, Math.max(0, (R + w - r) / w)));
}

/** Texture area in surface mm (x0, y0, width, height): the whole sphere-plus-fillet out to the fillet's outer edge. */
export function vesselRect(g: VesselGeometry): [number, number, number, number] {
  const S = (g.scleraR + g.filletW) * Math.PI / 2;
  return [-S, -S / 2, 2 * S, S];
}

interface Segment { ax: number; ay: number; bx: number; by: number; w: number; deep: boolean }

function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function growVessels(p: VesselParams, g: VesselGeometry): Segment[] {
  const rand = rng(p.seed);
  const segs: Segment[] = [];
  const [x0, y0, w0, h0] = vesselRect(g);
  const sL = surfaceS(g.limbusR, g);
  const clear = sL + p.limbal_clear_zone;
  const meshOut = clear + p.mesh_width;
  const sMed = -surfaceS(Math.abs(g.medialX), g), sLat = surfaceS(Math.abs(g.lateralX), g);
  const cx = (sMed + sLat) / 2;                      // the fornices' centre along the horizontal meridian
  const sStart = (g.scleraR + g.filletW) * Math.PI / 2;   // trunks enter from the fornix: the fillet's outer edge
  const swell = 1 + p.dilation * p.injection;
  const minW = p.min_calibre / (1 + p.injection);    // injected eyes show finer vessels too
  const kink = p.kink_angle * Math.PI / 180;
  const inside = (x: number, y: number) => x > x0 && x < x0 + w0 && y > y0 && y < y0 + h0;

  // Spatial grid of superficial segment midpoints for the mesh joins; `branch` tags the vessel that made each.
  const cell = Math.max(p.mesh_cell, 0.05);
  const grid = new Map<string, { x: number; y: number; branch: number; seg: number }[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  let branchId = 0;
  const push = (s: Segment, branch: number) => {
    segs.push(s);
    if (s.deep) return;
    const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2, k = key(mx, my);
    let list = grid.get(k);
    if (!list) grid.set(k, list = []);
    list.push({ x: mx, y: my, branch, seg: segs.length - 1 });
  };

  // Trunks enter from the fornices, mostly along the horizontal meridian (the lids hide the rest),
  // with extra trunks on the nasal side.
  const trunkAngle = () => {
    for (;;) {
      const a = rand() * Math.PI * 2;
      const c = Math.cos(a);
      const weight = (0.25 + Math.pow(Math.abs(c), 0.7)) * (1 + 1.5 * p.nasal_bias * Math.max(0, -c));
      if (rand() * (1.25 * (1 + 1.5 * p.nasal_bias)) < weight) return a;
    }
  };

  // One vessel from (x, y): it stops at geodesic radius `stop` or after `maxLen` mm. A trunk tapers down to the
  // calibre floor (min_calibre) and continues at it; a side branch ends when it tapers below the floor. Superficial
  // vessels zigzag: each kink_length step deviates up to kink_angle from a smoothly wandering heading.
  // Returns where the vessel ended, if it reached `stop`.
  function grow(x: number, y: number, heading: number, w: number, gen: number, deep: boolean, pull: number, stop: number, maxLen: number): [number, number, number] | undefined {
    const id = branchId++;
    let k = 0, travelled = 0;
    const wander = p.tortuosity * (deep ? 0.25 : 1);
    while (travelled < maxLen) {
      const len = deep ? Math.min(0.32, Math.max(0.1, w * 3.2)) : p.kink_length;
      // drift toward the limbus, but wander
      let d = Math.atan2(-y, -x) - heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      k = k * 0.7 + (rand() - 0.5) * wander * 0.3;
      heading += k + d * pull * len;
      const step = deep ? heading : heading + kink * (2 * rand() - 1);
      const nx = x + Math.cos(step) * len, ny = y + Math.sin(step) * len;
      if (!inside(nx, ny)) return;
      if (Math.hypot(nx, ny) < stop) {
        // terminal arcade: fine twigs that turn to run along the limbus
        if (!deep && gen <= p.branch_depth) {
          for (const side of [-1, 1]) if (rand() < p.anastomosis) {   // arcades: the plexus's loop-closing links
            grow(x, y, heading + side * (1.2 + rand() * 0.4), Math.max(minW * 1.3, w * 0.6), p.branch_depth + 1, false, 0, clear, 0.6 + rand() * 1.4);
          }
        }
        return [x, y, heading];
      }
      push({ ax: x, ay: y, bx: nx, by: ny, w: w * swell, deep }, id);
      x = nx; y = ny; travelled += len;
      w *= Math.pow(p.taper, len);
      if (w < minW) { if (gen > 0) return; w = minW; }   // trunks reach the limbus at the floor; side branches end as twigs
      const branchRate = BRANCH_FILL * (deep ? 0.12 : 0.42) * (0.5 + p.density);
      const wb = w * (0.5 + rand() * 0.3);   // no branch finer than the calibre floor
      if (gen < p.branch_depth && wb >= minW && rand() < branchRate * len) {
        const side = rand() < 0.5 ? -1 : 1;
        const spread = 0.35 + rand() * 0.55;
        grow(x, y, heading + side * spread, wb, gen + 1, deep, pull * 0.6, stop, maxLen - travelled);
        heading -= side * spread * 0.3;
        w *= 0.86;
      }
    }
  }

  const trunks = Math.round(12 + 34 * p.density);
  const start = (a: number, s: number): [number, number] =>
    [Math.min(Math.max(cx + Math.cos(a) * s, x0 + 0.1), x0 + w0 - 0.1), Math.min(Math.max(Math.sin(a) * s, y0 + 0.1), y0 + h0 - 0.1)];
  for (let i = 0; i < trunks; i++) {
    const [x, y] = start(trunkAngle(), sStart);
    const w = 0.1 * p.width * (0.55 + 0.75 * rand());
    grow(x, y, Math.atan2(-y, -x) + (rand() - 0.5) * 0.7, w, 0, false, 0.12 + 0.12 * rand(), clear + rand() * 0.8, 40);
  }
  // Deep anterior ciliary vessels: straighter, radial, ending 2-4 mm from the limbus where they perforate. There each
  // gives off a fine anterior conjunctival artery that runs on to the limbus and ends in an arcade: these feed the
  // perilimbal plexus, so the mesh below grows all round the limbus, not only where a fornix trunk happens to arrive.
  const deepCount = Math.round(trunks * p.deep_fraction);
  for (let i = 0; i < deepCount; i++) {
    const [x, y] = start(trunkAngle(), sStart * 0.95);
    const end = grow(x, y, Math.atan2(-y, -x) + (rand() - 0.5) * 0.2, 0.13 * p.width * (0.7 + 0.6 * rand()), 1, true, 0.25, clear + 1.6 + rand() * 2.2, 40);
    if (end) grow(end[0], end[1], end[2], 2 * minW, p.branch_depth, false, 0.3, clear + rand() * 0.4, 6);
  }

  // Perilimbal mesh: fine zigzag branches in the band [clear, clear + mesh_width]. Each branch heads for a random point
  // of the band from the nearest vessel within two mesh cells (or starts there as a plexus capillary), so the mesh
  // fills the band evenly all round the limbus. A branch tip within mesh_cell of another vessel joins it with
  // probability `anastomosis`, which closes small loops.
  const inBand = (x: number, y: number) => { const s = Math.hypot(x, y); return s >= clear && s <= meshOut; };
  const bandArea = Math.PI * (meshOut * meshOut - clear * clear);
  const branches = Math.round(MESH_FILL * p.density * bandArea / (cell * cell));
  // nearest superficial segment midpoint within reach of (x, y), not on `skip` and not within `avoid` mm of (ax, ay)
  const nearest = (x: number, y: number, reach: number, skip = -1, ax = 0, ay = 0, avoid = -1) => {
    let best: { x: number; y: number } | undefined, bd = reach;
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell), n = Math.ceil(reach / cell);
    for (let dx = -n; dx <= n; dx++) for (let dy = -n; dy <= n; dy++) {
      for (const q of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
        if (q.branch === skip || Math.hypot(q.x - ax, q.y - ay) < avoid) continue;
        const d = Math.hypot(q.x - x, q.y - y);
        if (d < bd && d > 1e-3) { bd = d; best = q; }
      }
    }
    return best ? { x: best.x, y: best.y, d: bd } : undefined;
  };
  for (let made = 0, tries = 0; made < branches && tries < 8 * branches; tries++) {
    const ang = rand() * Math.PI * 2, rad = Math.sqrt(clear * clear + rand() * (meshOut * meshOut - clear * clear));
    const tx = Math.cos(ang) * rad, ty = Math.sin(ang) * rad;
    // branch from the nearest vessel within two mesh cells; with none, a plexus capillary starts at the point itself
    const near = nearest(tx, ty, 2 * cell);
    const from = near && inBand(near.x, near.y) ? near : { x: tx, y: ty, d: cell };
    made++;
    const sx = from.x, sy = from.y;
    let heading = near ? Math.atan2(ty - sy, tx - sx) : rand() * Math.PI * 2;
    const w = p.min_calibre * (4 / 3 + rand() * 2 / 3);   // 1.3-2x the finest calibre
    const id = branchId++;
    let x = sx, y = sy, travelled = 0, ok = true;
    const length = Math.min(from.d, cell) * (0.5 + rand());
    while (travelled < length) {
      const step = heading + kink * (2 * rand() - 1);
      const nx = x + Math.cos(step) * p.kink_length, ny = y + Math.sin(step) * p.kink_length;
      if (!inBand(nx, ny)) { ok = travelled > 0; break; }
      push({ ax: x, ay: y, bx: nx, by: ny, w: w * swell, deep: false }, id);
      x = nx; y = ny; travelled += p.kink_length;
      heading += (rand() - 0.5) * p.tortuosity * 0.6;
    }
    if (!ok || rand() >= p.anastomosis) continue;
    // join the nearest other vessel within mesh_cell (not this branch, not right where it started)
    const best = nearest(x, y, cell, id, sx, sy, 2 * p.kink_length);
    if (!best) continue;
    const bd = best.d;
    const n = Math.max(1, Math.round(bd / p.kink_length));
    let px = x, py = y;
    for (let j = 1; j <= n; j++) {
      const f = j / n, jit = j < n ? (2 * rand() - 1) * Math.tan(kink) * p.kink_length * 0.5 : 0;
      const ux = (best.x - x) / bd, uy = (best.y - y) / bd;
      const nx = x + (best.x - x) * f - uy * jit, ny = y + (best.y - y) * f + ux * jit;
      push({ ax: px, ay: py, bx: nx, by: ny, w: w * swell, deep: false }, id);
      px = nx; py = ny;
    }
  }
  return segs;
}

/** Rasterises the network with anti-aliased capsules (max-blended per channel). */
export function bakeVessels(segs: Segment[], rect: [number, number, number, number]): Uint8Array {
  const [W, H] = RES, [x0, y0, w0] = rect;
  const px = w0 / W;                  // mm per pixel (square pixels)
  const data = new Uint8Array(W * H * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const s of segs) {
    const ew = Math.max(s.w, px), half = ew / 2, fade = Math.min(1, s.w / px);
    const pad = half + px;
    const ix0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - pad - x0) / px)), ix1 = Math.min(W - 1, Math.ceil((Math.max(s.ax, s.bx) + pad - x0) / px));
    const iy0 = Math.max(0, Math.floor((Math.min(s.ay, s.by) - pad - y0) / px)), iy1 = Math.min(H - 1, Math.ceil((Math.max(s.ay, s.by) + pad - y0) / px));
    const bax = s.bx - s.ax, bay = s.by - s.ay, bb = bax * bax + bay * bay || 1e-9;
    const ch = s.deep ? 1 : 0, calibre = Math.min(255, Math.round(255 * s.w / MAX_TRUNK_MM));
    for (let iy = iy0; iy <= iy1; iy++) {
      const py = y0 + (iy + 0.5) * px;
      for (let ix = ix0; ix <= ix1; ix++) {
        const pxm = x0 + (ix + 0.5) * px;
        const pax = pxm - s.ax, pay = py - s.ay;
        const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / bb));
        const d = Math.hypot(pax - bax * h, pay - bay * h);
        const cov = Math.min(1, Math.max(0, (half - d) / px + 0.5)) * fade;
        if (cov <= 0) continue;
        const o = (iy * W + ix) * 4;
        const v = Math.round(cov * 255);
        if (v > data[o + ch]) data[o + ch] = v;
        if (!s.deep && cov > 0.5 && calibre > data[o + 2]) data[o + 2] = calibre;
      }
    }
  }
  return data;
}

let cache: { key: string; tex: THREE.Texture } | undefined;
let importedMap: { data: Uint8Array; w: number; h: number } | undefined;

// Vessels of a hand-refined map count as thick from half-width THICK_FROM texels and reach the full narrowing at
// THICK_FULL; thinner ones are left alone. Coverage at or above COVERED marks a vessel pixel.
const THICK_FROM = 4, THICK_FULL = 6, COVERED = 30, REACH = 8;

/** Use a hand-refined map image (R superficial, G deep, B calibre; top row = +v) instead of the generated network. */
export async function useVesselImage(url: string): Promise<void> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const src = ctx.getImageData(0, 0, c.width, c.height).data;
  const data = new Uint8Array(src.length);
  for (let y = 0; y < c.height; y++) data.set(src.subarray(y * c.width * 4, (y + 1) * c.width * 4), (c.height - 1 - y) * c.width * 4);   // row 0 = -v, as the baked network
  importedMap = { data, w: c.width, h: c.height };
}

/** Narrows the widest vessels of the map to `keep` of their width. A chamfer distance transform gives each vessel pixel
 *  its distance d to the nearest bare pixel; the local half-width h is the largest d within REACH texels. Where h is
 *  thick, coverage is kept only for d above (1 - keep)·h, with a one-texel soft edge. Fine vessels are untouched. */
function narrowThick(m: { data: Uint8Array; w: number; h: number }, keep: number): Uint8Array {
  const { data, w, h } = m, n = w * h, out = new Uint8Array(data);
  if (keep >= 1) return out;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = data[i * 4] >= COVERED ? 1e4 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {          // forward pass
    const i = y * w + x;
    if (!d[i]) continue;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 1);
    if (y > 0) {
      v = Math.min(v, d[i - w] + 1);
      if (x > 0) v = Math.min(v, d[i - w - 1] + 1.414);
      if (x < w - 1) v = Math.min(v, d[i - w + 1] + 1.414);
    }
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {   // backward pass
    const i = y * w + x;
    if (!d[i]) continue;
    let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < h - 1) {
      v = Math.min(v, d[i + w] + 1);
      if (x < w - 1) v = Math.min(v, d[i + w + 1] + 1.414);
      if (x > 0) v = Math.min(v, d[i + w - 1] + 1.414);
    }
    d[i] = v;
  }
  // local half-width: separable box maximum of d
  const tmp = new Float32Array(n), hw = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let mx = 0;
    for (let k = Math.max(0, x - REACH); k <= Math.min(w - 1, x + REACH); k++) mx = Math.max(mx, d[y * w + k]);
    tmp[y * w + x] = mx;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let mx = 0;
    for (let k = Math.max(0, y - REACH); k <= Math.min(h - 1, y + REACH); k++) mx = Math.max(mx, tmp[k * w + x]);
    hw[y * w + x] = mx;
  }
  for (let i = 0; i < n; i++) {
    if (!d[i]) continue;
    const t = Math.min(1, Math.max(0, (hw[i] - THICK_FROM) / (THICK_FULL - THICK_FROM)));
    const f = 1 - t * (1 - keep);                       // width kept at this vessel
    const edge = (1 - f) * hw[i];                       // bare margin this vessel loses on each side
    out[i * 4] = Math.round(data[i * 4] * Math.min(1, Math.max(0, d[i] - edge + 0.5)));
  }
  return out;
}

export function vesselTexture(p: VesselParams, g: VesselGeometry): THREE.Texture {
  const key = JSON.stringify([p, g, importedMap ? "map" : "generated"]);
  if (cache?.key === key) return cache.tex;
  cache?.tex.dispose();
  let tex: THREE.DataTexture;
  if (importedMap) {
    tex = new THREE.DataTexture(narrowThick(importedMap, p.thick_vessel_width), importedMap.w, importedMap.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.anisotropy = 4;
  } else {
    tex = new THREE.DataTexture(bakeVessels(growVessels(p, g), vesselRect(g)), RES[0], RES[1], THREE.RGBAFormat, THREE.UnsignedByteType);
  }
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  cache = { key, tex };
  return tex;
}
