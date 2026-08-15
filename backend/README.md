# Backend

This directory owns the backend for Deep: API handling, webpage inspection,
parallel agent orchestration, Grok/xAI integration, result aggregation, schema
validation, and backend tests.

The backend uses Node.js and TypeScript. No HTTP framework has been selected
yet; the initial integration is a provider adapter that can be reused by the
future API and orchestration layers.

## Grok/xAI configuration

The integration uses xAI's Responses API through native `fetch`. Copy the
values from `../.env.example` into your local environment and provide a real
API key:

```sh
export XAI_API_KEY="your-key"
export XAI_MODEL="grok-4.6"
```

`grok-4.6` is the project default and was verified against the configured xAI
account on 2026-08-15. Set `XAI_MODEL` to another model slug only when an
environment needs an explicit override. Never commit the key.

Run the mocked integration tests without making a billable API request:

```sh
npm run backend:test
```

List the exact models and aliases available to the configured API key:

```sh
npm run grok:models
```

Use an ID or alias shown by that command as `XAI_MODEL`.

Run an explicit live smoke check, which does make a billable API request:

```sh
npm run grok:check
```

## Planned responsibility

The expected high-level flow is:

1. Accept a webpage URL through the API.
2. Validate and normalize the request.
3. Inspect or retrieve the webpage using an approved mechanism.
4. Run specialized evaluation agents concurrently.
5. Identify UI elements and the UX relationships between them.
6. Validate and aggregate agent results.
7. Return a response matching `../openapi.yaml`.

## Rules for future backend work

- Keep the public API synchronized with `../openapi.yaml`.
- Keep prompts versioned with the source code.
- Require structured model responses and validate them before aggregation.
- Isolate external providers behind adapters.
- Never log secrets or commit `.env` files.
- Add every installed tool or package to `../clean.txt`, including its cleanup
  command.
- Add HTTP-framework-specific run and OpenAPI export instructions here when the
  API framework is chosen.

## Suggested layout after stack selection

```text
backend/
  src/
    api/          Public routes and request/response schemas
    agents/       Specialized webpage evaluation agents
    orchestration/ Parallel execution and result aggregation
    providers/    Grok/xAI and webpage-access adapters
  tests/
  README.md
```

The provider and test folders are now implemented. The other folders remain
guidance until their corresponding features are added.
