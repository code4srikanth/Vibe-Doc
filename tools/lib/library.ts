// Loads the eye-model library from disk for Node tools (validator, manifest, render).
// The browser loads the same files through Vite in src/model/library.browser.ts.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Library } from "../../src/model/library.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MODEL = join(ROOT, "eye-model");

export interface Loaded<T> { file: string; data: T }

export function readJsonDir<T>(dir: string, suffix = ".json"): Loaded<T>[] {
  const full = join(MODEL, dir);
  return readdirSync(full).filter(f => f.endsWith(suffix)).sort().map(f => {
    const path = join(full, f);
    return { file: relative(ROOT, path).replaceAll("\\", "/"), data: JSON.parse(readFileSync(path, "utf8")) as T };
  });
}

export function loadLibrary(): Library {
  return {
    components: readJsonDir<Library["components"][number]>("normal").map(l => l.data),
    types: readJsonDir<Library["types"][number]>("schema/types", ".type.json").map(l => l.data),
    diseases: readJsonDir<Library["diseases"][number]>("diseases").map(l => l.data),
    variants: readJsonDir<Library["variants"][number]>("variants").map(l => l.data),
    cases: readJsonDir<Library["cases"][number]>("cases").map(l => l.data),
    rules: JSON.parse(readFileSync(join(MODEL, "rules", "anatomy.rules.json"), "utf8")).rules
  };
}
