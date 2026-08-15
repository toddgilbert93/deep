import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_GROK_MODEL,
  GrokApiError,
  GrokClient,
  GrokConfigurationError,
} from "../src/providers/grok";
import { RECONSTRUCTION_RESPONSE_FORMAT } from "../src/reconstruction/reconstruction-spec-schema";

test("requires an API key without making a request", async () => {
  let called = false;
  const client = new GrokClient({
    apiKey: "",
    fetchImpl: async () => {
      called = true;
      return new Response();
    },
  });

  await assert.rejects(
    client.generateText("hello"),
    GrokConfigurationError,
  );
  assert.equal(called, false);
});

test("calls the xAI Responses API and normalizes output", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  const client = new GrokClient({
    apiKey: "test-key",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json({
        id: "resp_test",
        model: DEFAULT_GROK_MODEL,
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "connected" }],
          },
        ],
        usage: {
          input_tokens: 3,
          output_tokens: 1,
          total_tokens: 4,
          cost_in_usd_ticks: 123,
        },
      });
    },
  });

  const result = await client.generateText("ping");

  assert.equal(capturedUrl, "https://api.x.ai/v1/responses");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(
    new Headers(capturedInit?.headers).get("Authorization"),
    "Bearer test-key",
  );
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    model: DEFAULT_GROK_MODEL,
    input: "ping",
  });
  assert.deepEqual(result, {
    id: "resp_test",
    model: DEFAULT_GROK_MODEL,
    text: "connected",
    usage: {
      inputTokens: 3,
      outputTokens: 1,
      totalTokens: 4,
      costInUsdTicks: 123,
    },
  });
});

test("sends a strict JSON Schema through Responses API text.format", async () => {
  let capturedBody: unknown;
  const client = new GrokClient({
    apiKey: "test-key",
    fetchImpl: async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return Response.json({
        id: "resp_structured",
        model: DEFAULT_GROK_MODEL,
        output_text: "{}",
      });
    },
  });

  await client.generateText("Build a reconstruction spec.", {
    responseFormat: RECONSTRUCTION_RESPONSE_FORMAT,
  });

  assert.deepEqual(capturedBody, {
    model: DEFAULT_GROK_MODEL,
    input: "Build a reconstruction spec.",
    text: { format: RECONSTRUCTION_RESPONSE_FORMAT },
  });
});

test("lists models and aliases available to the API key", async () => {
  const client = new GrokClient({
    apiKey: "test-key",
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://api.x.ai/v1/models");
      assert.equal(init?.method, "GET");
      return Response.json({
        object: "list",
        data: [
          {
            id: "grok-private-preview",
            aliases: ["grok-4.6", 42],
          },
        ],
      });
    },
  });

  assert.deepEqual(await client.listModels(), [
    { id: "grok-private-preview", aliases: ["grok-4.6"] },
  ]);
});

test("surfaces API errors without exposing the API key", async () => {
  const client = new GrokClient({
    apiKey: "do-not-leak",
    fetchImpl: async () =>
      Response.json(
        { code: "permission_denied", message: "Team lacks permission" },
        { status: 403, headers: { "x-request-id": "req_test" } },
      ),
  });

  await assert.rejects(client.generateText("hello"), (error: unknown) => {
    assert.ok(error instanceof GrokApiError);
    assert.equal(error.status, 403);
    assert.equal(error.requestId, "req_test");
    assert.match(error.message, /Team lacks permission/);
    assert.match(error.message, /req_test/);
    assert.doesNotMatch(error.message, /do-not-leak/);
    return true;
  });
});
