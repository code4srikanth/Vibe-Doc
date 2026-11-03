// The blueprint grid shared by the landing and loading screens: faint lines draw in outward from the centre of a canvas.
const FORM_S = 2.2;       // the ripple reaches the screen corners at this time (s)
const LINE_S = 0.9;       // each line grows to full length over this time (s)
const LINE_ALPHA = 0.5;
const LINE_RGB = "178, 226, 218";
const MAX_CANVAS_PX = 4096;   // the backing store never exceeds this on its long side

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (v: number) => 1 - (1 - v) ** 3;

/** Draws the grid on `canvas` (sized to `root`) and animates it, or shows it finished when `animate` is false (for a
 *  screen that follows another grid, so nothing flashes); returns a function that stops it. */
export function startGrid(root: HTMLElement, canvas: HTMLCanvasElement, animate = true): () => void {
  const still = !animate || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = canvas.getContext("2d")!;
  let W = 0, H = 0, dpr = 1, cell = 40;
  const t0 = performance.now();
  let raf = 0;

  function size() {
    const cw = root.clientWidth, ch = root.clientHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1, MAX_CANVAS_PX / Math.max(cw, ch, 1));
    W = Math.max(1, Math.round(cw * dpr)); H = Math.max(1, Math.round(ch * dpr));
    canvas.width = W; canvas.height = H;
    cell = Math.min(64, Math.max(24, Math.min(cw, ch) / 23)) * dpr;   // ~23 rows on a landscape screen
    draw(still ? FORM_S + LINE_S + 1 : (performance.now() - t0) / 1000);   // a resize clears the canvas
  }

  // t: seconds since the grid appeared. Everything is in device pixels.
  function draw(t: number) {
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = Math.hypot(cx, cy);
    const lw = Math.max(1, Math.round(1.25 * dpr));
    const snap = (v: number) => Math.round(v) + (lw % 2 ? 0.5 : 0);
    // a line starts growing when the ripple front reaches it, from its crossing with the centre lines outward
    const lineP = (d: number) => easeOut(clamp01((t - 0.1 - (FORM_S - LINE_S) * Math.min(1, d / R)) / LINE_S));
    const xs: number[] = [], ys: number[] = [];
    for (let x = cx - Math.ceil(cx / cell) * cell; x <= W + cell; x += cell) xs.push(x);
    for (let y = cy - Math.ceil(cy / cell) * cell; y <= H + cell; y += cell) ys.push(y);

    const stroke = (p: number, x0: number, y0: number, x1: number, y1: number) => {
      ctx.strokeStyle = `rgba(${LINE_RGB}, ${LINE_ALPHA * p})`;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    };
    ctx.lineWidth = lw;
    for (const x of xs) {
      const p = lineP(Math.abs(x - cx));
      if (p <= 0) continue;
      const half = p * (cy + cell);
      stroke(p, snap(x), cy - half, snap(x), cy + half);
    }
    for (const y of ys) {
      const p = lineP(Math.abs(y - cy));
      if (p <= 0) continue;
      const half = p * (cx + cell);
      stroke(p, cx - half, snap(y), cx + half, snap(y));
    }
  }

  function frame(now: number) {
    const t = (now - t0) / 1000;
    draw(t);
    // the grid is finished once the last line has grown; nothing moves after that
    raf = t < FORM_S + LINE_S + 0.2 ? requestAnimationFrame(frame) : 0;
  }
  const startLoop = () => { if (!raf && !still && !document.hidden) raf = requestAnimationFrame(frame); };
  const stopLoop = () => { cancelAnimationFrame(raf); raf = 0; };
  const onVisibility = () => (document.hidden ? stopLoop() : startLoop());

  const resizeObs = new ResizeObserver(size);
  resizeObs.observe(root);
  size();
  startLoop();
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    stopLoop();
    resizeObs.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
