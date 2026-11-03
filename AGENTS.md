# EyeSim

Slit-lamp simulator for trainee ophthalmologists. The eye is **metadata** in `eye-model/`; the renderer in `src/` only reads it.

## Layout
- `eye-model/manifest.json`: generated index of every component, disease, variant and case. Read this first; open only the files you need.
- `eye-model/schema/`: JSON Schemas (`component`, `quantity`, `disease`, `case`, `variant`, `rules`, `type`) and `types/*.type.json` (required properties per component type).
- `eye-model/normal/`: the healthy eye, one file per component, ID = file name (`eye.lens.nucleus.json`).
- `eye-model/diseases/`, `variants/`, `cases/`, `rules/anatomy.rules.json`.
- `src/model/`: `resolve.ts` turns a case into a concrete eye (variants → diseases → exam conditions → overrides → age functions → derived values → range checks). `generated.ts` comes from the schemas.
- `src/render/modules/`: one render module per component type; each declares the metadata it `consumes`. `src/render/shaders/eye.frag.glsl` is the ray-marching shader.
- `src/exam/views.ts`: slit-lamp settings per view (technique, not anatomy).
- `tools/`: manifest, validator, renderer, visual tests.

## Commands
- `npm run validate`: regenerate the manifest, then check schemas, types, references, disease patches, grade monotonicity, anatomy rules and renderer coverage. Must pass before any commit.
- `npm run gen:types`: regenerate `src/model/generated.ts` after a schema change.
- `npm run typecheck`
- `npm run render -- --round N` (all cases and views plus blind review sheets) or `--out .tmp/check --cases a,b --views x,y`.
- `npm run test:visual` (`-- --update` after an intended visual change).
- `npm run dev`: interactive app with a metadata inspector.

## Conventions
- Every number is a quantity with `unit`, `normal` and `hard`; exactly one of `value`, `age` or `derived`.
- Never store a value twice; use `derived` (`{component.id:facet.property}` expressions).
- No clinical numbers in `src/`. If the shader needs a value, add it to metadata and read it through a render module.
- Diseases change physical properties (scatter, absorption, thickness, position), never painted colours, so findings stay right in every illumination.
- Values marked `provenance.confidence: "low"` are render-calibrated, not clinically validated.
