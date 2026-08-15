import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DESIGN_SCOPE_SELECTOR,
  scopeCss,
  scopeSelectorList,
  splitTopLevel,
} from "../scope-css";

const S = DESIGN_SCOPE_SELECTOR;

/** Collapses whitespace so assertions do not depend on formatting. */
function flat(css: string): string {
  return css.replace(/\s+/g, " ").trim();
}

describe("scopeCss", () => {
  it("returns an empty string for empty input", () => {
    assert.equal(scopeCss(""), "");
    assert.equal(scopeCss("   \n  "), "");
    assert.equal(scopeCss(undefined as unknown as string), "");
  });

  it("prefixes a plain selector", () => {
    assert.equal(flat(scopeCss(".hero { color: red; }")), `${S} .hero { color: red; }`);
  });

  it("scopes every selector in a comma list", () => {
    assert.equal(
      flat(scopeCss("h1, .card > p, a:hover { margin: 0 }")),
      `${S} h1, ${S} .card > p, ${S} a:hover { margin: 0 }`,
    );
  });

  it("does not split commas inside :is() or attribute selectors", () => {
    assert.equal(
      flat(scopeCss(':is(h1, h2) { margin: 0 }')),
      `${S} :is(h1, h2) { margin: 0 }`,
    );
    assert.equal(
      flat(scopeCss('[data-x="a,b"] { margin: 0 }')),
      `${S} [data-x="a,b"] { margin: 0 }`,
    );
  });

  it("maps html, body, and :root onto the scope element itself", () => {
    assert.equal(flat(scopeCss("body { background: #000 }")), `${S} { background: #000 }`);
    assert.equal(flat(scopeCss(":root { --x: 1px }")), `${S} { --x: 1px }`);
    assert.equal(flat(scopeCss("body .hero { color: red }")), `${S} .hero { color: red }`);
  });

  it("does not repeat the scope when html and body are listed together", () => {
    assert.equal(flat(scopeCss("html, body { color: red }")), `${S} { color: red }`);
  });

  it("keeps the @media prelude and scopes the rules inside it", () => {
    const out = flat(
      scopeCss("@media (min-width: 900px) { .panel { display: flex } body { color: red } }"),
    );
    assert.equal(
      out,
      `@media (min-width: 900px) { ${S} .panel { display: flex } ${S} { color: red } }`,
    );
  });

  it("scopes rules inside @supports", () => {
    const out = flat(scopeCss("@supports (display: grid) { .g { display: grid } }"));
    assert.equal(out, `@supports (display: grid) { ${S} .g { display: grid } }`);
  });

  it("leaves @keyframes bodies untouched", () => {
    const out = flat(scopeCss("@keyframes spin { from { opacity: 0 } to { opacity: 1 } }"));
    assert.equal(out, "@keyframes spin { from { opacity: 0 } to { opacity: 1 } }");
    assert.ok(!out.includes(`${S} from`));
  });

  it("leaves @font-face bodies untouched", () => {
    const out = flat(scopeCss('@font-face { font-family: "X"; src: local("X") }'));
    assert.equal(out, '@font-face { font-family: "X"; src: local("X") }');
  });

  it("drops @import statements", () => {
    const out = scopeCss('@import url("https://evil.example/x.css");\n.a { color: red }');
    assert.ok(!out.includes("@import"));
    assert.equal(flat(out), `${S} .a { color: red }`);
  });

  it("drops @import nested inside @media", () => {
    const out = scopeCss('@media screen { @import "x.css"; .a { color: red } }');
    assert.ok(!out.includes("@import"));
    assert.ok(out.includes(`${S} .a`));
  });

  it("drops unknown at-rules it cannot scope", () => {
    assert.equal(scopeCss("@unknown-thing { .a { color: red } }"), "");
  });

  it("strips comments, including ones containing braces", () => {
    const out = flat(scopeCss("/* a { b } */ .c { color: red }"));
    assert.equal(out, `${S} .c { color: red }`);
  });

  it("does not treat braces inside strings as blocks", () => {
    const out = flat(scopeCss('.a::after { content: "}" }'));
    assert.equal(out, `${S} .a::after { content: "}" }`);
  });

  it("survives truncated CSS from a partial stream", () => {
    // The half-received rule is still scoped; the browser ignores the
    // incomplete declaration inside it.
    const out = flat(scopeCss(".a { color: red } .b { color:"));
    assert.equal(out, `${S} .a { color: red } ${S} .b { color:}`);
    assert.equal(flat(scopeCss(".a { color: red } .b")), `${S} .a { color: red }`);
  });

  it("never emits a rule without the scope prefix", () => {
    const css = `
      .a, .b { color: red }
      @media print { .c { color: blue } }
      @keyframes k { from { opacity: 0 } }
    `;
    for (const line of scopeCss(css).split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "}" || trimmed.startsWith("@")) continue;
      assert.ok(
        trimmed.startsWith(S) || !trimmed.includes("{"),
        `unscoped rule: ${trimmed}`,
      );
    }
  });
});

describe("scopeSelectorList", () => {
  it("drops empty and brace-bearing selectors", () => {
    assert.equal(scopeSelectorList(" , .a , ", S), `${S} .a`);
    assert.equal(scopeSelectorList(".a}", S), "");
  });

  it("normalizes whitespace", () => {
    assert.equal(scopeSelectorList(".a    >   .b", S), `${S} .a > .b`);
  });
});

describe("splitTopLevel", () => {
  it("ignores separators inside parens, brackets, and strings", () => {
    assert.deepEqual(splitTopLevel("a,b", ","), ["a", "b"]);
    assert.deepEqual(splitTopLevel("f(a,b),c", ","), ["f(a,b)", "c"]);
    assert.deepEqual(splitTopLevel('[x=","],c', ","), ['[x=","]', "c"]);
  });
});
