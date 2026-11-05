// Progressive slit-lamp renderer on Three.js. Each frame ray-marches the eye once with
// new jitter (anti-aliasing, depth of field) and blends it into a running average held
// in half-float render targets; a display pass adds bloom and the camera vignette.
import * as THREE from "three";
import vert from "./shaders/quad.vert.glsl?raw";
import eyeFrag from "./shaders/eye.frag.glsl?raw";

// slitLampLayers: the slit-lamp program with the ?layer= debug views (uLayer), which the app's program leaves out
export const SHADERS = { slitLamp: eyeFrag, slitLampLayers: "#define DEBUG_LAYERS\n" + eyeFrag, exterior: "#define EXTERIOR_VIEW\n" + eyeFrag,
  fundus: fundusFrag };   // fundus: the fundus seen through a fundus lens (docs/fundus)
import dispFrag from "./shaders/display.frag.glsl?raw";
import fundusFrag from "./shaders/fundus.frag.glsl?raw";
import type { UniformValue } from "./modules/module.ts";

export class EyeRenderer {
  readonly maxFrames: number;
  frame = 0;
  private gl: THREE.WebGLRenderer;
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private eyeMat: THREE.RawShaderMaterial;
  private eyeMesh!: THREE.Mesh;
  private programs = new Map<string, THREE.RawShaderMaterial>();   // one material per fragment source, so switching back needs no recompile
  private dispMat: THREE.RawShaderMaterial;
  private eyeScene = new THREE.Scene();
  private dispScene = new THREE.Scene();
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private size = new THREE.Vector2();
  private compiled = false;   // the eye program is linked; until then nothing is drawn
  private compileGen = 0;
  private compiling: Promise<void> = Promise.resolve();

  /** fragment: the first program to compile (one of SHADERS), so the page compiles only the view it shows. */
  constructor(canvas: HTMLCanvasElement, maxFrames = 64, fragment = SHADERS.slitLamp) {
    this.maxFrames = maxFrames;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
    this.gl.setPixelRatio(1);
    const quad = new THREE.PlaneGeometry(2, 2);
    const common = { glslVersion: THREE.GLSL3, vertexShader: vert, depthTest: false, depthWrite: false };
    this.eyeMat = new THREE.RawShaderMaterial({ ...common, fragmentShader: fragment, uniforms: { uPrev: { value: null }, uZero: { value: 0 }, uRes: { value: new THREE.Vector2() }, uCam: { value: new THREE.Vector2() } } });
    this.dispMat = new THREE.RawShaderMaterial({ ...common, fragmentShader: dispFrag, uniforms: { uTex: { value: null }, uRes: { value: new THREE.Vector2() }, uEye: { value: 0 }, uBloom: { value: 1 }, uGrain: { value: 1 }, uMirror: { value: 0 },
      uBlink: { value: 0 }, uBlinkWarp: { value: 0 }, uLidRest: { value: 0 }, uFov: { value: 1 }, uCanLX: { value: 1 }, uCanMX: { value: 0 }, uCam: { value: new THREE.Vector2() }, uExtRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uLidRows: { value: null } } });
    for (const [scene, mat] of [[this.eyeScene, this.eyeMat], [this.dispScene, this.dispMat]] as const) {
      const mesh = new THREE.Mesh(quad, mat);
      mesh.frustumCulled = false;
      scene.add(mesh);
      if (mat === this.eyeMat) this.eyeMesh = mesh;
    }
    this.programs.set(fragment, this.eyeMat);
    this.compile();
    // A GPU reset (a driver timeout, or the browser reclaiming the GPU) loses the context. Three.js asks the browser to
    // restore it and rebuilds its own state; the eye program is then compiled again and the accumulation restarts.
    // Until then nothing is drawn and whenReady() waits for the restore.
    canvas.addEventListener("webglcontextlost", () => {
      this.lost = true;
      this.compiled = false;
      this.compileGen++;   // a compile in flight on the lost context must not mark the program ready
      this.compiling = new Promise(done => canvas.addEventListener("webglcontextrestored", () => done(), { once: true }));
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      this.compile();
      this.restart();
    });
  }

  /** True while the GPU context is lost (after a GPU reset), until the browser restores it. */
  lost = false;

  /** True once the current eye program has compiled; until then step() draws nothing. */
  get ready() { return this.compiled; }

  /** Resolves once the current eye program has compiled (waiting through any recompile started meanwhile). */
  async whenReady() { while (!this.compiled) await this.compiling; }

  // Big ray-march programs take seconds to compile (tens on Windows/D3D). Compile in the background
  // (KHR_parallel_shader_compile, where the browser has it) so the page stays responsive meanwhile;
  // drawing with an uncompiled program would block until the compile ends.
  private compile() {
    this.compiled = false;
    const gen = ++this.compileGen;
    this.compiling = this.gl.compileAsync(this.eyeScene, this.camera)
      .then(() => this.gl.compileAsync(this.dispScene, this.camera))
      .then(() => { if (gen === this.compileGen) this.compiled = true; });
  }

  /** Size in device pixels. Recreates the accumulation targets and restarts. */
  resize(width: number, height: number) {
    if (this.size.x === width && this.size.y === height) return;
    this.size.set(width, height);
    this.gl.setSize(width, height, false);
    this.targets?.forEach(t => t.dispose());
    this.dispMat.uniforms.uTex.value = null;   // nothing finished to show at the new size
    const make = () => new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true
    });
    this.targets = [make(), make()];
    (this.eyeMat.uniforms.uRes.value as THREE.Vector2).set(width, height);
    (this.dispMat.uniforms.uRes.value as THREE.Vector2).set(width, height);
    this.restart();
  }

  setUniforms(values: Record<string, UniformValue>, camera: [number, number]) {
    const u = this.eyeMat.uniforms;
    for (const [name, v] of Object.entries(values)) {
      if (Array.isArray(v)) {
        const Vec = v.length === 4 ? THREE.Vector4 : THREE.Vector3;
        if (u[name]?.value instanceof Vec) (u[name].value as THREE.Vector3 | THREE.Vector4).fromArray(v);
        else u[name] = { value: new Vec().fromArray(v) };
      } else if (u[name]) u[name].value = v;
      else u[name] = { value: v };
    }
    (u.uCam.value as THREE.Vector2).set(camera[0], camera[1]);
    this.dispMat.uniforms.uEye.value = values.uEye ?? 0;
    this.dispMat.uniforms.uBloom.value = values.uBloom ?? 1;
    this.dispMat.uniforms.uGrain.value = values.uGrain ?? 1;
    if (values.uMirror !== undefined) this.dispMat.uniforms.uMirror.value = values.uMirror;   // kept otherwise: a blink only sends the lids
    this.restart();
  }

  /** Swap the scene shader (slit-lamp or external view); uniforms are kept. */
  setFragment(source: string) {
    if (this.eyeMat.fragmentShader === source) return;
    // the materials share one uniforms object; a material kept here keeps its compiled program alive
    let mat = this.programs.get(source);
    if (!mat) {
      mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: this.eyeMat.vertexShader, depthTest: false, depthWrite: false, fragmentShader: source, uniforms: this.eyeMat.uniforms });
      this.programs.set(source, mat);
    }
    this.eyeMat = mat;
    this.eyeMesh.material = mat;
    this.compile();
    this.restart();
  }

  restart() { this.frame = 0; }

  /** Draws the last finished picture with the lid part-way through a blink, with no ray marching: a frame of the eye can
   *  take seconds on a weak GPU, and a blink must not wait for one. Accumulation holds until `closed` is null, which
   *  ends the blink; the picture built so far is kept. warp: move the lid (slit lamp), or only darken (fundus). */
  blink(closed: number | null, warp: boolean) {
    this.blinking = closed !== null;
    const d = this.dispMat.uniforms, u = this.eyeMat.uniforms, rows = u.uLidRows?.value, rect = u.uExtRect?.value;
    const moves = warp && !!rows && !!rect;
    d.uBlink.value = closed ?? 0;
    d.uBlinkWarp.value = moves ? 1 : 0;
    if (moves) {
      d.uLidRows.value = rows;
      d.uExtRect.value = rect;
      d.uLidRest.value = u.uLidClose?.value ?? 0;
      d.uFov.value = u.uFov.value;
      d.uCanLX.value = u.uCanLX.value;
      d.uCanMX.value = u.uCanMX.value;
      (d.uCam.value as THREE.Vector2).copy(u.uCam.value as THREE.Vector2);
    }
    if (!this.compiled || !d.uTex.value) return;
    this.gl.setRenderTarget(null);
    this.gl.render(this.dispScene, this.camera);
  }
  private blinking = false;

  get done() { return this.frame >= this.maxFrames; }

  /** Renders one more accumulation frame and shows it. Returns false when converged. */
  step(): boolean {
    if (!this.targets || this.done || !this.compiled || this.blinking) return false;
    const [read, write] = this.targets;
    const u = this.eyeMat.uniforms;
    u.uPrev.value = read.texture;
    u.uBlend = { value: 1 / (this.frame + 1) };
    u.uFrame = { value: this.frame };
    this.gl.setRenderTarget(write);
    this.gl.render(this.eyeScene, this.camera);
    this.targets = [write, read];
    this.dispMat.uniforms.uTex.value = write.texture;
    this.gl.setRenderTarget(null);
    this.gl.render(this.dispScene, this.camera);
    this.frame++;
    return true;
  }
}
