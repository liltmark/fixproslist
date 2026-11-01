#!/usr/bin/env node
/*
 * generate-service-pages.js — FixProsList static Miami service page generator.
 *
 * WHY: the site's service pages live at /#/miami/<service> hash routes,
 * which Google does not index as separate pages (same problem the blog had).
 * This script renders one real static page per service at
 * miami/<service>/index.html (full content in raw HTML), mirroring exactly
 * what the SPA renders for #/miami/<service>: same H1, same intro, same
 * listing cards, same "other services" list — plus canonical/OG tags and
 * Service + LocalBusiness JSON-LD built ONLY from facts already in the
 * site's own data (SERVICES / LISTINGS in index.html). Nothing is invented:
 * no businesses, reviews, ratings or stats beyond what the site publishes.
 *
 * It also syncs the 8 Miami service URLs in sitemap.xml from the
 * #/miami/<slug> hash form to the real /miami/<slug>/ form (replace in
 * place, deduplicated — if a real URL is already present the hash entry
 * is dropped instead of duplicated). Other cities' hash URLs are untouched.
 *
 * The SPA itself is NOT modified: index.html is only read. The hash routes
 * keep working exactly as today; these static pages are an addition.
 *
 * RUN (from the repo root):  node tools/generate-service-pages.js
 * Run after any change to SERVICES/LISTINGS in index.html, before
 * committing — it writes miami/<slug>/index.html and sitemap.xml.
 *
 * No dependencies.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SITE = "https://fixproslist.com";
const TODAY = new Date().toISOString().slice(0, 10); // sitemap lastmod for converted entries
const CITY = { slug: "miami", name: "Miami", state: "FL", match: ["miami", "miami beach"] };

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

/* ---------- extract JS data literals from index.html ---------- */
// Same bracket-matching extractor as generate-blog-pages.js.
function extractVarSource(src, name) {
  const marker = "var " + name + " = ";
  const start = src.indexOf(marker);
  if (start < 0) throw new Error("var " + name + " not found in index.html");
  let i = start + marker.length;
  const first = src[i];
  if (first === "[" || first === "{") {
    const open = first, close = first === "[" ? "]" : "}";
    let depth = 0, inStr = null, esc = false;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === inStr) inStr = null;
      } else if (c === '"' || c === "'") inStr = c;
      else if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return src.slice(i, j + 1); }
    }
    throw new Error("unterminated literal for var " + name);
  }
  const end = src.indexOf(";", i);
  if (end < 0) throw new Error("unterminated scalar for var " + name);
  return src.slice(i, end);
}

const dataSrc = ["BRAND", "SERVICES", "ABOUT_BASE", "LISTINGS", "PHONE_SVG", "WEB_SVG"]
  .map((n) => "var " + n + " = " + extractVarSource(html, n) + ";")
  .join("\n");
const data = new Function(
  dataSrc + "\nreturn { BRAND, SERVICES, LISTINGS, PHONE_SVG, WEB_SVG };"
)();
const { SERVICES, LISTINGS, PHONE_SVG, WEB_SVG } = data;
const BRAND = data.BRAND;
// The SPA defaults every listing's website at runtime; mirror that default.
for (const l of LISTINGS) if (!l.website) l.website = "https://easytofix.homes";

function svc(slug) { for (const s of SERVICES) if (s.slug === slug) return s; return null; }
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function telHref(phone) { return "tel:+1" + String(phone).replace(/\D/g, ""); }
function telIntl(phone) { return "+1-" + String(phone).replace(/\D/g, "").replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3"); }

/* ---------- site chrome (style / header / footer) from index.html ---------- */
function sliceBetween(src, from, to) {
  const a = src.indexOf(from);
  if (a < 0) throw new Error("marker not found: " + from);
  const b = src.indexOf(to, a);
  if (b < 0) throw new Error("marker not found: " + to);
  return src.slice(a, b + to.length);
}
const styleBlock = sliceBetween(html, "<style>", "</style>");
const headerBlock = sliceBetween(html, '<header class="site">', "</header>");
const footerBlock = sliceBetween(html, '<footer class="site">', "</footer>");

/* ---------- link rewriting ---------- */
// Miami service links become the real static URLs; blog links become real
// URLs too; every other SPA hash route becomes a root-absolute hash URL so
// it still works from a static page; tel:/external links are untouched.
const SVC_SLUGS = SERVICES.map((s) => s.slug);
function rwLinks(s) {
  let out = s;
  for (const slug of SVC_SLUGS) {
    out = out.replace(new RegExp("href=(['\"])#/miami/" + slug + "\\1", "g"), 'href="/miami/' + slug + '/"');
  }
  return out
    .replace(/href=(['"])#\/blog\/([a-z0-9-]+)\/?\1/g, 'href="/blog/$2/"')
    .replace(/href=(['"])#\/blog\1/g, 'href="/blog/"')
    .replace(/href=(['"])#\//g, 'href="/#/')
    .replace(/href=(['"])#\1/g, 'href="/#"');
}
function rwChrome(s) {
  return rwLinks(s).replace(/href="partner\.html"/g, 'href="/partner.html"')
    .replace(/href="partner-rules\.html"/g, 'href="/partner-rules.html"');
}
const header = rwChrome(headerBlock);
const footer = rwChrome(footerBlock);

/* ---------- rendering (mirrors the SPA's cardHTML / groupHTML / city-service page) ---------- */
function websiteHTML(l) {
  if (!l.website) return "";
  if (l.tier === "advertised")
    return '<a class="webbtn" href="' + esc(l.website) + '" target="_blank" rel="sponsored nofollow noopener">' + WEB_SVG + " Visit Website</a>";
  return '<a class="weblink" href="' + esc(l.website) + '" target="_blank" rel="nofollow noopener">Visit Website ↗</a>';
}
// Same card as the SPA, except: full about text (the SPA truncates cards to
// 190 chars; the full text is the site's own, shown in full on its listing
// pages) and root-absolute links so they work from a static page.
function cardHTML(l) {
  const s = svc(l.service);
  const badge = l.tier === "advertised"
    ? '<span class="badge badge-sponsored">★ Sponsored</span>'
    : '<span class="badge badge-free">Published</span>';
  return '<article class="card' + (l.tier === "advertised" ? " ad" : "") + '">' +
    '<div class="top"><div class="avatar" aria-hidden="true">' + esc(l.business.charAt(0)) + "</div>" +
    '<div><h3><a href="/#/listing/' + l.id + '">' + esc(l.business) + "</a></h3>" +
    '<div class="svc">' + esc(s.name) + " · " + esc(l.city) + ", " + esc(l.state) + "</div></div>" +
    '<div class="badges">' + badge + "</div></div>" +
    '<div class="meta"><span>▸ ' + esc(l.area) + "</span><span>▸ " + esc(l.hours) + '</span><span class="badge badge-open">Open Now</span></div>' +
    '<p class="about">' + esc(l.about) + "</p>" +
    '<div class="actions"><a class="callbtn" href="' + telHref(l.phone) + '">' + PHONE_SVG + " Call " + esc(l.phone) + "</a>" +
    websiteHTML(l) +
    '<a class="viewbtn" href="/#/listing/' + l.id + '">View Listing</a></div></article>';
}
function emptyHTML(contextText) {
  return '<div class="empty"><h3>No pros listed here yet — be the first, it’s free</h3>' +
    "<p>" + esc(contextText) + "</p>" +
    '<a class="btn btn-accent" href="/#/add-your-business">Add Your Business — Free</a></div>';
}
function groupHTML(title, items, emptyCtx) {
  const h = '<div class="group-label"><h3>' + esc(title) + '</h3><div class="rule"></div></div>';
  if (!items.length) return h + emptyHTML(emptyCtx);
  return h + '<div class="cards">' + items.map(cardHTML).join("") + "</div>";
}

function headFor(title, desc, canonical, jsonLd) {
  return "<head>\n" +
    '<meta charset="utf-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n' +
    '<meta name="color-scheme" content="light dark" />\n' +
    '<meta name="description" content="' + esc(desc) + '" />\n' +
    '<link rel="canonical" href="' + canonical + '" />\n' +
    '<meta property="og:type" content="website" />\n' +
    '<meta property="og:site_name" content="' + esc(BRAND) + '" />\n' +
    '<meta property="og:title" content="' + esc(title) + '" />\n' +
    '<meta property="og:description" content="' + esc(desc) + '" />\n' +
    '<meta property="og:url" content="' + canonical + '" />\n' +
    '<meta name="twitter:card" content="summary" />\n' +
    '<meta name="twitter:title" content="' + esc(title) + '" />\n' +
    '<meta name="twitter:description" content="' + esc(desc) + '" />\n' +
    '<link rel="icon" href="data:," />\n' +
    "<title>" + esc(title) + "</title>\n" +
    '<link rel="preconnect" href="https://fonts.googleapis.com" />\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=Public+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet" />\n' +
    (jsonLd ? '<script type="application/ld+json">\n' + jsonLd + "\n</script>\n" : "") +
    styleBlock + "\n</head>";
}

function servicePage(s) {
  const canonical = SITE + "/miami/" + s.slug + "/";
  const inCity = LISTINGS.filter((l) =>
    l.service === s.slug && CITY.match.indexOf(l.city.toLowerCase()) !== -1);
  const ads = inCity.filter((l) => l.tier === "advertised");
  const free = inCity.filter((l) => l.tier !== "advertised");
  const pro = ads[0] || inCity[0] || null;

  const title = s.plural + " in Miami, FL | " + BRAND;
  const desc = "Need " + s.name.toLowerCase() + " help in Miami, FL? " + s.blurb +
    ". Compare local pros and call directly — no middleman, no advance payments." +
    (pro ? " Call " + pro.business + " at " + pro.phone + " — " + pro.hours.toLowerCase() + "." : "");

  const ldGraph = [];
  const svcLd = {
    "@type": "Service",
    "@id": canonical + "#service",
    name: s.plural + " in Miami, FL",
    serviceType: s.name,
    description: s.blurb,
    url: canonical,
    areaServed: { "@type": "City", name: "Miami", addressRegion: "FL", addressCountry: "US" },
  };
  if (pro) {
    svcLd.provider = {
      "@type": "LocalBusiness",
      name: pro.business,
      telephone: telIntl(pro.phone),
      url: pro.website,
    };
    ldGraph.push({
      "@type": "LocalBusiness",
      "@id": canonical + "#business",
      name: pro.business,
      description: pro.about,
      telephone: telIntl(pro.phone),
      url: pro.website,
      address: {
        "@type": "PostalAddress",
        addressLocality: pro.city,
        addressRegion: pro.state,
        addressCountry: "US",
      },
      areaServed: pro.area,
      openingHours: "Mo-Su 00:00-24:00",
    });
  }
  ldGraph.push(svcLd);
  const jsonLd = JSON.stringify({ "@context": "https://schema.org", "@graph": ldGraph }, null, 2);

  const others = SERVICES.filter((x) => x.slug !== s.slug).map((x) =>
    '<li><a href="/miami/' + x.slug + '/">' + esc(x.plural) + " in Miami, FL</a></li>").join("");
  const ctx = "There are no " + s.name.toLowerCase() + " pros listed in Miami yet. If that’s your trade, claim this page with a free listing.";

  const body =
    '<div class="wrap">\n' +
    '<div class="crumbs"><a href="/">Home</a> › <a href="/#/browse">Browse Pros</a> › ' + esc(s.plural) + " in Miami, FL</div>" +
    '<div class="page-head"><h1>' + esc(s.plural) + " in Miami, FL</h1>" +
    "<p>Need " + esc(s.name.toLowerCase()) + " help in Miami? Compare local pros below and call directly — no middleman, no advance payments. " + esc(s.blurb) + ".</p></div>" +
    '<section class="block" style="padding-top:24px">' +
      groupHTML("Advertised Pros — Sponsored", ads, ctx) +
      groupHTML("Published Listings — Free", free, ctx) +
      '<div class="cta-band" style="margin-top:36px"><div><h2>Do ' + esc(s.name.toLowerCase()) + " work in Miami?</h2>" +
      "<p>This page is where Miami homeowners look first. A Published listing is free — an Advertised listing puts you above everyone else here.</p></div>" +
      '<a class="btn btn-accent" href="/#/add-your-business">List Your Business Free</a></div>' +
      '<h3 style="margin:34px 0 10px;font-family:Archivo">Other services in Miami, FL</h3>' +
      '<ul style="columns:2;max-width:640px;line-height:2;padding-left:18px">' + others + "</ul>" +
    "</section>\n</div>";

  return "<!doctype html>\n<html lang=\"en\">\n" +
    headFor(title, desc, canonical, jsonLd) +
    "\n<body>\n" + header + "\n<main>\n" + body + "\n</main>\n" + footer + "\n</body>\n</html>\n";
}

/* ---------- write pages ---------- */
let written = 0;
for (const s of SERVICES) {
  const dir = path.join(ROOT, "miami", s.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), servicePage(s));
  written++;
}

/* ---------- sitemap sync (Miami services only; deduplicated) ---------- */
const smPath = path.join(ROOT, "sitemap.xml");
let sm = fs.readFileSync(smPath, "utf8");
// Which real Miami URLs already exist in the sitemap?
const realPresent = new Set();
{
  const re = /<loc>(https:\/\/fixproslist\.com\/miami\/[a-z0-9-]+\/)<\/loc>/g;
  let m;
  while ((m = re.exec(sm)) !== null) realPresent.add(m[1]);
}
let converted = 0, droppedDup = 0;
sm = sm.replace(/<url>[\s\S]*?<\/url>/g, (block) => {
  const locM = /<loc>([^<]+)<\/loc>/.exec(block);
  if (!locM) return block;
  const m = /^https:\/\/fixproslist\.com\/#\/miami\/([a-z0-9-]+)$/.exec(locM[1]);
  if (!m) return block;
  const real = SITE + "/miami/" + m[1] + "/";
  if (realPresent.has(real)) { droppedDup++; return ""; } // real URL already listed — drop the hash entry
  realPresent.add(real);
  converted++;
  return block.replace(locM[1], real)
    .replace(/<lastmod>[^<]*<\/lastmod>/, "<lastmod>" + TODAY + "</lastmod>");
});
// Any service whose hash entry was absent and whose real URL is still
// missing gets a fresh entry appended (checked first — no duplicates).
let added = 0;
const missing = SERVICES.map((s) => s.slug)
  .filter((slug) => !realPresent.has(SITE + "/miami/" + slug + "/"));
if (missing.length) {
  const blocks = missing.map((slug) =>
    "  <url>\n    <loc>" + SITE + "/miami/" + slug + "/</loc>\n    <lastmod>" + TODAY + "</lastmod>\n  </url>"
  ).join("\n");
  sm = sm.replace("</urlset>", blocks + "\n</urlset>");
  added = missing.length;
}
sm = sm.replace(/\n{3,}/g, "\n\n"); // tidy gaps left by dropped duplicates
fs.writeFileSync(smPath, sm);

console.log("Services in SERVICES array: " + SERVICES.length);
console.log("Static service pages written: " + written);
console.log("Sitemap Miami URLs: " + converted + " hash URLs converted, " +
  droppedDup + " duplicate hash entries dropped, " + added + " added");
