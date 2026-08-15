import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  attrFlag,
  attrNumber,
  attrString,
  cssLength,
  cssPropertyToReactKey,
  isAbsoluteHttpUrl,
  mapAttributes,
  readDeepAttrs,
  safeCssColor,
  safeFontFamily,
  safeSrcSet,
  safeUrl,
  styleToReactStyle,
  truncateLabel,
} from "../design-attrs";

describe("mapAttributes", () => {
  it("renames the common HTML attributes", () => {
    assert.deepEqual(mapAttributes({ class: "a b" }, "div"), { className: "a b" });
    assert.deepEqual(mapAttributes({ for: "x" }, "label"), { htmlFor: "x" });
    assert.deepEqual(mapAttributes({ colspan: "2" }, "td"), { colSpan: "2" });
    assert.deepEqual(mapAttributes({ tabindex: "0" }, "div"), { tabIndex: "0" });
  });

  it("renames SVG attributes from either spelling", () => {
    assert.deepEqual(mapAttributes({ "stroke-width": "2" }, "path"), {
      strokeWidth: "2",
    });
    assert.deepEqual(mapAttributes({ strokeWidth: "2" }, "path"), {
      strokeWidth: "2",
    });
    assert.deepEqual(mapAttributes({ viewbox: "0 0 10 10" }, "svg"), {
      viewBox: "0 0 10 10",
    });
  });

  it("passes aria-* and data-* through unchanged", () => {
    assert.deepEqual(
      mapAttributes({ "aria-label": "Menu", "data-x": "1" }, "nav"),
      { "aria-label": "Menu", "data-x": "1" },
    );
  });

  it("drops namespaced, event, and structural attributes", () => {
    assert.deepEqual(
      mapAttributes(
        {
          "xlink:href": "#a",
          onclick: "alert(1)",
          onClick: "alert(1)",
          style: "color:red",
          dangerouslySetInnerHTML: "x",
          xmlns: "http://www.w3.org/2000/svg",
        },
        "svg",
      ),
      {},
    );
  });

  it("keeps a plain lower-case attribute it does not know", () => {
    assert.deepEqual(mapAttributes({ role: "banner", d: "M0 0" }, "path"), {
      role: "banner",
      d: "M0 0",
    });
  });

  it("converts boolean props", () => {
    assert.deepEqual(mapAttributes({ disabled: "" }, "button"), {
      disabled: true,
    });
    assert.deepEqual(mapAttributes({ disabled: "false" }, "button"), {
      disabled: false,
    });
    assert.deepEqual(mapAttributes({ required: "required" }, "input"), {
      required: true,
    });
  });

  it("keeps form controls uncontrolled", () => {
    assert.deepEqual(mapAttributes({ value: "hi" }, "input"), {
      defaultValue: "hi",
    });
    assert.deepEqual(mapAttributes({ checked: "checked" }, "input"), {
      defaultChecked: true,
    });
    // Not a form control: `value` stays `value`.
    assert.deepEqual(mapAttributes({ value: "hi" }, "li"), { value: "hi" });
  });

  it("drops unsafe URLs and keeps safe ones", () => {
    assert.deepEqual(mapAttributes({ href: "javascript:alert(1)" }, "a"), {});
    assert.deepEqual(mapAttributes({ href: "https://x.test/a" }, "a"), {
      href: "https://x.test/a",
    });
    assert.deepEqual(mapAttributes({ src: "/api/assets/a1" }, "img"), {
      src: "/api/assets/a1",
    });
    assert.deepEqual(mapAttributes({ src: "//evil.test/a.png" }, "img"), {});
  });

  it("ignores malformed input", () => {
    assert.deepEqual(mapAttributes(undefined, "div"), {});
    assert.deepEqual(
      mapAttributes({ "": "x", "1bad": "x", "a b": "x" }, "div"),
      {},
    );
    assert.deepEqual(
      mapAttributes({ ok: 5 } as unknown as Record<string, string>, "div"),
      {},
    );
  });
});

describe("safeUrl", () => {
  it("accepts http(s), site-relative, fragment, and data:image", () => {
    assert.equal(safeUrl("https://x.test/a"), "https://x.test/a");
    assert.equal(safeUrl("  http://x.test  "), "http://x.test");
    assert.equal(safeUrl("/api/assets/a1"), "/api/assets/a1");
    assert.equal(safeUrl("#top"), "#top");
    assert.equal(safeUrl("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
  });

  it("rejects everything else", () => {
    assert.equal(safeUrl("javascript:alert(1)"), null);
    assert.equal(safeUrl("java\nscript:alert(1)"), null);
    assert.equal(safeUrl("vbscript:x"), null);
    assert.equal(safeUrl("//evil.test"), null);
    assert.equal(safeUrl("data:text/html,<script>"), null);
    assert.equal(safeUrl(""), null);
    assert.equal(safeUrl(undefined), null);
  });

  it("knows which URLs are absolute http(s)", () => {
    assert.equal(isAbsoluteHttpUrl("https://x.test"), true);
    assert.equal(isAbsoluteHttpUrl("/local"), false);
  });
});

describe("safeSrcSet", () => {
  it("keeps a valid candidate list", () => {
    assert.equal(safeSrcSet("/a.png 1x, /b.png 2x"), "/a.png 1x, /b.png 2x");
  });

  it("drops the whole list when a candidate is unsafe", () => {
    assert.equal(safeSrcSet("/a.png 1x, javascript:alert(1) 2x"), null);
  });
});

describe("styleToReactStyle", () => {
  it("camel-cases property names", () => {
    assert.deepEqual(
      styleToReactStyle({ "background-color": "red", margin: "0 auto" }),
      { backgroundColor: "red", margin: "0 auto" },
    );
  });

  it("keeps custom properties as written", () => {
    assert.deepEqual(styleToReactStyle({ "--ui3d-d": "12px" }), {
      "--ui3d-d": "12px",
    });
  });

  it("handles vendor prefixes the way React expects", () => {
    assert.equal(cssPropertyToReactKey("-webkit-mask-image"), "WebkitMaskImage");
    assert.equal(cssPropertyToReactKey("-ms-flex-align"), "msFlexAlign");
    assert.equal(cssPropertyToReactKey("grid-template-areas"), "gridTemplateAreas");
  });

  it("drops unsafe or malformed declarations", () => {
    assert.equal(
      styleToReactStyle({ background: "url(javascript:alert(1))" }),
      undefined,
    );
    assert.equal(styleToReactStyle({ color: "red; } body {" }), undefined);
    assert.equal(styleToReactStyle({ "": "red", color: "" }), undefined);
    assert.equal(styleToReactStyle(undefined), undefined);
  });

  it("keeps the safe half of a mixed bag", () => {
    assert.deepEqual(
      styleToReactStyle({ color: "red", background: "expression(x)" }),
      { color: "red" },
    );
  });
});

describe("deep attribute reading", () => {
  const attrs = readDeepAttrs({
    "font-family": "Quantico, sans-serif",
    fontSize: "48",
    SPIN: "false",
    label: "  Go deep  ",
    width: "not-a-number",
  });

  it("normalizes kebab, camel, and upper-case spellings", () => {
    assert.equal(attrString(attrs, "fontfamily"), "Quantico, sans-serif");
    assert.equal(attrNumber(attrs, "fontsize"), 48);
    assert.equal(attrFlag(attrs, "spin", true), false);
  });

  it("trims strings and rejects non-numbers", () => {
    assert.equal(attrString(attrs, "label"), "Go deep");
    assert.equal(attrNumber(attrs, "width"), undefined);
    assert.equal(attrString(attrs, "missing"), undefined);
  });

  it("clamps numbers to the given range", () => {
    const range = readDeepAttrs({ count: "42", depth: "-5" });
    assert.equal(attrNumber(range, "count", { min: 3, max: 8 }), 8);
    assert.equal(attrNumber(range, "depth", { min: 0 }), 0);
  });

  it("defaults flags when absent or unreadable", () => {
    assert.equal(attrFlag(readDeepAttrs({}), "spin", true), true);
    assert.equal(attrFlag(readDeepAttrs({ spin: "maybe" }), "spin", true), true);
  });
});

describe("value sanitizers", () => {
  it("accepts sane colours and rejects injections", () => {
    assert.equal(safeCssColor("#00a8ff"), "#00a8ff");
    assert.equal(safeCssColor("rgb(0 168 255 / 40%)"), "rgb(0 168 255 / 40%)");
    assert.equal(safeCssColor("var(--x)"), "var(--x)");
    assert.equal(safeCssColor("url(x)", "#fff"), "#fff");
    assert.equal(safeCssColor("red; } body {", "#fff"), "#fff");
    assert.equal(safeCssColor(42, "#fff"), "#fff");
  });

  it("accepts font stacks and rejects injections", () => {
    assert.equal(safeFontFamily('"Quantico", sans-serif'), '"Quantico", sans-serif');
    assert.equal(safeFontFamily("@import url(x)", undefined), undefined);
  });

  it("normalizes lengths", () => {
    assert.equal(cssLength("520", "360px"), "520px");
    assert.equal(cssLength("60vh", "360px"), "60vh");
    assert.equal(cssLength("calc(100% - 10px)", "360px"), "360px");
    assert.equal(cssLength(undefined, "360px"), "360px");
  });

  it("truncates labels on a collapsed single line", () => {
    assert.equal(truncateLabel("  Contact\n  sales  ", 20), "Contact sales");
    assert.equal(truncateLabel("Contact sales team today", 20), "Contact sales team…");
  });
});
