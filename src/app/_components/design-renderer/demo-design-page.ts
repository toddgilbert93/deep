/**
 * Hand-written `DesignPage` used by `/preview` to exercise the renderer without
 * a backend. It is deliberately written the way Grok is expected to write the
 * source HTML: lower-case `deep-*` tags, kebab-case attributes, plain HTML
 * around them, and one `<style>` block's worth of CSS in `page.css`.
 */

import {
  DESIGN_TREE_VERSION,
  type DesignElementNode,
  type DesignNode,
  type DesignPage,
} from "@/lib/reconstruction/design-tree";

function text(value: string): DesignNode {
  return { type: "text", value };
}

function el(
  id: string,
  tag: DesignElementNode["tag"],
  attrs: Record<string, string> = {},
  children: DesignNode[] = [],
  style?: Record<string, string>,
): DesignElementNode {
  return { type: "element", id, tag, attrs, style, children };
}

/** The node highlighted on `/preview`, to show the Phase 3 outline. */
export const DEMO_HIGHLIGHT_ID = "n_card";

const nav = el("n_nav", "nav", { "aria-label": "Primary" }, [
  el(
    "n_carousel",
    "deep-carousel",
    { count: "5", spin: "true", height: "480" },
    [
      el("n_nav_1", "deep-carousel-item", {}, [text("Overview")]),
      el("n_nav_2", "deep-carousel-item", {}, [text("Pricing")]),
      el("n_nav_3", "deep-carousel-item", {}, [text("Docs")]),
      el("n_nav_4", "deep-carousel-item", {}, [text("Changelog")]),
      el("n_nav_5", "deep-carousel-item", { label: "Contact sales" }, [
        text("Contact sales team today"),
      ]),
    ],
  ),
]);

const hero = el("n_hero", "header", { class: "hero" }, [
  el(
    "n_hero_title",
    "deep-text",
    { as: "h1", "font-size": "56", depth: "22", ink: "#e8dcc8" },
    [text("Depth by default")],
  ),
  el(
    "n_hero_sub",
    "deep-text-shadow",
    { as: "p", "font-size": "20", ink: "#9fb6c6" },
    [text("Every flat control from the source page, lofted into a box.")],
  ),
  el("n_hero_actions", "deep-button-group", {}, [
    el(
      "n_hero_cta",
      "deep-button",
      { label: "Go deep", href: "https://example.com/start", face: "#00a8ff", ink: "#04121c" },
      [],
    ),
    el("n_hero_docs", "deep-button", { label: "Read docs" }, []),
  ]),
]);

const feature = el("n_features", "section", { class: "panel" }, [
  el("n_features_head", "h2", {}, [text("What the renderer proves")]),
  el("n_card", "deep-card", { width: "320", height: "200", depth: "36" }, [
    el("n_card_text", "deep-text-shadow", { as: "span", "font-size": "18" }, [
      text("Cards keep their content and their shadow."),
    ]),
    el("n_card_icon", "deep-icon", { name: "cuboid", size: "44", depth: "14" }, []),
  ]),
  el("n_image", "deep-image", {
    src: "/api/assets/asset_000000000000000000000000",
    alt: "Cached source screenshot",
    width: "320",
    height: "200",
    depth: "10",
  }),
  el("n_unknown_icon", "deep-icon", { name: "not-a-real-glyph" }, []),
]);

const details = el("n_details", "section", { class: "panel" }, [
  el("n_details_head", "h2", {}, [text("Plain HTML still renders")]),
  el("n_list", "ul", {}, [
    el("n_list_1", "li", {}, [text("Scoped CSS cannot touch the Deep chrome.")]),
    el("n_list_2", "li", {}, [
      text("Links open in a new tab: "),
      el("n_link", "a", { href: "https://example.com" }, [text("example.com")]),
      text(" — relative links become inert text: "),
      el("n_link_rel", "a", { href: "/pricing" }, [text("/pricing")]),
    ]),
    el("n_list_3", "li", {}, [
      text("Forms are inert: "),
      el("n_form", "form", { action: "https://example.com/subscribe" }, [
        el("n_label", "label", { for: "demo-email" }, [text("Email")]),
        el("n_input", "input", {
          id: "demo-email",
          type: "email",
          value: "you@example.com",
          placeholder: "you@example.com",
        }),
        el("n_submit", "button", { type: "submit" }, [text("Subscribe")]),
      ]),
    ]),
  ]),
  el(
    "n_note",
    "p",
    { class: "note" },
    [text("Inline styles are converted to React style objects.")],
    { "background-color": "#10202c", "border-left": "3px solid #00a8ff", padding: "12px" },
  ),
]);

const chrome = el("n_chrome", "deep-chrome", { depth: "30", height: "300" }, [
  el("n_chrome_text", "deep-text-shadow", { as: "p" }, [
    text("Recessed window regions map to Chrome3D."),
  ]),
  el("n_chrome_actions", "deep-button-group", {}, [
    el("n_chrome_b1", "deep-button", { label: "Save", width: "140", height: "48" }, []),
    el("n_chrome_b2", "deep-button", { label: "Cancel", width: "140", height: "48" }, []),
    el("n_chrome_b3", "deep-button", { label: "Share", width: "140", height: "48" }, []),
  ]),
]);

const DEMO_CSS = `
/* Generated-page CSS. Every selector below is re-scoped at render time. */
@import url("https://fonts.example.com/evil.css");

html, body {
  background: #06121b;
  color: #e8dcc8;
  font-family: inherit;
}

.hero {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 0 40px;
}

.panel, nav {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 0;
  border-top: 1px solid rgb(0 168 255 / 35%);
}

h2 {
  margin: 0;
  font-size: 24px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

ul { margin: 0; padding-left: 1.2em; line-height: 1.7; }

a { color: #00a8ff; }

@media (min-width: 900px) {
  .panel {
    flex-direction: row;
    align-items: flex-start;
    flex-wrap: wrap;
  }
}

@keyframes demo-drift {
  from { opacity: 0.6; }
  to { opacity: 1; }
}
`;

export const DEMO_DESIGN_PAGE: DesignPage = {
  version: DESIGN_TREE_VERSION,
  theme: {
    background: "#0a0604",
    ink: "#e8dcc8",
    accent: "#00a8ff",
    surface: "#12161c",
    fontFamily: "var(--font-body, system-ui, sans-serif)",
    dark: true,
  },
  title: "Deep design renderer demo",
  css: DEMO_CSS,
  nodes: [nav, hero, feature, details, chrome],
  partial: false,
  stats: {
    elements: 33,
    components: {
      "deep-carousel": 1,
      "deep-carousel-item": 5,
      "deep-button": 5,
      "deep-button-group": 2,
      "deep-card": 1,
      "deep-image": 1,
      "deep-text": 1,
      "deep-text-shadow": 4,
      "deep-icon": 2,
      "deep-chrome": 1,
    },
    htmlBytes: DEMO_CSS.length,
  },
};
