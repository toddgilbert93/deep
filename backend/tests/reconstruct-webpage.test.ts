import assert from "node:assert/strict";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { ReconstructionAgentClient } from "../src/agents/reconstruction-agent";
import { FileImageAssetStore } from "../src/assets/file-image-asset-store";
import type { GrokMessage } from "../src/providers/grok";
import type { ReconstructionEvent } from "../src/workflow/reconstruction-events";
import { reconstructWebpage } from "../src/workflow/reconstruct-webpage";

const fixtureDirectory = path.join(
  process.cwd(),
  "backend/tests/fixtures/simple-site",
);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("connects collection, parsing, assets, Grok, validation, and UI events", async (t) => {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "deep-reconstruction-workflow-"),
  );
  const indexHtml = await readFile(
    path.join(fixtureDirectory, "index.html"),
    "utf8",
  );
  const appJavaScript = await readFile(
    path.join(fixtureDirectory, "app.js"),
    "utf8",
  );
  const server = createServer((request, response) => {
    if (request.url === "/app.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" });
      response.end(appJavaScript);
      return;
    }
    if (request.url === "/product.png") {
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(png);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(indexHtml);
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const events: ReconstructionEvent[] = [];
  const client = createMockReconstructionClient();
  const { port } = server.address() as AddressInfo;
  const result = await reconstructWebpage({
    url: `http://127.0.0.1:${port}`,
    allowPrivateNetwork: true,
    jobId: "job_test",
    client,
    assetStore: new FileImageAssetStore({
      storageDirectory: path.join(temporaryDirectory, "storage"),
      cacheDirectory: path.join(temporaryDirectory, "cache"),
    }),
    onEvent: (event) => {
      events.push(event);
    },
  });

  assert.equal(result.spec.nodes.length, result.parsed.elements.length);
  assert.equal(result.parsed.assets.images.length, 1);
  assert.equal(events[0].type, "workflow.status");
  assert.equal(events.at(-1)?.type, "workflow.completed");
  assert.equal(
    events.filter((event) => event.type === "source.element").length,
    result.parsed.elements.length,
  );
  assert.equal(
    events.filter((event) => event.type === "reconstruction.node").length,
    result.spec.nodes.length,
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_event, index) => index + 1),
  );
  assert.ok(
    events.every(
      (event, index) => index === 0 || event.progress >= events[index - 1].progress,
    ),
  );
  assert.ok(
    events
      .filter((event) => "focus" in event)
      .every((event) => event.focus.highlightColor === "#22c55e"),
  );
});

function createMockReconstructionClient(): ReconstructionAgentClient {
  return {
    model: "grok-test",
    async generateText(input, options) {
      assert.equal(options?.responseFormat?.name, "reconstruction_spec");
      assert.ok(Array.isArray(input));
      const userMessage = (input as GrokMessage[]).find(
        (message) => message.role === "user",
      );
      assert.ok(userMessage);
      const graph = JSON.parse(
        userMessage.content.slice(userMessage.content.indexOf("{")),
      ) as ParsedAgentInput;
      const nodes = graph.elements.map((element, index) =>
        createNode(element, index),
      );
      const spec = {
        schemaVersion: "1.0",
        source: { url: graph.page.url, title: graph.page.title },
        page: {
          route: "/generated/local-fixture",
          title: graph.page.title || "Generated page",
          maxWidth: 1200,
          padding: 24,
          gap: 20,
          theme: {
            background: "#ffffff",
            surface: "#f5f5f5",
            ink: "#111111",
            accent: "#22c55e",
            fontFamily: "Arial, sans-serif",
          },
        },
        nodes,
        interactions: [],
        unresolved: [],
        notes: [],
      };
      return {
        id: "resp_test",
        model: "grok-test",
        text: JSON.stringify(spec),
        usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
      };
    },
  };
}

interface ParsedAgentInput {
  page: { url: string; title: string };
  elements: Array<{
    id: string;
    tag: string;
    role: string;
    name?: string;
    text?: string;
    assetId?: string;
  }>;
}

function createNode(element: ParsedAgentInput["elements"][number], order: number) {
  const common = {
    id: `node_${element.id}`,
    sourceElementIds: [element.id],
    order,
    layout: {},
    evidence: {
      sourceConnectionIds: [],
      confidence: 1,
      rationale: `Maps ${element.id}.`,
    },
  };
  if (element.tag === "img" && element.assetId) {
    return {
      ...common,
      component: "Image3D",
      props: {
        assetId: element.assetId,
        alt: element.name ?? "Source image",
      },
    };
  }
  if (element.tag === "button") {
    return {
      ...common,
      component: "Button3D",
      props: { label: element.name ?? element.text ?? "Button" },
    };
  }
  if (/^h[1-6]$/.test(element.tag)) {
    return {
      ...common,
      component: "Text3D",
      props: {
        text: element.name ?? element.text ?? "Heading",
        fontSize: 40,
        semanticTag: element.tag,
      },
    };
  }
  return {
    ...common,
    component: "HtmlElement",
    props: {
      tag: toAllowedHtmlTag(element.tag),
      ...(element.text ? { text: element.text } : {}),
    },
  };
}

function toAllowedHtmlTag(tag: string): string {
  const allowed = new Set([
    "div",
    "main",
    "section",
    "nav",
    "header",
    "footer",
    "form",
    "label",
    "input",
    "textarea",
    "select",
    "option",
    "a",
    "p",
    "ul",
    "ol",
    "li",
    "span",
  ]);
  return allowed.has(tag) ? tag : "div";
}
