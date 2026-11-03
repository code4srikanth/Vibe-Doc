// Light or dark for the exam screen. The choice is the trainee's, kept in this browser; with no choice yet it follows the system.
export type Theme = "light" | "dark";

const KEY = "eyesim.theme";

export function savedTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch { /* storage blocked: follow the system */ }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(root: HTMLElement, theme: Theme, save = false) {
  root.dataset.theme = theme;
  if (!save) return;
  try { localStorage.setItem(KEY, theme); } catch { /* not kept */ }
}
