// Ray-marched slit-lamp view of the anterior eye. Every anatomical and optical
// value arrives as a uniform built from eye-model metadata by src/render/modules.
// Units are millimetres; the corneal apex is at z = 0 and the viewer looks down -z.
precision highp float;
out vec4 fragColor;

// exam (slit lamp, camera, accumulation)
uniform vec2 uRes, uCam;
uniform float uFrame, uFov, uAng, uBW, uBH, uBX, uBI, uAmb, uFocus, uAper, uRetro, uEye, uBlend;
uniform float uBY, uBR;   // beam: vertical centre (mm) and slit rotation about the beam axis (radians, 0 = vertical slit)
// patient: the gaze (the globe's forward axis, +x temporal on screen, +y up) and the upper lid's move (blink, open
// wide, lifted for the gaze) as a fraction of the opening's height, negative = raised; uLidRows: see lidMove()
uniform vec3 uGaze;
uniform float uLidClose, uLidCentre;
uniform sampler2D uLidRows;
uniform vec3 uFilt;
uniform sampler2D uPrev;
// Always 0. A loop bound that adds it is unknown at compile time, so the D3D compiler (Windows) cannot unroll the loop
// and inline its body once per pass: unrolled, the program takes minutes to compile and can crash the GPU process.
uniform int uZero;
// cornea
uniform float uR1, uR2, uCCT, uRL, uScEpi, uScStroma, uScEndo, uHaze, uArcus, uArcW, uLucid, uCornN;
uniform vec3 uScTint;
// tear film: index and normal reflectance, lower/upper meniscus height and fillet radius, taper, surface roughness
uniform float uTearN, uTearF0, uTMH, uTMHU, uTMR, uTMRU, uTMTaper, uTearIrr, uTearIrrL, uDis, uDisW;
uniform vec3 uDisAlb;
// anterior chamber, iris, pupil
uniform float uACD, uAqN, uCells, uFlare, uRP, uPupOval, uCollar, uIrisConvex;
uniform vec3 uPupDec;   // pupil decentration (xy, mm)
uniform vec3 uIris1, uIris2, uIrisBorder, uIrisCil, uIrisTrab;
uniform float uIrisR, uRuffW, uLimbW, uLimbRamp, uLimbDark;
uniform float uFibCon, uFibSpace, uFibW, uFibJit, uFibLen, uFibLace, uFibSlant, uFibPupRatio, uFibOct, uFibGain, uFibBright, uFibWavy, uFibWaveL, uFibH, uFibSeed;
uniform float uMotScale, uMotOct, uMotAmp, uMotStretch, uMotSeed, uLimbTexFade;
uniform float uColLobes, uColAmp, uColJit, uColRidgeW, uColRidgeH, uColCon, uColSeed;
uniform float uColRough, uColCryptN, uColCryptL, uColRim, uColNet;
uniform float uCryptN, uCryptDen, uCryptSize, uCryptAsp, uCryptJit, uCryptIn, uCryptOut, uCryptInN, uCryptDepth, uCryptCon, uIrisSeed;
uniform float uCryptSpread, uCryptSoft, uCryptOutline, uCryptBridge, uCryptWall;
uniform float uFurN, uFurIn, uFurOut, uFurCov, uFurW, uFurDepth, uFurOn, uFurFull, uFurCon, uFurSeed;
// lens
uniform float uNucMilk, uLensDiffuse, uLT, uLR1, uLR2, uLensEqR, uLensN, uLensRefl, uCapSc, uPSC, uLensBase, uLamellar, uCort, uCortLoc, uNucBase, uNuc, uNucSize;
uniform vec3 uNucCol, uNucAbs;
// conjunctiva, sclera, adnexa
uniform float uInj, uFlush, uFlushW, uScR, uScZ, uScYellow, uOvSup, uOvInf, uLimbWH, uLimbWV;
uniform vec3 uScBase;
uniform float uCanMX, uCanMY, uCanLX, uCanLY, uCarSize;
// conjunctiva (L3): vessel texture in globe-surface coordinates, blood wash, mottle, plica and medial folds
uniform sampler2D uVesTex;
uniform vec4 uVesRect;
uniform vec3 uVesCol, uVesDeepCol, uPlicaCol, uVenCol;
uniform vec4 uVesVis;      // visibility at the limbus, mid, periphery; overall gain
uniform vec4 uVesAt;      // distances (mm) of the mid and peripheral stops; canthal visibility (nasal, temporal)
uniform float uVesFade, uVesFadeL, uVesDeepOp, uVesDeepBlur, uCapOp, uCapL;
uniform float uPlicaTex, uPlicaTexL, uPlicaOpac;
uniform float uConjMottle, uConjMottleL, uBasalVasc, uFornixVasc, uMarginVasc, uInjBlush, uInjRamp, uInjLimb, uVesReach, uVesBlend, uFornixBlushW, uMarginBlushW;
uniform float uPlicaW, uPlicaH, uPlicaOff, uPlicaL, uPlicaYc, uPlicaCurv, uPlicaTilt, uPlicaSoft, uPlicaFoot, uPlicaShadowW, uPlicaGloss;
uniform float uRecessVasc, uRecessOcc, uRecessContact, uRecessContactW, uFoldN, uFoldSp, uFoldDepth, uFoldLen, uFoldSeed;
// external view (uExterior = 1): globe geometry, the exterior photo layer, the lamp grade and the lid shadow
// debug: 0 all, 6 all but the skin, 1 skin, 2 sclera + conjunctiva, 3 iris + pupil, 4 cornea + tear film, 5 lens.
// Only the ?layer= program (SHADERS.slitLampLayers) has it; elsewhere it is the constant 0, so its branches compile away.
#ifdef DEBUG_LAYERS
uniform float uLayer;
#else
#define uLayer 0.
#endif
uniform float uExterior, uExtShow, uCornQ, uLimbZone, uFilletW, uFornixOcc, uLidDepth, uDistRange, uPenumbraTan, uShadowMargin, uAlbedoNv;
uniform vec4 uExtRect, uLampSpot, uLampGrade;   // grade: room, exposure, contrast, side light
uniform vec3 uWarmth;
uniform vec3 uLampDir;                // the lamp seen in reflection (L5): direction, angular half-size, radiance
uniform float uReflex, uReflexGain;
uniform sampler2D uExtTex, uExtDist;
// slit-lamp views: the exterior photo's skin albedo, relit by the room and the beam
uniform sampler2D uSkinTex;
uniform float uSwellU, uSwellL, uSwellBlood;   // lid swelling: margin displacement (mm) of the upper and lower lid; blood per mm of it

const float K = 3.0;     // scattering gain
const float CAPG = .6;   // capsule interface: path integral of the thin scattering layer (mm) x render gain
const float TAU = 6.2831853;
const vec3 ROOM = vec3(1., .95, .88);
const vec3 L1 = vec3(-.6, .255, .756);   // square background illuminator (left)
const vec3 L2 = vec3(.56, -.207, .80);   // round fill light (right)
float ZI, LZA, LZP, LZC, CLA, CLP;
vec3 LD, NB, L1n, L2n;

// The pupil is an ellipse, uRP across and uRP*uPupOval high (vertical_ratio). pupD: distance from its centre scaled
// so that the margin is at uRP in every direction. pupWarp: the iris-plane point q moved along its radius so the
// oval margin lands on the round pupil the iris pattern is built around, while the iris root stays put.
float pupD(vec2 v){ return length(vec2(v.x, v.y/uPupOval)); }
vec2 pupWarp(vec2 q){
  vec2 v = q - uPupDec.xy;
  float r = length(v), d = pupD(v);
  if(uPupOval == 1. || r < 1e-5) return q;
  float rp = r*uRP/d;   // the margin's radius toward q
  float r2 = r < rp ? r*uRP/rp : uRP + (r - rp)*(uIrisR - uRP)/max(uIrisR - rp, 1e-3);
  return uPupDec.xy + v*(r2/r);
}

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
float hash13(vec3 p3){ p3 = fract(p3*.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y)*p3.z); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3. - 2.*f);
  return mix(mix(hash12(i), hash12(i + vec2(1., 0.)), u.x), mix(hash12(i + vec2(0., 1.)), hash12(i + vec2(1., 1.)), u.x), u.y);
}
// noise that wraps around in x (angular patterns without a seam)
float noiseP(vec2 p, float per){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3. - 2.*f);
  float x0 = mod(i.x, per), x1 = mod(i.x + 1., per);
  return mix(mix(hash12(vec2(x0, i.y)), hash12(vec2(x1, i.y)), u.x), mix(hash12(vec2(x0, i.y + 1.)), hash12(vec2(x1, i.y + 1.)), u.x), u.y);
}
// gradient (Perlin) noise, periodic in x with period per, scaled to about [-1, 1]
vec2 grad2(vec2 c){ float a = TAU*hash12(c); return vec2(cos(a), sin(a)); }
float gnoiseP(vec2 p, float per){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*f*(f*(f*6. - 15.) + 10.);
  float x0 = mod(i.x, per), x1 = mod(i.x + 1., per);
  float a = dot(grad2(vec2(x0, i.y)), f), b = dot(grad2(vec2(x1, i.y)), f - vec2(1., 0.));
  float c = dot(grad2(vec2(x0, i.y + 1.)), f - vec2(0., 1.)), d = dot(grad2(vec2(x1, i.y + 1.)), f - vec2(1.));
  return 1.41*mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){ float a = .5, s = 0.; for(int i = 0; i < 4 + uZero; i++){ s += a*noise(p); p = p*2.03 + 17.1; a *= .5; } return s; }
// smoothstep that also accepts e0 > e1 (a falling edge)
float sstep(float e0, float e1, float x){ float t = clamp((x - e0)/(e1 - e0), 0., 1.); return t*t*(3. - 2.*t); }
vec2 sph(vec3 ro, vec3 rd, vec3 c, float r){
  vec3 oc = ro - c; float b = dot(oc, rd); float h = b*b - dot(oc, oc) + r*r;
  if(h < 0.) return vec2(-1.); h = sqrt(h); return vec2(-b - h, -b + h);
}
vec3 roomLight(vec3 N){ return ROOM*uAmb*(.22 + .55*max(dot(N, L2n), 0.) + .35*max(dot(N, L1n), 0.)); }

// ---- gaze -------------------------------------------------------------
// The globe turns about its centre (0, 0, uScZ) under the fixed lids. shade() marches the eye in the globe's own
// frame, so everything fixed to the room (the beam, the lights, the lids, plica and caruncle) is turned into it or
// out of it with GAZE, the globe-to-room rotation. It stays the identity outside shade() (slitSkin runs first).
mat3 GAZE = mat3(1.);
vec2 GTILT = vec2(0.);   // lateral run (per mm of depth) of a view ray in the globe's frame, from the gaze alone
vec3 SHIFT = vec3(0.);   // the globe's lift in the room: with the lid raised wide the iris follows to the middle of the opening
float lidLift(float x);
vec3 toRoom(vec3 p){ vec3 c = vec3(0., 0., uScZ); return GAZE*(p - c) + c + SHIFT; }
void gazeFrame(inout vec3 ro, inout vec3 rd){
  vec3 f = length(uGaze) > .5 ? normalize(uGaze) : vec3(0., 0., 1.);
  vec3 r = normalize(cross(vec3(0., 1., 0.), f));
  GAZE = mat3(r, cross(f, r), f);
  mat3 G = transpose(GAZE);
  GTILT = -vec2(GAZE[0].z, GAZE[1].z)/GAZE[2].z;
  vec3 c = vec3(0., 0., uScZ);
  SHIFT = vec3(0., .5*uLidCentre*lidLift(0.), 0.);
  ro = G*(ro - c - SHIFT) + c; rd = G*rd;
  LD = G*LD; L1n = G*L1n; L2n = G*L2n;   // NB stays in the room: slitUV() works on room points
}

// ---- slit beam --------------------------------------------------------
// p in slit coordinates: x across the slit (its width), y along it (its height); p is turned into the room first
vec2 slitUV(vec3 p){
  p = toRoom(p);
  float d = (p.x - uBX)*NB.x + (p.z - uFocus)*NB.z, y = p.y - uBY;
  float c = cos(uBR), s = sin(uBR);
  return vec2(c*d + s*y, c*y - s*d);
}
float slabAt(vec3 p){
  vec2 q = slitUV(p);
  float hw = uBW*.5;
  float e = .006 + .02*hw + .2*max(hw - 1., 0.);   // a broad (diffuse) beam has a wide penumbra; a thin slit stays crisp
  float s = smoothstep(hw + e, hw - e, abs(q.x));
  float eh = .05 + .3*max(uBH*.5 - 2., 0.);
  float h = smoothstep(uBH*.5 + eh, uBH*.5 - eh, abs(q.y));
  return s*h;
}

// ---- media ------------------------------------------------------------
// The pupil margin is irregular, never a drawn circle: slow lobes, medium scallops and fine fraying of the rim, up to
// ~12% of the radius. pv: from the pupil's centre. Returns the margin's offset from the radius uRP.
float pupRim(vec2 pv){
  float a = atan(pv.y, pv.x)/TAU;
  return uRP*(.07*(2.*noiseP(vec2(a*5., 5.3), 5.) - 1.)
            + .04*(2.*noiseP(vec2(a*13., 2.7), 13.) - 1.)
            + .02*(2.*noiseP(vec2(a*37., 8.1), 37.) - 1.));
}

// The iris shades the lens just behind the pupil margin, in light coming from all around: this is what sets the lens
// back behind the iris instead of flat in the pupil. pv: from the pupil's centre.
float lensRimShade(vec2 pv){ return 1. - .55*smoothstep(.62, 1., pupD(pv)/uRP); }

bool inLens(vec3 p){ return length(p - vec3(0., 0., CLA)) < uLR1 && length(p - vec3(0., 0., CLP)) < uLR2; }

vec3 gClr;   // clear-lens (cortex) scatter inside the last lensMedium call; the beam lights it, ambient light barely does
void lensMedium(vec3 p, out vec3 sc, out vec3 ex){
  sc = vec3(0.); ex = vec3(0.); gClr = vec3(0.);
  if(!inLens(p)) return;
  vec3 e = vec3(p.xy/uLensEqR, (p.z - LZC)/(uLT*.5));
  float q = length(e);
  float rr = length(p.xy);
  float a01 = atan(p.y, p.x)/TAU + .5;
  float nucM = smoothstep(uNucSize + .4, uNucSize - .1, q);   // nucleus grades into the cortex without a sharp edge
  float core = smoothstep(uNucSize - .13, uNucSize - .43, q);
  // a nuclear opacity is denser towards the axis and uneven, a soft cloud rather than one flat colour
  float axial = mix(.62, 1.1, smoothstep(3.4, .3, rr));
  float cloud = .72 + .36*noise(p.xy*1.3 + p.z*.4 + 3.1) + .2*noise(p.xy*3.1 - p.z*.7 + 7.7);
  float nd = uNuc*(nucM*.85 + core*.55)*axial*cloud;
  float shell = smoothstep(.5, .75, q);
  // lamellar zones of discontinuity: a few thin shells parallel to the capsule, not a regular grating
  float zn = exp(-pow((q - .94)/.022, 2.)) + .8*exp(-pow((q - .84)/.026, 2.)) + .6*exp(-pow((q - .70)/.03, 2.)) + .5*exp(-pow((q - .55)/.03, 2.));
  float clear = uLensBase + uLamellar*zn*1.2;
  float base = clear + uNucBase*nucM;
  // spokes spread by grade (the scale is by area): a denser cortex has more wedges, reaching further towards the axis.
  // Each wedge narrows towards the axis and has a fibrous, feathered edge; its density saturates, so a top grade adds
  // spokes rather than solid black blades.
  float spT = .6 - .1*uCort + .14*(1. - smoothstep(1., 3.6, rr));
  float sp = smoothstep(spT, spT + .34, noiseP(vec2(a01*18., 4.7), 18.)*.7 + noiseP(vec2(a01*46., 1.3), 46.)*.3 + .08*(noiseP(vec2(a01*140., 2.1), 140.) - .5));
  float radial = smoothstep(1.8 - .4*uCort, 3.6 - .9*uCort, rr);
  float loc = mix(1., smoothstep(.2, -.7, sin(a01*TAU - 3.14159)), uCortLoc);
  float cort = 1.1*(1. - exp(-uCort/1.1))*sp*radial*loc*shell;
  float dP = uLR2 - length(p - vec3(0., 0., CLP));
  // posterior subcapsular plaque: thin, axial and granular, and dense enough to stand out against the red reflex
  float psc = uPSC*smoothstep(.35, .05, dP)*smoothstep(2.2, .6, rr)*(.35 + .4*noise(p.xy*6.) + .5*noise(p.xy*22.));
  gClr = vec3(.62, .74, .95)*clear;
  sc = vec3(.62, .74, .95)*base + uNucCol*nd*.9 + vec3(.95, .94, .9)*(cort*1.4 + psc*1.6);
  ex = sc*.5 + uNucAbs*nd*1.2 + vec3(cort*2.2 + psc*8.);
  // the milky haze lifts the colour, added after ex so it does not darken the lens as well. It fades as the nucleus
  // hardens, so the opacity runs from milky yellow to brown.
  sc += vec3(.95, .94, .9)*nd*uNucMilk*mix(1., .25, smoothstep(.35, 1., uNuc));
}

// Arcus at radius rr: a band uArcW wide (soft over +-0.4 of its width) ending at the lucid interval inside the limbus.
float arcus(float rr){
  float o = uRL - uLucid;
  return uArcus*sstep(o - 1.4*uArcW, o - .6*uArcW, rr)*sstep(o + .5*uLucid, o - .5*uLucid, rr);
}
// Schlick Fresnel of the tear film at incidence cosine c
float tearF(float c){ return uTearF0 + (1. - uTearF0)*pow(1. - clamp(c, 0., 1.), 5.); }

// What clouds the cornea (lipid, oedema), as against the faint scatter of clear tissue
vec3 corneaOpacity(float rr){ return vec3(.92, .92, .9)*(arcus(rr)*2.2 + uHaze*1.5); }

vec3 corneaSc(vec3 p){
  float dF = uR1 - length(p - vec3(0., 0., -uR1));
  float dB = length(p - vec3(0., 0., -uCCT - uR2)) - uR2;
  float rr = length(p.xy);
  float s = uScStroma + uScEpi*exp(-max(dF, 0.)/.02) + uScEndo*exp(-max(dB, 0.)/.016);
  s *= .85 + .3*noise(p.xy*14.);
  return uScTint*s + corneaOpacity(rr);
}

float cellsAt(vec3 p){
  vec3 g = floor(p*28.);
  if(hash13(g) < 1. - uCells*.04) return 0.;
  return smoothstep(.3, .1, length(fract(p*28.) - .5));
}

vec3 beamLight(vec3 p){
  float s = slabAt(p);
  if(s < .001) return vec3(0.);
  vec3 L = uBI*uFilt*s;
  if(p.z < ZI){
    float t = (ZI - p.z)/LD.z;
    vec3 q = p + LD*t;
    float pass = smoothstep(uRP + .04, uRP - .04, pupD(q.xy - uPupDec.xy));
    if(pass < .001) return vec3(0.);
    vec3 sc, ex; lensMedium(p + LD*t*.5, sc, ex);
    L *= pass*exp(-ex*t*.9);
  }
  return L;
}

// ---- iris -------------------------------------------------------------
// Worley cells: x = distance to nearest feature point, y = gap to the second nearest (cell borders).
vec2 worley(vec2 p, float seed){
  vec2 i = floor(p), f = fract(p);
  float d1 = 8., d2 = 8.;
  for(int y = -1; y <= 1 + uZero; y++) for(int x = -1; x <= 1 + uZero; x++){
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(hash12(i + g + seed), hash12(i + g + seed + 17.3));
    vec2 r = g + o - f;
    float d = dot(r, r);
    if(d < d1){ d2 = d1; d1 = d; } else if(d < d2) d2 = d;
  }
  return vec2(sqrt(d1), sqrt(d2) - sqrt(d1));
}

// Iris surface (realism layer L4). Everything is placed in the pattern coordinate t: 0 at the pupil margin,
// 1 at the root (true radius uIrisR), measured about a centre that follows the decentred pupil near the
// margin and the limbus at the root. Zones: pupillary (albedo_light) inside the zigzag collarette, the
// crypt band (border_layer_albedo) out to crypts.outer, then the ridge band (ciliary_albedo). On top: radial
// trabecular ridges, radial-lozenge crypts with the posterior pigment showing through, the beaded ruff
// and the contraction furrows (which deepen as the pupil dilates). Returns albedo and height h (mm).
const float PI = 3.14159265;
float irisRad(float t){ return uRP + t*(uIrisR - uRP); }

vec3 irisPolar(vec2 q){   // (r, theta in [0, TAU), t)
  float t = clamp((length(q - uPupDec.xy) - uRP)/(uIrisR - uRP), 0., 1.);
  vec2 v = q - uPupDec.xy*(1. - t);   // one fixed-point step: the centre slides from the pupil to the limbus
  float r = length(v), th = atan(v.y, v.x);
  return vec3(r, th < 0. ? th + TAU : th, clamp((r - uRP)/(uIrisR - uRP), 0., 1.));
}

// Collarette (L4c): the outer edge of the raised pupillary band. Sawtooth teeth pointing outward, each with its
// tip skewed and its height scaled by lobe_jitter, plus fine edge roughness (about 4 wiggles per tooth).
float collarR(float th){
  float u = uColLobes*th/TAU;
  u += uColJit*(2.*noiseP(vec2(u, uColSeed), uColLobes) - 1.);
  float k = mod(floor(u), uColLobes), f = fract(u);
  float tip = .5 + .4*uColJit*(2.*hash12(vec2(k, uColSeed + 5.)) - 1.);
  float z = 2.*pow(f < tip ? f/tip : (1. - f)/(1. - tip), 1.5) - 1.;   // sharp tip, rounded notch
  float nr = 4.*uColLobes;
  return irisRad(uCollar) + uColAmp*(1. - uColJit*hash12(vec2(k, uColSeed + 3.)))*z
       + uColRough*(2.*noiseP(vec2(th/TAU*nr, uColSeed + 9.), nr) - 1.);
}

// Signed distance (mm, < 0 inside) to a radial lozenge from r0 to r0 + L on angle thk, widest W:
// blunt at its inner end, pointed at its outer end.
float lozenge(float r, float th, float thk, float r0, float L, float W){
  float s = (r - r0)/L;
  float da = th - thk; da -= TAU*floor(da/TAU + .5);
  float d = abs(da)*r - .5*W*sin(PI*pow(clamp(s, 0., 1.), .8));
  return max(d, max(-s, s - 1.)*L);
}

// One crypt candidate: slot hashes h (keep, angle, start, length), the slot's angle span da, its inner end r0
// and its length L (size_spread spreads L lognormally). Soft edge over edge_softness x the width, outline
// perturbed by outline_noise x the width. Accumulates the floor m and the wall w.
void crypt(float r, float th, float thk, float r0, float L, float seed, inout float m, inout float w){
  float W = uCryptAsp*L;
  float d = lozenge(r, th, thk, r0, L, W);
  if(d > uCryptWall + W) return;
  float da = th - thk; da -= TAU*floor(da/TAU + .5);
  d += uCryptOutline*W*(2.*noise(vec2(da*r, r - r0)/max(.5*W, .02) + seed) - 1.);
  float soft = .5*uCryptSoft*W;
  m = max(m, sstep(soft, -soft, d));
  w = max(w, sstep(uCryptWall, 0., d));
}
// lognormal length factor from two slot hashes (Box-Muller)
float lognorm(float a, float b){ return exp(uCryptSpread*sqrt(-2.*log(max(a, 1e-4)))*cos(TAU*b)); }

// Crypts of Fuchs, one candidate per angular slot (the pixel's slot and its neighbours).
// Returns (floor, wall): floor shows the pigment epithelium, the wall is the trabecular rim around it.
vec2 crypts(float r, float th){
  float m = 0., w = 0., rOut = irisRad(uCryptOut);
  float k0 = floor(th/TAU*uCryptN);
  for(int i = -1; i <= 1 + uZero; i++){   // crypts opening just outside the collarette, many sizes
    float k = mod(k0 + float(i), uCryptN);
    vec4 h = vec4(hash12(vec2(k, uIrisSeed)), hash12(vec2(k, uIrisSeed + 1.7)), hash12(vec2(k, uIrisSeed + 3.1)), hash12(vec2(k, uIrisSeed + 5.3)));
    if(h.x > uCryptDen) continue;
    float thk = (k + .5 + (h.y - .5)*.6)*TAU/uCryptN;
    float r0 = collarR(thk) + .25*h.z;
    float L = min(uCryptSize*lognorm(h.w, hash12(vec2(k, uIrisSeed + 7.9))), rOut - r0);
    if(L < .05) continue;
    crypt(r, th, thk, r0, L, k, m, w);
  }
  float k1 = floor(th/TAU*uCryptInN);
  for(int i = -1; i <= 1 + uZero; i++){   // small crypts in the pupillary zone
    float k = mod(k1 + float(i), uCryptInN);
    vec4 h = vec4(hash12(vec2(k, uIrisSeed + 11.)), hash12(vec2(k, uIrisSeed + 12.7)), hash12(vec2(k, uIrisSeed + 14.1)), hash12(vec2(k, uIrisSeed + 16.3)));
    if(h.x > uCryptDen) continue;
    float thk = (k + .5 + (h.y - .5)*.6)*TAU/uCryptInN;
    float rI = irisRad(uCryptIn), rE = collarR(thk) - .1;
    float L = .3*uCryptSize*lognorm(h.w, hash12(vec2(k, uIrisSeed + 18.9)));
    float r0 = rI + h.z*max(rE - rI - L, 0.);
    L = min(L, rE - r0);
    if(L < .05) continue;
    crypt(r, th, thk, r0, L, k + 50., m, w);
  }
  return vec2(m, w*(1. - m));
}

// Crypts of the collarette band (L4c): one candidate per slot plus a half-size family between them, their outer
// end anywhere from just past the band edge (opening it) to 40% of the band width inside it; radial length is
// collarette_crypt_length x the band width, spread lognormally. Every full-size slot holds a crypt; the half-size
// family is thinned by crypts.density. Returns (floor, rim, depth): depth ramps from the outer edge of the rim to
// half the crypt width inside. The fourth value is the wall lighting: +1 on the wall facing the room lights (the
// far side of the hole), -1 on the wall in their shadow, so the relief reads even where the lights are near frontal.
vec4 bandCrypts(float r, float th){
  float m = 0., w = 0., z = 0., sd = 0., rI = uRP + uRuffW + .03;
  vec2 Lxy = normalize(.55*L2n.xy + .35*L1n.xy);   // the room lights' mean direction (weights as in roomLight)
  for(int f = 0; f < 2 + uZero; f++){
    float ff = float(f), sz = 1. - .5*ff;
    float k0 = floor(th/TAU*uColCryptN - .5*ff);
    for(int i = -1; i <= 1 + uZero; i++){
      float k = mod(k0 + float(i), uColCryptN);
      vec4 h = vec4(hash12(vec2(k, uColSeed + 21. + ff)), hash12(vec2(k, uColSeed + 22.7 + ff)), hash12(vec2(k, uColSeed + 24.1 + ff)), hash12(vec2(k, uColSeed + 26.3 + ff)));
      if(ff > .5 && h.x > uCryptDen) continue;
      float thk = (k + .5 + .5*ff + (h.y - .5)*.6)*TAU/uColCryptN;
      float rE = collarR(thk), bw = rE - uRP;
      float L = min(sz*uColCryptL*bw*lognorm(h.w, hash12(vec2(k, uColSeed + 28.9 + ff))), 1.5*uColCryptL*bw);
      float r1 = rE + bw*(.1 - .5*h.z*(1. + ff));
      float r0 = max(r1 - L, rI);
      if(r1 - r0 < .05) continue;
      // as crypt(), but the floor deepens toward the middle and the pale rim scales with the crypt's width
      float Lc = r1 - r0, Wc = uCryptAsp*Lc, rim = uCryptWall + .2*Wc;
      float d = lozenge(r, th, thk, r0, Lc, Wc);
      if(d > rim + Wc) continue;
      float da = th - thk; da -= TAU*floor(da/TAU + .5);
      d += uCryptOutline*Wc*(2.*noise(vec2(da*r, r - r0)/max(.5*Wc, .02) + k + 90. + 40.*ff) - 1.);
      float soft = .5*uCryptSoft*Wc;
      m = max(m, sstep(soft, -soft, d)*(.6 + .4*sstep(0., -.3*Wc, d)));
      w = max(w, sstep(rim, 0., d));
      float zc = sstep(rim, -.5*Wc, d);
      if(zc > z){   // pixel offset from the crypt's middle, in the iris plane: tangential da*r, radial r - mid
        vec2 v = da*r*vec2(-sin(thk), cos(thk)) + (r - .5*(r0 + r1))*vec2(cos(thk), sin(thk))*Wc/Lc;
        sd = -dot(normalize(v + 1e-5), Lxy);
        z = zc;
      }
    }
  }
  return vec4(m, w*(1. - min(m/.6, 1.)), z, sd*4.*z*(1. - z));
}

// Fibre bundles (L4b): the radial trabeculae as a ridged gradient-noise field, periodic in theta, with cells one
// bundle apart round the iris (n bundles) and radially bundle_length long, pulled toward isotropic by interlacing.
// The field is displaced sideways by waviness (along wave_length), by a slow slant of up to angle_spread and by
// spacing_jitter (bundle units), so crests branch, merge and are irregularly spaced. Octaves halve the spacing
// with weight octave_gain^o; an octave finer than 2 px is replaced by its mean (no aliasing at low resolution).
// Returns the crest signal: 0 at the field's mean, 1 at a crest centre (f = 1) of a single octave; the octave
// sum is scaled to the same std as one octave.
const float FIB_SLOPE = 1.11;   // mean |dN/dx| of the normalised gradient noise at its zero crossings (per cell)
float fibreBand(float r, float th, float n, float rmid){
  float Lr = uFibSpace*mix(uFibLen/uFibSpace, 1., uFibLace);   // cell aspect 1:(length/spacing), pulled toward 1:1
  float x = th/TAU*n, y = r/Lr + uFibSeed;
  float n6 = max(floor(n/6. + .5), 1.), n4 = max(floor(n/4. + .5), 1.), n2 = max(floor(n/2. + .5), 1.);
  // sideways displacement (mm): waves along wave_length, plus a slant of up to angle_spread from radial that
  // changes slowly across a few bundles (and along 4 bundle lengths), measured from the band's middle radius
  float d = uFibWavy*(2.*noiseP(vec2(th/TAU*n6, r/uFibWaveL + uFibSeed), n6) - 1.)
          + uFibSlant*(r - rmid)*(2.*noiseP(vec2(th/TAU*n4, r/(4.*uFibLen) + uFibSeed + 7.), n4) - 1.);
  // spacing jitter (bundle units): varies across bundles, slowly along them, so it spreads the spacing, not the angle
  x += d*n/(TAU*max(r, .1)) + uFibJit*(2.*noiseP(vec2(th/TAU*n2, r/uFibLen + 3.), n2) - 1.);
  // crest exponent: half-width at half maximum = bundle_width/2 (the noise crosses zero with slope FIB_SLOPE per cell)
  float P = log(.5)/log(clamp(1. - FIB_SLOPE*.5*uFibW/uFibSpace, .05, .95));
  float fbar = 1./(1. + P/3.);   // mean of (1 - |N|)^P for this noise (fitted numerically, within 2% for P 1-4)
  float pix = uFov/uRes.x, cell = TAU*r/n;
  float f = 0., a = 1., sc = 1., a2 = 0.;
  for(int o = 0; o < 5 + uZero; o++){
    if(float(o) >= uFibOct) break;
    float lod = sstep(1.*pix, 1.6*pix, cell/sc);
    float cr = lod > 0. ? pow(max(1. - abs(gnoiseP(vec2(x*sc, y*sc + 17.*float(o)), n*sc)), 0.), P) : fbar;
    f += a*(mix(fbar, cr, lod) - fbar); a2 += a*a;
    a *= uFibGain; sc *= 2.;
  }
  return f/(sqrt(a2)*(1. - fbar));
}
// Bundle counts round the iris: the ciliary family is bundle_spacing apart at mid-iris; the pupillary family is
// pupillary_spacing_ratio x that apart at mid pupillary zone.
float nCil(){ return max(floor(TAU*irisRad(.5)/uFibSpace + .5), 1.); }
float nPup(){ return max(floor(TAU*irisRad(.5*uCollar)/(uFibSpace*uFibPupRatio) + .5), 1.); }
// The two families cross-fade over 0.3 mm at the collarette rc, where the stroma reorganises. Returns the crest
// signal s in [-1, 1]: +1 at a bundle's crest, negative in the gaps.
float fibres(float r, float th, float rc){
  float wc = sstep(rc - .15, rc + .15, r), z = 0.;
  if(wc < 1.){   // the band's net: the pupillary family plus two copies slanted +/- net_angle (shifted round the
    // ring, so uncorrelated); the sum is scaled to 1.15x the std of one family, so the net reads a little stronger
    float rm = irisRad(.5*uCollar), sl = uColNet*(r - rm)/max(r, .1), n = nPup();
    z += (1. - wc)*(fibreBand(r, th, n, rm) + fibreBand(r, th + sl + 2.3, n, rm) + fibreBand(r, th - sl + 4.1, n, rm))*.66;
  }
  if(wc > 0.) z += wc*fibreBand(r, th, nCil(), irisRad(.5));
  float s = clamp(z, -1., 1.);
  // per-bundle brightness: slow variation along the bundles (2 bundle lengths) and across a few bundles
  float n3 = max(floor(nCil()/3. + .5), 1.);
  return s > 0. ? min(s*(1. + uFibBright*(2.*noiseP(vec2(th/TAU*n3, r/(2.*uFibLen) + uFibSeed + 31.), n3) - 1.)), 1.) : s;
}
// Mottling: soft lighter and darker patches, an fBm (unit std) in iris-plane mm, stretched radially.
float mottling(float r, float th){
  float nm = max(floor(TAU*irisRad(.5)/uMotScale + .5), 1.);
  float s = 0., a = 1., v = 0.;
  for(int o = 0; o < 5 + uZero; o++){
    if(float(o) >= uMotOct) break;
    float k = exp2(float(o));
    s += a*(noiseP(vec2(th/TAU*nm*k, r/(uMotScale*uMotStretch)*k + uMotSeed + 9.*float(o)), nm*k) - .5);
    v += a*a; a *= .5;
  }
  return s/(.2*sqrt(v));   // value noise - .5 has an RMS of about .2
}

float gTex = 1.;   // texture amplitude: 1, falling to limbal_texture_fade at the floor of the limbal ring (set by the caller)

vec3 irisSurface(vec2 q, out float h){
  q = pupWarp(q);
  vec3 pp = irisPolar(q);
  float r = pp.x, th = pp.y, t = pp.z;
  float rc = collarR(th), rOut = irisRad(uCryptOut);
  float inner = sstep(rc + .03, rc - .03, r);
  vec3 c = mix(mix(uIrisBorder, uIrisCil, sstep(rOut - .15, rOut + .15, r)), uIris2, inner);
  // fibres: crests toward trabecula, gaps toward the pigment epithelium; the gap weight k makes the two cancel
  // in mean display luma (the albedos are band medians), for a crest signal symmetric about 0
  float s = fibres(r, th, rc);
  const vec3 Y = vec3(.2126, .7152, .0722);
  float gz = pow(dot(c, Y), 1./2.2);
  float k = clamp((pow(dot(uIrisTrab, Y), 1./2.2) - gz)/max(gz - pow(dot(uIris1, Y), 1./2.2), 1e-4), 0., 1./max(uFibCon, 1e-3));
  c = mix(c, uIrisTrab, clamp(gTex*uFibCon*max(s, 0.), 0., 1.));
  c = mix(c, uIris1, clamp(gTex*uFibCon*k*max(-s, 0.), 0., 1.));
  // amplitude is a relative std of luma as a photo records it (sRGB-encoded), so it applies before decoding
  c *= pow(max(1. + gTex*uMotAmp*mottling(r, th), 0.), 2.2);
  // collarette band: a plateau ridge_height high inside the jagged edge, its shoulder ridge_width wide. Relief that
  // reads under any light: occlusion darkens a strip two shoulder widths wide at the foot of the edge (strongest at
  // the step), and the band top catches more light toward its edge (blend toward trabecula_albedo).
  float W = uColRidgeW, band = sstep(rc + .5*W, rc - .5*W, r);
  float foot = sstep(rc + 2.5*W, rc + .5*W, r)*(1. - band);
  c *= 1. - uColCon*.6*foot*foot;
  c = mix(c, uIrisTrab, gTex*.6*uColRim*band*sstep(rc - 4.*W, rc - .5*W, r));
  vec4 bc = bandCrypts(r, th);
  c *= 1. + .6*gTex*uColCon*bc.w;   // lit and shaded crypt walls
  c = mix(c, uIrisTrab, gTex*uColRim*bc.y);
  // floor: the darker brown of the posterior layers, and occluded the deeper it lies (never black)
  c = mix(c, uIris1, gTex*uColCon*bc.x);
  c *= 1. - .25*gTex*uColCon*bc.x*bc.z;
  vec2 cr = crypts(r, th);
  c = mix(c, uIrisTrab, .3*gTex*uCryptCon*cr.y);
  c = mix(c, mix(uIris1, c, uCryptBridge*max(s, 0.)), gTex*uCryptCon*cr.x);   // bundles cross the crypt floor
  float crest = s, fbar = 0.;
  // contraction furrows: broken concentric folds in the outer ciliary zone, only once the pupil is wide
  float fur = 0.;
  float fs = uFurCon*clamp((2.*uRP - uFurOn)/(uFurFull - uFurOn), 0., 1.);
  if(fs > 0. && uFurN > 0.){
    float span = max(uFurN - 1., 1.);
    float i = clamp(floor((t - uFurIn)/(uFurOut - uFurIn)*span + .5), 0., uFurN - 1.);
    float rf = irisRad(mix(uFurIn, uFurOut, i/span));
    float nb = max(floor(TAU*rf/2.), 1.);   // arcs break about every 2 mm
    float brk = sstep(1. - uFurCov - .1, 1. - uFurCov + .1, noiseP(vec2(th/TAU*nb, i*7.3 + uFurSeed), nb));
    fur = sstep(uFurW*.5, 0., abs(r - rf))*brk;
    c = mix(c, uIris1, fs*fur);
  }
  // pupillary ruff: the pigment epithelium wrapping round the margin, one bead per finest pupillary bundle
  float nf = nPup()*exp2(clamp(uFibOct - 1., 0., 2.));
  float rm = length(q - uPupDec.xy) - uRP;
  float ruff = sstep(.05, -.05, rm - uRuffW*(.75 + .25*cos(th*nf)));
  c = mix(c, uIris1, .8*ruff);
  h = uFibH*(crest - fbar) + uColRidgeH*band - (uColRidgeH + uCryptDepth)*bc.z - uCryptDepth*cr.x - uFurDepth*fs*fur;
  return c;
}

// Limbal ring weight at apparent radius ra (seen through the cornea): its half-dark onset lies
// uLimbW inside the corneal edge; 0.82 turns a 10-90% width into a smoothstep half-span.
float limbalRing(float ra){ float on = uRL - uLimbW; return sstep(on - .82*uLimbRamp, on + .82*uLimbRamp, ra); }
vec3 ringed(vec3 c, float w){ return c*mix(1., uLimbDark, w); }

// ---- globe surface (every view) ----
// The conic corneal cap and the scleral sphere joined by a smooth limbal groove, as a height field over the image
// plane (apex at z = 0).
float SCZ, GK;   // scleral sphere centre (z) and groove blend height

float corneaZ(float r){   // conic front surface, apex at z = 0
  float c = 1./uR1;
  return -c*r*r/(1. + sqrt(max(1. - (1. + uCornQ)*c*c*r*r, 0.)));
}
// Cornea and sclera meet in a crease; a smooth max (which fills the crease) rounds it into a groove.
float globeZ(float r){
  float zc = corneaZ(r), zs = SCZ + sqrt(max(uScR*uScR - r*r, 0.));
  float h = max(GK - abs(zc - zs), 0.)/GK;
  return max(zc, zs) + h*h*GK*.25;
}
vec3 globeN(vec2 p){
  float r = length(p), e = .005, r0 = max(r - e, 0.);
  float dz = (globeZ(r + e) - globeZ(r0))/(r + e - r0);
  return normalize(vec3(-dz*p/max(r, 1e-4), 1.));
}
// The view ray's hit on the globe surface: the corneal sphere (or, past it, the scleral sphere) as a start, then
// Newton steps on the height field.
vec3 globeHit(vec3 ro, vec3 rd){
  vec2 h = sph(ro, rd, vec3(0., 0., -uR1), uR1);
  if(h.x < 0.) h = sph(ro, rd, vec3(0., 0., SCZ), uScR);
  float t = h.x > 0. ? h.x : (-ro.z)/rd.z;
  for(int i = 0; i < 3 + uZero; i++){
    vec3 p = ro + rd*t;
    float r = length(p.xy), e = .005, r0 = max(r - e, 0.);
    float dz = (globeZ(r + e) - globeZ(r0))/(r + e - r0);
    float f = p.z - globeZ(r), df = rd.z - dz*dot(p.xy, rd.xy)/max(r, 1e-4);
    t -= f/df;
  }
  return ro + rd*t;
}

// ---- limbus (realism layer L5): one limbal cover for every view ----
// The sclera overlaps the cornea more above than below, so the visible edge is an oval: at meridian phi it lies at
// rho = RL - sin^2(phi) x overlap, and the translucent band's 10-90% width goes from its 3/9 to its 12/6 o'clock value.
// Cover c is 0 on clear cornea and 1 on opaque sclera (0.82 turns a 10-90% width into a smoothstep half-span).
float limbCover(vec2 p){
  float r = length(p), s2 = p.y*p.y/max(r*r, 1e-8);
  float rho = uRL - s2*(p.y > 0. ? uOvSup : uOvInf), w = mix(uLimbWH, uLimbWV, s2);
  return sstep(rho - .82*w, rho + .82*w, r);
}
// The band is scleral tissue whose optical depth rises to BAND_TAU (at blue) on the sclera, with a scatter
// coefficient falling as lambda^-BAND_B (relative to blue, at sRGB-primary wavelengths): what lies behind it is
// attenuated twice (in and out), and the tissue adds its own scatter, normalised so that full depth is the lit
// sclera scl. A thin layer over the dark uvea is therefore cool grey, and turns white as it thickens.
// The band's position and 10-90% width were measured on photo luma (display-encoded), so the depth is set where
// the green scatter term equals c in that encoding, c^2.2 in linear light; the colour then follows from the physics.
// Render constants from the L5 design (no metadata yet).
const float BAND_TAU = 3., BAND_B = 1.2;
const vec3 BAND_LAMBDA = vec3(610., 550., 465.);
vec3 limbalBand(vec3 behind, vec3 scl, float c){
  vec3 k = pow(BAND_LAMBDA/BAND_LAMBDA.b, vec3(-BAND_B));
  vec3 n = 1. - exp(-BAND_TAU*k);
  float tau = -log(1. - pow(c, 2.2)*n.g)/k.g;
  vec3 tk = tau*k;
  return behind*exp(-2.*tk) + scl*(1. - exp(-tk))/n;
}

// pI: the iris point; ra: apparent radius where the view ray crossed the cornea
vec3 irisShade(vec3 pI, float ra){
  vec2 q = pI.xy;
  float t = irisPolar(q).z, ring = limbalRing(ra);
  gTex = mix(1., uLimbTexFade, ring);
  float e = .015;
  float h0 = 0., hx = 0., hy = 0.;
  vec3 c = vec3(0.);
  // the centre and two offset samples (for the normal) share one inlined irisSurface(): uZero keeps the loop rolled
  for(int i = 0; i < 3 + uZero; i++){
    float h;
    vec3 ci = irisSurface(q + (i == 1 ? vec2(e, 0.) : i == 2 ? vec2(0., e) : vec2(0.)), h);
    if(i == 0){ c = ci; h0 = h; } else if(i == 1) hx = h - h0; else hy = h - h0;
  }
  vec3 N = normalize(vec3(-hx/e, -hy/e, 1.));
  vec3 pb = vec3(pI.xy, ZI + uIrisConvex*pow(1. - t, 1.5) + h0 + .01);   // iris bows forward near the pupil
  vec3 ill = roomLight(N)*.9 + beamLight(pb)*max(dot(N, LD), 0.);
  return ringed(c, ring)*ill;
}

// ---- conjunctiva (realism layer L3) -------------------------------------
// Geodesic distance from the corneal pole of the globe point seen at image radius r: along the sphere, then along
// the fornix fillet's quarter-circle arc. It is the vessel texture's coordinate, so nothing has a seam at the
// silhouette and the pattern stays on the globe.
float surfS(float r){
  if(r < uScR) return uScR*asin(r/uScR);
  return uScR*PI*.5 + uFilletW*acos(clamp((uScR + uFilletW - r)/uFilletW, 0., 1.));
}
// Transmittance of a blood layer of strength a: the absorber has the spectrum of col normalised to its max, so red
// passes and green and blue are absorbed (vessels and the blood wash are the same absorber).
vec3 bloodT(float a, vec3 col){ return 1. - clamp(a, 0., 1.)*(1. - col/max(max(col.r, col.g), col.b)); }
vec3 gVesT = vec3(1.);   // transmittance of the vessels alone at the last bulbar() sample (they continue over the plica)

// Bulbar conjunctiva over the sclera albedo alb at image radius r, surface distance s along image direction dir:
// mottle, the blood wash (basal_vascularity rising to fornix_vascularity over the last fornix_blush_width before the
// silhouette, plus injection rising from injection_limbal_fraction at the limbus to full over injection_ramp_width,
// plus aExtra), then
// the superficial and deep vessels. rRoom: the radius in the room. The fornix does not turn with the globe, so its
// blush stays where it is under gaze while the pattern read at r rides on the globe.
// Ciliary flush engorges the deep limbal plexus: a second, deep absorber densest at the limbus that falls off over
// ciliary_flush_width, and the deep vessels under it darken with it.
// pix: image pixel size (mm); nv: n.v, which foreshortens the surface (texture level of detail).
// The superficial vessel map leaves an empty ring round the limbus, so its lookup is stretched inward: at the limbus
// it reads vessel_limbal_reach further out, and the shift tapers to nothing vessel_reach_blend from the limbus. The
// map's own vessels then run on up to the cornea; none are added, and the pattern further out stays where it was.
vec3 bulbar(vec3 alb, float r, float rRoom, float s, vec2 dir, float pix, float nv, float aExtra){
  vec2 su = s*dir;
  // mottle: a 2-octave value-noise fBm with unit RMS (0.214 per octave, measured); the amplitude is a relative
  // std of luma as a photo records it (sRGB-encoded), so it applies before decoding
  vec2 mq = su/uConjMottleL;
  float m = ((noise(mq) - .5) + .5*(noise(mq*2. + 7.3) - .5))/(.214*sqrt(1.25));
  alb *= pow(max(1. + uConjMottle*m, 0.), 2.2);
  float sL = uScR*asin(uRL/uScR);
  float a = mix(uBasalVasc, uFornixVasc, sstep(uScR - uFornixBlushW, uScR, rRoom))
          + uInj*uInjBlush*mix(uInjLimb, 1., sstep(0., uInjRamp, s - sL)) + aExtra;
  vec2 uv = (su - uVesRect.xy)/uVesRect.zw;
  float texel = uVesRect.z/float(textureSize(uVesTex, 0).x);
  float lod = max(log2(pix/(texel*sqrt(max(nv, .05)))), 0.);   // explicit level: this runs in divergent branches
  float ds = s - sL, sv = ds < uVesBlend ? sL + uVesReach + ds*(1. - uVesReach/uVesBlend) : s;
  vec4 vs = textureLod(uVesTex, (sv*dir - uVesRect.xy)/uVesRect.zw, lod);
  float deep = clamp(textureLod(uVesTex, uv, lod + uVesDeepBlur).g*1.5, 0., 1.);   // deep vessels, blurred by the tissue over them
  float fl = uFlush*exp(-max(s - sL, 0.)/uFlushW);
  // vessel visibility: faint but present at the limbus, rising through the mid and peripheral conjunctiva, and
  // strongest toward the canthi (nasal most); it dips and returns along each vessel
  float vis = mix(uVesVis.x, uVesVis.y, sstep(0., uVesAt.x, ds));
  vis = mix(vis, uVesVis.z, sstep(uVesAt.x, uVesAt.y, ds));
  float cx = r*dir.x;
  vis = mix(vis, max(vis, cx < 0. ? uVesAt.z : uVesAt.w), sstep(.55*uScR, 1.15*uScR, abs(cx)));
  vis *= uVesVis.w*(1. - uVesFade*noise(su/uVesFadeL + 11.7));
  // thicker vessels (venules) are a deeper red than the fine arterioles
  vec3 vcol = mix(uVesCol, uVenCol, sstep(.2, .55, vs.b));
  // the capillary meshwork: a very faint ridge-noise network, a little stronger where the vessels are
  vec2 cq = su/uCapL;
  float ridge = max(1. - abs(2.*noise(cq + 3.1) - 1.), 1. - abs(2.*noise(cq*1.9 + 8.3) - 1.));
  float cap = uCapOp*sstep(.86, .98, ridge)*(.5 + vis);
  // engorged superficial vessels carry more blood than their wider calibre alone shows (render gain)
  gVesT = bloodT(vs.r*vis*(1. + 1.5*uInj), vcol)*bloodT(cap, uVesCol)*bloodT(deep*uVesDeepOp*(1. + 2.*fl), uVesDeepCol);
  return alb*bloodT(a, uVesCol)*bloodT(fl, uVesDeepCol)*gVesT;
}

// Plica semilunaris: a crescent fold medial of its free edge. Its middle lies plica_offset from the medial canthus
// along the canthal line and plica_centre_height above it; v: height from there in half plica_length. The free
// edge passes through the middle, tilted by plica_tilt, and is concave toward the cornea (its tips plica_curvature
// lateral of the middle, the semilunar shape of Gray's Anatomy); the width follows an ellipse along the
// length, so the tips are rounded. Across the width u (0 at the free edge) the fold rises steeply at its lip and
// falls gently medially, H·sin(pi·sqrt u), and it flattens toward the tips. dIn: approximate mm inside the outline.
float plicaFold(vec2 p, out float dIn, out float xe, out float v){
  float x0 = uCanMX + uPlicaOff, y = p.y - mix(uCanMY, uCanLY, uPlicaOff/(uCanLX - uCanMX)) - uPlicaYc;
  v = y/(.5*uPlicaL);
  float a = max(1. - v*v, 0.);
  xe = x0 + uPlicaTilt*y + uPlicaCurv*min(v*v, 1.);
  float w = uPlicaW*sqrt(a), u = (xe - p.x)/max(w, 1e-4);
  dIn = min(min(xe - p.x, p.x - xe + w), .5*uPlicaL*(1. - abs(v)));
  return (u > 0. && u < 1.) ? uPlicaH*sqrt(a)*sin(PI*sqrt(u)) : 0.;
}
// The plica, the medial recess and the medial folds as a height field (mm) at image point p. yRel: mm from the
// opening's mid-height (the folds fade toward their ends with it); pix: pixel size (mm).
// g: height gradient (image x, y); wP: the plica's albedo weight (soft over plica_edge_softness); occ: diffuse light
// left by the soft shadow at the fold's foot and, medial of the free edge, by the recess cavity and its contact
// shadows along the opening's edges (dEdge: mm from the nearer lid margin); wR: the recess weight, 0 at the free
// edge rising to 1 one caruncle size from the medial canthus. medial_folds: shallow grooves lateral to the free
// edge, fading toward their ends. Nothing here reaches past the folds and the foot shadow, so the rest of the
// bulbar surface is untouched.
float plica(vec2 p, float yRel, float pix, float dEdge, out vec2 g, out float wP, out float occ, out float wR){
  float dIn, xe, v, d2, x2, v2, e = max(pix, .02);
  float h = plicaFold(p, dIn, xe, v);
  g = vec2(plicaFold(p + vec2(e, 0.), d2, x2, v2) - h, plicaFold(p + vec2(0., e), d2, x2, v2) - h)/e;
  wP = sstep(-uPlicaSoft, uPlicaSoft, dIn);
  // the mucosa's fine wet bumps tilt its surface, so the lamp catches it in scattered glints (plica_texture)
  vec2 qb = p/(2.*uPlicaTexL);
  g += wP*uPlicaTex*1.2*(vec2(noise(qb), noise(qb + 17.3)) - .5);
  occ = 1. - uPlicaFoot*sstep(uPlicaShadowW, 0., -dIn)*(1. - wP)*sstep(1.15, .85, abs(v));
  // the recess is the hollow between the plica and the caruncle: the raised fold itself is not in it
  wR = sstep(xe, uCanMX + uCarSize, p.x)*(1. - wP);
  float med = sstep(xe, xe - uPlicaSoft, p.x)*(1. - wP);   // medial of the fold only
  occ *= mix(1., uRecessOcc, wR)*(1. - uRecessContact*med*sstep(uRecessContactW, 0., dEdge));
  float fade = sstep(.5*uFoldLen, .35*uFoldLen, abs(yRel)), sg = .25*uFoldSp;
  for(int k = 1; k <= 4 + uZero; k++){
    if(float(k) > uFoldN) break;
    float xk = xe + float(k)*uFoldSp + .4*uFoldSp*(noise(vec2(p.y/uFoldLen*2., uFoldSeed + float(k))) - .5);
    float ek = (p.x - xk)/sg, hk = -uFoldDepth*fade*exp(-ek*ek);
    h += hk;
    g.x += hk*(-2.*ek/sg);
  }
  return h;
}

// The plica's surface is a moist mucosa, not the smooth bulbar surface: a fine cobbled grain (its crypts and goblet
// cells, plica_texture_scale across) and faint folds along its length, as an albedo multiplier of strength
// plica_texture. Its thicker, fleshier tissue hides the bulbar vessels beneath it by plica_opacity.
float plicaGrain(vec2 p){
  vec2 q = p/uPlicaTexL;
  float g = .55*noise(q) + .3*noise(q*2.3 + 4.1) + .15*noise(q*5.1 + 9.);
  float folds = pow(1. - abs(2.*noise(vec2(p.x*6., p.y*.8)) - 1.), 6.);
  return max(1. + uPlicaTex*((g - .5)*1.6 - .12*folds), 0.);
}
vec3 plicaAlb(vec2 p){ return uPlicaCol*mix(vec3(1.), gVesT, 1. - uPlicaOpac)*plicaGrain(p); }

// ---- outer eye --------------------------------------------------------
vec2 distAt(vec2 p);
// Distances (mm) of image point p from the upper (x) and lower (y) lid margins: the exterior photo's distance field.
vec2 lidDist(vec2 p){ return distAt(p); }

float lampDisc(vec3 R);

// Mucopurulent discharge (tear_film optics.discharge, 0-1) as coverage at image point p, dL mm from the lower margin:
// separate strands and globs (about 3 x 0.4 mm, more of them as the amount rises) lying in the lower tear meniscus
// within discharge_band_width of the margin, a thin film along the margin itself, and a pool in the lower medial
// angle in front of the caruncle. The strands and film settle only where the margin lies below them (the distance
// to it grows upward); toward the canthi and along the caruncle the margin turns up and they fade out.
float discharge(vec2 p, float dL){
  if(uDis <= 0.) return 0.;
  float w = uDisW*(.4 + .6*uDis);
  vec2 s = vec2(p.x*.9, dL*4.);
  float n = .65*noise(s) + .35*noise(s*2.7 + 5.);
  vec2 gd = vec2(distAt(p + vec2(.1, 0.)).y, distAt(p + vec2(0., .1)).y) - dL;
  float lower = sstep(.75, .95, gd.y/max(length(gd), 1e-4));
  float strands = lower*sstep(.62 - .25*uDis, .7 - .25*uDis, n)*sstep(w, .3*w, dL);
  float film = lower*.6*sstep(.3*w, .08*w, dL);
  vec2 q = (p - vec2(uCanMX + uCarSize, uCanMY - .3))*vec2(.7, 1.);
  float pool = sstep(.2 + uDis, .3*uDis, length(q) + .6*(noise(p*3.1) - .5) + .3*(noise(p*7.3) - .5));
  return max(max(strands, film), pool)*min(1.5*uDis, 1.);
}
// Its radiance at coverage c: a wet, cloudy diffuser of albedo discharge_albedo lit like the conjunctiva beside it
// (light ill), thinner and so dimmer at its frayed edges, with a broken sheen where its moist surface mirrors the lamp.
vec3 dischargeLit(vec2 p, vec3 ill, float c){
  vec3 N = normalize(vec3((vec2(noise(p*6.), noise(p*6. + 4.)) - .5)*.8, 1.));
  return uDisAlb*ill*(.65 + .35*c) + .4*tearF(N.z)*lampDisc(reflect(vec3(0., 0., -1.), N))*uReflexGain;
}
vec3 sclera(vec3 ro, vec3 rd){
  vec2 h = sph(ro, rd, vec3(0., 0., uScZ), uScR);
  vec3 p, N;
  vec2 sp;   // where the conjunctiva's pattern is read: the globe's own frame on the globe, the room's on the fillet
  float cav = 1., s;
  mat3 G = transpose(GAZE);
  if(h.x < 0.){
    // past the silhouette: the conjunctival fornix fillet (as in externalEye) closes the canthal ends of the fissure.
    // The fornix does not turn with the globe, so the fillet is worked out in the room, without the globe's lift
    vec3 C = vec3(0., 0., uScZ), ror = GAZE*(ro - C) + C, rdr = GAZE*rd, q = ror + rdr*((uScZ - ror.z)/rdr.z);
    float rr = length(q.xy), c = (uScR + uFilletW - rr)/uFilletW;
    if(c < 0.) return vec3(.4, .17, .14)*uAmb*.5;
    N = G*normalize(vec3(q.xy/rr*c, sqrt(max(1. - c*c, 0.))));
    cav = mix(1., uFornixOcc, 1. - c);
    s = uScR*PI*.5 + uFilletW*acos(clamp(c, 0., 1.));
    p = G*(q - C) + C;
    sp = q.xy;
  } else {
    p = ro + rd*h.x;
    N = normalize(p - vec3(0., 0., uScZ));
    s = uScR*acos(clamp(N.z, -1., 1.));
    sp = p.xy;
  }
  float r = length(sp), pix = uFov/uRes.x;
  vec3 base = mix(uScBase, vec3(.9, .85, .72), uScYellow);
  vec2 pw = toRoom(p).xy, dl = lidDist(pw);   // the lids, plica, caruncle and canthi stay put when the globe turns
  // plica semilunaris, medial recess and medial folds (L3); the recess adds to the blood wash
  vec2 g; float wP, occ, wR;
  plica(pw, .5*(dl.y - dl.x), pix, min(dl.x, dl.y), g, wP, occ, wR);
  vec2 qw = pw - SHIFT.xy;
  float rw = length(qw);
  vec3 c = bulbar(base, r, rw, s, sp/max(r, 1e-4), pix, (GAZE*N).z, uMarginVasc*max(1. - dl.y/uMarginBlushW, 0.) + uRecessVasc*wR);
  // The plica is fixed in the room and keeps its colour as the globe turns, so the vessels in it are read at its room
  // position, not from the globe sliding behind it. gVesT goes back to the globe's for the limbal band.
  vec3 vesGlobe = gVesT;
  if(wP > 0. && h.x >= 0.) bulbar(base, rw, rw, surfS(rw), qw/max(rw, 1e-4), pix, sqrt(max(1. - rw*rw/(uScR*uScR), .0025)), 0.);
  c = mix(c, plicaAlb(pw), wP);
  gVesT = vesGlobe;
  N = normalize(N + G*vec3(-g, 0.));   // g is a slope in the room
  cav *= occ;
  // caruncle: within one caruncle size of the medial canthus
  float med = uCanMX + uCarSize;
  c = mix(c, vec3(.62, .3, .27), sstep(med, uCanMX + .28*uCarSize, pw.x));
  // canthal corners and fornix: tissue grain, a pink mottle and fine branching vessels, so they are not flat tint
  float tw = max(max(sstep(med + 1.5, uCanMX + .28*uCarSize, pw.x), sstep(uCanLX - 4., uCanLX - .3, pw.x)), sstep(uScR - uFornixBlushW, uScR, rw));
  vec2 wq = pw + .35*vec2(noise(pw*2.3), noise(pw*2.3 + 9.));
  float vein = pow(max(1. - abs(noise(wq*5.5)), 0.), 14.) + .6*pow(max(1. - abs(noise(wq*13. + 4.)), 0.), 16.);
  c *= 1. + tw*(.6*fbm(pw*3.) + .3*noise(pw*12.));
  c = mix(c, c*vec3(1., .9, .9), tw*.3*sstep(-.1, .3, fbm(pw*1.8 + 5.)));
  c = mix(c, c*vec3(.72, .28, .28), clamp(tw*vein*.8, 0., 1.));
  vec3 ill = roomLight(N)*.95*mix(.45, 1.15, smoothstep(med, 6., pw.x)) + uBI*uFilt*slabAt(p)*max(dot(N, LD), 0.)*.9;
  ill += ROOM*uAmb*.12*smoothstep(0., 9., pw.x);            // scatter from the bright fill light
  vec3 col = c*ill*cav;
  vec3 R = reflect(rd, N);
  col += uAmb*.15*pow(max(dot(R, L2n), 0.), 400.);
  return col;
}

// render gains for corneal haze scatter (strength itself comes from optics.haze): HZA the scattered fraction's
// growth, HZB the forward lobe's width (rad), HZR the share of scattered light that goes back toward the viewer
const float HZA = 2.4, HZB = .08, HZR = .12;

vec3 roughen(vec3 N, vec2 p);

vec3 cornealPath(vec3 ro, vec3 rd, vec3 p0, float jt){
  vec3 N0 = roughen(globeN(p0.xy), p0.xy);
  vec3 col = vec3(0.);
  vec3 T = vec3(1.);
  vec3 ambIn = ROOM*uAmb*.22;
  float cosi = -dot(rd, N0);
  float F = tearF(cosi);
  vec3 R = reflect(rd, N0);
  // reflections on the tear film: only the lamp's own reflex. The room is dark, so its lights leave no glints.
  col += uBI*uFilt*slabAt(p0)*smoothstep(.9965, .999, dot(R, LD))*12.;               // Purkinje I of the slit
  col += ROOM*uAmb*.06*F;
  T *= 1. - F;

  vec3 rd1 = refract(rd, N0, 1./uCornN);
  // Oedematous stroma scatters a fraction 1 - hzT of the light, mostly forward: that light still reaches the iris
  // and comes back, as a halo around the sharp image rather than lost. A sample takes the scattered path with
  // that probability, so the running average over frames mixes the sharp and the blurred iris.
  float hzT = exp(-uHaze*HZA);
  vec2 hz = vec2(hash12(p0.xy*91.7 + uFrame*7.3), hash12(p0.yx*53.1 + uFrame*3.1)) - .5;
  if(hash12(p0.xy*37.3 + uFrame*11.7) > hzT) rd1 = normalize(rd1 + vec3(hz, 0.)*HZB);
  vec2 hb = sph(p0, rd1, vec3(0., 0., -uCCT - uR2), uR2);
  float t1 = hb.x > 0. ? hb.x : .6;
  const int NC = 20;
  float dt = t1/float(NC);
  // A wide (diffused) beam lights the whole clear cornea, whose faint backscatter then veils the iris; real diffuse
  // illumination shows the iris clearly, so the cornea's glow is cut for wide beams (render calibration). A thin
  // slit, where that scatter is the optic section itself, keeps its full brightness.
  float wideCut = mix(1., .2, smoothstep(1., 6., uBW));
  // Clear tissue is cut further, as its veil still washed out the iris; a clouded cornea keeps its glow, the finding itself.
  float clearCut = mix(1., .25, smoothstep(1., 6., uBW));
  for(int i = 0; i < NC + uZero; i++){
    vec3 p = p0 + rd1*(dt*(float(i) + jt));
    vec3 sc = corneaSc(p), opq = corneaOpacity(length(p.xy));
    col += T*(beamLight(p)*.36 + ambIn*.12)*wideCut*((sc - opq)*clearCut + opq)*dt*K;
    T *= exp(-sc*.3*dt);
  }
  // back scatter: the small share of the scattered light that turns back is lost to the image behind the cornea
  // and lifts it with a neutral veil of the room light (oedema's water lakes are large scatterers, so not blue)
  float hzR = (1. - hzT)*HZR;
  col += T*hzR*ROOM*uAmb*.5;
  T *= 1. - hzR;
  vec3 p1 = p0 + rd1*t1;
  vec3 N1 = normalize(p1 - vec3(0., 0., -uCCT - uR2));
  vec3 rd2 = refract(rd1, N1, uCornN/uAqN);
  float tI = (ZI - p1.z)/rd2.z;
  vec3 pI = p1 + rd2*tI;
  // Parallax from the gaze alone is eased: the iris sits behind the limbus, so a turned globe shifts the pupil against the
  // limbal edge the wrong way for the eye to read as looking where it points (render calibration).
  pI.xy -= .5*GTILT*(p1.z - ZI);

  if(uFlare + uCells > 0.){
    const int NA = 24;
    float da = tI/float(NA);
    for(int i = 0; i < NA + uZero; i++){
      vec3 p = p1 + rd2*(da*(float(i) + jt));
      vec3 sc = vec3(.8, .85, 1.)*uFlare*.06 + vec3(cellsAt(p)*1.5);
      col += T*(beamLight(p) + ambIn*.3)*sc*da*K;
    }
  }

  // one irisShade() call site: each call inlines the whole iris, and the D3D compile grows with every copy
  // the running average over frames feathers the margin (jt changes each frame)
  vec2 pupV = pI.xy - uPupDec.xy;
  bool onIris = pupD(pupV) - uRP - pupRim(pupV) + (jt - .5)*.12 > 0.;
  if(uLayer > 3.5 && uLayer < 4.5) return col;
  if(onIris || (uLayer > 2.5 && uLayer < 3.5)){
    if(uLayer > 4.5 && uLayer < 5.5) return vec3(0.);
    vec3 ir = onIris ? irisShade(pI, length(p0.xy)) : vec3(0.);
    return uLayer > 2.5 && uLayer < 3.5 ? ir : col + T*ir;
  }

  vec2 hA = sph(pI, rd2, vec3(0., 0., CLA), uLR1);
  vec2 hP = sph(pI, rd2, vec3(0., 0., CLP), uLR2);
  float tA = max(hA.x, 0.);
  float tB = min(hA.y, hP.y);
  if(tB > tA){
    const int NL = 64;
    float dl = (tB - tA)/float(NL);
    vec3 lens = vec3(0.);
    for(int i = 0; i < NL + uZero; i++){
      vec3 p = pI + rd2*(tA + dl*(float(i) + jt));
      vec3 sc, ex; lensMedium(p, sc, ex);
      lens += T*(beamLight(p)*sc + ambIn*.25*max(sc - gClr*.9, 0.))*wideCut*dl*K;   // the wide-beam cut, as for the cornea
      T *= exp(-ex*dl);
    }
    // a wide beam: the iris shades the lens at the margin, and a bright lamp saturates softly instead of washing out to a
    // flat disc. A thin slit, the optic section itself, is left as it is.
    float wide = smoothstep(1., 6., uBW);
    lens *= mix(1., lensRimShade(pupV), wide);
    col += mix(lens, lens/(1. + 1.1*lens), wide);
    // capsule interfaces are thinner than a march step, so add them analytically at the surface hits
    vec3 nA = normalize(pI + rd2*tA - vec3(0., 0., CLA));
    vec3 pA = pI + rd2*tA + rd2*.01;
    col += beamLight(pA)*vec3(.8, .86, .95)*uCapSc*CAPG*K*wideCut/max(-dot(rd2, nA), .2);
    if(hP.y < hA.y){
      vec3 nP = normalize(pI + rd2*hP.y - vec3(0., 0., CLP));
      vec3 pP = pI + rd2*hP.y - rd2*.01;
      col += T*beamLight(pP)*vec3(.8, .86, .95)*uCapSc*.7*CAPG*K*wideCut/max(dot(rd2, nP), .2);
    }
  }
  col += T*uRetro*uBI*vec3(.8, .2, .07)*.45*uFilt.r;   // fundus red reflex
  return col;
}

vec3 shade(vec3 ro, vec3 rd, float jt){
  // lids are a curved surface in front of the globe; iterate to find its depth
  vec3 pS = ro + rd*((1.5 - ro.z)/rd.z);
  vec2 dl = lidDist(pS.xy);
  gazeFrame(ro, rd);

  // the view ray meets the external view's surface (conic cornea grooved into the scleral sphere); the limbal
  // cover then mixes the cornea's path with the sclera through the translucent band
  vec3 col;
  vec3 p0 = globeHit(ro, rd);
  float r0 = length(p0.xy), cv = r0 < uScR ? limbCover(p0.xy) : 1.;
  // A ray past the globe's silhouette meets the fornix, whatever point globeHit() lands on when the globe is turned;
  // and the plica lies on top of the globe, so a limbus turned toward it passes under it.
  if(sph(ro, rd, vec3(0., 0., uScZ), uScR).x < 0.) cv = 1.;
  else {
    float dIn, xe, v;
    plicaFold(toRoom(p0).xy, dIn, xe, v);
    cv = max(cv, sstep(-uPlicaSoft, uPlicaSoft, dIn));
  }
  bool inner = uLayer > 2.5 && uLayer < 5.5;   // debug layers inside the cornea
  bool sclOnly = uLayer > 1.5 && uLayer < 2.5;
  // one sclera() call site (and one cornealPath()), for the same reason as irisShade()
  vec3 scl = sclOnly || (cv > 0. && !inner) ? sclera(ro, rd) : vec3(0.);
  if(sclOnly || cv >= 1.) col = scl;
  else {
    // past the corneal edge the ray meets sclera, so behind the band is the ring floor on the same meridian
    float rc = uRL - .01;
    vec3 pc = r0 < rc ? p0 : vec3(p0.xy*rc/r0, globeZ(rc));
    vec3 behind = cornealPath(ro, rd, pc, jt);
    // the conjunctival vessels (gVesT, set by sclera()) lie on top of the band and run on up to the cornea
    vec3 vT = max(gVesT, vec3(.02));
    col = limbalBand(behind, scl/vT, cv)*vT;
  }

  if(uLayer > .5) return col;   // debug layers show the part alone, without what lies on it at the lids

  float dm = dl.y, hm = uTMH*pow(uTMTaper, abs(pS.x - uPupDec.x)/3.);   // tear meniscus on the lower lid
  col += ROOM*uAmb*.1*smoothstep(hm, .13*hm, dm)*smoothstep(0., .17*hm, dm)*(.6 + .8*noise(vec2(pS.x*3., 1.)));
  float dc = discharge(pS.xy, dm);   // lies on the meniscus, lit by the room and the beam like the conjunctiva
  if(dc > 0.) col = mix(col, dischargeLit(pS.xy, roomLight(vec3(0., 0., 1.))*.95 + uBI*uFilt*slabAt(pS)*.9, dc), dc);
  col *= 1. - .6*smoothstep(1.1, 0., dl.x);   // upper lid and lash shadow
  return col;
}

// Exterior photo in the slit views: the daylight skin albedo lit by the room and the slit beam. The lids lie
// uLidDepth in front of the globe (out to the orbital rim, taken flat past 0.8 of its radius), so the beam's strip
// on the skin shifts sideways with depth like the section through the eye.
vec3 slitSkin(vec2 p, vec3 alb){
  float r = min(length(p), .8*uScR);
  vec3 ps = vec3(p, uScZ + sqrt(uScR*uScR - r*r) + uLidDepth);
  // the photo is soft in places (lower lid, cheek): pores and fine creases keep the skin from reading as flat tone
  vec2 sw = p + .25*vec2(noise(p*3.1), noise(p*3.1 + 5.));
  float pores = .5*noise(p*10.) + .35*noise(p*22. + 3.) + .25*noise(p*46. + 8.);
  float crease = pow(max(1. - abs(noise(sw*vec2(2.6, 1.5) + 11.)), 0.), 9.) + .6*pow(max(1. - abs(noise(sw*vec2(5.5, 3.5) + 2.)), 0.), 12.);
  alb *= 1. + .12*(pores - .35) - .05*crease;   // grain only: mean-neutral, no colour shift
  float room = 1.;   // keep the photo's own skin colour under every lamp setting
  vec2 sq = slitUV(ps);
  float d = abs(sq.x) - .5*uBW;
  float halo = .1*exp(-max(d, 0.)/1.2)*smoothstep(uBH*.5 + 1.5, uBH*.5 - .2, abs(sq.y));   // scattered beam light beside the strip
  // halogen spill: the lamp's warm (~3000 K, uFilt) light scattered round the beam pools on the lids and cheek,
  // brightest round the beam and on the lamp arm's side, and grows with the beam's size and intensity
  vec2 q = p - vec2(uBX, uBY);
  float power = uBI*min(1., sqrt(uBW*uBH)/14.);
  float spill = .55*power*exp(-dot(q, q)/(2.*9.*9.))*(1. + .35*clamp(p.x*sign(LD.x)/10., -1., 1.));
  return alb*(roomLight(vec3(0., 0., 1.))*.8*room + uBI*uFilt*(slabAt(ps)*.6 + halo) + uFilt*spill);
}

// ---- external view (realism layer L2: globe and sclera behind the exterior photo) ----------
// Orthographic, looking down -z, so the visible globe is a height field over the image plane: the
// conic corneal cap and the scleral sphere joined by a smooth limbal groove, plus a concave fillet
// skirt (a quarter circle) that curls back from the silhouette to close the corners of the opening.
// Lit like the photo: a broad diffuser on the camera axis, then the lamp spot and grade of the L1 relight.

// tools/cut-exterior.ts relight(): linear light as the daylight photo would record it -> the lamp grade, sRGB.
vec3 lampGrade(vec3 lin, vec2 p){
  vec2 d = p - uLampSpot.xy;
  float beam = sstep(uLampSpot.z + uLampSpot.w, uLampSpot.z - uLampSpot.w, length(d));
  float light = (uLampGrade.x + (1. - uLampGrade.x)*beam)*(1. + uLampGrade.w*clamp(d.x/uLampSpot.z, -1., 1.));
  vec3 c = pow(max(lin*uLampGrade.y*light*uWarmth, 0.), vec3(uLampGrade.z));
  return pow(clamp(c, 0., 1.), vec3(1./2.2));
}

// The same, continued past the silhouette onto the fornix fillet (as in externalEye).
vec3 surfN(vec2 p){
  float r = length(p);
  if(r < uScR) return globeN(p);
  float c = clamp((uScR + uFilletW - r)/uFilletW, 0., 1.);
  return normalize(vec3(p/r*c, sqrt(max(1. - c*c, 0.))));
}
// Tear-surface slope error (break-up, epithelial oedema): N tilted by uTearIrr times a unit-RMS noise vector.
vec3 roughen(vec3 N, vec2 p){
  if(uTearIrr <= 0.) return N;
  vec2 q = p/uTearIrrL;
  vec2 g = (vec2(noise(q), noise(q + 31.7)) - .5)*3.5;   // value noise - .5 has an RMS of about .2 per axis
  return normalize(N + uTearIrr*vec3(g, 0.));
}

// The view ray (down -z) refracted at the front-surface point p0 (normal N; jit tilts it, the stromal haze
// scattering) and at the back surface: its start p1 and direction rd2 in the aqueous.
void intoAqueous(vec3 p0, vec3 N, vec2 jit, out vec3 p1, out vec3 rd2){
  vec3 rd1 = normalize(refract(vec3(0., 0., -1.), N, 1./uCornN) + vec3(jit, 0.));
  p1 = p0; rd2 = rd1;
  vec2 hb = sph(p0, rd1, vec3(0., 0., -uCCT - uR2), uR2);
  if(hb.x > 0.){
    p1 = p0 + rd1*hb.x;
    rd2 = refract(rd1, normalize(p1 - vec3(0., 0., -uCCT - uR2)), uCornN/uAqN);
  }
}
bool inPupil(vec3 p1, vec3 rd2){ return pupD((p1 + rd2*((ZI - p1.z)/rd2.z)).xy - uPupDec.xy) < uRP; }

// The room's diffuse light scattered back by the lens along a ray through the pupil. A clear lens returns almost
// nothing, so the pupil stays black; a cataract's own scatter and absorption colour it, in this view as in the slit views.
vec3 lensInPupil(vec3 pI, vec3 rd2, float jt){
  vec2 hA = sph(pI, rd2, vec3(0., 0., CLA), uLR1);
  vec2 hP = sph(pI, rd2, vec3(0., 0., CLP), uLR2);
  float tA = max(hA.x, 0.), tB = min(hA.y, hP.y);
  if(tB <= tA) return vec3(0.);
  const int NE = 16;
  float dl = (tB - tA)/float(NE);
  vec3 col = vec3(0.), T = vec3(1.);
  for(int i = 0; i < NE + uZero; i++){
    vec3 sc, ex; lensMedium(pI + rd2*(tA + dl*(float(i) + jt)), sc, ex);
    col += T*max(sc - gClr, 0.)*dl;
    T *= exp(-ex*dl);
  }
  return col*uLensDiffuse*lensRimShade(pI.xy - uPupDec.xy);
}

// Iris seen through the cornea: refract at the front surface (normal N at p0) and the back surface.
vec3 irisThroughCornea(vec3 p0, vec3 N, vec2 jit){
  vec3 p1, rd2;
  intoAqueous(p0, N, jit, p1, rd2);
  // pupil: no light comes back from the fundus in diffuse light; the margin is a soft ramp whose half-width follows the ruff width
  vec2 xy = (p1 + rd2*((ZI - p1.z)/rd2.z)).xy;
  // the margin is irregular and feathered, over a ramp at least 0.15 mm wide
  vec2 pv = xy - uPupDec.xy;
  float pw = max(.5*uRuffW, .15);
  float pc = sstep(-pw, pw, pupD(pv) - uRP - pupRim(pv));
  float h;
  vec3 lens = pc < 1. ? lensInPupil(vec3(xy, ZI), rd2, hash12(xy*71.3 + uFrame*5.1)) : vec3(0.);
  return irisSurface(xy, h)*pc + lens*(1. - pc);
}

// Stromal haze and arcus (external view): transmission of the image behind the cornea at radius r, with the
// same scatter gains as corneaSc and cornealPath.
float hazeT(float r){ return exp(-HZA*(1.5*uHaze + 2.2*arcus(r))/1.5); }

// Iris radiance through the tear film and cornea at image point p (inside the corneal edge). Arcus takes light out
// of the iris image and sends half of it back as a grey veil (lit by the diffuser like any surface facing n).
// Haze scatters mostly forward, as in cornealPath: a scattered sample sees the iris through a tilted ray (the
// halo), and only the HZR share of the scattered light is lost to the image and returned as veil.
// ring: the limbal-ring weight, applied to the iris image only (the veil lies in front of it, in the cornea).
vec3 irisSeen(vec2 p, float ring){
  vec3 N = roughen(globeN(p), p);
  float r = length(p), F = tearF(N.z);
  float hzT = exp(-uHaze*HZA), hzR = (1. - hzT)*HZR, aT = exp(-HZA*2.2*arcus(r)/1.5);
  float T = aT*(1. - hzR);
  vec2 jit = hash12(p*37.3 + uFrame*11.7) > hzT ? (vec2(hash12(p*91.7 + uFrame*7.3), hash12(p.yx*53.1 + uFrame*3.1)) - .5)*HZB : vec2(0.);
  vec3 veil = ((1. - aT)*.5 + aT*hzR)*vec3(.92, .92, .9)*(1. + N.z)*.5;
  gTex = mix(1., uLimbTexFade, ring);
  return ringed(irisThroughCornea(vec3(p, globeZ(r)), N, jit), ring)*(1. - F)*(1. - F)*T + veil;
}

// ---- reflections of the lamp (realism layer L5) ----
// Fraction of the lamp disc seen along the mirror direction R; the rim ramps over the last 10% of the half-size.
float lampDisc(vec3 R){ return sstep(uReflex, .9*uReflex, acos(clamp(dot(R, uLampDir), -1., 1.))); }

// A ray reflected by the lens, leaving it at p in direction d (aqueous): back through the pupil and out through
// both corneal surfaces. Returns the lamp fraction it sees (0 if the iris stops it or the cornea reflects it totally).
float lensReflexOut(vec3 p, vec3 d){
  if(d.z <= 0.) return 0.;
  if(pupD((p + d*((ZI - p.z)/d.z)).xy - uPupDec.xy) > uRP) return 0.;
  vec3 cb = vec3(0., 0., -uCCT - uR2);
  vec2 hb = sph(p, d, cb, uR2);
  if(hb.y <= 0.) return 0.;
  vec3 p1 = p + d*hb.y;
  d = refract(d, -normalize(p1 - cb), uAqN/uCornN);
  vec2 hf = sph(p1, d, vec3(0., 0., -uR1), uR1);   // the sphere finds the exit point; the conic gives its normal
  if(dot(d, d) < .5 || hf.y <= 0.) return 0.;
  vec3 p2 = p1 + d*hf.y;
  d = refract(d, -roughen(globeN(p2.xy), p2.xy), uCornN);
  return dot(d, d) < .5 ? 0. : lampDisc(d);
}

// Mirror images of the lamp at image point p (radiance, before the grade): Purkinje I on the tear film, and inside
// the pupil the lens's front (III) and back (IV) surface images, seen through the cornea and its haze.
float externalSpec(vec2 p){
  float r = length(p);
  if(r >= uScR) return 0.;
  vec3 N = roughen(globeN(p), p);
  float s = tearF(N.z)*lampDisc(reflect(vec3(0., 0., -1.), N));
  if(r >= uRL) return s*uReflexGain;
  vec3 p1, rd2;
  intoAqueous(vec3(p, globeZ(r)), N, vec2(0.), p1, rd2);
  if(!inPupil(p1, rd2)) return s*uReflexGain;
  vec3 CA = vec3(0., 0., CLA), CP = vec3(0., 0., CLP);
  vec2 hA = sph(p1, rd2, CA, uLR1);
  if(hA.x <= 0.) return s*uReflexGain;
  vec3 pa = p1 + rd2*hA.x, na = normalize(pa - CA);
  float l = lensReflexOut(pa, reflect(rd2, na));                   // III: front surface
  vec3 rl = refract(rd2, na, uAqN/uLensN);
  vec2 hP = sph(pa, rl, CP, uLR2);
  if(hP.y > 0.){
    vec3 pb = pa + rl*hP.y;
    vec3 rb = reflect(rl, normalize(pb - CP));                      // IV: back surface, seen from inside the lens
    vec2 hF = sph(pb, rb, CA, uLR1);
    if(hF.y > 0.){
      vec3 pf = pb + rb*hF.y;
      vec3 ro = refract(rb, -normalize(pf - CA), uLensN/uAqN);
      if(dot(ro, ro) > .5) l += lensReflexOut(pf, ro);
    }
  }
  return (s + uLensRefl*l*hazeT(r))*uReflexGain;
}

// Tear meniscus along one lid margin: a concave fillet of height h and radius r in the lid-globe angle. d is the
// apparent distance (mm) from the margin at p and u the image-plane direction away from the lid. Across the strip
// the normal turns from the globe's (top) to the lid-facing tangent e (at the margin). Updates the transmission of
// the light seen through it, the sample shift (refraction toward the lid) and the lamp glint. The glint line is
// thinner than a pixel, so its energy goes to the pixel row that holds it rather than being point-sampled.
void meniscus(vec2 p, float d, vec2 u, float h, float r, float pix, inout float trans, inout vec2 shift, inout float glint){
  vec3 n = surfN(p);
  vec2 t2 = vec2(-u.y, u.x);
  vec3 t = normalize(vec3(t2, -dot(n.xy, t2)/n.z));   // lid tangent lifted into the globe's tangent plane
  vec3 e = normalize(cross(n, t));
  if(dot(e.xy, u) < 0.) e = -e;
  float el = length(e.xy);                            // apparent / true distance across the strip
  if(d < h*el){
    float s = clamp((h - d/el)/r, 0., 1.), c = sqrt(1. - s*s);
    vec3 N = roughen(c*n + s*e, p);
    float F = tearF(N.z);
    trans *= (1. - F)*(1. - F);
    float ti = acos(clamp(N.z, 0., 1.)), tt = asin(sin(ti)/uTearN);
    shift -= u*r*(1. - c)*tan(ti - tt);
  }
  vec3 H = normalize(uLampDir + vec3(0., 0., 1.));
  float pg = atan(dot(H, e), dot(H, n));              // the strip's normal closest to the view/lamp bisector
  if(pg < 0. || sin(pg) > min(h/r, 1.)) return;
  float dg = (h - r*sin(pg))*el;                      // apparent distance of the glint line from the margin
  float w = r*cos(pg)*uReflex*el;                     // its apparent width: the lamp disc spans uReflex of normal tilt
  float cover = max(w, pix);
  if(abs(d - dg) >= .5*cover) return;
  vec3 Ng = roughen(cos(pg)*n + sin(pg)*e, p);
  glint += tearF(Ng.z)*lampDisc(reflect(vec3(0., 0., -1.), Ng))*uReflexGain*w/cover;
}

float gDU = 4., gDL = 4.;   // distances (mm) of the current sample from the upper and lower lid margins (externalView)

// Linear radiance of the eye at p (mm), or -1 where the ray misses every surface.
vec3 externalEye(vec2 p){
  float r = length(p), R = uScR;
  if(r >= R + uFilletW) return vec3(-1.);
  // base_colour (and plica_colour) were sampled from photos, so they already hold the diffuser shading at n.v = uAlbedoNv
  float norm = 1./((1. + uAlbedoNv)*.5);
  vec3 alb = mix(uScBase, vec3(.9, .85, .72), uScYellow)*norm;
  float cav = 1.;
  vec3 N;
  if(r >= R){
    // fillet: concave quarter circle of radius uFilletW, vertical at the silhouette, facing the camera at its outer edge
    N = surfN(p);
    cav = mix(1., uFornixOcc, (r - R)/uFilletW);   // the fold is recessed: less of the diffuser reaches into it
  } else if(r > uRL + uLimbZone){
    N = vec3(p/R, sqrt(max(R*R - r*r, 0.))/R);
  } else N = globeN(p);
  // conjunctiva (L3): mottle, blood wash with the pink band along the lower lid, vessels; then the plica and folds
  vec2 g; float wP, occ, wR;
  plica(p, .5*(gDL - gDU), uFov/uRes.x, min(gDU, gDL), g, wP, occ, wR);
  alb = bulbar(alb, r, r, surfS(r), p/max(r, 1e-4), uFov/uRes.x, N.z, uMarginVasc*max(1. - gDL/uMarginBlushW, 0.) + uRecessVasc*wR);
  alb = mix(alb, plicaAlb(p)*norm, wP);
  N = normalize(N + vec3(-g, 0.));
  cav *= occ;
  float nv = max(N.z, 0.);
  vec3 scl = alb*(1. + nv)*.5*cav;                  // broad diffuser on the view axis
  // the wet plica crest mirrors the lamp in a thin glint
  if(wP > 0.) scl += wP*uPlicaGloss*tearF(nv)*lampDisc(reflect(vec3(0., 0., -1.), N))*uReflexGain;
  // iris to sclera: the dark limbal ring, then the translucent limbal band. Past the corneal edge the ray meets
  // sclera, so behind the band is the ring floor on the same meridian. The conjunctival vessels lie on top of the
  // band, so they are taken out of the band's tissue and laid over the result: they run on up to the cornea.
  float cv = limbCover(p);
  if(cv >= 1.) return scl;
  vec3 ir = irisSeen(r < uRL ? p : p*(uRL - .01)/r, limbalRing(r));
  vec3 vT = max(gVesT, vec3(.02));
  return limbalBand(ir, scl/vT, cv)*vT;
}

// explicit level (the textures have no mipmaps): these lookups run in divergent branches of the slit views
vec2 distRaw(vec2 p){ return textureLod(uExtDist, vec2(p.x - uExtRect.x, uExtRect.y - p.y)/uExtRect.zw, 0.).rg*uDistRange; }

// ---- lid swelling: an image-space warp of the exterior photo ----
// Oedema pushes each margin toward the eye by that lid's swelling S. The photo slides vertically by S*f(d), d the
// distance from the margin: f is a half cosine over the field's range, flat at the margin (the margin and lashes ride
// along unstretched) and with zero slope where it ends. Along the lid it tapers as 1 - u^2 between the canthi, and
// where the margins converge at the lateral canthus the two pulls cancel, so the canthi stay fixed. The photo crop
// ends less than the field's range past the margins, so each falloff is shortened to end at the crop's top (upper
// lid) or bottom (lower lid) edge, and the warp never samples outside the photo.
float swellFall(float d, float L){ return .5 + .5*cos(PI*min(d/L, 1.)); }
vec2 swellLen(vec2 s, vec2 d){
  return min(vec2(uDistRange), d + max(vec2(uExtRect.y - s.y, s.y - uExtRect.y + uExtRect.w), 0.) + 1e-3);
}
float swellTaper(float x){ float u = (x - .5*(uCanLX + uCanMX))/(.5*(uCanLX - uCanMX)); return max(1. - u*u, 0.); }
// Blink, open wide and the lid lifted for the gaze: the upper margin moves down by uLidClose x the opening's height in
// each photo column (uLidRows: the upper (r) and lower (g) margin and the fold (b) heights in mm, a = 1 where the
// column has an opening, which includes the caruncle and canthal tissue a closed lid hides), so 1 closes the whole opening, canthi
// included, and a negative value raises the lid. Only the lid moves: its skin from the margin up to the fold (b: the
// still skin's edge, fissure.json lid_fold) stretches or gathers to follow, the skin above the fold never moves, and
// the opening compresses or stretches onto the fixed lower margin.
// Both maps are monotone in y, so the photo never folds, and every lookup of the photo (colour, opening, distance
// field) follows the moved margin.
// How far the raised upper margin (uLidClose < 0) climbs above the photo's, mm, at column x: a share of the column's
// opening height, eased off against the room the skin above leaves and weighted toward the middle so the margin arches.
float lidLift(float x){
  if(uLidClose >= 0.) return 0.;
  vec4 m = textureLod(uLidRows, vec2((x - uExtRect.x)/uExtRect.z, .5), 0.);
  if(m.a < .5) return 0.;
  float top = max(min(m.b, uExtRect.y), m.r + .5), room = .5*(top - m.r), lift = -uLidClose*(m.r - m.g)*mix(.3, 1., swellTaper(x));
  return room*(1. - exp(-lift/room));
}
vec2 lidMove(vec2 p){
  if(uLidClose == 0.) return p;
  vec4 m = textureLod(uLidRows, vec2((p.x - uExtRect.x)/uExtRect.z, .5), 0.);
  if(m.a < .5 || p.y <= m.g) return p;                         // no opening in this column, or the lower lid
  float yu = m.r, yl = m.g, top = max(min(m.b, uExtRect.y), yu + .5);
  float yn = uLidClose < 0. ? yu + lidLift(p.x) : max(yu - uLidClose*(yu - yl), yl);   // the moved margin
  if(p.y >= top) return p;
  if(p.y >= yn) return vec2(p.x, top - (top - p.y)*(top - yu)/(top - yn));   // the upper lid
  return vec2(p.x, yl + (p.y - yl)*(yu - yl)/max(yn - yl, 1e-4));           // what is left of the opening
}
// Output point p shows the photo at s = p + V(s). The map is monotone along y with dV/ds between -S*pi/(2L) (lid side,
// steep where the crop shortens L) and S*pi/(2R) (opening side), so a damped iteration with the step 2/(a + b) for
// slopes a, b of s - V(s) converges at every point. Every lookup of the photo layer (colour, opening, distance
// field) goes through it.
vec2 swellWarp(vec2 p){
  p = lidMove(p);
  if(uSwellU + uSwellL <= 0.) return p;
  float t = swellTaper(p.x), h = .5*PI*t;
  vec2 s = p;
  for(int i = 0; i < 6 + uZero; i++){
    vec2 d = distRaw(s), L = swellLen(s, d);
    float V = t*(uSwellU*swellFall(d.x, L.x) - uSwellL*swellFall(d.y, L.y));
    float a = 1. - h*max(uSwellU, uSwellL)/uDistRange, b = 1. + h*max(uSwellU/L.x, uSwellL/L.y);
    s.y += 2./(a + b)*(p.y + V - s.y);
  }
  return s;
}
// The swollen lid's look at photo point s, relative to the flat lid the photo holds: the stretched band between the
// margin and the falloff's end L rises into a dome h = 0.25*S*t*(1 - cos(2*pi*d/L)) (half the swelling high), shaded by
// the diffuser on the view axis and the lamp Ld; its concave feet (margin and crease) lose some light. x: shading
// factor, y: blood absorber strength (uSwellBlood per mm of local displacement, the hyperaemia of the inflamed lid).
vec2 swellLook(vec2 s, vec3 Ld){
  const float e = .25;
  float t = swellTaper(s.x);
  vec2 d = distRaw(s), L = swellLen(s, d), k = PI/L, S = t*vec2(uSwellU, uSwellL), a = 2.*k*min(d, L);
  vec2 gx = (distRaw(s + vec2(e, 0.)) - distRaw(s - vec2(e, 0.)))/(2.*e), gy = (distRaw(s + vec2(0., e)) - distRaw(s - vec2(0., e)))/(2.*e);
  vec2 dh = .5*S*k*sin(a);                                       // dh/dd for each margin
  vec3 N = normalize(vec3(-(dh.x*vec2(gx.x, gy.x) + dh.y*vec2(gx.y, gy.y)), 1.));
  float lit = .5*(1. + N.z) + .5*max(dot(N, Ld), 0.)/Ld.z;          // diffuser and lamp, each 1 on the flat lid
  vec2 cav = S*k*k*cos(a)*vec2(sstep(L.x, .75*L.x, d.x), sstep(L.y, .75*L.y, d.y));   // d2h/dd2 > 0: concave, faded out at the field's edge
  float occ = 1. - .3*clamp(max(cav.x, 0.) + max(cav.y, 0.), 0., 1.);
  return vec2(lit*occ, uSwellBlood*(S.x*swellFall(d.x, L.x) + S.y*swellFall(d.y, L.y)));
}
vec3 swellSkin(vec3 lin, vec2 s, vec3 L){
  vec2 lk = swellLook(s, L);
  return lin*lk.x*bloodT(lk.y, uVesCol);
}

vec2 distAt(vec2 p){ return distRaw(swellWarp(p)); }
// Unit direction away from the upper (k 0) or lower (k 1) margin. The field holds 8-bit levels (0.016 mm), so
// the gradient is taken over a 0.5 mm baseline, from a point moved off the margin so that no sample straddles
// it (the field is unsigned).
vec2 distDir(vec2 p, int k){
  const float e = .25;
  vec2 g, q = p;
  for(int i = 0; i < 2 + uZero; i++){
    vec2 gx = distAt(q + vec2(e, 0.)) - distAt(q - vec2(e, 0.)), gy = distAt(q + vec2(0., e)) - distAt(q - vec2(0., e));
    vec2 v = k == 0 ? vec2(gx.x, gy.x) : vec2(gx.y, gy.y);
    g = v/max(length(v), 1e-6);
    q = p + g*(e + .05);
  }
  return g;
}

// The distance field is unsigned, so under the L1 feather it also grows into the lid. There u points into the
// lid (the photo's alpha is high a step along it): turn u toward the opening and hold d at the margin, so the
// meniscus ends at the cut instead of being mirrored, back-facing, onto the lid side.
void openSide(vec2 p, inout vec2 u, inout float d){
  vec2 q = swellWarp(p + u*.1);
  if(textureLod(uExtTex, vec2(q.x - uExtRect.x, uExtRect.y - q.y)/uExtRect.zw, 0.).a > .5){ u = -u; d = 0.; }
}

// pc: pixel centre (the photo is sampled there, so it stays sharp); pj: jittered position for the eye.
vec3 externalView(vec2 pc, vec2 pj){
  vec2 sc = swellWarp(pc), uvc = vec2(sc.x - uExtRect.x, uExtRect.y - sc.y)/uExtRect.zw;
  vec4 ext = texture(uExtTex, uvc)*uExtShow;          // uExtShow 0: the eye layer alone
  if(uSwellU + uSwellL > 0. && ext.a > 0.) ext.rgb = pow(swellSkin(pow(ext.rgb, vec3(2.2)), sc, uLampDir), vec3(1./2.2));
  if(ext.a >= 1.) return ext.rgb;                   // only march the eye inside the opening
  vec2 dd = distAt(pj);                             // distance from the upper (x) and lower (y) lid margins, mm
  gDU = dd.x; gDL = dd.y;
  // tear menisci along both margins, their height and radius tapering away from the centre
  float tap = pow(uTMTaper, abs(pj.x - uPupDec.x)/3.), hl = uTMH*tap, hu = uTMHU*tap;
  float trans = 1., glint = 0.;
  vec2 shift = vec2(0.);
  if(dd.y < hl || dd.x < hu){
    float pix = uFov/uRes.x;
    if(dd.y < hl){ vec2 u = distDir(pj, 1); float d = dd.y; openSide(pj, u, d); meniscus(pj, d, u, hl, uTMR*tap, pix, trans, shift, glint); }
    if(dd.x < hu){ vec2 u = distDir(pj, 0); float d = dd.x; openSide(pj, u, d); meniscus(pj, d, u, hu, uTMRU*tap, pix, trans, shift, glint); }
  }
  vec3 lin = externalEye(pj + shift);
  vec3 eye = vec3(1., 0., 1.);                      // a miss shows magenta, never a plausible colour
  if(lin.x >= 0.){
    // discharge lies on the meniscus: a diffuser facing the view, lit like the conjunctiva beside it
    float dc = discharge(pj, dd.y);
    if(dc > 0.) lin = mix(lin, dischargeLit(pj, vec3(.95), dc), dc);
    // upper-lid shadow: the margin is a slab uLidDepth deep, so the diffuser is partly hidden over a
    // penumbra uLidDepth*tan(half-angle) below the margin. Across it the edge uncovers the disc-shaped
    // diffuser like a sliding chord: the visible half-disc segment grows fast at first, then levels off.
    float u = clamp(dd.x/(uLidDepth*uPenumbraTan), 0., 1.);
    lin *= mix(uShadowMargin, 1., (asin(u) + u*sqrt(1. - u*u))*2./3.14159265)*trans;
    // the lamp itself, seen in reflection, is hidden by the same slab within uLidDepth*tan(elevation) of the margin
    float el = atan(uLampDir.y, length(uLampDir.xz));
    float vis = sstep(uLidDepth*tan(el - uReflex), uLidDepth*tan(el + uReflex), dd.x);
    lin += (externalSpec(pj) + glint)*vis;
    eye = lampGrade(lin, pj);
  }
  return mix(eye, ext.rgb, ext.a);
}

void main(){
  float a = uAng;
  LD = vec3(sin(a), 0., cos(a));
  NB = vec3(cos(a), 0., -sin(a));
  L1n = normalize(L1); L2n = normalize(L2);
  ZI = -uCCT - uACD;
  LZA = ZI - .05;
  LZP = LZA - uLT;
  LZC = .5*(LZA + LZP);
  CLA = LZA - uLR1;
  CLP = LZP + uLR2;

  vec3 prev = texelFetch(uPrev, ivec2(gl_FragCoord.xy), 0).rgb;
  vec2 jit = vec2(hash12(gl_FragCoord.xy + uFrame*17.3), hash12(gl_FragCoord.yx + uFrame*9.1)) - .5;
  vec2 uv = (gl_FragCoord.xy + jit - .5*uRes)/uRes.x;
  // One source, two programs (SHADERS.exterior defines EXTERIOR_VIEW): each compiles only its own path, which
  // halves the D3D compile that blocks the browser on Windows.
  {
    float c = 1./uR1;
    SCZ = corneaZ(uRL) - sqrt(uScR*uScR - uRL*uRL);
    // groove: blend over uLimbZone, centred on the limbus, where the two surfaces' slopes differ
    float sc = c*uRL/sqrt(1. - (1. + uCornQ)*c*c*uRL*uRL), ss = uRL/sqrt(uScR*uScR - uRL*uRL);
    GK = .5*uLimbZone*abs(sc - ss);
  }
#ifdef EXTERIOR_VIEW
  {
    vec2 pc = (gl_FragCoord.xy - .5*uRes)/uRes.x*uFov + uCam;
    fragColor = vec4(mix(prev, externalView(pc, uv*uFov + uCam), uBlend), 1.);
  }
#else
  if(uEye > .5 && length(uv) > .5*uRes.y/uRes.x){ fragColor = vec4(mix(prev, vec3(0.), uBlend), 1.); return; }

  vec2 xy = uv*uFov + uCam;
  float r1 = hash12(gl_FragCoord.xy*1.37 + uFrame*3.7), r2 = hash12(gl_FragCoord.xy*.71 + uFrame*5.3);
  vec2 ap = sqrt(r1)*vec2(cos(TAU*r2), sin(TAU*r2))*uAper;
  vec3 ro = vec3(xy + ap, 40.);
  vec3 rd = normalize(vec3(xy, uFocus) - ro);
  float jt = hash12(gl_FragCoord.xy*2.11 + uFrame*1.91);

  // layered eye: the relit photo over the eye, which is marched only inside the opening. shade() has one call
  // site: drivers inline it, and a second copy of the ray march doubles the (already long) D3D compile.
  vec4 sk = vec4(0.);
  {
    vec2 pc = (gl_FragCoord.xy - .5*uRes)/uRes.x*uFov + uCam;   // pixel centre: the photo stays sharp
    vec2 sc = swellWarp(pc);
    sk = textureLod(uSkinTex, vec2(sc.x - uExtRect.x, uExtRect.y - sc.y)/uExtRect.zw, 0.);
    vec3 alb = pow(sk.rgb, vec3(2.2));
    if(uSwellU + uSwellL > 0. && sk.a > 0.) alb = swellSkin(alb, sc, vec3(0., 0., 1.));   // the room light: on the view axis
    sk.rgb = slitSkin(pc, alb);
    if(uLayer > 1.5) sk = vec4(0.);   // debug layers hide the skin
  }
  vec3 col = (sk.a < 1. && uLayer != 1.) ? shade(ro, rd, jt) : vec3(0.);
  col = mix(col, sk.rgb, sk.a);
  col = 1. - exp(-col*1.35);
  col = pow(col, vec3(1./2.2));
  fragColor = vec4(mix(prev, col, uBlend), 1.);   // running average over frames
#endif
}
