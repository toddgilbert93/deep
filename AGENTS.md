# Deep project guide

## Purpose

Deep reconstructs a submitted webpage as a similar 3D webpage. The backend
collects the source page, converts it into a compact UI-element and interaction
graph, stores image assets locally, and gives that evidence to Grok-powered
agents. The agents create a reconstruction specification that maps source
elements onto the approved primitives in `src/app/3DUI/_lib/`, preserves the
page's hierarchy, content, assets, and interactions, and drives generation of
the new page.

## Product end state

The end-state experience is a live, understandable webpage-to-3D conversion,
not a request that appears frozen until a final page suddenly arrives. The UI
will mature through three phases:

### Phase 1 — Parse progress

- After the user submits a URL, immediately show a simple loading bar while the
  backend fetches and parses the webpage.
- The backend may expose coarse progress for this phase, but it must always
  provide clear success and failure completion states.

### Phase 2 — Granular conversion status

- Replace the generic in-progress state with dynamic status messages describing
  the current work, such as fetching source, parsing the DOM, caching images,
  mapping elements, reconstructing interactions, generating components, and
  validating the result.
- The backend must emit stable, machine-readable stage and progress events. UI
  copy is owned by the frontend and must not depend on parsing log messages.
- Events must include a job identifier, ordered sequence or timestamp, stage,
  human-readable detail, optional progress, and an explicit terminal outcome.

### Phase 3 — Live visual reconstruction

- Stream the parsed and reconstructed page into the UI as it is produced rather
  than waiting for the entire conversion to finish.
- Highlight the source or generated UI element currently being processed with
  a green bounding box.
- Show floating explanatory text beside the generated content describing what
  is being recognized, mapped, or created.
- Backend stream events must link activity to stable source element IDs,
  reconstruction node IDs, and local asset IDs so highlights and annotations
  attach to the correct element.
- Stream structured snapshots or deltas that the frontend can apply safely and
  idempotently. Do not stream raw model reasoning, unvalidated model output, or
  executable source fragments directly into the page.
- The completed visualization must converge on the same validated
  `ReconstructionSpec` used for final generation; streaming is a presentation
  of the workflow, not a separate reconstruction format.

All backend work should preserve a path toward Phase 3 even when implementing
only Phase 1 or Phase 2. Long-running operations should expose meaningful
progress boundaries rather than being designed as one opaque blocking call.

## Current implementation status

Implemented:

- Next.js frontend scaffold.
- Grok/xAI Responses API provider with configurable `XAI_MODEL`.
- Browser-free HTML and JavaScript source collection with redirect, byte, and
  private-network protections.
- Deterministic conversion of webpage source into a compact UI-element and
  UX-connection graph.
- Static analysis of bounded first-party JavaScript for event listeners and
  fetch effects; JavaScript is downloaded but never executed.
- Local-only image download, SHA-256 content-addressed persistence, URL cache,
  and `assetId` links from parsed image elements.
- Versioned, strict `ReconstructionSpec` JSON Schema with source-reference,
  hierarchy, coverage, interaction, and local-asset validation.
- Mocked provider, parser, network-safety, and image-cache tests.

Not implemented yet:

- Public backend HTTP endpoints.
- Parallel reconstruction agents, final planning, and code generation.
- Final request/response schemas from the teammate-owned backend contract.
- Production deployment or shared remote asset storage.

## Repository map

- `src/app/` — Next.js frontend application.
- `public/` — frontend static assets.
- `src/app/3DUI/_lib/` — approved 3D primitives that generated pages must use.
  Read `src/app/3DUI/instructions.md` before changing or using the library.
- `src/app/library/` — visual catalog of available 3D primitives.
- `backend/` — all backend source code, tests, prompts, and backend-specific
  configuration. Read `backend/README.md` before adding backend code.
- `backend/src/webpage/` — safe source collection and deterministic conversion
  of HTML/JavaScript into the compact UI graph sent to evaluation agents.
- `backend/src/assets/` — local content-addressed image storage. Parsed image
  elements link to stored files through `assetId`.
- `backend/scripts/` — local smoke checks and webpage pull/parse commands.
- `backend/tests/` — backend unit and integration tests plus deterministic
  fixtures.
- `backend/storage/webpage-assets/` — generated local persistent images and
  metadata. This directory is ignored by Git.
- `backend/.cache/webpage-assets/` — generated local URL cache. This directory
  is ignored by Git.
- `openapi.yaml` — canonical frontend/backend API contract. Update this file
  before implementing a contract change.
- `clean.txt` — dependency and generated-artifact cleanup ledger. Record every
  newly installed dependency or tool here.
- `README.md` — human-facing project setup and usage documentation.

## Current boundaries

- Keep frontend code in `src/` and backend code in `backend/`.
- Treat `openapi.yaml` as the integration boundary between teammates.
- Do not commit API keys or `.env` files. The repository `.gitignore` excludes
  `.env*` files.
- The backend runtime is Node.js with TypeScript. No backend HTTP framework has
  been selected yet.
- Keep model-provider calls behind `backend/src/providers/` so workflow logic
  is not coupled directly to Grok/xAI transport details.
- Prefer structured, schema-validated agent outputs over free-form text. Use
  `backend/src/reconstruction/reconstruction-spec-schema.ts` as the shared
  agent output contract and validate it with `validateReconstructionSpec`.
- Asset storage is intentionally local filesystem storage. Do not introduce
  cloud storage or a database without an explicit project decision.
- Never enable `--allow-private` for an untrusted or user-submitted URL.
- Do not send raw HTML or framework JavaScript to Grok. Send the compact UI
  graph produced by `webpage:parse`.
- Agents reconstruct the source webpage; they are not primarily UX critics.
- Generated pages must compose existing 3DUI primitives. Do not invent or
  modify primitives during page generation.
- Preserve source text, hierarchy, navigation, form behavior, accessibility,
  and parsed UX connections unless the reconstruction contract says otherwise.
- Update this guide whenever the project layout or architectural boundaries
  change.

## Reconstruction workflow

1. Fetch the source HTML, first-party JavaScript, and image elements.
2. Convert them into the compact UI graph and persist images locally.
3. Produce a strict reconstruction specification that maps every retained
   source element to a 3DUI primitive or an explicitly preserved HTML element.
4. Compose the mapped elements into a page layout that resembles the source.
5. Recreate navigation, forms, controls, and other parsed connections.
6. Generate Next.js source using the approved components and local assets.
7. Validate schemas, TypeScript, lint, accessibility semantics, and component
   usage before returning the generated page.

Current primitive mapping guidance:

- Buttons and grouped actions → `Button3D` / `Button3DGroup`.
- Cards and bounded content groups → `Card3D`.
- Images with `assetId` → `Image3D` containing the locally stored image.
- Large headings (32px+) → `Text3D`.
- Small display text (16–24px) → `TextShadow3D` when appropriate.
- Supported common icons → `Icon3D`.
- Tabs or rotating groups of 3–8 items → `Carousel3D`.
- Recessed application/window regions → `Chrome3D`.

The reconstruction planner must read the actual component prop types and
`src/app/3DUI/instructions.md`; this table is routing guidance, not permission
to invent unsupported props.

## Common commands

Install exact dependencies:

```sh
npm ci
```

Run the frontend:

```sh
npm run dev
```

Run all backend tests and project checks:

```sh
npm run backend:test
npx tsc --noEmit
npm run lint
```

Parse a public page into the compact graph and cache its images locally:

```sh
npm run webpage:parse -- https://example.com
```

Parse an explicitly trusted local development page:

```sh
npm run webpage:parse -- http://127.0.0.1:3000 --allow-private
```

Test the configured Grok connection; this makes a billable request:

```sh
npm run grok:check
```

## Local generated data

- Git shares source code, tests, documentation, dependency manifests, and the
  OpenAPI contract.
- Git does not share downloaded webpage images, asset metadata, URL caches,
  `.env` files, API keys, `node_modules/`, or `.next/` output.
- Each teammate regenerates local webpage assets by running `webpage:parse`.
- The graph's `assetId`, `storageKey`, and `metadataKey` link an image element
  to files under that teammate's local `backend/storage/webpage-assets/`.
- See `clean.txt` before removing generated data or installed tools.

## Collaboration workflow

Before starting work:

```sh
git switch main
git pull --rebase origin main
npm ci
```

Before sharing work:

```sh
npm run backend:test
npx tsc --noEmit
npm run lint
git status
git add .
git diff --staged
git commit -m "describe the change"
git pull --rebase origin main
git push origin main
```

- Review staged changes and confirm no secret or generated runtime data is
  included.
- Resolve rebase conflicts carefully; do not use force-push on shared `main`.
- Preserve a teammate's unrelated changes when working in a dirty tree.

## API contract workflow

1. Merge the agreed backend contract into `openapi.yaml`.
2. Review contract changes with both frontend and backend owners.
3. Implement each side against the same contract.
4. Add contract validation or client generation when the backend framework is
   selected; document any new tool in `clean.txt`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
