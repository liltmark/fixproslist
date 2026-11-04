#!/usr/bin/env node
/*
 * generate-blog-pages.js — FixProsList static blog page generator.
 *
 * WHY: the site is a hash-routed SPA, so articles lived at /#/blog/<slug>,
 * which Google does not index as separate pages. This script renders every
 * article in the ARTICLES array of index.html to a real static page at
 * blog/<slug>/index.html (full content in raw HTML), plus a static blog
 * index at blog/index.html, and syncs the blog URLs in sitemap.xml from
 * the #/blog/ hash form to the real /blog/<slug>/ form.
 *
 * RUN (from the repo root):  node tools/generate-blog-pages.js
 * Run it after every change to the ARTICLES array in index.html
 * (the daily-articles cron should run it right after adding articles,
 * before committing — it writes blog/<slug>/index.html, blog/index.html
 * and sitemap.xml; index.html itself is NOT modified by this script).
 *
 * No dependencies. Content is taken verbatim from ARTICLES — nothing is
 * rewritten except internal links (hash routes -> real/absolute routes).
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SITE = "https://fixproslist.com";
const TODAY = new Date().toISOString().slice(0, 10); // sitemap lastmod for new entries

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

/* ---------- extract JS data literals from index.html ---------- */
// Find "var NAME = <value>" and return the value's source text, using
// bracket matching that respects strings, so nested literals parse safely.
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
  // string / scalar literal: up to the terminating semicolon
  const end = src.indexOf(";", i);
  if (end < 0) throw new Error("unterminated scalar for var " + name);
  return src.slice(i, end);
}

const dataSrc = ["BRAND", "SERVICES", "ABOUT_BASE", "LISTINGS", "ARTICLES", "PHONE_SVG"]
  .map((n) => "var " + n + " = " + extractVarSource(html, n) + ";")
  .join("\n");
const data = new Function(
  dataSrc + "\nreturn { BRAND, SERVICES, LISTINGS, ARTICLES, PHONE_SVG };"
)();
const { ARTICLES, SERVICES, LISTINGS, PHONE_SVG } = data;
const BRAND = data.BRAND;

function svc(slug) { for (const s of SERVICES) if (s.slug === slug) return s; return null; }
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function telHref(phone) { return "tel:+1" + String(phone).replace(/\D/g, ""); }

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
// Inside article bodies: blog cross-links become real URLs; other SPA
// hash routes become root-absolute hash URLs so they still work from a
// static page; tel:/external links are untouched.
function rwContent(s) {
  return s
    .replace(/href=(['"])#\/blog\/([a-z0-9-]+)\/?\1/g, 'href="/blog/$2/"')
    .replace(/href=(['"])#\/blog\1/g, 'href="/blog/"')
    .replace(/href=(['"])#\//g, 'href="/#/')
    .replace(/href=(['"])#\1/g, 'href="/#"');
}
// In header/footer chrome: same idea, plus relative .html pages -> root-absolute.
function rwChrome(s) {
  return rwContent(s).replace(/href="partner\.html"/g, 'href="/partner.html"')
    .replace(/href="partner-rules\.html"/g, 'href="/partner-rules.html"');
}
const header = rwChrome(headerBlock);
const footer = rwChrome(footerBlock);

/* ---------- rendering (mirrors the SPA's postCardHTML / renderArticle) ---------- */
function postCard(a) {
  return '<article class="post-card">' +
    '<div class="post-meta"><span class="cat">' + esc(a.category) + "</span><span>" + esc(a.date) + "</span><span>· " + a.minutes + ' min read</span></div>' +
    '<h3><a href="/blog/' + a.slug + '/">' + esc(a.title) + "</a></h3>" +
    "<p>" + esc(a.excerpt) + "</p>" +
    '<a class="read" href="/blog/' + a.slug + '/">Read the guide →</a></article>';
}

const MONTHS = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
function isoMonth(dateStr) {
  const m = /^([A-Za-z]+)\s+(\d{4})$/.exec(String(dateStr).trim());
  if (!m) return null;
  const mm = MONTHS[m[1].toLowerCase()];
  return mm ? m[2] + "-" + mm : null;
}

function headFor(title, desc, canonical, image, jsonLd) {
  return "<head>\n" +
    '<meta charset="utf-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n' +
    '<meta name="color-scheme" content="light dark" />\n' +
    '<meta name="description" content="' + esc(desc) + '" />\n' +
    '<link rel="canonical" href="' + canonical + '" />\n' +
    '<meta property="og:type" content="article" />\n' +
    '<meta property="og:site_name" content="' + esc(BRAND) + '" />\n' +
    '<meta property="og:title" content="' + esc(title) + '" />\n' +
    '<meta property="og:description" content="' + esc(desc) + '" />\n' +
    '<meta property="og:url" content="' + canonical + '" />\n' +
    (image ? '<meta property="og:image" content="' + image + '" />\n' : "") +
    '<meta name="twitter:card" content="summary_large_image" />\n' +
    '<meta name="twitter:title" content="' + esc(title) + '" />\n' +
    '<meta name="twitter:description" content="' + esc(desc) + '" />\n' +
    (image ? '<meta name="twitter:image" content="' + image + '" />\n' : "") +
    '<link rel="icon" href="data:," />\n' +
    "<title>" + esc(title) + "</title>\n" +
    '<link rel="preconnect" href="https://fonts.googleapis.com" />\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=Public+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet" />\n' +
    (jsonLd ? '<script type="application/ld+json">\n' + jsonLd + "\n</script>\n" : "") +
    styleBlock + "\n</head>";
}

function articlePage(a) {
  const s = svc(a.service) || { name: a.category, plural: a.category, slug: a.service };
  let pro = null;
  for (const l of LISTINGS) { if (l.service === a.service) { pro = l; break; } }
  const canonical = SITE + "/blog/" + a.slug + "/";
  const image = a.photo ? SITE + "/" + a.photo : null;
  const ld = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description: a.excerpt,
    mainEntityOfPage: canonical,
    author: { "@type": "Organization", name: BRAND, url: SITE + "/" },
    publisher: { "@type": "Organization", name: BRAND, url: SITE + "/" },
  };
  if (image) ld.image = image;
  const dm = isoMonth(a.date);
  if (dm) ld.datePublished = dm;

  const others = ARTICLES.filter((x) => x.slug !== a.slug);
  const body =
    '<div class="wrap">\n' +
    '<div class="crumbs"><a href="/">Home</a> › <a href="/blog/">Blog</a> › ' + esc(a.title) + "</div>" +
    '<article class="article-wrap" style="padding-bottom:8px">' +
      '<div class="post-meta" style="margin-top:26px"><span class="cat">' + esc(a.category) + "</span><span>" + esc(a.date) + "</span><span>· " + a.minutes + ' min read</span></div>' +
      "<h1>" + esc(a.title) + "</h1>" +
      (a.photo ? '<img class="article-photo-img" src="/' + a.photo + '" alt="' + esc(a.photoAlt || "") + '" loading="lazy">' : "") +
      '<div class="article-body">' + rwContent(a.body.join("")) + "</div>" +
      '<div class="cta-box"><h3>Need a ' + esc(String(s.name).toLowerCase()) + " pro?</h3>" +
      "<p>Reading only gets you so far. Talk to a reviewed local pro, get a written quote, and pay the business directly — this platform never takes advance payments.</p>" +
      '<div class="acts">' +
        (pro ? '<a class="callbtn" href="' + telHref(pro.phone) + '">' + PHONE_SVG + " Call " + esc(pro.phone) + "</a>" : "") +
        '<a class="seelink" href="/#/miami/' + s.slug + '">See ' + esc(s.plural) + " in Miami, FL →</a>" +
        '<a class="seelink" href="/#/browse">Browse all pros →</a>' +
      "</div></div>" +
    "</article>" +
    '<section class="block" style="padding-top:34px"><div class="sec-head"><div><h2>More from the blog</h2></div>' +
    '<a class="more" href="/blog/">All guides →</a></div>' +
    '<div class="blog-grid">' + others.map(postCard).join("") + "</div></section>\n</div>";

  return "<!doctype html>\n<html lang=\"en\">\n" +
    headFor(a.title + " | " + BRAND + " Blog", a.excerpt, canonical, image, JSON.stringify(ld, null, 2)) +
    "\n<body>\n" + header + "\n<main>\n" + body + "\n</main>\n" + footer + "\n</body>\n</html>\n";
}

function blogIndexPage() {
  const canonical = SITE + "/blog/";
  const desc = "Plain-English guides for homeowners: what home-service jobs cost and why, warning signs to watch for, and how to decide between repair and replacement.";
  const body =
    '<div class="wrap">\n' +
    '<div class="page-head"><h2>The FixProsList Blog</h2>' +
    "<p>Straight-talk guides for homeowners: what jobs really involve, what drives the price, and how to decide with confidence — written by the team behind the directory.</p></div>" +
    '<section class="block" style="padding-top:26px"><div class="blog-grid">' +
    ARTICLES.map(postCard).join("") +
    "</div></section>\n</div>";
  return "<!doctype html>\n<html lang=\"en\">\n" +
    headFor("Blog — Homeowner Guides | " + BRAND, desc, canonical, null, null) +
    "\n<body>\n" + header + "\n<main>\n" + body + "\n</main>\n" + footer + "\n</body>\n</html>\n";
}

/* ---------- write pages ---------- */
let written = 0;
for (const a of ARTICLES) {
  const dir = path.join(ROOT, "blog", a.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), articlePage(a));
  written++;
}
fs.writeFileSync(path.join(ROOT, "blog", "index.html"), blogIndexPage());

/* ---------- sitemap sync ---------- */
const smPath = path.join(ROOT, "sitemap.xml");
let sm = fs.readFileSync(smPath, "utf8");
let replaced = 0;
const presentSlugs = new Set();
sm = sm.replace(/<url>[\s\S]*?<\/url>/g, (block) => {
  const locM = /<loc>([^<]+)<\/loc>/.exec(block);
  if (!locM) return block;
  const loc = locM[1];
  if (loc === SITE + "/#/blog") {
    replaced++;
    return block.replace(loc, SITE + "/blog/")
      .replace(/<lastmod>[^<]*<\/lastmod>/, "<lastmod>" + TODAY + "</lastmod>");
  }
  const m2 = /^https:\/\/fixproslist\.com\/blog\/([a-z0-9-]+)\/$/.exec(loc);
  if (m2) { presentSlugs.add(m2[1]); return block; }
  const m = /^https:\/\/fixproslist\.com\/#\/blog\/([a-z0-9-]+)\/?$/.exec(loc);
  if (m) {
    replaced++;
    presentSlugs.add(m[1]);
    return block.replace(loc, SITE + "/blog/" + m[1] + "/")
      .replace(/<lastmod>[^<]*<\/lastmod>/, "<lastmod>" + TODAY + "</lastmod>");
  }
  return block;
});
let added = 0;
const missing = ARTICLES.map((a) => a.slug).filter((s) => !presentSlugs.has(s));
if (missing.length) {
  const blocks = missing.map((s) =>
    "  <url>\n    <loc>" + SITE + "/blog/" + s + "/</loc>\n    <lastmod>" + TODAY + "</lastmod>\n  </url>"
  ).join("\n");
  sm = sm.replace("</urlset>", blocks + "\n</urlset>");
  added = missing.length;
}
fs.writeFileSync(smPath, sm);

console.log("Articles in ARTICLES array: " + ARTICLES.length);
console.log("Static article pages written: " + written + " (+ blog/index.html)");
console.log("Sitemap blog URLs: " + replaced + " hash URLs replaced, " + added + " article URLs added");
