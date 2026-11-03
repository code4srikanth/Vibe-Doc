// Browser copy of the eye-model library, bundled by Vite at build time.
import type { Library } from "./library.ts";

const all = <T>(files: Record<string, unknown>) => Object.keys(files).sort().map(k => files[k] as T);

export const library: Library = {
  components: all(import.meta.glob("../../eye-model/normal/*.json", { eager: true, import: "default" })),
  types: all(import.meta.glob("../../eye-model/schema/types/*.type.json", { eager: true, import: "default" })),
  diseases: all(import.meta.glob("../../eye-model/diseases/*.json", { eager: true, import: "default" })),
  variants: all(import.meta.glob("../../eye-model/variants/*.json", { eager: true, import: "default" })),
  cases: all(import.meta.glob("../../eye-model/cases/*.json", { eager: true, import: "default" })),
  rules: (Object.values(import.meta.glob("../../eye-model/rules/anatomy.rules.json", { eager: true, import: "default" }))[0] as { rules: Library["rules"] }).rules
};
