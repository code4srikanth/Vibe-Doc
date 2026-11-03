// Renders case/view pairs to PNG through the real app: starts a Vite server, opens
// headless Chrome (SwiftShader, so results do not depend on the GPU) and screenshots
// the bare view once the accumulation has converged.
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./library.ts";

export interface Job {
  case: string;
  view: string;
  out: string;
  query?: string;
  /** Render this eye instead of the stored case: the Case agent's edits over its base. */
  remote?: NonNullable<Window["__eyesimRemote"]>;
}

export async function renderJobs(jobs: Job[], { frames = 48, width = 960, height = 540, concurrency = 2 } = {}) {
  let server: ViteDevServer | undefined, browser: Browser | undefined;
  try {
    server = await createServer({ root: ROOT, logLevel: "error", server: { port: 0 } });
    await server.listen();
    const base = server.resolvedUrls!.local[0];
    browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
    const queue = [...jobs];
    const failures: string[] = [];
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      const open = async () => {
        const p = await browser!.newPage({ viewport: { width, height } });
        // shader compile errors only reach the page console; surface them instead of waiting for the timeout
        p.on("console", m => { if (m.type() === "error") console.log(`  [page] ${m.text().slice(0, 2000)}`); });
        return p;
      };
      const shared = await open();
      for (let job = queue.shift(); job; job = queue.shift()) {
        const label = `${job.case}/${job.view}`;
        // An init script stays on its page for every later load, so an eye passed this way gets a page of its own.
        const page = job.remote ? await open() : shared;
        if (job.remote) await page.addInitScript(r => { window.__eyesimRemote = r; }, job.remote);
        // Software rendering is slow under load; one retry absorbs occasional timeouts.
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            // Don't wait for the full load event: web fonts can stall it, and the bare view needs none.
            await page.goto(`${base}?case=${job.case}&view=${job.view}&bare&frames=${frames}${job.query ? `&${job.query}` : ""}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
            // frame time (software rendering, so a relative budget, not the app's GPU speed): first frame to done
            await page.waitForFunction(() => (window.__eyesim?.frames ?? 0) >= 1 || window.__eyesim?.done, null, { timeout: 240_000 });
            const t0 = Date.now();
            await page.waitForFunction(() => window.__eyesim?.done, null, { timeout: 900_000 });
            const ms = (Date.now() - t0) / Math.max(1, frames - 1);
            const error = await page.evaluate(() => window.__eyesim?.error);
            if (error) throw new Error(error);
            mkdirSync(join(job.out, ".."), { recursive: true });
            await page.screenshot({ path: job.out });
            console.log(`  rendered ${label} (${Math.round(ms)} ms/frame)`);
            break;
          } catch (e) {
            const msg = (e as Error).message.split("\n")[0];
            if (attempt === 2) failures.push(`${label}: ${msg}`);
            else console.log(`  retrying ${label} (${msg})`);
          }
        }
        if (page !== shared) await page.close();
      }
      await shared.close();
    }));
    if (failures.length) throw new Error(`Render failed:\n  ${failures.join("\n  ")}`);
  } finally {
    await browser?.close();
    await server?.close();
  }
}
