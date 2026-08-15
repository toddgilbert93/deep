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
- Single-agent URL-to-`ReconstructionSpec` workflow with ordered progress,
  source-element, reconstructed-node, completion, and failure events.
- Mocked provider, parser, network-safety, image-cache, reconstruction, and
  workflow-event tests.
- One automatic repair round when the model's first structured response fails
  validation (the errors are fed back and a corrected spec is requested), an
  abort signal that stops the billable request when the client disconnects, and
  `MODEL_NOT_CONFIGURED` / `WORKFLOW_ABORTED` failure codes.
- Public HTTP transport as Next.js route handlers (`src/app/api/`):
  `POST /api/reconstruct` streams the event union as Server-Sent Events and
  `GET /api/assets/{assetId}` serves locally cached images. Both are specified
  in `openapi.yaml`.
- Frontend state layer in `src/lib/reconstruction/`: type re-exports of the
  event contract, a transport-independent reducer (job isolation, sequence
  de-duplication, upserts, terminal handling), an injectable event-source
  adapter (SSE over `fetch` plus a mock replayer), deterministic fixtures, and
  frontend-owned stage copy.
- Conversion UI (`src/app/_components/conversion/`): Phase 1 progress bar,
  Phase 2 stage tracker with counts/elapsed time, Phase 3 live source-element
  list and reconstruction preview with green highlights and annotations,
  completed and failed states, cancel/retry. Append `?source=mock&fixture=<name>`
  to the home page to replay a fixture without the backend.
- Runtime `SpecRenderer` (`src/app/_components/spec-renderer/`) that renders a
  validated `ReconstructionSpec` — complete or still streaming — onto the 3DUI
  primitives inside the Deep app. `/preview` renders a demo spec.
- Verified end to end on 2026-08-15: `https://nextjs.org/` converted through
  the UI with `grok-4.6` in ~3 minutes (39 elements → 23 nodes, 12
  interactions, images served through `/api/assets`).

Not implemented yet:

- Generated Next.js source files (the current deliverable is the live render
  inside Deep; codegen is a possible later artifact).
- Parallel reconstruction agents and richer per-node styling in the spec.
- Resumable streams (reconnect by job ID + last sequence); jobs are in-process.
- Production deployment or shared remote asset storage.
- Collection of pages behind bot-protection WAFs (see "Known source
  limitations").

## Product direction (2026-08-15)

The owner's priority is the best-looking result: a faithful reproduction of the
source page — its layout, colours, fonts, text and imagery — lifted into 3D
with depth, tilt and lighting, rendered live inside Deep. The 3DUI primitives
are rough guidance and a starting palette, not a source of truth: renderer and
prompt logic may extend styling, add its own depth surfaces, or bypass a
primitive when that makes the final output look better. Existing code and
contracts are guidance too; when the desired outcome is unclear, ask the owner
rather than inferring intent from older code. The model is expected to gain
rich, validated per-node styling (colours, sizes, spacing, depth, alignment,
backgrounds) so it can match the source closely.

## Known source limitations

- `https://x.ai/` is behind a Cloudflare WAF that returns 403 to any
  non-browser TLS client (Node `fetch`, curl, even with full browser headers),
  while a real browser loads it. The browser-free collector therefore cannot
  convert x.ai today; `https://docs.x.ai/overview` is fetchable and is the
  closest x.ai-family target. Supporting WAF-protected pages needs a
  headless-browser collector, which is a project decision (new dependency and a
  change to the browser-free design).
- Node's `net.BlockList` matches IPv4 addresses through their IPv4-mapped IPv6
  form, so a `::ffff:0:0/96` rule blocks every public IPv4 site. Do not add it
  back; the IPv4 rules already cover mapped literals.

## Frontend/backend split

- Frontend (`src/`): URL submission, progress, streamed preview, error/retry,
  the runtime renderer, and the route handlers under `src/app/api/` that adapt
  the backend workflow to HTTP. Client components must only `import type` from
  backend modules; route handlers may import backend values.
- Backend (`backend/`): collection, parsing, local assets, model calls,
  validation, orchestration, and event production. Preserve the event semantics
  in `backend/src/workflow/reconstruction-events.ts`; a breaking event change
  needs a matching update to `openapi.yaml`, `src/lib/reconstruction/`, and the
  fixtures.

## Repository map

- `src/app/` — Next.js frontend application.
- `src/app/api/` — route handlers adapting the backend workflow to HTTP
  (`reconstruct` SSE stream, `assets/[assetId]` image serving).
- `src/app/_components/conversion/` — progress bar, stage tracker, source
  element list, completed/failed views, and the conversion panel.
- `src/app/_components/spec-renderer/` — runtime renderer from
  `ReconstructionSpec` to 3DUI primitives, plus a demo spec.
- `src/app/preview/` — renders the demo spec for eyeballing the renderer.
- `src/lib/reconstruction/` — frontend event types, reducer, event-source
  adapters (SSE + mock), fixtures, stage copy, spec-tree helpers, and the
  `useReconstruction` hook; `server/` holds SSE framing and request validation
  used by the route handlers. Tests live in `__tests__/`.
- `src/themes/` — Deep colour tokens: near-black surface, electric-blue accents.
- `src/fonts/` — Quantico, the only UI face.
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
- `backend/src/agents/` — structured reconstruction-agent prompts and validated
  model-output handling.
- `backend/src/workflow/` — URL-to-reconstruction orchestration and the stable
  frontend event contract.
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
- The backend runtime is Node.js with TypeScript. The public HTTP surface is
  Next.js route handlers in `src/app/api/` (no separate server); keep them thin
  and keep workflow logic in `backend/`.
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
- Prefer the 3DUI primitives as the vocabulary of the reconstruction, but the
  final look wins: the renderer may add its own depth surfaces or styling when
  a primitive fights the source layout (see "Product direction"). Do not modify
  the primitives in `src/app/3DUI/_lib/` during page generation.
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
6. Stream the validated nodes to the UI and render the spec live inside Deep
   with the runtime `SpecRenderer` (generated source files may become a later,
   secondary artifact).
7. Validate schemas, evidence links, hierarchy, and local assets before any
   node reaches the UI; the renderer only ever renders validated data as text
   and props, never as markup.

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

## Frontend/backend workflow event contract

The canonical TypeScript event definitions are in
`backend/src/workflow/reconstruction-events.ts`. UI-building agents must use
that discriminated union as the behavioral contract until equivalent schemas
are merged into `openapi.yaml`. Do not invent an endpoint or transport while
the public HTTP contract remains undecided; adapt the agreed SSE, WebSocket, or
streaming-fetch transport to these events when it is added.

Every event contains:

- `eventVersion`, currently `"1.0"`.
- `jobId`, identifying one conversion.
- A monotonically increasing `sequence`, used for ordering and deduplication.
- `emittedAt`, `stage`, and integer `progress` from 0 through 100.
- A discriminating `type` with type-specific data.

Event types and UI behavior:

- `workflow.status` — update the loading bar from `progress` and select UI copy
  from `stage`. The supplied `message` is displayable context, but the UI must
  never parse it to determine state.
- `source.element` — optionally visualize the parsed source element, draw the
  green highlight from `focus.highlightColor`, and place `annotation` beside
  it. Use the IDs in `focus` for attachment, never text matching.
- `reconstruction.node` — add or replace the node by `node.id`, associate it
  with `focus.sourceElementIds`, highlight it, and show its annotation. Treat
  the node as a complete idempotent snapshot, not executable source code.
- `workflow.completed` — treat as the only successful terminal event. Replace
  incremental state with the validated `result` specification and set progress
  to 100.
- `workflow.failed` — stop the loading state, present a safe error using
  `error.code`, and offer retry only when `error.retryable` is true.

The frontend event reducer must:

1. Keep state isolated by `jobId`.
2. Ignore duplicate events and any event whose `sequence` is not newer than the
   last applied sequence for that job.
3. Upsert elements and nodes by their stable IDs so replay is safe.
4. Treat `workflow.completed` and `workflow.failed` as terminal.
5. Never render raw model text, chain-of-thought, unvalidated JSON, or arbitrary
   executable HTML/React received over the event stream.
6. Preserve the last valid state if the stream disconnects. A future resumable
   transport should reconnect using the job ID and last applied sequence.

The current backend runner emits source-element and reconstruction-node events
after each corresponding validated batch becomes available. Future token- or
tool-streaming may make these events arrive earlier, but it must retain the same
event version, ordering, ID, validation, and terminal-state guarantees.

## Common commands

Install exact dependencies:

```sh
npm ci
```

Run the frontend:

```sh
npm run dev
```

Run the app end to end: create `.env.local` with `XAI_API_KEY` (see
`.env.example`), `npm run dev`, open http://localhost:3000, paste a public URL
and press Go Deep. Append `?source=mock&fixture=success` (or `failure`,
`failure-retryable`, `out-of-order`, `empty-images`, `long-model-stage`,
`reconnection`) to replay a fixture without the backend. `/preview` renders a
demo spec through the renderer.

Run all tests and project checks:

```sh
npm run backend:test
npm run frontend:test
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

Run a billable local end-to-end reconstruction. Structured progress events are
written as NDJSON to stderr and the final validated spec is written to stdout:

```sh
npm run --silent webpage:reconstruct -- http://127.0.0.1:3000 --allow-private
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
