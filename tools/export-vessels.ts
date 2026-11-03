// Exports the conjunctival vessel map of a case as editable PNGs (docs: vessel-map/README.md).
//   npm run export:vessels -- [--case reference_black_brown] [--out vessel-map]
// The map is an azimuthal-equidistant projection of the globe: centre = corneal pole, distance from the centre =
// geodesic distance s (mm) along the globe, angle = azimuth; temporal is to the right, up is up.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { ROOT, loadLibrary } from "./lib/library.ts";
import { resolveCase } from "../src/model/resolve.ts";
import { genParam } from "../src/render/modules/module.ts";
import { bakeVessels, growVessels, vesselRect, surfaceS, type VesselParams } from "../src/render/vessels.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter(a => a.length));
const lib = loadLibrary();
const eye = resolveCase(lib, lib.cases.find(c => c.id === (args.case ?? "reference_black_brown"))!);
const id = "eye.conjunctiva";
const v = (n: string) => genParam(eye, id, "microstructure.vessels", n);
const geometry = {
  scleraR: eye.num("eye.sclera", "anatomy.radius"), filletW: eye.num(id, "anatomy.fornix_fillet_width"),
  limbusR: eye.num("eye.cornea", "anatomy.diameter") / 2,
  medialX: eye.num("eye.adnexa.palpebral_fissure", "anatomy.medial_canthus_x"), lateralX: eye.num("eye.adnexa.palpebral_fissure", "anatomy.lateral_canthus_x")
};
const params = Object.fromEntries(["seed", "density", "width", "nasal_bias", "branch_depth", "taper", "tortuosity", "limbal_clear_zone", "deep_fraction", "dilation", "mesh_width", "mesh_cell", "anastomosis", "kink_length", "kink_angle", "min_calibre"].map(n => [n, v(n)]));
const p = { ...params, injection: eye.num(id, "appearance.injection") } as VesselParams;
const rect = vesselRect(geometry);
const W = 3072, H = 1536;
const rgba = bakeVessels(growVessels(p, geometry), rect);

const out = join(ROOT, args.out ?? "vessel-map");
mkdirSync(out, { recursive: true });
const grey = (ch: number) => { const b = Buffer.alloc(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) b[(H - 1 - y) * W + x] = rgba[(y * W + x) * 4 + ch]; return b; };   // flipped: +v (up) at the top
const [R, G, B] = [grey(0), grey(1), grey(2)];
const save = (name: string, b: Buffer) => sharp(b, { raw: { width: W, height: H, channels: 1 } }).png().toFile(join(out, name));

const px = rect[2] / W;
const mm = (r: number) => surfaceS(r, geometry);
const rings = [["limbus", mm(geometry.limbusR)], ["equator of the sclera sphere (r = R)", surfaceS(geometry.scleraR - 1e-6, geometry)]] as const;

// preview: superficial vessels (red) and deep vessels (blue-grey) on white, with the limbus ring and axes
const prev = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  const s = R[i] / 255, d = G[i] / 255;
  const c = [255, 255, 255].map((w, k) => w * (1 - .75 * d * [.55, .35, .3][k] * 1.4) * (1 - s * [.05, .85, .85][k]));
  for (let k = 0; k < 3; k++) prev[i * 3 + k] = Math.max(0, Math.min(255, c[k]));
}
const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" fill="none" stroke-width="3">
  <circle cx="${W / 2}" cy="${H / 2}" r="${rings[0][1] / px}" stroke="#2a6fdb"/>
  <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#aaa" stroke-dasharray="14 10"/><line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}" stroke="#aaa" stroke-dasharray="14 10"/>
  <text x="${W / 2 + 12}" y="${H / 2 - rings[0][1] / px - 10}" fill="#2a6fdb" font-size="34" stroke="none" font-family="Arial">limbus (corneal edge)</text>
  <text x="${W - 330}" y="${H / 2 - 12}" fill="#555" font-size="34" stroke="none" font-family="Arial">temporal →</text><text x="12" y="${H / 2 - 12}" fill="#555" font-size="34" stroke="none" font-family="Arial">← nasal</text>
</svg>`;
await sharp(prev, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).png().toFile(join(out, "preview-with-guides.png"));
await save("superficial-vessels.png", R);
await save("deep-vessels.png", G);
await save("calibre.png", B);
writeFileSync(join(out, "map-info.json"), JSON.stringify({
  case: eye.case.id, width_px: W, height_px: H, mm_per_pixel: px,
  mapping: "u = s·cos(φ), v = s·sin(φ); s = geodesic distance from the corneal pole (mm) over the globe, φ = azimuth. +u temporal (right), +v up. Pixel (col,row): u = x0 + (col+.5)·mm_per_pixel, v = y1 − (row+.5)·mm_per_pixel (PNG row 0 = top = +v).",
  rect_mm: { x0: rect[0], y0: rect[1], width: rect[2], height: rect[3] },
  centre_px: [W / 2, H / 2], limbus_radius_mm: rings[0][1], limbus_radius_px: rings[0][1] / px,
  globe_equator_s_mm: rings[1][1], geometry, generator_params: p
}, null, 2));
console.log("wrote", out, `(${W}x${H}, ${px.toFixed(4)} mm/px, limbus s = ${rings[0][1].toFixed(2)} mm)`);
