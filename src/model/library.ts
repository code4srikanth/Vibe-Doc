// The eye-model library: everything under eye-model/ loaded into memory.
// Node tools load it with tools/lib/library.ts, the browser with library.browser.ts.
import type { AnatomyRules, Case, ComponentType, Disease, EyeComponent, Variant } from "./generated.ts";

export interface Library {
  components: EyeComponent[];
  types: ComponentType[];
  diseases: Disease[];
  variants: Variant[];
  cases: Case[];
  rules: AnatomyRules["rules"];
}

export const FACETS = ["anatomy", "optics", "appearance", "microstructure", "physiology"] as const;
export type FacetName = (typeof FACETS)[number];
