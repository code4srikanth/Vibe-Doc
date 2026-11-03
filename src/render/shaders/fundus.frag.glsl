// Fundus view (docs/fundus F2): a flat image of the retina in millimetres, built from eye-model metadata by
// src/render/modules/fundus.ts. Fundus coordinates: fovea at the origin, +x temporal, +y up. uLens.xy maps the screen to
// the fundus: an upright photograph has a right eye's temporal side on the screen's left and a left eye's on its right;
// the image of a handheld lens (uLens.w = 1, F3) is inverted, and the lamp lights it through the slit.
// Colours are linear reflectance; the output is sRGB. Each frame jitters the sample inside the pixel, so the running
// average (uBlend) anti-aliases.
precision highp float;
out vec4 fragColor;

uniform vec2 uRes, uCam;
uniform float uFrame, uFov, uBlend, uFieldR;
// the view: uLens = screen-to-fundus signs, lens image scale, 1 through a lens; uFC = fundus point at the screen's
// origin, then the field's centre on the screen; uFN = filter relative to white; uBlurMM = defocus; uDec = beam decentration
uniform vec4 uLens, uFC;
uniform vec3 uFN;
uniform float uBlurMM, uDec;
// the lamp (src/exam/views.ts) and the lids
uniform float uBW, uBH, uBR, uBI, uAmb, uLidClose;
uniform sampler2D uPrev, uVessels;
uniform float uVesHalf;
// retina
uniform vec3 uFBg;
uniform float uFDark, uFTess, uFSheen;
// optic disc: centre and radii; cup offset and ratios; notch depth and angle, haemorrhage length and angle
uniform vec4 uDisc, uCup, uNotch;
uniform float uPPA, uPallor;
uniform vec3 uRimCol, uCupCol;
// macula: macula, fovea and foveola radii, pigment; foveal reflex
uniform vec4 uMac;
uniform float uFovReflex;
// vessels
uniform vec3 uVesA, uVesV;
uniform float uArtReflex;

const float PI = 3.14159265, TAU = 6.2831853;
float sstep(float a, float b, float x){ float t = clamp((x - a)/(b - a), 0., 1.); return t*t*(3. - 2.*t); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f*f*(3. - 2.*f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y)*2. - 1.;
}
float fbm(vec2 p){ float s = 0., a = .5; for(int i = 0; i < 4; i++){ s += a*noise(p); p = p*2.03 + 7.1; a *= .5; } return s; }
float angDiff(float a, float b){ return abs(atan(sin(a - b), cos(a - b))); }

// Rim width lost toward angle th (notch), as a fraction of the healthy rim.
float notchAt(float th){ return uNotch.x*exp(-pow(angDiff(th, uNotch.y)/.35, 2.)); }

vec3 fundus(vec2 p){
  float r = length(p);
  vec3 col = uFBg;
  // choroidal pattern: dark interlacing stripes between the choroidal vessels, plainer at the posterior pole
  float tess = pow(max(0., 1. - abs(fbm(p*vec2(.9, .7) + 3.)*1.6)), 3.);
  col *= 1. - uFTess*.55*tess*sstep(2., 9., r);
  // shades of dark: broad brighter and darker areas, patches of denser pigment, and a darker upper fundus (the lid's
  // shadow in a fundus photograph); then the fine mottle of the RPE
  col *= 1. + .22*fbm(p*.16 + 11.);
  vec2 w = p + 2.5*vec2(fbm(p*.22 + 2.), fbm(p*.22 + 19.));      // warped, so the patches have no straight edges
  col *= 1. - .4*sstep(-.25, .5, fbm(w*.13 + 4.));
  col *= 1. - .3*sstep(2., 12., p.y + 2.5*fbm(p*.2 + 7.));
  col *= 1. + .06*fbm(p*6.) + .03*noise(p*25.);
  // peripheral darkening (the light falls off away from the posterior pole)
  col *= 1. - uFDark*sstep(3., 11., length(p - vec2(uDisc.x*.3, 0.)));
  // macula: extra pigment, strongest at the fovea
  col *= 1. - uMac.w*(.55*sstep(uMac.x, uMac.y, r) + .45*sstep(uMac.y, uMac.z, r));
  // nerve-fibre sheen: fine bright striations radiating from the disc, strongest along the arcades near it
  vec2 q = p - uDisc.xy;
  float dq = length(q), th = atan(q.y, q.x);
  float arc = sstep(1.2, .2, abs(abs(sin(th)) - .75));      // the superior and inferior bundles
  float stri = .5 + .5*noise(vec2(th*38., dq*1.2));
  col += uFSheen*.012*stri*arc*exp(-max(dq - uDisc.z, 0.)/2.2)*vec3(1., .85, .6);

  // peripapillary atrophy: a paler, mottled crescent just outside the disc, widest temporally
  vec2 e = q/uDisc.zw;
  float ed = length(e), mr = min(uDisc.z, uDisc.w);
  float ppaW = uPPA*max(cos(th), 0.);
  float ppa = sstep(1. + ppaW/mr + .1, 1. + ppaW/mr - .1, ed)*sstep(.95, 1.03, ed)*sstep(0., .05, ppaW);
  col = mix(col, vec3(.5, .2, .07)*(1. + .2*noise(p*14.)), ppa*.6);

  // the disc: an orange-pink rim, a pale cup, a soft scleral ring at the margin
  float disc = sstep(1.05, .93, ed);
  vec2 cq = (p - uDisc.xy - uCup.xy)/(uDisc.zw*uCup.zw);
  float cth = atan(cq.y, cq.x), ce = length(cq);
  // a notch widens the cup toward its angle, eating into the rim
  float n = notchAt(cth);
  float cupEdge = 1. + n*(1./max(min(uCup.z, uCup.w), .05) - 1.)*.98;
  float cup = sstep(cupEdge + .3, cupEdge - .3, ce);
  vec3 rim = mix(uRimCol, vec3(.75, .62, .45), uPallor)*(1. + .08*noise(p*20.));
  vec3 cupC = uCupCol*(.92 + .08*sstep(cupEdge, 0., ce));          // the cup floor is brightest at its centre
  vec3 dcol = mix(rim, cupC, cup);
  dcol = mix(dcol, vec3(.8, .55, .3), sstep(.9, 1., ed)*.12);       // a faint scleral ring at the margin
  col = mix(col, dcol, disc);

  // splinter haemorrhage across the disc margin at its angle
  if(uNotch.z > 0.){
    vec2 dir = vec2(cos(uNotch.w), sin(uNotch.w));
    vec2 m = uDisc.xy + dir*uDisc.zw;                              // on the margin
    float along = dot(p - m, dir), across = dot(p - m, vec2(-dir.y, dir.x));
    float t = clamp((along + uNotch.z*.4)/uNotch.z, 0., 1.);       // along the flame: a splinter, widest in the middle
    float h = sstep(.09*sin(PI*t) + .01, .02*sin(PI*t), abs(across + .05*noise(vec2(along*8., 3.))))*step(.001, t)*step(t, .999);
    col = mix(col, vec3(.3, .008, .006), h);
  }

  // vessels: veins under arteries; the artery's central reflex on top
  vec2 vuv = vec2(p.x + uVesHalf, uVesHalf - p.y)/(2.*uVesHalf);
  vec3 v = texture(uVessels, vuv).rgb;
  col = mix(col, uVesV, v.g);
  col = mix(col, uVesA, v.r);
  col += uArtReflex*.02*v.b*vec3(1., .6, .45);

  // foveal reflex: a small bright point at the centre of the pit
  col += uFovReflex*.5*exp(-pow(r/.06, 2.))*vec3(1., .9, .8);
  return col;
}

void main(){
  vec3 prev = texelFetch(uPrev, ivec2(gl_FragCoord.xy), 0).rgb;
  vec2 jit = vec2(hash12(gl_FragCoord.xy + uFrame*17.3), hash12(gl_FragCoord.yx + uFrame*9.1)) - .5;
  vec2 sv = (gl_FragCoord.xy + jit - .5*uRes)/uRes.x*uFov;          // millimetres from the view's centre
  vec2 s = sv + uCam;                                               // screen millimetres
  if(uBlurMM > 0.){                                                 // out of focus: the running average spreads each point over a disc
    float a = TAU*hash12(gl_FragCoord.xy*1.37 + uFrame*3.7), b = sqrt(hash12(gl_FragCoord.xy*.71 + uFrame*5.3));
    s += uBlurMM*b*vec2(cos(a), sin(a));
  }
  vec3 col = fundus(uLens.xy*s + uFC.xy);                           // fundus millimetres
  col *= sstep(uFieldR, uFieldR - .25, length(s - uFC.zw));         // the circular field
  if(uLens.w > .5){
    // the filter, with the eye's adaptation to a dimmer colour
    const vec3 LUM = vec3(.3, .6, .1);
    col *= uFN*pow(dot(uFBg, LUM)/max(dot(uFBg*uFN, LUM), 1e-4), .7);
    // the slit's strip on the fundus, centred in the view (the beam moves with the microscope) and scaled by the lens;
    // the background light fills in the rest
    vec2 d = sv - vec2(uDec, 0.);
    float c = cos(uBR), sn = sin(uBR), hw = .5*uBW/uLens.z, hh = .5*uBH/uLens.z, e = .04 + .05*hw;
    float lit = sstep(hw + e, hw - e, abs(c*d.x + sn*d.y))*sstep(hh + e, hh - e, abs(c*d.y - sn*d.x));
    col *= uBI*.3*lit + uAmb*.5;
    col *= 1. - clamp(uLidClose, 0., 1.);                           // a blink shuts out the view
    // the two reflections of the beam from the lens's surfaces, sliding apart as the beam is decentred
    vec2 a = sv*uLens.z, dec = vec2(uDec*uLens.z, 0.);
    vec2 g1 = a - (vec2(.45, .3) + .5*dec), g2 = a - (vec2(-.35, -.22) - .3*dec);
    col += uBI*.1*(exp(-dot(g1, g1)/.03) + .6*exp(-dot(g2, g2)/.02))*uFN;
  }
  col = pow(max(col, 0.), vec3(1./2.2));
  fragColor = vec4(mix(prev, col, uBlend), 1.);
}
