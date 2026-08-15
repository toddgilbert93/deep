import assert from "node:assert/strict";
import test from "node:test";

import { extractDesignBrief } from "../src/design/design-brief";
import { parseDesignPage, sanitizeCss } from "../src/design/parse-design-page";
import { stripCodeFence } from "../src/design/generate-page";
import { designWebpage } from "../src/workflow/design-webpage";
import type { WebpageSource } from "../src/webpage/fetch-webpage-source";
import type { ReconstructionEvent } from "../src/workflow/reconstruction-events";
import type { GrokMessage, GrokStreamOptions } from "../src/providers/grok";

const SAMPLE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Acme — Build faster</title>
    <meta name="description" content="Ship products quickly." />
    <style>
      :root { --brand-accent: #ff5a1f; --color-bg: #0b0b0f; }
      body { background-color: #0b0b0f; color: #f4f4f5; font-family: "Inter", sans-serif; }
      h1 { font-family: "Söhne", sans-serif; }
    </style>
  </head>
  <body>
    <header>
      <nav>
        <a href="/product">Product</a>
        <a href="/docs">Docs</a>
        <a href="/pricing">Pricing</a>
        <button>Sign in</button>
      </nav>
    </header>
    <main>
      <section>
        <h1>Build faster with Acme</h1>
        <p>Everything you need to ship your next product without the busywork.</p>
        <a class="button" href="/start">Get started</a>
        <pre>npm install acme</pre>
      </section>
      <section>
        <h2>Why teams choose Acme</h2>
        <ul>
          <li><h3>Fast</h3><p>Deploy in seconds.</p></li>
          <li><h3>Safe</h3><p>Audited by default.</p></li>
          <li><h3>Simple</h3><p>One command to start.</p></li>
        </ul>
      </section>
    </main>
    <footer><a href="/legal">Legal</a></footer>
  </body>
</html>`;

function makeSource(html = SAMPLE_HTML): WebpageSource {
  return {
    requestedUrl: "https://acme.test/",
    finalUrl: "https://acme.test/",
    title: "Acme — Build faster",
    language: "en",
    rawHtml: html,
    domHtml: html,
    visibleText: "Build faster with Acme",
    elementCount: 30,
    scripts: [],
  };
}

test("design brief captures identity, palette, type, and ordered blocks", () => {
  const brief = extractDesignBrief(makeSource(), {
    stylesheets: [
      ":root { --brand-accent: #ff5a1f; } body { background-color: #0b0b0f; color: #f4f4f5; font-family: \"Inter\", sans-serif; } h1 { font-family: \"Söhne\", sans-serif; }",
    ],
  });

  assert.equal(brief.title, "Acme — Build faster");
  assert.equal(brief.description, "Ship products quickly.");
  assert.equal(brief.palette.background, "#0b0b0f");
  assert.equal(brief.palette.accent, "#ff5a1f");
  assert.match(brief.fonts.body ?? "", /Inter/);
  assert.match(brief.fonts.heading ?? "", /Söhne/);

  const kinds = brief.blocks.map((block) => block.kind);
  assert.equal(kinds[0], "nav", "navigation comes first");
  assert.ok(kinds.includes("hero"), "hero is captured");
  assert.ok(kinds.includes("footer"), "footer is captured");

  const nav = brief.blocks[0];
  assert.deepEqual(
    nav.links?.map((link) => link.label),
    ["Product", "Docs", "Pricing"],
  );

  const hero = brief.blocks.find((block) => block.kind === "hero");
  assert.equal(hero?.heading, "Build faster with Acme");
  assert.match(hero?.subheading ?? "", /Everything you need/);
  assert.equal(hero?.code, "npm install acme");

  const features = brief.blocks.find((block) => (block.items?.length ?? 0) >= 3);
  assert.ok(features, "feature items are grouped");
  assert.equal(features?.items?.[0].heading, "Fast");
});

test("design brief stays inside its character budget", () => {
  const long = SAMPLE_HTML.replace(
    "</main>",
    `${Array.from(
      { length: 60 },
      (_value, index) =>
        `<section><h2>Section ${index}</h2><p>${"padding text ".repeat(40)}</p></section>`,
    ).join("")}</main>`,
  );

  const brief = extractDesignBrief(makeSource(long), { maxCharacters: 6000 });
  assert.ok(JSON.stringify(brief).length <= 6500, "serialized brief is bounded");
  assert.equal(brief.stats.truncated, true);
});

test("brief only references locally cached images", () => {
  const html = SAMPLE_HTML.replace(
    "<h1>",
    '<img src="https://cdn.acme.test/hero.png" alt="Hero" /><h1>',
  );
  const brief = extractDesignBrief(makeSource(html), {
    resolveImage: (raw) =>
      raw.includes("hero.png")
        ? { src: "/api/assets/asset_0123456789abcdef01234567", alt: "Hero", role: "content" }
        : undefined,
  });

  const serialized = JSON.stringify(brief);
  assert.ok(serialized.includes("/api/assets/asset_0123456789abcdef01234567"));
  assert.ok(!serialized.includes("cdn.acme.test"), "remote image URLs never reach the model");
});

test("generated HTML is parsed into an allow-listed tree", () => {
  const page = parseDesignPage(`<!doctype html>
    <html><head><title>Deep page</title>
    <style>body { background: #000 } .hero { color: red }</style></head>
    <body>
      <header><deep-carousel><deep-carousel-item>Docs</deep-carousel-item></deep-carousel></header>
      <main>
        <h1 style="color: #fff; background: url(https://evil.test/x.png)">Hello</h1>
        <p onclick="steal()">Copy</p>
        <a href="javascript:alert(1)">Bad link</a>
        <a href="https://acme.test/docs">Good link</a>
        <img src="https://cdn.evil.test/a.png" alt="remote" />
        <img src="/api/assets/asset_0123456789abcdef01234567" alt="local" />
        <marquee>Legacy</marquee>
        <script>window.x = 1</script>
      </main>
    </body></html>`);

  assert.equal(page.title, "Deep page");
  assert.equal(page.partial, false);
  assert.equal(page.stats.components["deep-carousel"], 1);

  const flat = JSON.stringify(page);
  assert.ok(!flat.includes("onclick"), "event handlers are stripped");
  assert.ok(!flat.includes("javascript:"), "javascript URLs are stripped");
  assert.ok(!flat.includes("window.x"), "script content is dropped");
  assert.ok(!flat.includes("cdn.evil.test"), "remote images are dropped");
  assert.ok(flat.includes("/api/assets/asset_0123456789abcdef01234567"), "local images survive");
  assert.ok(flat.includes("https://acme.test/docs"), "safe links survive");
  assert.ok(flat.includes("Legacy"), "unknown tags keep their text content");
  assert.ok(!flat.includes("evil.test/x.png"), "url() in inline style is dropped");
});

test("CSS sanitizer removes imports, script escapes, and remote urls", () => {
  const css = sanitizeCss(
    `@import url("https://evil.test/x.css");
     .a { background: url(https://evil.test/bg.png); }
     .b { behavior: url(#default#x); width: expression(alert(1)); }
     .c { background: url("/api/assets/asset_0123456789abcdef01234567"); }
     </style><script>alert(1)</script>`,
    ["/api/assets/"],
  );

  assert.ok(!css.includes("@import"));
  assert.ok(!css.includes("evil.test"));
  assert.ok(!/behavior\s*:/.test(css));
  assert.ok(!css.includes("expression("));
  assert.ok(!/<\/?\s*style/i.test(css));
  assert.ok(css.includes("/api/assets/asset_0123456789abcdef01234567"));
});

test("partial HTML still parses for the live preview", () => {
  const page = parseDesignPage(
    `<!doctype html><html><head><title>Half</title><style>.x{color:red}</style></head><body><header><h1>Partial`,
    { partial: true },
  );
  assert.equal(page.partial, true);
  assert.ok(page.nodes.length > 0);
  assert.ok(JSON.stringify(page).includes("Partial"));
});

test("stripCodeFence unwraps a fenced document", () => {
  assert.equal(stripCodeFence("```html\n<!doctype html><p>x</p>\n```"), "<!doctype html><p>x</p>");
  assert.equal(stripCodeFence("<!doctype html><p>x</p>"), "<!doctype html><p>x</p>");
});

/* -------------------------------------------------------------------------- */
/* Workflow                                                                   */
/* -------------------------------------------------------------------------- */

const GENERATED = `<!doctype html><html><head><title>Acme in 3D</title>
<style>body{background:#0b0b0f;color:#f4f4f5}</style></head>
<body><header><deep-carousel><deep-carousel-item>Product</deep-carousel-item><deep-carousel-item>Docs</deep-carousel-item><deep-carousel-item>Pricing</deep-carousel-item></deep-carousel></header>
<main><deep-text as="h1" fontSize="64">Build faster</deep-text><p>Everything you need.</p>
<deep-button-group><deep-button label="Get started" href="https://acme.test/start"></deep-button></deep-button-group></main></body></html>`;

function makeStreamClient(chunks: string[] = [GENERATED]): {
  client: { model: string; streamText: (input: string | GrokMessage[], options: GrokStreamOptions) => Promise<{ id: string; model: string; text: string }> };
  calls: number;
} {
  const state = { calls: 0 };
  return {
    calls: state.calls,
    client: {
      model: "grok-test",
      async streamText(_input, options) {
        state.calls += 1;
        let text = "";
        await options.onFirstDelta?.();
        for (const chunk of chunks) {
          text += chunk;
          await options.onDelta?.(chunk);
        }
        return { id: "resp_test", model: "grok-test", text };
      },
    },
  };
}

function makeFetchImpl(html: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith(".css")) {
      return new Response("body{color:#fff}", {
        status: 200,
        headers: { "Content-Type": "text/css" },
      });
    }
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }) as typeof fetch;
}

test("design workflow streams snapshots and completes with a page", async () => {
  const events: ReconstructionEvent[] = [];
  const { client } = makeStreamClient([
    GENERATED.slice(0, 240),
    GENERATED.slice(240),
  ]);
  let clock = 0;

  const result = await designWebpage({
    url: "https://acme.test/",
    allowPrivateNetwork: true,
    jobId: "job_design_test",
    client,
    fetchImpl: makeFetchImpl(SAMPLE_HTML),
    assetStore: {
      async findBySourceUrl() {
        return undefined;
      },
      async put() {
        throw new Error("no images in this fixture");
      },
    },
    snapshotIntervalMs: 0,
    now: () => (clock += 1000),
    onEvent: (event) => {
      events.push(event);
    },
  });

  const sequences = events.map((event) => event.sequence);
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b), "sequences increase");
  assert.equal(new Set(sequences).size, sequences.length, "no duplicate sequences");

  const terminal = events.at(-1);
  assert.equal(terminal?.type, "workflow.completed");
  assert.equal(terminal?.progress, 100);

  const snapshots = events.filter((event) => event.type === "design.page");
  assert.ok(snapshots.length >= 1, "at least one live snapshot is emitted");
  assert.ok(
    snapshots.every((event) => event.type === "design.page" && event.page.partial),
    "streamed snapshots are marked partial",
  );

  assert.equal(result.page.partial, false);
  assert.equal(result.page.stats.components["deep-carousel"], 1);
  assert.equal(result.page.stats.components["deep-button"], 1);
  assert.equal(result.model, "grok-test");

  // No source.element spam: the design pipeline does not stream per-element events.
  assert.equal(events.filter((event) => event.type === "source.element").length, 0);
  assert.ok(events.length < 20, `event volume stays small (was ${events.length})`);
});

test("design workflow reports a fetch failure as a terminal event", async () => {
  const events: ReconstructionEvent[] = [];
  const { client } = makeStreamClient();

  await assert.rejects(
    designWebpage({
      url: "https://acme.test/",
      allowPrivateNetwork: true,
      jobId: "job_fail",
      client,
      fetchImpl: (async () =>
        new Response("nope", { status: 500 })) as typeof fetch,
      onEvent: (event) => {
        events.push(event);
      },
    }),
  );

  const terminal = events.at(-1);
  assert.equal(terminal?.type, "workflow.failed");
  assert.equal(
    terminal?.type === "workflow.failed" ? terminal.error.code : undefined,
    "SOURCE_FETCH_FAILED",
  );
});

test("an aborted job fails with WORKFLOW_ABORTED", async () => {
  const events: ReconstructionEvent[] = [];
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    designWebpage({
      url: "https://acme.test/",
      allowPrivateNetwork: true,
      jobId: "job_abort",
      client: makeStreamClient().client,
      fetchImpl: makeFetchImpl(SAMPLE_HTML),
      signal: controller.signal,
      onEvent: (event) => {
        events.push(event);
      },
    }),
  );

  const terminal = events.at(-1);
  assert.equal(
    terminal?.type === "workflow.failed" ? terminal.error.code : undefined,
    "WORKFLOW_ABORTED",
  );
});
