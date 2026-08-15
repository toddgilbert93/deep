import { parse } from "acorn";
import type { AnyNode as AcornNode } from "acorn";
import { simple as walkSimple } from "acorn-walk";
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";

import type { CollectedScript, WebpageSource } from "./fetch-webpage-source";

const DEFAULT_MAX_ELEMENTS = 400;
const DEFAULT_MAX_TEXT_LENGTH = 300;
const DEFAULT_MAX_JAVASCRIPT_BYTES = 500_000;

const CANDIDATE_SELECTOR = [
  "body",
  "header",
  "nav",
  "main",
  "aside",
  "footer",
  "section",
  "article",
  "form",
  "fieldset",
  "legend",
  "dialog",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "li",
  "label",
  "a[href]",
  "button",
  "input:not([type='hidden'])",
  "textarea",
  "select",
  "summary",
  "details",
  "img[alt]",
  "table",
  "[role]",
  "[aria-label]",
  "[aria-labelledby]",
  "[aria-controls]",
  "[tabindex]",
  "[contenteditable]",
  "[onclick]",
  "[onchange]",
  "[onsubmit]",
].join(",");

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);

const STRUCTURAL_ROLES = new Set([
  "article",
  "banner",
  "complementary",
  "contentinfo",
  "dialog",
  "document",
  "form",
  "heading",
  "main",
  "navigation",
  "region",
  "table",
]);

export interface ParseWebpageUiOptions {
  maxElements?: number;
  maxTextLength?: number;
  maxJavaScriptBytes?: number;
}

export interface UiElementState {
  disabled?: boolean;
  required?: boolean;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  pressed?: boolean;
  hidden?: boolean;
}

export interface UiElement {
  id: string;
  kind: "interactive" | "structure" | "content";
  tag: string;
  role: string;
  name?: string;
  text?: string;
  selector: string;
  parentId?: string;
  attributes?: Record<string, string>;
  state?: UiElementState;
  assetId?: string;
}

export interface UiImageAssetSource {
  url: string;
  finalUrl: string;
  cacheHit: boolean;
}

export interface UiImageAsset {
  id: string;
  sha256: string;
  mimeType: string;
  bytes: number;
  storageKey: string;
  metadataKey: string;
  sources: UiImageAssetSource[];
}

export interface UiConnection {
  id: string;
  type: string;
  sourceElementId: string;
  targetElementId?: string;
  event?: string;
  destination?: string;
  confidence: "high" | "medium";
  evidence: {
    source: "dom" | "javascript";
    detail: string;
  };
}

export interface ParsedWebpageUi {
  page: {
    url: string;
    title: string;
    language?: string;
    visibleText?: string;
  };
  elements: UiElement[];
  connections: UiConnection[];
  assets: {
    images: UiImageAsset[];
  };
  scripts: {
    discovered: number;
    analyzed: number;
    ignored: number;
    failed: number;
  };
  stats: {
    sourceElements: number;
    relevantElements: number;
    connections: number;
    imageAssets: number;
    imageBytes: number;
    estimatedTokens: number;
  };
  warnings: string[];
}

interface NormalizedParseOptions {
  maxElements: number;
  maxTextLength: number;
  maxJavaScriptBytes: number;
}

interface ScriptAnalysisResult {
  connections: Omit<UiConnection, "id">[];
  analyzed: number;
  ignored: number;
  warnings: string[];
}

export function parseWebpageUi(
  source: WebpageSource,
  options: ParseWebpageUiOptions = {},
): ParsedWebpageUi {
  const settings = normalizeOptions(options);
  const $ = cheerio.load(source.rawHtml);
  const warnings: string[] = [];
  const sourceElementCount = $("*").length;
  const allCandidates = $(CANDIDATE_SELECTOR)
    .toArray()
    .filter((node): node is Element => node.type === "tag")
    .filter((node) => !isStaticallyHidden($, node))
    .filter((node) => isMeaningfulCandidate($, node));
  const candidates = allCandidates.slice(0, settings.maxElements);

  if (allCandidates.length > settings.maxElements) {
    warnings.push(
      `Relevant element limit reached: kept ${settings.maxElements} of ${allCandidates.length}.`,
    );
  }

  const candidateIds = new Map<AnyNode, string>();
  const domIds = new Map<string, Element>();
  $("[id]").each((_index, node) => {
    if (node.type === "tag") {
      const id = $(node).attr("id")?.trim();
      if (id && !domIds.has(id)) {
        domIds.set(id, node);
      }
    }
  });

  candidates.forEach((node, index) => {
    const domId = $(node).attr("id")?.trim();
    const stablePart = domId ? sanitizeId(domId) : String(index + 1).padStart(4, "0");
    candidateIds.set(node, `el_${stablePart}`);
  });

  const elements = candidates.map((node): UiElement => {
    const element = $(node);
    const role = inferRole(element);
    const text = getElementText(element, settings.maxTextLength);
    const name = getAccessibleName($, node, domIds, settings.maxTextLength);
    const attributes = getRelevantAttributes(element);
    const state = getElementState(element);
    const parentId = findParentCandidateId($, node, candidateIds);

    return compactObject({
      id: candidateIds.get(node)!,
      kind: inferKind(role),
      tag: node.tagName.toLowerCase(),
      role,
      name,
      text: text && text !== name ? text : undefined,
      selector: buildSelector($, node),
      parentId,
      attributes: Object.keys(attributes).length ? attributes : undefined,
      state: Object.keys(state).length ? state : undefined,
    });
  });

  const domConnections = buildDomConnections(
    $,
    candidates,
    candidateIds,
    domIds,
  );
  const javascript = analyzeJavaScript(
    $,
    source.scripts,
    candidateIds,
    settings.maxJavaScriptBytes,
  );
  warnings.push(...javascript.warnings);

  const connections = deduplicateConnections([
    ...domConnections,
    ...javascript.connections,
  ]).map((connection, index) => ({
    id: `rel_${String(index + 1).padStart(4, "0")}`,
    ...connection,
  }));

  const failedScripts = source.scripts.filter((script) => script.error).length;
  if (failedScripts) {
    warnings.push(`${failedScripts} script(s) could not be downloaded.`);
  }

  const result: ParsedWebpageUi = {
    page: compactObject({
      url: source.finalUrl,
      title: source.title,
      language: source.language,
      visibleText: truncate(source.visibleText, 2_000) || undefined,
    }),
    elements,
    connections,
    assets: { images: [] },
    scripts: {
      discovered: source.scripts.length,
      analyzed: javascript.analyzed,
      ignored: javascript.ignored,
      failed: failedScripts,
    },
    stats: {
      sourceElements: sourceElementCount,
      relevantElements: elements.length,
      connections: connections.length,
      imageAssets: 0,
      imageBytes: 0,
      estimatedTokens: 0,
    },
    warnings,
  };

  result.stats.estimatedTokens = Math.ceil(
    Buffer.byteLength(JSON.stringify(result)) / 4,
  );
  return result;
}

function normalizeOptions(options: ParseWebpageUiOptions): NormalizedParseOptions {
  return {
    maxElements: options.maxElements ?? DEFAULT_MAX_ELEMENTS,
    maxTextLength: options.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH,
    maxJavaScriptBytes:
      options.maxJavaScriptBytes ?? DEFAULT_MAX_JAVASCRIPT_BYTES,
  };
}

function isMeaningfulCandidate($: CheerioAPI, node: Element): boolean {
  const element = $(node);
  const tag = node.tagName.toLowerCase();
  const role = inferRole(element);
  if (tag === "body" || INTERACTIVE_ROLES.has(role) || STRUCTURAL_ROLES.has(role)) {
    return true;
  }
  if (
    element.is(
      "label, input, textarea, select, summary, details, img[alt], [aria-controls], [onclick], [onchange], [onsubmit]",
    )
  ) {
    return true;
  }
  return getElementText(element, 1).length > 0;
}

function isStaticallyHidden($: CheerioAPI, node: Element): boolean {
  return $(node)
    .parents()
    .addBack()
    .toArray()
    .some((ancestor) => {
      if (ancestor.type !== "tag") {
        return false;
      }
      const element = $(ancestor);
      const style = element.attr("style")?.toLowerCase().replace(/\s/g, "") ?? "";
      return (
        element.is("[hidden]") ||
        element.attr("aria-hidden")?.toLowerCase() === "true" ||
        style.includes("display:none") ||
        style.includes("visibility:hidden")
      );
    });
}

function inferRole(element: ReturnType<CheerioAPI>): string {
  const explicitRole = element.attr("role")?.trim().toLowerCase();
  if (explicitRole) {
    return explicitRole;
  }

  const tag = element.prop("tagName")?.toLowerCase() ?? "unknown";
  const inputType = element.attr("type")?.toLowerCase() ?? "text";
  const roles: Record<string, string> = {
    a: element.attr("href") ? "link" : "generic",
    article: "article",
    aside: "complementary",
    body: "document",
    button: "button",
    dialog: "dialog",
    footer: "contentinfo",
    form: "form",
    header: "banner",
    img: "img",
    main: "main",
    nav: "navigation",
    section: element.attr("aria-label") || element.attr("aria-labelledby") ? "region" : "section",
    select: "combobox",
    table: "table",
    textarea: "textbox",
  };

  if (tag === "input") {
    const inputRoles: Record<string, string> = {
      button: "button",
      checkbox: "checkbox",
      email: "textbox",
      number: "spinbutton",
      radio: "radio",
      range: "slider",
      reset: "button",
      search: "searchbox",
      submit: "button",
      tel: "textbox",
      text: "textbox",
      url: "textbox",
    };
    return inputRoles[inputType] ?? "input";
  }
  if (/^h[1-6]$/.test(tag)) {
    return "heading";
  }
  return roles[tag] ?? tag;
}

function inferKind(role: string): UiElement["kind"] {
  if (INTERACTIVE_ROLES.has(role)) {
    return "interactive";
  }
  if (STRUCTURAL_ROLES.has(role) || role === "section") {
    return "structure";
  }
  return "content";
}

function getAccessibleName(
  $: CheerioAPI,
  node: Element,
  domIds: Map<string, Element>,
  maxLength: number,
): string | undefined {
  const element = $(node);
  const ariaLabel = normalizeText(element.attr("aria-label") ?? "");
  if (ariaLabel) {
    return truncate(ariaLabel, maxLength);
  }

  const labelledBy = element.attr("aria-labelledby")?.trim().split(/\s+/) ?? [];
  const labelledText = normalizeText(
    labelledBy
      .map((id) => domIds.get(id))
      .filter((target): target is Element => Boolean(target))
      .map((target) => $(target).text())
      .join(" "),
  );
  if (labelledText) {
    return truncate(labelledText, maxLength);
  }

  const domId = element.attr("id")?.trim();
  if (domId) {
    const label = $("label")
      .toArray()
      .find(
        (candidate) =>
          candidate.type === "tag" && $(candidate).attr("for") === domId,
      );
    const labelText = label ? normalizeText($(label).text()) : "";
    if (labelText) {
      return truncate(labelText, maxLength);
    }
  }

  const wrappingLabel = element.closest("label");
  const wrappingLabelText = normalizeText(wrappingLabel.text());
  if (wrappingLabelText) {
    return truncate(wrappingLabelText, maxLength);
  }

  const tag = node.tagName.toLowerCase();
  const attributeName =
    (tag === "img" ? element.attr("alt") : undefined) ??
    (["button", "input"].includes(tag) ? element.attr("value") : undefined) ??
    element.attr("title") ??
    element.attr("placeholder");
  if (normalizeText(attributeName ?? "")) {
    return truncate(normalizeText(attributeName ?? ""), maxLength);
  }

  const text = getElementText(element, maxLength);
  return text || undefined;
}

function getElementText(
  element: ReturnType<CheerioAPI>,
  maxLength: number,
): string {
  const clone = element.clone();
  clone.find("script, style, noscript, template").remove();
  return truncate(normalizeText(clone.text()), maxLength);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function getRelevantAttributes(
  element: ReturnType<CheerioAPI>,
): Record<string, string> {
  const names = [
    "type",
    "name",
    "href",
    "target",
    "rel",
    "action",
    "method",
    "placeholder",
    "src",
    "srcset",
    "data-src",
    "sizes",
    "width",
    "height",
    "loading",
    "decoding",
    "autocomplete",
    "inputmode",
    "for",
    "aria-controls",
    "aria-describedby",
    "aria-live",
    "data-target",
    "data-bs-target",
  ];
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = element.attr(name)?.trim();
      return value ? [[name, truncate(value, 300)]] : [];
    }),
  );
}

function getElementState(element: ReturnType<CheerioAPI>): UiElementState {
  return compactObject({
    disabled: element.is("[disabled]") || undefined,
    required: element.is("[required]") || undefined,
    checked:
      element.is("[checked]") || element.attr("aria-checked") === "true" || undefined,
    selected:
      element.is("[selected]") || element.attr("aria-selected") === "true" || undefined,
    expanded:
      element.attr("aria-expanded") === undefined
        ? undefined
        : element.attr("aria-expanded") === "true",
    pressed:
      element.attr("aria-pressed") === undefined
        ? undefined
        : element.attr("aria-pressed") === "true",
    hidden: element.is("[hidden]") || undefined,
  });
}

function findParentCandidateId(
  $: CheerioAPI,
  node: Element,
  candidateIds: Map<AnyNode, string>,
): string | undefined {
  let parent = $(node).parent().get(0);
  while (parent) {
    const id = candidateIds.get(parent);
    if (id) {
      return id;
    }
    parent = $(parent).parent().get(0);
  }
  return undefined;
}

function buildSelector($: CheerioAPI, node: Element): string {
  const domId = $(node).attr("id")?.trim();
  if (domId) {
    return `[id="${escapeAttribute(domId)}"]`;
  }

  const segments: string[] = [];
  let current: Element | undefined = node;
  while (current && segments.length < 6) {
    const tag = current.tagName.toLowerCase();
    const siblings = $(current).parent().children(tag).toArray();
    const position = siblings.indexOf(current) + 1;
    segments.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${position})` : tag);
    if (tag === "body") {
      break;
    }
    const parent: AnyNode | undefined = $(current).parent().get(0);
    current = parent?.type === "tag" ? parent : undefined;
  }
  return segments.join(" > ");
}

function escapeAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sanitizeId(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
  return sanitized || "unnamed";
}

function buildDomConnections(
  $: CheerioAPI,
  candidates: Element[],
  candidateIds: Map<AnyNode, string>,
  domIds: Map<string, Element>,
): Omit<UiConnection, "id">[] {
  const connections: Omit<UiConnection, "id">[] = [];
  const targetIdForDomId = (domId: string): string | undefined => {
    const target = domIds.get(domId);
    return target ? candidateIds.get(target) : undefined;
  };

  for (const node of candidates) {
    const element = $(node);
    const sourceElementId = candidateIds.get(node)!;
    const parentElementId = findParentCandidateId($, node, candidateIds);
    if (parentElementId) {
      connections.push({
        type: "contains",
        sourceElementId: parentElementId,
        targetElementId: sourceElementId,
        confidence: "high",
        evidence: { source: "dom", detail: "DOM ancestry" },
      });
    }

    const labelFor = element.attr("for")?.trim();
    if (node.tagName.toLowerCase() === "label" && labelFor) {
      const targetElementId = targetIdForDomId(labelFor);
      if (targetElementId) {
        connections.push({
          type: "labels",
          sourceElementId,
          targetElementId,
          confidence: "high",
          evidence: { source: "dom", detail: `for=${JSON.stringify(labelFor)}` },
        });
      }
    }

    for (const [attribute, type] of [
      ["aria-controls", "controls"],
      ["aria-describedby", "described-by"],
      ["data-target", "controls"],
      ["data-bs-target", "controls"],
    ] as const) {
      const rawTargets = element.attr(attribute)?.trim();
      if (!rawTargets) {
        continue;
      }
      for (const rawTarget of rawTargets.split(/\s+/)) {
        const domId = rawTarget.replace(/^#/, "");
        const targetElementId = targetIdForDomId(domId);
        if (targetElementId) {
          connections.push({
            type,
            sourceElementId,
            targetElementId,
            confidence: "high",
            evidence: {
              source: "dom",
              detail: `${attribute}=${JSON.stringify(rawTarget)}`,
            },
          });
        }
      }
    }

    const href = element.attr("href")?.trim();
    if (href) {
      connections.push({
        type: "navigates",
        sourceElementId,
        destination: resolveDestination(href, $.root().find("base").attr("href")),
        confidence: "high",
        evidence: { source: "dom", detail: `href=${JSON.stringify(href)}` },
      });
    }

    const tag = node.tagName.toLowerCase();
    const inputType = element.attr("type")?.toLowerCase();
    if (
      tag === "button" ||
      (tag === "input" && ["submit", "image"].includes(inputType ?? ""))
    ) {
      const formDomId = element.attr("form")?.trim();
      const form = formDomId ? domIds.get(formDomId) : element.closest("form").get(0);
      const targetElementId = form ? candidateIds.get(form) : undefined;
      if (targetElementId && inputType !== "button" && inputType !== "reset") {
        connections.push({
          type: "submits",
          sourceElementId,
          targetElementId,
          event: "click",
          confidence: "high",
          evidence: { source: "dom", detail: "HTML form submission behavior" },
        });
      }
    }

    if (tag === "form") {
      const action = element.attr("action")?.trim();
      if (action) {
        connections.push({
          type: "submits-to",
          sourceElementId,
          destination: action,
          event: "submit",
          confidence: "high",
          evidence: { source: "dom", detail: `action=${JSON.stringify(action)}` },
        });
      }
    }

    for (const attribute of ["onclick", "onchange", "onsubmit"] as const) {
      const handler = element.attr(attribute)?.trim();
      if (handler) {
        connections.push({
          type: "handles",
          sourceElementId,
          event: attribute.slice(2),
          confidence: "high",
          evidence: {
            source: "dom",
            detail: `${attribute}=${JSON.stringify(truncate(handler, 160))}`,
          },
        });
      }
    }
  }

  return connections;
}

function resolveDestination(value: string, baseHref: string | undefined): string {
  if (!baseHref) {
    return value;
  }
  try {
    return new URL(value, baseHref).href;
  } catch {
    return value;
  }
}

function analyzeJavaScript(
  $: CheerioAPI,
  scripts: CollectedScript[],
  candidateIds: Map<AnyNode, string>,
  maxBytes: number,
): ScriptAnalysisResult {
  const result: ScriptAnalysisResult = {
    connections: [],
    analyzed: 0,
    ignored: 0,
    warnings: [],
  };
  let analyzedBytes = 0;

  for (const script of scripts) {
    if (!script.content || script.error || shouldIgnoreScript(script)) {
      result.ignored += 1;
      continue;
    }
    const bytes = Buffer.byteLength(script.content);
    if (analyzedBytes + bytes > maxBytes) {
      result.ignored += 1;
      continue;
    }

    let ast: AcornNode;
    try {
      ast = parse(script.content, {
        ecmaVersion: "latest",
        sourceType: "module",
        allowHashBang: true,
      });
    } catch {
      try {
        ast = parse(script.content, {
          ecmaVersion: "latest",
          sourceType: "script",
          allowHashBang: true,
        });
      } catch {
        result.ignored += 1;
        result.warnings.push(
          `Could not statically parse ${script.sourceUrl ?? "an inline script"}.`,
        );
        continue;
      }
    }

    analyzedBytes += bytes;
    result.analyzed += 1;
    const variables = collectSelectorVariables(ast);
    const scriptLabel = script.sourceUrl ?? "inline script";

    walkSimple(ast, {
      CallExpression(node) {
        const member = getMemberCall(node);
        if (!member || member.property !== "addEventListener") {
          return;
        }
        const selector = selectorFromExpression(member.object, variables);
        const event = getLiteralString(node.arguments[0]);
        if (!selector || !event) {
          return;
        }

        const sourceElementIds = findCandidateIds($, selector, candidateIds);
        for (const sourceElementId of sourceElementIds) {
          result.connections.push({
            type: "handles",
            sourceElementId,
            event,
            confidence: "medium",
            evidence: {
              source: "javascript",
              detail: `${scriptLabel}: addEventListener(${JSON.stringify(event)})`,
            },
          });
        }

        const handler = node.arguments[1];
        if (!handler || handler.type === "SpreadElement") {
          return;
        }
        walkSimple(handler, {
          CallExpression(innerNode) {
            const calleeName = getCalleeName(innerNode);
            const destination = getLiteralString(innerNode.arguments[0]);
            if (calleeName === "fetch" && destination) {
              for (const sourceElementId of sourceElementIds) {
                result.connections.push({
                  type: "requests",
                  sourceElementId,
                  event,
                  destination,
                  confidence: "medium",
                  evidence: {
                    source: "javascript",
                    detail: `${scriptLabel}: fetch(${JSON.stringify(destination)})`,
                  },
                });
              }
            }
          },
        });
      },
    });
  }

  if (analyzedBytes >= maxBytes) {
    result.warnings.push(
      `JavaScript analysis reached its ${maxBytes}-byte budget.`,
    );
  }
  return result;
}

function shouldIgnoreScript(script: CollectedScript): boolean {
  const source = script.sourceUrl?.toLowerCase() ?? "";
  if (
    /(node_modules|react-dom|next-devtools|turbopack|hmr-client|polyfill)/.test(
      source,
    )
  ) {
    return true;
  }

  const prefix = script.content?.slice(0, 2_000) ?? "";
  return /(__next_f|__webpack|turbopack|react-refresh)/i.test(prefix);
}

function collectSelectorVariables(ast: AcornNode): Map<string, string> {
  const variables = new Map<string, string>();
  walkSimple(ast, {
    VariableDeclarator(node) {
      if (node.id.type !== "Identifier" || !node.init) {
        return;
      }
      const selector = selectorFromExpression(node.init, variables);
      if (selector) {
        variables.set(node.id.name, selector);
      }
    },
  });
  return variables;
}

function selectorFromExpression(
  node: AcornNode,
  variables: Map<string, string>,
): string | undefined {
  if (node.type === "Identifier") {
    return variables.get(node.name);
  }
  if (node.type !== "CallExpression") {
    return undefined;
  }
  const member = getMemberCall(node);
  if (!member) {
    return undefined;
  }
  const value = getLiteralString(node.arguments[0]);
  if (!value) {
    return undefined;
  }
  if (member.property === "getElementById") {
    return `[id="${escapeAttribute(value)}"]`;
  }
  if (["querySelector", "querySelectorAll"].includes(member.property)) {
    return value;
  }
  return undefined;
}

function getMemberCall(
  node: Extract<AcornNode, { type: "CallExpression" }>,
): { object: AcornNode; property: string } | undefined {
  if (node.callee.type !== "MemberExpression" || node.callee.computed) {
    return undefined;
  }
  if (node.callee.property.type !== "Identifier") {
    return undefined;
  }
  return {
    object: node.callee.object,
    property: node.callee.property.name,
  };
}

function getCalleeName(
  node: Extract<AcornNode, { type: "CallExpression" }>,
): string | undefined {
  return node.callee.type === "Identifier" ? node.callee.name : undefined;
}

function getLiteralString(node: AcornNode | undefined): string | undefined {
  return node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : undefined;
}

function findCandidateIds(
  $: CheerioAPI,
  selector: string,
  candidateIds: Map<AnyNode, string>,
): string[] {
  try {
    return $(selector)
      .toArray()
      .flatMap((node) => {
        const id = candidateIds.get(node);
        return id ? [id] : [];
      });
  } catch {
    return [];
  }
}

function deduplicateConnections(
  connections: Omit<UiConnection, "id">[],
): Omit<UiConnection, "id">[] {
  const seen = new Set<string>();
  return connections.filter((connection) => {
    const key = JSON.stringify([
      connection.type,
      connection.sourceElementId,
      connection.targetElementId,
      connection.event,
      connection.destination,
    ]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function compactObject<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as T;
}
