import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ReconstructionNode } from "../../../../backend/src/reconstruction/reconstruction-spec";
import { validateReconstructionSpec } from "../../../../backend/src/reconstruction/validate-reconstruction-spec";
import {
  DEMO_HIGHLIGHT_NODE_ID,
  DEMO_SPEC,
} from "../../../app/_components/spec-renderer/demo-spec";
import {
  buildSpecTree,
  layoutToStyle,
  resolveDestination,
  safeCssColor,
  safeFontFamily,
} from "../spec-tree";

function htmlNode(
  id: string,
  overrides: Partial<Omit<ReconstructionNode, "component" | "props">> & {
    tag?: "div" | "span" | "p";
  } = {},
): ReconstructionNode {
  const { tag = "div", ...rest } = overrides;
  return {
    id,
    component: "HtmlElement",
    sourceElementIds: ["el_1"],
    order: 0,
    layout: {},
    props: { tag },
    evidence: { sourceConnectionIds: [], confidence: 1, rationale: "test" },
    ...rest,
  };
}

describe("buildSpecTree", () => {
  it("nests children under parents and sorts by order then id", () => {
    const tree = buildSpecTree([
      htmlNode("node_b", { parentId: "node_root", order: 1 }),
      htmlNode("node_root"),
      htmlNode("node_c", { parentId: "node_root", order: 0 }),
      htmlNode("node_a", { parentId: "node_root", order: 1 }),
    ]);

    assert.equal(tree.roots.length, 1);
    assert.equal(tree.roots[0].node.id, "node_root");
    assert.deepEqual(
      tree.roots[0].children.map((child) => child.node.id),
      ["node_c", "node_a", "node_b"],
    );
    assert.deepEqual(tree.orphanIds, []);
    assert.equal(tree.byId.size, 4);
  });

  it("promotes nodes with a missing parent to roots and reports them", () => {
    const tree = buildSpecTree([
      htmlNode("node_child", { parentId: "node_not_yet_streamed", order: 2 }),
      htmlNode("node_root", { order: 1 }),
    ]);

    assert.deepEqual(
      tree.roots.map((root) => root.node.id),
      ["node_root", "node_child"],
    );
    assert.deepEqual(tree.orphanIds, ["node_child"]);
  });

  it("treats a self-parented node as an orphan root", () => {
    const tree = buildSpecTree([htmlNode("node_self", { parentId: "node_self" })]);
    assert.deepEqual(tree.roots.map((root) => root.node.id), ["node_self"]);
    assert.deepEqual(tree.orphanIds, ["node_self"]);
    assert.equal(tree.roots[0].children.length, 0);
  });

  it("breaks parent cycles without dropping nodes", () => {
    const tree = buildSpecTree([
      htmlNode("node_a", { parentId: "node_b" }),
      htmlNode("node_b", { parentId: "node_a" }),
      htmlNode("node_c", { parentId: "node_a" }),
      htmlNode("node_root"),
    ]);

    const rootIds = tree.roots.map((root) => root.node.id).sort();
    assert.deepEqual(rootIds, ["node_a", "node_root"]);
    assert.deepEqual(tree.orphanIds, ["node_a"]);

    const a = tree.byId.get("node_a")!;
    assert.deepEqual(
      a.children.map((child) => child.node.id).sort(),
      ["node_b", "node_c"],
    );
    assert.equal(tree.byId.get("node_b")!.children.length, 0);

    const seen = new Set<string>();
    const walk = (nodes: typeof tree.roots) => {
      for (const entry of nodes) {
        assert.equal(seen.has(entry.node.id), false, "node rendered twice");
        seen.add(entry.node.id);
        walk(entry.children);
      }
    };
    walk(tree.roots);
    assert.equal(seen.size, 4);
  });

  it("dedupes by id with the last snapshot winning", () => {
    const first = htmlNode("node_x", { order: 5, tag: "div" });
    const second = htmlNode("node_x", { order: 1, tag: "span" });
    const tree = buildSpecTree([first, second, htmlNode("node_y", { order: 3 })]);

    assert.equal(tree.byId.size, 2);
    assert.equal(tree.byId.get("node_x")!.node, second);
    assert.deepEqual(
      tree.roots.map((root) => root.node.id),
      ["node_x", "node_y"],
    );
  });

  it("returns an empty tree for no nodes", () => {
    const tree = buildSpecTree([]);
    assert.deepEqual(tree.roots, []);
    assert.equal(tree.byId.size, 0);
    assert.deepEqual(tree.orphanIds, []);
  });
});

describe("layoutToStyle", () => {
  it("returns an empty object for an empty layout", () => {
    assert.deepEqual(layoutToStyle({}), {});
    assert.deepEqual(layoutToStyle(undefined), {});
  });

  it("maps width modes", () => {
    assert.equal(layoutToStyle({ widthMode: "full", width: 300 }).width, "100%");
    assert.equal(layoutToStyle({ widthMode: "fit" }).width, "fit-content");
    assert.equal(layoutToStyle({ widthMode: "fixed", width: 300 }).width, "300px");
    assert.equal(layoutToStyle({ widthMode: "fixed" }).width, undefined);
    assert.equal(layoutToStyle({ widthMode: "auto", width: 300 }).width, undefined);
    assert.equal(layoutToStyle({ width: 240 }).width, "240px");
  });

  it("maps px sizes and flex alignment keywords", () => {
    const style = layoutToStyle({
      display: "flex",
      position: "relative",
      height: 120,
      maxWidth: 960,
      gap: 12,
      padding: 16,
      flexDirection: "column",
      alignItems: "start",
      justifyContent: "end",
      order: 3,
    });
    assert.deepEqual(style, {
      display: "flex",
      position: "relative",
      height: "120px",
      maxWidth: "960px",
      gap: "12px",
      padding: "16px",
      flexDirection: "column",
      alignItems: "flex-start",
      justifyContent: "flex-end",
      order: 3,
    });
  });

  it("passes through center/stretch/space-* alignment values", () => {
    const style = layoutToStyle({
      alignItems: "stretch",
      justifyContent: "space-between",
    });
    assert.equal(style.alignItems, "stretch");
    assert.equal(style.justifyContent, "space-between");
  });

  it("switches on flex when only a direction is given", () => {
    assert.equal(layoutToStyle({ flexDirection: "row" }).display, "flex");
    assert.equal(
      layoutToStyle({ display: "grid", flexDirection: "row" }).display,
      "grid",
    );
  });

  it("maps gridColumns onto a grid template", () => {
    const style = layoutToStyle({ gridColumns: 3 });
    assert.equal(style.display, "grid");
    assert.equal(style.gridTemplateColumns, "repeat(3, minmax(0, 1fr))");
  });

  it("drops non-finite numbers", () => {
    const style = layoutToStyle({
      width: Number.NaN,
      gap: Number.POSITIVE_INFINITY,
    });
    assert.deepEqual(style, {});
  });
});

describe("resolveDestination", () => {
  it("resolves relative paths against the source URL", () => {
    assert.equal(
      resolveDestination("/pricing", "https://example.com/home"),
      "https://example.com/pricing",
    );
    assert.equal(
      resolveDestination("about", "https://example.com/docs/"),
      "https://example.com/docs/about",
    );
    assert.equal(
      resolveDestination("#top", "https://example.com/page"),
      "https://example.com/page#top",
    );
  });

  it("keeps absolute http(s) URLs", () => {
    assert.equal(
      resolveDestination("http://other.test/x?y=1", "https://example.com"),
      "http://other.test/x?y=1",
    );
    assert.equal(resolveDestination("https://a.test/", undefined), "https://a.test/");
  });

  it("rejects non-http schemes", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:void(0)",
      "data:text/html,hi",
      "mailto:someone@example.com",
      "tel:+15550100",
      "file:///etc/passwd",
      "blob:https://example.com/abc",
    ]) {
      assert.equal(resolveDestination(bad, "https://example.com"), null, bad);
    }
  });

  it("returns null for empty, undefined, or unresolvable input", () => {
    assert.equal(resolveDestination(undefined, "https://example.com"), null);
    assert.equal(resolveDestination("   ", "https://example.com"), null);
    assert.equal(resolveDestination("/relative", undefined), null);
    assert.equal(resolveDestination("/relative", "not a url"), null);
  });
});

describe("safeCssColor", () => {
  it("accepts colour-like values", () => {
    for (const ok of [
      "#fff",
      "#00a8ff",
      "#00a8ff80",
      "rebeccapurple",
      "rgb(0, 168, 255)",
      "rgba(0 168 255 / 50%)",
      "hsl(200 100% 50%)",
      "oklch(70% 0.1 230)",
      "var(--accent)",
      "var(--accent, #00a8ff)",
      "color-mix(in srgb, var(--accent) 40%, black)",
    ]) {
      assert.equal(safeCssColor(ok, "fallback"), ok, ok);
    }
  });

  it("falls back for anything that is not a plain colour", () => {
    for (const bad of [
      "url(https://evil.test/pixel.png)",
      "red; background: url(x)",
      "expression(alert(1))",
      "linear-gradient(red, blue)",
      "",
      "   ",
      undefined,
    ]) {
      assert.equal(safeCssColor(bad, "fallback"), "fallback", String(bad));
    }
  });
});

describe("safeFontFamily", () => {
  it("accepts font stacks and var() tokens", () => {
    for (const ok of [
      "Inter, sans-serif",
      '"Helvetica Neue", Arial, sans-serif',
      "var(--font-body)",
      "var(--font-quantico), 'Arial Narrow', sans-serif",
    ]) {
      assert.equal(safeFontFamily(ok, "fallback"), ok, ok);
    }
  });

  it("falls back for functions, urls, and statements", () => {
    for (const bad of [
      "url(https://evil.test/font.woff)",
      "local(Foo)",
      "Inter; color: red",
      "expression(1)",
      "",
      undefined,
    ]) {
      assert.equal(safeFontFamily(bad, "fallback"), "fallback", String(bad));
    }
  });
});

describe("DEMO_SPEC (preview fixture)", () => {
  it("is a valid ReconstructionSpec against the backend validator", () => {
    const result = validateReconstructionSpec(DEMO_SPEC, {
      elementIds: DEMO_SPEC.nodes.flatMap((node) => node.sourceElementIds),
      connectionIds: DEMO_SPEC.interactions.flatMap(
        (interaction) => interaction.sourceConnectionIds,
      ),
      assetIds: ["asset_000000000000000000000000"],
      requireElementCoverage: true,
    });
    assert.equal(result.valid, true, result.valid ? "" : result.errors.join("\n"));
  });

  it("builds a single connected tree with no orphans", () => {
    const tree = buildSpecTree(DEMO_SPEC.nodes);
    assert.deepEqual(tree.orphanIds, []);
    assert.deepEqual(
      tree.roots.map((root) => root.node.id),
      ["node_header", "node_main", "node_footer"],
    );
    assert.ok(tree.byId.has(DEMO_HIGHLIGHT_NODE_ID));
    const group = tree.byId.get("node_hero_actions")!;
    assert.equal(group.children.length, 3);
    assert.ok(group.children.every((child) => child.node.component === "Button3D"));
    const carousel = tree.byId.get("node_tabs")!;
    assert.equal(carousel.children.length, 4);
  });
});
