"""Prepare the slit-lamp cut-out for the intro scene (src/intro.ts) so it sits in the walk-in clips instead of looking pasted on.

From assets/scene/slit-lamp.png (a cut-out with its own transparent background, table and pedestal included):
  - alpha: the faint haze left from the background is dropped and the near-opaque body (alpha ~250) made solid,
  - edges: the alpha is eroded by a pixel so the cut-out's coloured fringe drops away,
  - grade: blacks lifted and whites set to the clips' room light (measured on its walls, cabinets and floor),
  - softness: a slight colour blur to match the clips, and a wider feather on the alpha edge only,
  - screen: the monitor glass is cut out for the screensaver; its quad is written to slit-lamp.json for the intro,
  - light wrap: a mask of the lamp's outer rim (slit-lamp-wrap.png) where the bright room spills over its edge.

  python tools/prepare-slit-lamp.py
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SCENE = Path(__file__).resolve().parents[1] / "assets" / "scene"
ALPHA_LO, ALPHA_HI = 40, 245            # below: background haze (dropped); above: solid body
BLACK = np.array([16, 16, 15.])         # the clips' room: shadow colour (never pure black)
WHITE = np.array([236, 236, 229.])      # and the white its walls and cabinets reach (nearly neutral, a touch warm)
BLUR = 0.8                              # colour softness, px at the source image scale
FEATHER = 1.8                           # alpha edge, px at the source scale (the intro shows the lamp at ~0.3x: ~1.3 px edge)
WRAP = 7                                # light-wrap rim width, source px
# the monitor glass in source pixels (TL, TR, BR, BL)
SCREEN = [[350, 428], [538, 428], [538, 512], [350, 512]]
# where the lamp's base and rail blocks stand on the table (ellipse centre x, y and radii, source px): the intro's contact shadow
BASE = [443, 770, 92, 12]
# the chin rest's centre x (the intro centres the lamp on it), source px
CHIN = [443, 545]
# the eyepieces' centre: the intro puts them over the seated patient's eyes
EYES = [443, 325]


def soften(rgb, a, sigma):
    """Gaussian blur of premultiplied colour; returns un-premultiplied colour (no black bleeding in) and the blurred alpha."""
    pre = Image.fromarray(np.dstack([rgb * a[..., None], a * 255]).round().astype(np.uint8), "RGBA").filter(ImageFilter.GaussianBlur(sigma))
    p = np.asarray(pre).astype(np.float32)
    pa = p[..., 3] / 255
    return np.where(pa[..., None] > 0, p[..., :3] / np.maximum(pa[..., None], 1e-3), 0).clip(0, 255), pa


def main():
    src = np.asarray(Image.open(SCENE / "slit-lamp.png").convert("RGBA")).astype(np.float32)
    rgb, a = src[..., :3], src[..., 3] / 255
    # clean the alpha: drop faint haze, make the body solid, then erode a pixel (the cut-out's edge carries a coloured fringe)
    a = ((a * 255 - ALPHA_LO) / (ALPHA_HI - ALPHA_LO)).clip(0, 1)
    a = np.asarray(Image.fromarray((a * 255).round().astype(np.uint8), "L").filter(ImageFilter.MinFilter(3))).astype(np.float32) / 255
    # grade: map the lamp's 0..255 onto the room's black..white per channel
    rgb = BLACK + rgb / 255 * (WHITE - BLACK)
    # colour at the light blur inside the body; in the feathered rim, where that blur has no coverage yet, the wider blur's
    # colour (still un-premultiplied, so the edge pixels keep the lamp's own colour instead of a dark or white fringe)
    c1, a1 = soften(rgb, a, BLUR)
    c2, a2 = soften(rgb, a, FEATHER)
    k = np.clip(a1 * 4, 0, 1)[..., None]
    col = c1 * k + c2 * (1 - k)
    out = Image.fromarray(np.dstack([col, a2 * 255]).round().astype(np.uint8), "RGBA")
    hole = Image.new("L", out.size, 0)
    ImageDraw.Draw(hole).polygon([tuple(q) for q in SCREEN], fill=255)
    holed = np.asarray(hole) > 0
    alpha = np.where(holed, 0, a2 * 255)
    out.putalpha(Image.fromarray(alpha.round().astype(np.uint8), "L"))
    out.save(SCENE / "slit-lamp-cut.png", optimize=True)
    # light wrap: inside the silhouette, falling off over WRAP px from the outer edge (not from the screen hole)
    inner = np.asarray(Image.fromarray((a2 * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(WRAP))).astype(np.float32) / 255
    wrap = np.where(holed, 0, a2 * (1 - inner).clip(0, 1) * 2).clip(0, 1)
    w = Image.new("LA", out.size, 255)
    w.putalpha(Image.fromarray((wrap * 255).round().astype(np.uint8), "L"))
    w.save(SCENE / "slit-lamp-wrap.png", optimize=True)
    info = {"size": list(out.size), "screen": SCREEN, "base": BASE, "chin": CHIN, "eyes": EYES}
    (SCENE / "slit-lamp.json").write_text(json.dumps(info, indent=2) + "\n")
    print("wrote slit-lamp-cut.png, slit-lamp-wrap.png and slit-lamp.json", out.size)


if __name__ == "__main__":
    main()
