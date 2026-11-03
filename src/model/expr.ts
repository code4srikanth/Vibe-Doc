// Tiny expression language for derived quantities and anatomy rules.
// References look like {eye.cornea.stroma:anatomy.thickness}; the rest is arithmetic,
// comparisons, && || and the functions min, max, sum, abs.
export const REF = /\{(eye(?:\.[a-z][a-z0-9_]*)+):([a-z]+\.[a-z][a-z0-9_]*)\}/g;

export function refsOf(expr: string): { id: string; path: string }[] {
  return [...expr.matchAll(REF)].map(m => ({ id: m[1], path: m[2] }));
}

const ALLOWED = /^[0-9.\s+\-*/(),<>=!&|eE]*$/;
const FUNCS = { min: Math.min, max: Math.max, abs: Math.abs, sum: (...a: number[]) => a.reduce((s, x) => s + x, 0) };

export function evaluate(expr: string, lookup: (id: string, path: string) => number): number | boolean {
  const js = expr.replace(REF, (_, id: string, path: string) => {
    const v = lookup(id, path);
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`{${id}:${path}} is not a number`);
    return `(${v})`;
  });
  // Metadata is trusted project data, but keep the evaluator to arithmetic only.
  if (!ALLOWED.test(js.replace(/\b(min|max|abs|sum)\b/g, ""))) throw new Error(`Unsupported syntax in expression: ${expr}`);
  return new Function(...Object.keys(FUNCS), `"use strict"; return (${js});`)(...Object.values(FUNCS));
}
