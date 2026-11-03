// Display pass: bloom from the accumulated image's mip chain, vignette, eyepiece mask, grain.
precision highp float;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uEye, uBloom, uGrain;   // uBloom 1 = slit-lamp optics (glare, vignette), 0 = studio photograph; uGrain 0 = none
void main(){
  vec2 uv = gl_FragCoord.xy/uRes;
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
  fragColor = vec4(c, 1.);
}
