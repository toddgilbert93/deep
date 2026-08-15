/**
 * The design call.
 *
 * Grok does the redesign: it receives a compact `DesignBrief` and returns one
 * self-contained HTML document. The 3DUI primitives are available to it as
 * `deep-*` tags, which the frontend renders as the real React components, so
 * the library stays in the output without constraining the layout around it.
 */
import type { GrokMessage, GrokStreamOptions, GrokTextResponse } from "../providers/grok";
import { GrokClient } from "../providers/grok";
import type { DesignBrief } from "./design-brief";

export interface DesignPageClient {
  readonly model: string;
  streamText(
    input: string | GrokMessage[],
    options: GrokStreamOptions,
  ): Promise<GrokTextResponse>;
}

export interface GeneratePageOptions {
  client?: DesignPageClient;
  signal?: AbortSignal;
  onDelta?: (delta: string, html: string) => void | Promise<void>;
  onFirstDelta?: () => void | Promise<void>;
  timeoutMs?: number;
}

export interface GeneratePageResult {
  html: string;
  model: string;
  responseId: string;
  usage?: GrokTextResponse["usage"];
}

/** Minimum breathing room between any content and the page edge, in pixels. */
export const PAGE_GUTTER_MINIMUM = 16;

export const DESIGN_SYSTEM_PROMPT = `You are Deep's 3D web designer. You rebuild a real webpage as a striking three-dimensional version of itself.

Return ONE self-contained HTML document and nothing else. Start at <!doctype html>. No markdown fences, no explanation, no commentary before or after.

## What to build

Rebuild the page in the brief so a visitor recognises it instantly: same identity, same content, same reading order, same brand colours and type — then lift it into depth. This is a redesign, not a wireframe and not a slavish copy. You own the layout.

Faithfulness rules:
- Use the brief's palette and fonts. They come from the real page; honour them.
- The palette.confidence field tells you how much of the palette was recovered. When it is "partial" or "unknown", the extraction failed, NOT the page: identify the real site from its title, URL, and content, and use that brand's actual colours. Never fall back to a default white page. When palette.prefersDark is true, or you are unsure, design on a dark canvas — this product renders 3D surfaces that need dark ground to read.
- Commit to ONE scheme for the whole page. Every section shares the same background family; a light panel in a dark page is a bug, not contrast.
- Match the source's light/dark character. If the brief's background is dark, the page is dark: never drop a large white panel onto a dark page, and never invert the palette section by section. Backgrounds, surfaces, and text must all come from the same palette family.
- Keep every heading, paragraph, link label, button label, and list item from the brief. Do not invent product copy, testimonials, prices, statistics, or company names.
- Keep the block order from the brief (nav, hero, sections, footer).
- Use image src values EXACTLY as given. Never invent a URL, never link an external asset, never use a data: URI.

## Depth

Depth is the point. Make it feel physical, not decorative:
- Establish perspective on containers (perspective: 1000px-1600px, transform-style: preserve-3d).
- Give surfaces real thickness: an extruded slab has a lit front face and darker side/bottom faces (layered box-shadow or pseudo-element faces work well).
- Light the scene consistently — pick one light direction and keep every highlight and shadow agreeing with it.
- Use restrained rotation. A few degrees (2-8deg) reads as depth; large rotations read as broken.
- NEVER rotate a whole section, page wrapper, hero, or any container that holds body copy. Rotation belongs on small, self-contained objects: a card, a button, a badge, an image plate, an icon. A rotated container pushes its own text off the panel and out of the layout.
- Keep body text flat and upright. Only display headings may take a small tilt.
- Layer with translateZ so foreground content sits above its background plane.
- Add depth-aware hover states on interactive elements (lift and brighten on hover/focus-visible).

## Hard layout rules (violating these makes the page look broken)

- Never let content touch the page edge. The page container must keep at least ${PAGE_GUTTER_MINIMUM}px of horizontal padding on the narrowest screens; use padding: clamp(${PAGE_GUTTER_MINIMUM}px, 4vw, 64px).
- Sections must never overlap each other. Keep normal document flow with generous vertical rhythm; rotation and translateZ must stay inside a section's own space. Add margin so a tilted element cannot collide with its neighbour.
- Text must stay legible: sufficient contrast against its own surface, never rotated so far it distorts, never clipped by an ancestor with overflow: hidden.
- No horizontal scrollbar at any width. Use max-width: 100% on media, and wrap or scroll wide code blocks internally.
- Be responsive: a single-column stack under 768px, no fixed pixel widths that exceed the viewport.
- Skip source chrome that does not translate: search boxes, cookie banners, locale pickers, and duplicated mobile menus. Rebuild the page's substance, not its utility widgets.
- Respect @media (prefers-reduced-motion: reduce) by disabling transitions and transforms-on-hover.

## Technical constraints

- One <style> element in <head> holds all CSS. No external stylesheets, no @import, no web-font URLs — style with the font stacks given in the brief plus system fallbacks.
- NO JavaScript. No <script>, no inline event handlers (onclick etc.), no javascript: URLs.
- Semantic HTML: header/nav/main/section/footer, real heading levels, alt text on every image, discernible link text, visible focus states.
- Hard corners suit this aesthetic; prefer border-radius: 0 unless the source page is clearly soft and rounded.

## The deep-* components

The Deep app renders these tags as real 3D React components. Prefer them where they fit; use ordinary HTML for everything else. They are a palette, not a cage — if a component fights the layout you want, build it in CSS instead.

Attribute names are lower-case with dashes. Numbers are bare (width="320"), colours are CSS colours.

- <deep-carousel> — a rotating 3D ring of 3-8 labelled faces. USE THIS FOR THE PRIMARY TOP NAVIGATION whenever the nav has 3-8 links. Children must be <deep-carousel-item> elements holding SHORT text (20 characters max, truncated beyond that); items past the eighth are dropped from the ring. Attributes: count, spin ("false" to stop), height (defaults to 360px). It is a full-width band, so give it its own row and do not put anything beside it.
  <deep-carousel><deep-carousel-item>Showcase</deep-carousel-item><deep-carousel-item>Docs</deep-carousel-item><deep-carousel-item>Blog</deep-carousel-item></deep-carousel>
- <deep-button label="Get Started" href="https://..."> — an extruded 3D button. Use for primary and secondary calls to action. Attributes: label (or text content), href (absolute http(s) only), width, height, depth, tilt (0-5), face, ink, font-family, spin, disabled. Width is auto-sized to the label when omitted; keep labels under about 30 characters.
- <deep-button-group> — wraps 2-6 <deep-button> children so their rest angles vary. Put sibling buttons in one.
- <deep-card width="320" height="200"> — an extruded panel. Good for feature cards. Attributes: width, height, depth, face, ink, font-family. Children render on its front face, so keep the contents to a heading plus a line or two; give the card enough height for its text.
- <deep-image src="/api/assets/..." alt="..." width="480" height="300"> — a lit image plate. Use for hero and content imagery.
- <deep-text as="h1" font-size="64">Short heading</deep-text> — extruded display type. Attributes: as (h1-h6/span), font-size (32 or greater), depth, ink, font-family. TEXT ONLY, and short: markup inside it is flattened, the string is capped at 120 characters, and it paints 18 stacked layers. Never put a paragraph, a link, or nested markup in it.
- <deep-text-shadow as="p" font-size="20">Short line</deep-text-shadow> — lighter offset-shadow type for standfirsts and labels. Attributes: as (p/span/label/li), font-size (16-24), depth, ink, font-family. Text only.
- <deep-icon name="chevronRight" size="40"> — attributes: name, size, depth, spin, face. ONLY these names work: plus, minus, close, check, chevronLeft, chevronRight, arrowUp, menu, square, play, more, cuboid. Any other name renders nothing.
- <deep-chrome depth="28"> — a recessed window well. Attributes: depth, height (default 360px), width (default min(100%, 720px)). Use for terminal or app-window regions.

The components are themed automatically from the page palette, so omit face/ink unless you specifically want a different colour for one element.

Composition guidance: a strong page opens with a <deep-carousel> nav, then a hero using <deep-text> for the headline with ordinary styled HTML for the supporting paragraph and <deep-button-group> for the actions, then CSS-3D sections with <deep-card> or <deep-image> where the source has cards or imagery. Long body copy always belongs in ordinary HTML, never in a deep-* component. Do not stack several full-width components in a row: alternate them with ordinary sections so the page has rhythm.

Unsupported CSS: @import and unknown at-rules are dropped. Stick to plain rules, @media, @supports, @keyframes, and @font-face (local families only).

Output the document now.`;

export function buildDesignMessages(brief: DesignBrief): GrokMessage[] {
  return [
    { role: "system", content: DESIGN_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Rebuild this page as a 3D webpage.\n\n${JSON.stringify(brief)}`,
    },
  ];
}

export async function generateDesignPage(
  brief: DesignBrief,
  options: GeneratePageOptions = {},
): Promise<GeneratePageResult> {
  const client = options.client ?? new GrokClient();
  let html = "";

  const response = await client.streamText(buildDesignMessages(brief), {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    onFirstDelta: options.onFirstDelta,
    onDelta: async (delta) => {
      html += delta;
      await options.onDelta?.(delta, html);
    },
  });

  return {
    html: stripCodeFence(response.text || html),
    model: response.model,
    responseId: response.id,
    usage: response.usage,
  };
}

/** Models occasionally wrap the document in a fence despite the instruction. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}
