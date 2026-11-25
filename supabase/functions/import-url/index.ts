// Lit une page web (Amazon, Wikipédia, Fnac, Babelio, éditeur…) et en extrait les infos d'un livre.
// Sert de proxy : le navigateur ne peut pas lire ces pages directement (CORS).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

const PRIVATE = /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[|metadata\b|.*\.(local|internal|lan)$)/i;

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, " ").trim();
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, " "));

function meta(html: string, names: string[]): string {
  for (const n of names) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${n}["'][^>]*content=["']([^"']*)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${n}["']`, "i");
    const m = html.match(re1) || html.match(re2);
    if (m && m[1].trim()) return decode(m[1]);
  }
  return "";
}

function cleanIsbn(s: string) { return (s || "").toUpperCase().replace(/[^0-9X]/g, ""); }
function validIsbn(c: string) {
  if (c.length === 13 && /^97[89]\d{10}$/.test(c)) { let s = 0; for (let i = 0; i < 12; i++) s += +c[i] * (i % 2 ? 3 : 1); return (10 - s % 10) % 10 === +c[12]; }
  if (c.length === 10 && /^\d{9}[\dX]$/.test(c)) { let s = 0; for (let i = 0; i < 9; i++) s += +c[i] * (10 - i); const k = (11 - s % 11) % 11; return (k === 10 ? "X" : String(k)) === c[9]; }
  return false;
}

// deno-lint-ignore no-explicit-any
function findBook(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => findBook(n, out)); return out; }
  const t = ([] as string[]).concat(node["@type"] || []).join(" ");
  if (/Book|Product|CreativeWork/i.test(t) || node.isbn) out.push(node);
  for (const k of ["@graph", "mainEntity", "workExample", "itemOffered"]) if (node[k]) findBook(node[k], out);
  return out;
}
// deno-lint-ignore no-explicit-any
const names = (v: any): string[] => ([] as any[]).concat(v || []).map((a) => typeof a === "string" ? a : a && a.name).filter(Boolean).map(String);
// deno-lint-ignore no-explicit-any
const img = (v: any): string => { const x = Array.isArray(v) ? v[0] : v; return typeof x === "string" ? x : (x && (x.url || x.contentUrl)) || ""; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST attendu" }, 405);
  let target: URL;
  try { const body = await req.json(); target = new URL(String(body.url || "").trim()); } catch { return json({ error: "Lien invalide" }, 400); }
  if (!/^https?:$/.test(target.protocol) || PRIVATE.test(target.hostname)) return json({ error: "Lien non autorisé" }, 400);

  const out: Record<string, unknown> = { url: target.href, site: target.hostname.replace(/^www\./, "") };

  // Wikipédia : l'API donne un résumé propre et l'image de l'infobox
  const wiki = target.hostname.match(/^([a-z]{2,3})(?:\.m)?\.wikipedia\.org$/);
  if (wiki && target.pathname.startsWith("/wiki/")) {
    try {
      const title = target.pathname.slice(6);
      const r = await fetch(`https://${wiki[1]}.wikipedia.org/api/rest_v1/page/summary/${title}`, { headers: { "User-Agent": "BibliothequeApp/1.0" } });
      if (r.ok) { const p = await r.json(); out.title = p.title; out.description = p.extract; out.cover = (p.originalimage || p.thumbnail || {}).source || ""; }
    } catch { /* on continue avec la page */ }
  }

  let html = "";
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(target.href, {
      signal: ctl.signal, redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml", "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6",
      },
    });
    clearTimeout(t);
    if (/^image\//i.test(r.headers.get("content-type") || "")) { try { await r.body?.cancel(); } catch { /* */ } return json({ ...out, cover: target.href.replace(/^http:/, "https:"), isImage: true }); }
    const reader = r.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    while (reader) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); size += value.length; if (size > 3_000_000) { reader.cancel(); break; } }
    const all = new Uint8Array(size); let off = 0; for (const c of chunks) { all.set(c.subarray(0, Math.min(c.length, size - off)), off); off += c.length; if (off >= size) break; }
    html = new TextDecoder().decode(all);
    out.status = r.status;
  } catch { out.blocked = true; }

  if (html) {
    if (/captcha|robot check|api-services-support@amazon/i.test(html) && html.length < 20000) out.blocked = true;
    // 1. Données structurées JSON-LD
    // deno-lint-ignore no-explicit-any
    let ld: any = null;
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try { const books = findBook(JSON.parse(m[1].trim())); const b = books.find((x) => /Book/i.test(String(x["@type"]))) || books[0]; if (b) { ld = b; if (/Book/i.test(String(b["@type"]))) break; } } catch { /* JSON invalide */ }
    }
    if (ld) {
      out.title ||= ld.name || ld.headline; out.authors = names(ld.author); out.isbn = ld.isbn || ld.gtin13 || "";
      out.cover ||= img(ld.image); out.description ||= ld.description ? strip(String(ld.description)) : "";
      out.publisher = names(ld.publisher)[0] || ""; out.year = String(ld.datePublished || "").slice(0, 4); out.pages = ld.numberOfPages || "";
    }
    // 2. Balises meta (OpenGraph, etc.)
    out.title ||= meta(html, ["og:title", "twitter:title"]) || strip((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || ["", ""])[1]);
    out.cover ||= meta(html, ["og:image", "og:image:secure_url", "twitter:image"]);
    out.description ||= meta(html, ["og:description", "description", "twitter:description"]);
    if (!(out.authors as string[] || []).length) { const a = meta(html, ["book:author", "author", "books:author"]); if (a && !/^https?:/.test(a)) out.authors = a.split(/,| et | and /).map((x) => x.trim()).filter(Boolean); }
    out.isbn ||= meta(html, ["book:isbn", "books:isbn", "isbn"]);
    // 3. Amazon : image haute définition et fiche produit
    const hi = html.match(/data-old-hires=["'](https:[^"']+)["']/) || html.match(/"hiRes":"(https:[^"]+)"/) || html.match(/id="(?:landingImage|imgBlkFront|ebooksImgBlkFront)"[^>]+src=["'](https:[^"']+)["']/);
    if (hi) out.cover = hi[1];
    if (!(out.authors as string[] || []).length) { const by = [...html.matchAll(/class="author[^"]*"[\s\S]{0,400}?<a[^>]*>([^<]{2,80})<\/a>/g)].map((m) => decode(m[1])); if (by.length) out.authors = [...new Set(by)].slice(0, 3); }
    // 4. ISBN cherché dans le texte de la page
    if (!validIsbn(cleanIsbn(String(out.isbn || "")))) {
      const text = strip(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")).slice(0, 400000);
      const cands = [...text.matchAll(/(?:ISBN|EAN|GTIN)(?:[-‑\s]?1[03])?\s*[:：]?\s*((?:97[89][-‑\s]?)?(?:\d[-‑\s]?){9}[\dX])/gi), ...text.matchAll(/\b(97[89](?:[-‑\s]?\d){10})\b/g)]
        .map((m) => cleanIsbn(m[1])).filter(validIsbn);
      out.isbn = cands.find((c) => c.length === 13) || cands[0] || "";
    } else out.isbn = cleanIsbn(String(out.isbn));
    if (!out.year) { const y = meta(html, ["book:release_date", "datePublished"]); if (y) out.year = y.slice(0, 4); }
  }
  // Nettoyage du titre (« … : Amazon.fr : Livres », « — Wikipédia »)
  if (typeof out.title === "string") out.title = out.title.replace(/\s*[:|–—-]\s*(Amazon\.[a-z.]+|Livres|Wikip[ée]dia|Fnac|Babelio|Decitre|Cultura)\b.*$/i, "").replace(/^Amazon\.[a-z.]+\s*:\s*/i, "").trim();
  if (typeof out.cover === "string" && !/^https:\/\//.test(out.cover)) out.cover = out.cover.startsWith("//") ? "https:" + out.cover : "";
  if (typeof out.description === "string") out.description = out.description.slice(0, 4000);
  return json(out);
});
