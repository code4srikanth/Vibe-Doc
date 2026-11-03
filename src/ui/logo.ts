// The VibeDoc wordmark: one transparent PNG (assets/brand, cut out of the artwork) shared by every screen.
import logoUrl from "../../assets/brand/vibedoc-logo.png?url";
import logo2xUrl from "../../assets/brand/vibedoc-logo@2x.png?url";
import logoMeta from "../../assets/brand/vibedoc-logo.json";

export { logoUrl, logo2xUrl };

/** Natural size of the 1x asset, and where "Vibe" ends and "Doc" begins (fraction of the width). */
export const LOGO = logoMeta as { width: number; height: number; split: number };

/** An <img> of the wordmark at the given CSS height (width follows the artwork's aspect ratio). */
export function createLogo({ height = 48, alt = "VibeDoc" }: { height?: number; alt?: string } = {}): HTMLImageElement {
  const img = document.createElement("img");
  img.src = logoUrl;
  img.srcset = `${logoUrl} 1x, ${logo2xUrl} 2x`;
  img.alt = alt;
  img.height = Math.round(height);
  img.width = Math.round(height * LOGO.width / LOGO.height);
  img.decoding = "async";
  img.draggable = false;
  img.className = "vd-logo";
  return img;
}
