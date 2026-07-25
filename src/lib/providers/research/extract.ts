// Readable-content extraction from raw HTML using cheerio.
// A lightweight, dependency-light readability heuristic: drop boilerplate
// (script/style/nav/footer/aside), then keep the densest text container.

import * as cheerio from "cheerio";
import { normalizeWs } from "@/lib/util";

const DROP = [
  "script",
  "style",
  "noscript",
  "svg",
  "nav",
  "footer",
  "header",
  "aside",
  "form",
  "iframe",
  "template",
  "[role=navigation]",
  "[aria-hidden=true]",
];

export interface Extracted {
  title: string;
  text: string;
  links: string[];
}

export function extractReadable(html: string, baseUrl: string): Extracted {
  const $ = cheerio.load(html);

  const title =
    normalizeWs($("meta[property='og:title']").attr("content") || "") ||
    normalizeWs($("title").first().text()) ||
    normalizeWs($("h1").first().text()) ||
    baseUrl;

  // Collect links before we strip boilerplate (nav links can still be useful
  // for "follow relevant links", but we prefer in-content ones — grab all,
  // dedup, resolve to absolute).
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const abs = new URL(href, baseUrl).toString();
      if (abs.startsWith("http")) links.push(abs.split("#")[0]);
    } catch {
      /* ignore malformed */
    }
  });

  for (const sel of DROP) $(sel).remove();

  // Prefer semantic main/article containers; else fall back to <body>.
  const candidates = ["article", "main", "[role=main]", "#content", ".content", "body"];
  let best = "";
  for (const sel of candidates) {
    const node = $(sel).first();
    if (node.length) {
      const t = blockText($, node);
      if (t.length > best.length) best = t;
    }
  }
  if (!best) best = blockText($, $("body"));

  return {
    title,
    text: best.slice(0, 20_000), // cap to keep model/rule work bounded
    links: dedup(links).slice(0, 60),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function blockText($: cheerio.CheerioAPI, node: cheerio.Cheerio<any>): string {
  const parts: string[] = [];
  node.find("h1,h2,h3,h4,li,p,td,th,dd,dt,blockquote").each((_, el) => {
    const t = normalizeWs($(el).text());
    if (t.length >= 2) parts.push(t);
  });
  if (parts.length === 0) return normalizeWs(node.text());
  return parts.join("\n");
}

function dedup(arr: string[]): string[] {
  return Array.from(new Set(arr));
}
