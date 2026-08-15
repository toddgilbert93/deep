import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type { WebpageSource } from "../src/webpage/fetch-webpage-source";
import { parseWebpageUi } from "../src/webpage/parse-webpage-ui";

const fixtureDirectory = path.join(
  process.cwd(),
  "backend/tests/fixtures/simple-site",
);

test("creates a compact UI element and relationship graph", async () => {
  const rawHtml = await readFile(
    path.join(fixtureDirectory, "index.html"),
    "utf8",
  );
  const appJavaScript = await readFile(
    path.join(fixtureDirectory, "app.js"),
    "utf8",
  );
  const source: WebpageSource = {
    requestedUrl: "http://127.0.0.1:3000/",
    finalUrl: "http://127.0.0.1:3000/",
    title: "Local Parser Fixture",
    language: "en",
    rawHtml,
    domHtml: rawHtml,
    visibleText:
      "Primary navigation Documentation Evaluate this page Webpage URL Evaluate Results appear here.",
    elementCount: 20,
    scripts: [
      {
        kind: "external",
        type: "text/javascript",
        async: false,
        defer: true,
        sourceUrl: "http://127.0.0.1:3000/app.js",
        finalUrl: "http://127.0.0.1:3000/app.js",
        content: appJavaScript,
        bytes: Buffer.byteLength(appJavaScript),
      },
    ],
  };

  const result = parseWebpageUi(source);
  const findElement = (name: string) =>
    result.elements.find((element) => element.name === name);
  const button = findElement("Evaluate");
  const input = result.elements.find(
    (element) => element.tag === "input" && element.name === "Webpage URL",
  );
  const label = result.elements.find((element) => element.tag === "label");
  const form = result.elements.find((element) => element.tag === "form");
  const results = findElement("Evaluation results");

  assert.ok(button);
  assert.ok(input);
  assert.ok(label);
  assert.ok(form);
  assert.ok(results);
  assert.equal(input.state?.required, true);
  assert.ok(
    result.connections.some(
      (connection) =>
        connection.type === "labels" &&
        connection.sourceElementId === label.id &&
        connection.targetElementId === input.id,
    ),
  );
  assert.ok(
    result.connections.some(
      (connection) =>
        connection.type === "controls" &&
        connection.sourceElementId === button.id &&
        connection.targetElementId === results.id,
    ),
  );
  assert.ok(
    result.connections.some(
      (connection) =>
        connection.type === "submits" &&
        connection.sourceElementId === button.id &&
        connection.targetElementId === form.id,
    ),
  );
  assert.ok(
    result.connections.some(
      (connection) =>
        connection.type === "handles" &&
        connection.sourceElementId === button.id &&
        connection.event === "click" &&
        connection.evidence.source === "javascript",
    ),
  );
  assert.ok(
    result.connections.some(
      (connection) =>
        connection.type === "requests" &&
        connection.sourceElementId === button.id &&
        connection.destination === "/api/evaluations",
    ),
  );
  assert.equal(result.scripts.analyzed, 1);
  assert.ok(result.stats.estimatedTokens < 3_000);
  assert.doesNotMatch(JSON.stringify(result), /document\.querySelector/);
});
