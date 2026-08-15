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

Not implemented yet:

- Public backend HTTP endpoints.
- Parallel reconstruction agents, final planning, and code generation.
- Final request/response schemas from the teammate-owned backend contract.
- Production deployment or shared remote asset storage.

## UI/UX partner handoff

The partner agent is currently focused on the user-facing conversion
experience in `src/app/`. Its immediate goal is to implement Phase 1 and design
the frontend state model so Phases 2 and 3 can be added without replacing it.

UI/UX agent responsibilities:

- Own the URL submission experience, loading/progress presentation, conversion
  status UI, streamed reconstruction preview, error states, retry behavior,
  responsive layout, and accessibility.
- Build a reducer or equivalent state layer around the event union documented
  below. Keep it independent from the eventual SSE/WebSocket/fetch transport.
- Use `stage` for status selection, `progress` for the loading indicator,
  `sequence` for ordering, and stable IDs for element/node upserts.
- Design Phase 3 overlays around `focus.highlightColor` and `annotation` rather
  than deriving highlights from model text.
- Use deterministic mock event fixtures while the public streaming endpoint is
  absent. Fixtures should cover success, failure, duplicate or out-of-order
  events, reconnection, an empty image set, and a long-running model stage.
- Keep frontend-only implementation in `src/`; do not import Node-only backend
  modules into client components. Shared wire types should eventually be
  generated from or synchronized with `openapi.yaml`.
- Read `src/app/3DUI/instructions.md` before using or changing the approved 3D
  component library.

Backend agent responsibilities:

- Own collection, parsing, local asset persistence, model calls, validation,
  orchestration, event production, and the future streaming HTTP transport.
- Preserve the event semantics in
  `backend/src/workflow/reconstruction-events.ts` and notify the UI owner before
  making a breaking event change.
- Add the agreed public streaming endpoint to `openapi.yaml` before either side
  hardcodes its route, request body, or transport details.

Current integration limitation: `webpage:reconstruct` proves the full workflow
and emits the frontend event objects, but there is not yet a browser-accessible
backend endpoint. The UI agent should build against mocked events and an
injectable event-source adapter, not invoke the backend CLI from the browser.

## Repository map

- `src/app/` — Next.js frontend application.
- `src/themes/` — Desperado colour and type tokens.
- `src/fonts/` — Quantico and Doto faces for the Desperado theme.
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
