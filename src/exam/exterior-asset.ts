// Encoding of the exterior layer's generated assets, shared by tools/cut-exterior.ts (writes them)
// and src/exam/exterior.ts (reads them). No three.js or Vite imports here: the tool runs in Node.

/** opening-dist.png: distance in mm from the upper-lid (R) and lower-lid (G) margins of the opening, 0-255 over this range. */
export const OPENING_DIST_RANGE_MM = 4;
