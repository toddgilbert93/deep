# Deep

Deep takes a public webpage URL and reconstructs it as a similar 3D webpage.
The backend fetches and parses the page (browser-free, JavaScript never
executed), caches its images locally, asks Grok for an evidence-linked
reconstruction specification, validates it, and streams progress to the UI,
which renders the result live with the 3D primitives in `src/app/3DUI/_lib/`.

See `AGENTS.md` for the project guide, architecture, and event contract, and
`backend/README.md` for backend details.

## Setup

```sh
npm ci
cp .env.example .env.local   # then put your xAI key in XAI_API_KEY
npm run dev
```

Open http://localhost:3000, paste a URL, and press **Go Deep**. Conversions
make billable xAI requests and take a few minutes for larger pages.

- `http://localhost:3000/?source=mock&fixture=success` replays a deterministic
  fixture without touching the backend (also `failure`, `failure-retryable`,
  `out-of-order`, `empty-images`, `long-model-stage`, `reconnection`).
- `http://localhost:3000/preview` renders a demo spec through the renderer.
- `http://localhost:3000/library` is the visual catalog of 3D primitives.

## Checks

```sh
npm run backend:test
npm run frontend:test
npx tsc --noEmit
npm run lint
```

## CLI

```sh
npm run webpage:parse -- https://example.com          # graph + local images, no model call
npm run --silent webpage:reconstruct -- https://example.com > spec.json 2> events.ndjson
```

The CLI reads `XAI_API_KEY` from the shell environment (export it, or
`set -a; source .env.local; set +a`).

## HTTP API

Defined in `openapi.yaml`: `POST /api/reconstruct` (JSON `{ url, jobId? }` →
Server-Sent Events of the workflow event union) and `GET /api/assets/{assetId}`
(locally cached page images).

## Design

Quantico is the only UI face; electric blue on near-black; hard corners. The
product goal is a faithful reproduction of the source page lifted into 3D with
depth — the primitives are a palette, not a cage.
