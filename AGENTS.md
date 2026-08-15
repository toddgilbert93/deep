# Deep project guide

## Purpose

Deep evaluates a webpage from a submitted URL. The planned backend will run
multiple Grok-powered agents concurrently, identify UI elements, describe UX
connections between them, and combine those findings into a stable API
response. This workflow is planned but not implemented yet.

## Repository map

- `src/app/` — Next.js frontend application.
- `public/` — frontend static assets.
- `backend/` — all backend source code, tests, prompts, and backend-specific
  configuration. Read `backend/README.md` before adding backend code.
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
- Prefer structured, schema-validated agent outputs over free-form text.
- Update this guide whenever the project layout or architectural boundaries
  change.

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
