/**
 * Scopes a generated page's CSS so it can only ever style the rendered design
 * tree, never the Deep application chrome around it.
 *
 * Every selector is prefixed with `[data-design-root] `, which is put on the
 * element that wraps the tree. The function is a tiny CSS statement parser
 * rather than a regex, because selector lists, nested at-rules, strings, and
 * comments all have to be handled without mangling declaration values.
 *
 * Rules of the scoper:
 * - Selector lists are split on top-level commas and each part is scoped.
 * - `html`, `body`, and `:root` become the scope element itself, so page-level
 *   styling still lands somewhere instead of silently disappearing.
 * - `@media`, `@supports`, `@container`, `@layer`, `@scope`, and `@document`
 *   keep their prelude and have their inner rules scoped recursively.
 * - `@keyframes`, `@font-face`, `@page`, `@property`, and `@counter-style`
 *   bodies are emitted untouched — they contain no selectors to scope.
 * - Statements with no block (`@import url(...);`, `@charset ...;`) are
 *   dropped, so a generated page can never pull in a remote stylesheet.
 * - Any unknown at-rule with a block is dropped, because it cannot be scoped
 *   safely.
 * - Comments are stripped.
 *
 * DOM-free and pure, so it is unit tested directly.
 */

export const DESIGN_SCOPE_SELECTOR = "[data-design-root]";

/** At-rules whose block contains ordinary rules that must be scoped. */
const NESTED_AT_RULES: ReadonlySet<string> = new Set([
  "media",
  "supports",
  "container",
  "layer",
  "scope",
  "document",
]);

/** At-rules whose block contains no selectors and is emitted verbatim. */
const VERBATIM_AT_RULES: ReadonlySet<string> = new Set([
  "keyframes",
  "-webkit-keyframes",
  "-moz-keyframes",
  "font-face",
  "font-feature-values",
  "page",
  "property",
  "counter-style",
]);

const ROOT_SELECTORS: ReadonlySet<string> = new Set([
  "html",
  "body",
  ":root",
  "html body",
  ":root body",
]);

interface Statement {
  /** Everything before the block, or before the `;` for a bodyless rule. */
  prelude: string;
  /** Block contents, or `null` when the statement had no block. */
  body: string | null;
}

/**
 * Rewrites `css` so that every rule only applies inside `scope`.
 * Returns an empty string for empty or unparseable input.
 */
export function scopeCss(
  css: string,
  scope: string = DESIGN_SCOPE_SELECTOR,
): string {
  if (typeof css !== "string" || !css.trim()) return "";
  return scopeStatements(parseStatements(css), scope);
}

function scopeStatements(statements: readonly Statement[], scope: string): string {
  const out: string[] = [];

  for (const statement of statements) {
    const prelude = statement.prelude.trim();
    if (!prelude && statement.body === null) continue;
    // Belt and braces: never let an import survive, wherever it appears.
    if (/@import/i.test(prelude)) continue;
    if (statement.body === null) continue; // bodyless at-rules and stray text

    if (prelude.startsWith("@")) {
      const name = (/^@([a-zA-Z-]+)/.exec(prelude)?.[1] ?? "").toLowerCase();

      if (NESTED_AT_RULES.has(name)) {
        const inner = scopeStatements(parseStatements(statement.body), scope);
        if (inner) out.push(`${prelude} {\n${inner}\n}`);
        continue;
      }

      if (VERBATIM_AT_RULES.has(name)) {
        out.push(`${prelude} {${statement.body}}`);
        continue;
      }

      continue; // unknown at-rule: cannot be scoped safely
    }

    const selector = scopeSelectorList(prelude, scope);
    if (!selector) continue;
    out.push(`${selector} {${statement.body}}`);
  }

  return out.join("\n");
}

/** Splits a selector list on top-level commas and scopes each selector. */
export function scopeSelectorList(list: string, scope: string): string {
  const scoped: string[] = [];
  for (const part of splitTopLevel(list, ",")) {
    const selector = scopeSelector(part, scope);
    // `html, body { ... }` would otherwise collapse to the scope twice.
    if (selector && !scoped.includes(selector)) scoped.push(selector);
  }
  return scoped.join(", ");
}

function scopeSelector(rawSelector: string, scope: string): string {
  const selector = rawSelector.trim().replace(/\s+/g, " ");
  if (!selector) return "";
  if (selector.includes("{") || selector.includes("}")) return "";
  if (selector.startsWith("@")) return "";

  const lower = selector.toLowerCase();
  if (ROOT_SELECTORS.has(lower)) return scope;

  // `body .hero` / `html main` -> `[data-design-root] .hero`
  const rooted = selector.replace(/^(?:html|body|:root)\s+/i, "");
  if (!rooted) return scope;
  return `${scope} ${rooted}`;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

/** Splits on `separator`, ignoring separators inside (), [], and strings. */
export function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (char === "/" && input[index + 1] === "*") {
      index = skipComment(input, index);
      continue;
    }
    if (char === '"' || char === "'") {
      const end = skipString(input, index);
      current += input.slice(index, end);
      index = end;
      continue;
    }
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth = Math.max(0, depth - 1);

    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  parts.push(current);
  return parts;
}

function parseStatements(input: string): Statement[] {
  const statements: Statement[] = [];
  let prelude = "";
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (char === "/" && input[index + 1] === "*") {
      index = skipComment(input, index);
      continue;
    }
    if (char === '"' || char === "'") {
      const end = skipString(input, index);
      prelude += input.slice(index, end);
      index = end;
      continue;
    }
    if (char === "{") {
      const close = matchBrace(input, index);
      statements.push({ prelude, body: input.slice(index + 1, close) });
      prelude = "";
      index = close + 1;
      continue;
    }
    if (char === ";") {
      statements.push({ prelude, body: null });
      prelude = "";
      index += 1;
      continue;
    }
    if (char === "}") {
      // Stray close brace (truncated stream): drop what came before it.
      prelude = "";
      index += 1;
      continue;
    }

    prelude += char;
    index += 1;
  }

  if (prelude.trim()) statements.push({ prelude, body: null });
  return statements;
}

/** Index just past the end of a comment, or the end of input. */
function skipComment(input: string, start: number): number {
  const end = input.indexOf("*/", start + 2);
  return end === -1 ? input.length : end + 2;
}

/** Index just past the closing quote, or the end of input. */
function skipString(input: string, start: number): number {
  const quote = input[start];
  let index = start + 1;
  while (index < input.length) {
    const char = input[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    index += 1;
  }
  return input.length;
}

/** Index of the `}` matching the `{` at `start`, or the end of input. */
function matchBrace(input: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < input.length) {
    const char = input[index];
    if (char === "/" && input[index + 1] === "*") {
      index = skipComment(input, index);
      continue;
    }
    if (char === '"' || char === "'") {
      index = skipString(input, index);
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return input.length;
}
