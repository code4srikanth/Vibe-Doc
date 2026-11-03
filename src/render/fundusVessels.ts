// Retinal vessel network for the fundus view (docs/fundus F2), grown on the CPU from the eye.retinal_vessels,
// eye.optic_disc and eye.macula metadata and baked into an RGBA texture in fundus millimetres (fovea at the origin,
// +x temporal, +y up):
//   R  artery coverage    G  vein coverage    B  the arteries' central light reflex
// Trunks leave the cup in pairs (an artery beside its vein): the two temporal arcades arch round the macula, the
// others radiate nasally, up and down. Every vessel forks again and again at acute angles, losing calibre (Murray-like),
// wanders a little, and spreads away from the disc; an occupancy grid stops a tip that runs into another vessel's
// territory, so the network fills the fundus evenly down to fine twigs. Branches on the macular side of the arcades
// head for the fovea and stop at its vessel-free zone. The growth constants are render calibration, not anatomy.
import * as THREE from "three";
import type { ResolvedEye } from "../model/resolve.ts";

/** Texture extent: mm either side of the fovea. */
export const VESSEL_HALF = 14;
const PX_PER_MM = 72;
const STEP = 0.07;              // mm per step of a vessel's walk
const MIN_CALIBRE = 0.012;      // mm: finest twig drawn
const FIELD = 13.5;             // mm from the fovea beyond which nothing grows
const TWIG = 0.035;             // mm: minimum drawn width
const CLEAR = 0.9;              // mm a new branch walks before the grid can stop it
const CELL = 0.22;              // mm: occupancy grid; a tip entering a cell another branch holds stops
const BRANCH_WIDTH = 0.55;      // branches off the main trunks are drawn thinner...
const BRANCH_CONTRAST = 0.4;    // ...and fainter, so the trunks read first

type V2 = [number, number];
interface Path { pts: V2[]; w: number[]; main: boolean }

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Catmull-Rom through the waypoints, sampled about every STEP mm. */
function spline(pts: V2[]): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / STEP));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function buildRetinalVessels(eye: ResolvedEye): THREE.Texture {
  const V = "eye.retinal_vessels", D = "eye.optic_disc", M = "eye.macula";
  const veinW = eye.num(V, "anatomy.vein_calibre"), artW = eye.num(V, "anatomy.artery_calibre");
  const half = eye.num(V, "anatomy.arcade_separation") / 2;
  const seed = eye.num(V, "microstructure.branch_seed");
  const disc: V2 = [eye.num(D, "anatomy.position_x"), eye.num(D, "anatomy.position_y")];
  const discR = eye.num(D, "anatomy.vertical_diameter") / 2;
  const cup: V2 = [disc[0] + eye.num(D, "anatomy.cup_decentration_x"), disc[1] + eye.num(D, "anatomy.cup_decentration_y")];
  const faz = eye.num(M, "anatomy.foveola_diameter") / 2 + 0.15;   // vessels stop short of the foveal avascular zone
  const macR = eye.num(M, "anatomy.diameter") / 2;
  const [dx, dy] = disc;

  // one occupancy grid per kind: arteries and veins cross each other freely, but not their own kind
  const gridN = Math.ceil(2 * VESSEL_HALF / CELL);
  const owner = { a: new Int32Array(gridN * gridN), v: new Int32Array(gridN * gridN) };
  const cell = (p: V2) => Math.floor((p[0] + VESSEL_HALF) / CELL) + gridN * Math.floor((p[1] + VESSEL_HALF) / CELL);
  let nextId = 1;

  const paths = { a: [] as Path[], v: [] as Path[] };

  /** A branch: walks from p along heading h, forking until it is a fine twig, leaves the field or meets another vessel. */
  function grow(kind: "a" | "v", r: () => number, p: V2, h: number, w: number, macular: boolean, depth: number) {
    const id = nextId++, grid = owner[kind];
    const path: Path = { pts: [p], w: [w], main: false };
    paths[kind].push(path);
    let len = 0, nextFork = 0.35 + r() * 0.6, wig = r() * 6.28, blocked = 0;
    const maxLen = 2.5 + w * 200;
    while (w >= MIN_CALIBRE && len < maxLen) {
      // spread away from the disc; macular branches steer for the fovea; others skirt the macula
      const out = Math.atan2(p[1] - dy, p[0] - dx);
      const toF = Math.atan2(-p[1], -p[0]);
      const rf = Math.hypot(p[0], p[1]);
      let want = out, pull = 0.03;
      if (macular) { want = toF; pull = 0.06; }
      else if (rf < macR + 0.4 && p[0] > dx + discR) { want = toF + Math.PI; pull = 0.05; }
      h += Math.atan2(Math.sin(want - h), Math.cos(want - h)) * pull;
      wig += 0.9 + r() * 0.6;
      h += (r() - 0.5) * 0.3 + Math.sin(wig) * 0.06;            // tortuosity: noise plus a gentle meander
      const q: V2 = [p[0] + Math.cos(h) * STEP, p[1] + Math.sin(h) * STEP];
      const rq = Math.hypot(q[0], q[1]);
      if (rq < faz || rq > FIELD || Math.abs(q[0]) >= VESSEL_HALF || Math.abs(q[1]) >= VESSEL_HALF) break;
      const c = cell(q);
      // another branch already serves this cell; a new branch first gets clear of its parent, which it leaves at an acute angle
      if (grid[c] && grid[c] !== id && depth > 0 && len > CLEAR) {
        if (++blocked > 4) break;                                // boxed in
        h += (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.5); len += STEP;   // veer into free space
        continue;
      }
      grid[c] = id;
      path.pts.push(q); path.w.push(w);
      p = q; len += STEP; w *= 0.997;
      if (len > nextFork) {
        // fork: the child leaves at an acute angle, the parent bends a little the other way and both thin
        const side = r() < 0.5 ? -1 : 1;
        const child = w * (0.55 + r() * 0.25);
        grow(kind, r, p, h + side * (0.4 + r() * 0.5), child, macular, depth + 1);
        w *= 0.88; h -= side * 0.18;
        nextFork = len + 0.35 + r() * 0.7 + w * 6;
      }
    }
  }

  /** A main trunk along waypoints; its branches off the macular side head for the fovea. */
  function trunk(kind: "a" | "v", r: () => number, way: V2[], w0: number, arcade: boolean) {
    const phase = r() * 6.28;
    const pts = spline(way.map(([x, y], i) => i === 0 ? [x, y] as V2 : [x + (r() - 0.5) * 0.3, y + (r() - 0.5) * 0.3] as V2)).map(([x, y], i, all) => {
      // a gentle meander across the trunk's direction, none at the cup
      const [nx, ny] = all[Math.min(i + 1, all.length - 1)], [px, py] = all[Math.max(i - 1, 0)], l = Math.hypot(nx - px, ny - py) || 1;
      const m = Math.min(1, i / 30) * (0.07 * Math.sin(i * 0.13 + phase) + 0.035 * Math.sin(i * 0.41 + phase * 2));
      return [x - (ny - py) / l * m, y + (nx - px) / l * m] as V2;
    });
    const id = nextId++, grid = owner[kind];
    const path: Path = { pts: [pts[0]], w: [w0], main: true };
    paths[kind].push(path);
    let w = w0, len = 0, nextFork = 0.7 + r() * 0.5;
    for (let i = 1; i < pts.length && w >= MIN_CALIBRE; i++) {
      const a = pts[i - 1], b = pts[i];
      if (Math.hypot(b[0], b[1]) > FIELD) break;
      grid[cell(b)] = id;
      path.pts.push(b); path.w.push(w);
      len += Math.hypot(b[0] - a[0], b[1] - a[1]); w *= 0.9992;
      if (len > nextFork) {
        const h = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const toward = Math.sign((b[0] - a[0]) * -a[1] - (b[1] - a[1]) * -a[0]) || 1;   // the fovea's side of the trunk
        const side = r() < 0.5 ? toward : -toward;
        const macular = arcade && side === toward && a[0] > dx + 1.2;
        grow(kind, r, b, h + side * (0.5 + r() * 0.5), w * (0.45 + r() * 0.25), macular, 1);
        w *= 0.95; nextFork = len + 0.6 + r() * 0.8;
      }
    }
  }

  // Trunk waypoints (fundus mm) from the cup. The temporal arcades arch above and below the fovea (y = 0), so the
  // inferior one mirrors the superior about the fovea's level; the others radiate from the disc.
  const C: V2 = [cup[0], cup[1]];
  const sup: V2[] = [C, [dx + 0.15, dy + 0.9], [dx + 0.7, dy + 1.9], [dx + 1.9, half + 0.05], [dx + 3.3, half + 0.25],
    [1.8, half + 0.5], [5, half + 1.6], [9, half + 3.4], [12, half + 5.2]];
  const inf: V2[] = [C, [dx + 0.15, dy - 0.9], [dx + 0.7, dy - 1.9], ...sup.slice(3).map(([x, y]) => [x, -y] as V2)];
  const ray = (deg: number, len: number, bend: number): V2[] => {
    const a = deg * Math.PI / 180, b = (deg + bend) * Math.PI / 180;
    return [C, [dx + Math.cos(a) * 1.2, dy + Math.sin(a) * 1.2], [dx + Math.cos(a) * len * 0.5 + Math.cos(b) * 0.4, dy + Math.sin(a) * len * 0.5 + Math.sin(b) * 0.4],
      [dx + Math.cos(b) * len, dy + Math.sin(b) * len]];
  };
  // superonasal, inferonasal, nasal, and the smaller superior and inferior trunks (degrees from temporal)
  const others: [V2[], number][] = [[ray(115, 9, 12), 0.8], [ray(245, 9, -12), 0.8], [ray(178, 8, 4), 0.55], [ray(80, 9, 18), 0.5], [ray(282, 9, -18), 0.5]];
  const offset = (pts: V2[], o: number) => pts.map(([x, y], i) => {
    if (i === 0) return [x, y] as V2;
    const [px, py] = pts[i - 1], l = Math.hypot(x - px, y - py) || 1;
    return [x - (y - py) / l * o, y + (x - px) / l * o] as V2;   // shift sideways, to the left of the direction
  });

  const rv = rng(seed), ra = rng(seed * 7919 + 13);
  trunk("v", rv, sup, veinW, true); trunk("v", rv, inf, veinW, true);
  trunk("a", ra, offset(sup, -0.3), artW, true); trunk("a", ra, offset(inf, 0.3), artW, true);
  for (const [way, s] of others) { trunk("v", rv, way, veinW * s, false); trunk("a", ra, offset(way, 0.25), artW * s, false); }
  // small papillomacular vessels straight from the disc's temporal edge toward the fovea
  for (const oy of [-0.4, 0.35]) {
    grow("a", ra, [dx + discR * 0.8, dy + oy], Math.atan2(-dy - oy, -dx), artW * 0.25, true, 1);
    grow("v", rv, [dx + discR * 0.8, dy + oy + 0.15], Math.atan2(-dy - oy, -dx), veinW * 0.25, true, 1);
  }

  // bake: arteries, veins and the arterial reflex in separate passes; each path is stroked in short runs of equal width
  const size = Math.round(2 * VESSEL_HALF * PX_PER_MM);
  const X = (x: number) => (x + VESSEL_HALF) * PX_PER_MM, Y = (y: number) => (VESSEL_HALF - y) * PX_PER_MM;
  const layer = (list: Path[], scale: number, minW: number) => {
    const c = new OffscreenCanvas(size, size), g = c.getContext("2d")!;
    g.fillStyle = "#000"; g.fillRect(0, 0, size, size);
    g.lineCap = "round"; g.lineJoin = "round";
    for (const p of list) {
      for (let i = 0; i < p.pts.length - 1; i += 6) {
        const w = p.w[i] * scale * (p.main ? 1 : BRANCH_WIDTH);
        if (p.w[i] < minW) continue;
        // fine twigs are drawn at a minimum width and fainter, so they stay continuous at the view's resolution
        const a = Math.min(1, 0.35 + 0.65 * w / TWIG) * (p.main ? 1 : BRANCH_CONTRAST);
        g.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        g.lineWidth = Math.max(p.main ? TWIG : TWIG * BRANCH_WIDTH, w) * PX_PER_MM;
        g.beginPath(); g.moveTo(X(p.pts[i][0]), Y(p.pts[i][1]));
        for (let k = i + 1; k <= Math.min(i + 6, p.pts.length - 1); k++) g.lineTo(X(p.pts[k][0]), Y(p.pts[k][1]));
        g.stroke();
      }
    }
    return g.getImageData(0, 0, size, size).data;
  };
  const A = layer(paths.a, 1, 0), Vn = layer(paths.v, 1, 0), Rf = layer(paths.a, 0.3, 0.07);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) { data[i * 4] = A[i * 4]; data[i * 4 + 1] = Vn[i * 4]; data[i * 4 + 2] = Rf[i * 4]; data[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.flipY = false;   // row 0 is the top (+y), as drawn
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
