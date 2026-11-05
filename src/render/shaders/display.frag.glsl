// Display pass: bloom from the accumulated image's mip chain, vignette, eyepiece mask, grain.
precision highp float;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uEye, uBloom, uGrain;   // uBloom 1 = slit-lamp optics (glare, vignette), 0 = studio photograph; uGrain 0 = none
uniform float uMirror;   // 1 = the picture is flipped left to right: the other eye of the patient
// A blink is far quicker than a ray-marched frame on a weak GPU, so it is drawn here from the last finished picture.
// uBlink: how far it has closed from the lid's resting place (0 open, 1 shut); uBlinkWarp 1 moves the lid, 0 only
// darkens (the fundus view has no lid to move). The other uniforms are the eye shader's: see lidMove() there.
uniform float uBlink, uBlinkWarp, uLidRest, uFov, uCanLX, uCanMX;
uniform vec2 uCam;
uniform vec4 uExtRect;
uniform sampler2D uLidRows;
// The picture's point that the blink shows at p (mm): lidMove() with the resting margin in place of the photo's.
vec2 blinkMove(vec2 p){
  vec4 m = textureLod(uLidRows, vec2((p.x - uExtRect.x)/uExtRect.z, .5), 0.);
  if(m.a < .5 || p.y <= m.g) return p;
  float yu = m.r, yl = m.g, top = max(min(m.b, uExtRect.y), yu + .5), yr = max(yu - uLidRest*(yu - yl), yl);
  if(uLidRest < 0.){
    float u = (p.x - .5*(uCanLX + uCanMX))/(.5*(uCanLX - uCanMX)), room = .5*(top - yu);
    yr = yu + room*(1. - exp(-(-uLidRest*(yu - yl)*mix(.3, 1., max(1. - u*u, 0.)))/room));
  }
  float yn = mix(yr, yl, uBlink);
  if(p.y >= top) return p;
  if(p.y >= yn) return vec2(p.x, top - (top - p.y)*(top - yr)/max(top - yn, 1e-4));
  return vec2(p.x, yl + (p.y - yl)*(yr - yl)/max(yn - yl, 1e-4));
}
void main(){
  vec2 uv = gl_FragCoord.xy/uRes;
  if(uMirror > .5) uv.x = 1. - uv.x;
  if(uBlink > 0. && uBlinkWarp > .5){
    vec2 k = vec2(1., uRes.y/uRes.x)*uFov;
    uv = (blinkMove((uv - .5)*k + uCam) - uCam)/k + .5;
  }
  vec3 c = textureLod(uTex, uv, 0.).rgb;
  vec3 b = max(textureLod(uTex, uv, 2.).rgb - .75, 0.)*.3
         + max(textureLod(uTex, uv, 3.5).rgb - .65, 0.)*.35
         + max(textureLod(uTex, uv, 5.).rgb - .6, 0.)*.4;
  c += b*vec3(1., .94, .86)*uBloom;
  vec2 p = (gl_FragCoord.xy - .5*uRes)/uRes.y;
  if(uEye > .5){
    float r = length(p);
    c *= mix(1., .55, smoothstep(.3, .5, r))*smoothstep(.5, .492, r);
  } else {
    c *= mix(1., mix(1., .7, uBloom), smoothstep(.5, 1.05, length(p*vec2(.75, 1.))));
  }
  float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)))*43758.5453);
  c += (g - .5)*.016*uGrain;
  if(uBlinkWarp < .5) c *= 1. - uBlink;
  fragColor = vec4(c, 1.);
}
