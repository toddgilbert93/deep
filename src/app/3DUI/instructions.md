# 3DUI

Library of 3D UI primitives. Goal: take familiar 2D controls (buttons, tabs, toggles, inputs, …) and give them real depth. **CSS first.** GLB only when the silhouette or bevel cannot be an extruded box.

Read this file before adding a primitive. Other agents will be adding components in parallel — stay inside your own folder.

## Map

| Path | Role |
| --- | --- |
| `src/app/3DUI/_lib/<name>/` | Primitive source. `_` keeps it off the router. |
| `src/app/3DUI/_lib/<name>/<Name>3D.tsx` | Public React API for that primitive |
| `src/app/library/page.tsx` | Viewer at `/library`. Add your element here. |
| `public/3dui/<name>.glb` | Web-served mesh (GLB primitives only) |
| `src/app/3DUI/_lib/<name>/recipe.ts` | Layout / conversion recipe (CSS or GLB extras) |

Do not put primitives under `src/components`. Do not add barrel `index.ts` files.

## CSS vs GLB

Use **CSS 3D** (`transform-style: preserve-3d`, six faces, `transform-origin: 50% 50%`) when the 2D control is a rectangle or hard-corner box. See `button/` and `carousel/`.

Carousel is a **ring of `Button3D` blocks**, not a moulded mesh. It holds **3–8** faces. Radius is computed from count so buttons keep a gap; the ring is scaled to fit the stage. Nested buttons pass `nested` so they inherit the parent scene (`perspective: none`) and size to `--ui3d-w` × `--ui3d-h`. Pass `count` or use children length (clamped).

Use a **GLB** only when a box cannot represent the silhouette or bevel. Then:

1. Stamp `extras.ui3d` on the glTF root (and scene).
2. Keep the source `.glb` next to the builder.
3. Convert to `public/3dui/<name>.glb` + `recipe.ts` so the app never fetches from `src/`.

## `extras.ui3d` / recipe format

Same shape for CSS recipes and GLB extras:

```ts
{
  source: "2d-css",          // always — we are lofting 2D UI, not modeling from scratch
  component: "carousel",    // primitive id, matches folder name
  unit: "css-px",           // world units are CSS pixels
  metersPerUnit: 0.001,     // optional; 1px = 1mm if a DCC tool needs meters
  idleSpinMs: 100000,       // optional; default motion is slow
  faceCount: 6,             // optional
  face: { width, height, depth, gap },
  ring: { radius },         // optional, for orbital layouts
  contentSlots: ["Face_0", "Face_1", /* … */] // GLB only
}
```

GLB graph (if you need one):

- `Face_*` nodes are **content slots**. Children map onto these by index.
- `Body_*` is the shell. Do not put content there.
- Group slots under a named `Ring` if they should idle-spin together.

## Visual rules

- Hard corners unless the 2D source already has a specific silhouette.
- Rotation pivot is the geometric **center**. The object does not orbit.
- Motion is a **small** tilt or a **very slow** idle spin. Do not 360-tumble a control. Button rest is off-axis and **must differ per button in a group**. Wrap converted 2D buttons in `Button3DGroup` (or pass `tilt={n}`). Six rest poses cycle. Carousel: `idleSpinMs: 100000`.
- Honor `prefers-reduced-motion`.
- Faces are shaded as a physical object (front lightest, bottom/back darkest). No face stroke.
- Real HTML controls stay accessible (`<button>`, labels, focus).

## New primitive checklist

1. Create `src/app/3DUI/_lib/<name>/` only. Do not edit sibling primitives.
2. Name the export `<Name>3D`.
3. CSS primitive: colocate `<Name>3D.module.css`. Size via `--ui3d-w`, `--ui3d-h`, `--ui3d-d`.
4. GLB primitive: `recipe.ts` + `public/3dui/<name>.glb`. Load with `/3dui/<name>.glb`. Client component (`'use client'`) if you use R3F.
5. Append **one** object to `elements` in `src/app/library/page.tsx`. Do not restyle the library chrome. Do not reorder other entries.
6. Preview must show the primitive doing its job (button clicks, carousel shows tab labels on faces).

## Multiple 2D buttons

Never give every converted button the same resting tilt. A row of identical 12° / −18° / −4° blocks looks like one cloned object.

1. Wrap sibling `Button3D`s in `Button3DGroup`. CSS assigns 6 off-axis rests by `nth-child`, then repeats.
2. Or set `tilt={0}` … `tilt={5}` on each button when they are not siblings.
3. Nested carousel faces stay `spin={false}` — they do not use these rests.

```tsx
<Button3DGroup>
  <Button3D>Save</Button3D>
  <Button3D>Edit</Button3D>
  <Button3D>Share</Button3D>
</Button3DGroup>
```

## Library viewer

Route: `/library` (dev is often `http://localhost:3001` if 3000 is taken).

```tsx
{
  name: "Carousel",
  description: "One line: what 2D control this is, and how depth is built.",
  preview: <Carousel3D>{/* slot children */}</Carousel3D>,
}
```

## Parallel agents

- One primitive per agent. Folder name is the lock.
- Do not refactor `button/`, `carousel/`, or the library layout unless that is your assignment.
- Do not add Three.js to a CSS primitive “just in case”.
- Do not invent a second catalog page.

## Inventory

| Primitive | Kind | Status |
| --- | --- | --- |
| Button | CSS box | Done |
| Carousel | CSS ring of block buttons (3–8) | Done |
| Card | CSS hard shadow | Done |
| Image | CSS scene lighting | Done |
| Chrome | CSS edge gradients | Done |
| Icon | CSS box glyphs | Done |
| Text | CSS extrude, 32px+ | Done |
| Text shadow | CSS hard shadow, 16–24px | Done |
| *(more TBD)* | | Leave rows out until they exist |
