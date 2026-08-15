import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import test from "node:test";

import {
  fetchWebpageSource,
  WebpageSourceError,
} from "../src/webpage/fetch-webpage-source";

const fixtureDirectory = path.join(
  process.cwd(),
  "backend/tests/fixtures/simple-site",
);

test("blocks private network pages by default", async () => {
  for (const url of [
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "http://[::ffff:127.0.0.1]:3000",
  ]) {
    await assert.rejects(fetchWebpageSource(url), WebpageSourceError);
  }
});

test("allows public IPv4 and IPv4-mapped IPv6 literals while still blocking mapped private ones", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("<!doctype html><title>Public</title><body>ok</body>", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

  for (const url of ["http://104.18.19.80/", "http://[::ffff:104.18.19.80]/"]) {
    const result = await fetchWebpageSource(url, { fetchImpl });
    assert.equal(result.title, "Public");
  }

  for (const url of ["http://[::ffff:10.0.0.1]/", "http://[::ffff:a00:1]/"]) {
    await assert.rejects(
      fetchWebpageSource(url, { fetchImpl }),
      /Private or reserved network address/,
    );
  }
});

test("collects a local page DOM and JavaScript without executing it", async (t) => {
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
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(indexHtml);
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const result = await fetchWebpageSource(`http://127.0.0.1:${port}`, {
    allowPrivateNetwork: true,
  });

  assert.equal(result.title, "Local Parser Fixture");
  assert.equal(result.language, "en");
  assert.match(result.domHtml, /id="evaluate-button"/);
  assert.match(result.visibleText, /Evaluate this page/);
  assert.match(result.visibleText, /Webpage URL Evaluate/);
  assert.equal(result.scripts.length, 2);
  assert.deepEqual(
    result.scripts.map((script) => script.kind),
    ["external", "inline"],
  );
  assert.match(result.scripts[0].content ?? "", /addEventListener/);
  assert.match(result.scripts[1].content ?? "", /fixtureLoaded/);
  assert.doesNotMatch(result.domHtml, /evaluated="true"/);
});
