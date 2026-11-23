#!/usr/bin/env python3
"""
generate_listing_pages.py — FixProsList per-listing SEO pages.

WHAT THIS DOES
  Reads every listing with status='live' from the FixProsList Supabase
  project and writes one static HTML page per listing to:

      listing/<business-name-city>.html   ->  https://fixproslist.com/listing/<slug>.html

  Each page carries a unique <title>, meta description, canonical URL,
  the listing's own keyword title as H1, its description, a call button
  using ONLY the phone number stored on that listing's record, and
  LocalBusiness JSON-LD limited to fields that exist in the record.

HOW TO REGENERATE (when new listings are approved / go live)
  1. From the repo root:   python3 tools/generate_listing_pages.py
     (add --test to build only a 5-listing sample, without sitemap changes)
  2. Review the diff:      git status
  3. Commit and push:      git add listing sitemap.xml
                           git commit -m "Listing pages: regenerate"
                           git push
  GitHub Pages deploys automatically. The script also refreshes
  sitemap.xml (existing entries are kept, new listing URLs appended)
  and removes listing/*.html files whose listings are no longer live.

  No dependencies beyond Python 3 stdlib. The Supabase publishable key
  below is the same public key already shipped in index.html; override
  with the FPL_SB_KEY environment variable if it ever rotates.
"""

import argparse
import html
import json
import os
import re
import sys
import urllib.request
from datetime import date

SUPABASE_URL = "https://xmfyeqeenadntdpszihx.supabase.co"
SB_KEY = os.environ.get(
    "FPL_SB_KEY", "sb_publishable_6TOXqypn-w_ZLl2plDnX4Q_ljYcbzj6"
)
SITE = "https://fixproslist.com"
TODAY = date.today().isoformat()

# Category slug -> human service label used in titles / headings.
SERVICE_LABEL = {
    "plumbing": "Plumbing",
    "electrical": "Electrical",
    "hvac": "HVAC",
    "roofing": "Roofing",
    "garage-doors": "Garage Door",
    "handyman": "Handyman",
    "appliances": "Appliance Repair",
    "painting": "Painting",
    "pest-control": "Pest Control",
    "flooring": "Flooring",
    "emergency": "Emergency Home Services",
}

PAGE_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="description" content="{meta_desc}" />
<link rel="canonical" href="{page_url}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="FixProsList" />
<meta property="og:title" content="{title}" />
<meta property="og:description" content="{meta_desc}" />
<meta property="og:url" content="{page_url}" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="{title}" />
<meta name="twitter:description" content="{meta_desc}" />
<link rel="icon" href="/favicon.ico" />
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=Public+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet" />
<script type="application/ld+json">
{json_ld}
</script>
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin:0; font-family:'Public Sans',system-ui,sans-serif; color:#1f2937; background:#fff; line-height:1.6; }}
  header.site {{ background:#123a66; padding:14px 20px; }}
  header.site a.brand {{ color:#fff; font-family:'Archivo',sans-serif; font-weight:800; font-size:22px; text-decoration:none; }}
  header.site a.brand span {{ color:#ffb287; }}
  main {{ max-width:860px; margin:0 auto; padding:28px 20px 48px; }}
  .crumb {{ font-size:14px; color:#6b7280; margin-bottom:10px; }}
  .crumb a {{ color:#123a66; }}
  h1 {{ font-family:'Archivo',sans-serif; font-weight:800; font-size:32px; line-height:1.2; color:#123a66; margin:0 0 8px; }}
  .bizname {{ font-size:20px; font-weight:700; margin:0 0 4px; }}
  .meta {{ color:#4b5563; margin:0 0 20px; }}
  .cta {{ display:inline-block; background:#d14f16; color:#fff; font-weight:700; font-size:18px;
          padding:14px 26px; border-radius:10px; text-decoration:none; margin:6px 0 22px; }}
  .cta:hover {{ background:#b23f10; }}
  .desc p {{ margin:0 0 14px; }}
  .card {{ background:#eef3f9; border:1px solid #c6d4e4; border-radius:12px; padding:18px 20px; margin:24px 0; }}
  .card h2 {{ font-family:'Archivo',sans-serif; font-size:20px; color:#123a66; margin:0 0 10px; }}
  .card ul {{ margin:0; padding-left:20px; }}
  h2.related {{ font-family:'Archivo',sans-serif; font-size:22px; color:#123a66; margin:34px 0 12px; }}
  ul.related {{ list-style:none; padding:0; margin:0; display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px; }}
  ul.related li {{ background:#f7f9fc; border:1px solid #e5e7eb; border-radius:10px; padding:12px 14px; }}
  ul.related a {{ color:#123a66; font-weight:600; text-decoration:none; }}
  ul.related a:hover {{ text-decoration:underline; }}
  footer.site {{ background:#123a66; color:#c6d4e4; padding:22px 20px; text-align:center; font-size:14px; }}
  footer.site a {{ color:#ffb287; }}
</style>
</head>
<body>
<header class="site"><a class="brand" href="{site}/">Fix<span>Pros</span>List</a></header>
<main>
  <p class="crumb"><a href="{site}/">Home</a> &rsaquo; {category_label} &rsaquo; {city}, {state}</p>
  <h1>{h1}</h1>
  <p class="bizname">{business_name}</p>
  <p class="meta">{service_label} &middot; {city}, {state}</p>
{call_button}
  <div class="desc">
{description_html}
  </div>
  <div class="card">
    <h2>About {business_name}</h2>
    <ul>
      <li><strong>Service:</strong> {service_label}</li>
      <li><strong>Location:</strong> {city}, {state}</li>
{phone_row}{website_row}
      <li><strong>Listed on:</strong> FixProsList</li>
    </ul>
  </div>
{related_html}
  <p><a href="{site}/">Browse more local pros on FixProsList &rarr;</a></p>
</main>
<footer class="site">&copy; FixProsList &middot; <a href="{site}/">fixproslist.com</a> &middot; Find local home-service pros and call them directly.</footer>
</body>
</html>
"""


def slugify(text):
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "listing"


def fetch_live_listings():
    url = (
        SUPABASE_URL
        + "/rest/v1/listings?status=eq.live"
        + "&select=id,business_name,title,category,city,state,phone,website,description,created_at"
        + "&order=created_at.asc"
    )
    # Prefer curl (some proxies mangle urllib's chunked reads); fall back to urllib.
    import shutil
    import subprocess

    if shutil.which("curl"):
        proc = subprocess.run(
            [
                "curl", "-sS", "--retry", "3", "--max-time", "90",
                "-H", "apikey: " + SB_KEY,
                "-H", "Authorization: Bearer " + SB_KEY,
                url,
            ],
            capture_output=True,
            text=True,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            return json.loads(proc.stdout)
        raise RuntimeError("curl fetch failed: " + proc.stderr.strip())
    req = urllib.request.Request(
        url,
        headers={"apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY},
    )
    last_err = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as err:  # transient network hiccups — retry
            last_err = err
    raise last_err


def tel_href(phone):
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    if phone and phone.strip().startswith("+") and digits:
        return "+" + digits
    return digits


def truncate_words(text, limit):
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut.rstrip(".,;:") + "…"


def build_pages(listings, repo_root):
    # Assign unique slugs.
    used_slugs = {}
    for lst in listings:
        base = slugify(lst["business_name"] + " " + (lst["city"] or ""))
        slug = base
        n = 2
        while slug in used_slugs:
            slug = "%s-%d" % (base, n)
            n += 1
        used_slugs[slug] = lst["id"]
        lst["_slug"] = slug
        lst["_url"] = "%s/listing/%s.html" % (SITE, slug)

    # Related: same category first, then same city, up to 6.
    by_cat = {}
    by_city = {}
    for lst in listings:
        by_cat.setdefault(lst["category"], []).append(lst)
        by_city.setdefault((lst["city"] or "").lower(), []).append(lst)
    for lst in listings:
        rel = []
        for cand in by_cat.get(lst["category"], []):
            if cand["id"] != lst["id"] and cand not in rel:
                rel.append(cand)
        for cand in by_city.get((lst["city"] or "").lower(), []):
            if cand["id"] != lst["id"] and cand not in rel:
                rel.append(cand)
        lst["_related"] = rel[:6]

    used_titles = set()
    pages = {}
    no_phone = []
    for lst in listings:
        name = (lst["business_name"] or "").strip()
        city = (lst["city"] or "").strip()
        state = (lst["state"] or "").strip()
        service = SERVICE_LABEL.get(lst["category"], (lst["category"] or "Home Services").replace("-", " ").title())
        cat_label = service
        title = "%s — %s in %s, %s | FixProsList" % (name, service, city, state)
        if title in used_titles:
            # Differentiate with the first distinctive word of the record's own title.
            diff = ""
            for word in re.findall(r"[A-Za-z]+", lst.get("title") or ""):
                if word.lower() not in title.lower():
                    diff = word
                    break
            title = "%s — %s %s in %s, %s | FixProsList" % (name, diff, service, city, state)
            if title in used_titles:
                title = title.replace(" | FixProsList", " (%s) | FixProsList" % lst["id"][:8])
        used_titles.add(title)

        desc = re.sub(r"\s+", " ", lst.get("description") or "").strip()
        snippet = truncate_words(desc, 105)
        meta = "%s Call %s — %s in %s, %s via FixProsList." % (
            (snippet + " ") if snippet else "",
            lst.get("phone") or "now",
            service,
            city,
            state,
        )
        meta = truncate_words(meta, 160)

        h1 = (lst.get("title") or "").strip() or "%s in %s, %s — %s" % (service, city, state, name)

        phone = (lst.get("phone") or "").strip()
        if phone:
            call_button = '  <a class="cta" href="tel:%s">📞 Call %s — %s</a>' % (
                tel_href(phone),
                html.escape(name),
                html.escape(phone),
            )
            phone_row = "      <li><strong>Phone:</strong> %s</li>\n" % html.escape(phone)
        else:
            call_button = ""
            phone_row = ""
            no_phone.append(name)

        website = (lst.get("website") or "").strip()
        website_row = ""
        if website:
            website_row = '      <li><strong>Website:</strong> <a href="%s" rel="nofollow noopener" target="_blank">%s</a></li>\n' % (
                html.escape(website, quote=True),
                html.escape(re.sub(r"^https?://", "", website).rstrip("/")),
            )

        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", desc) if p.strip()]
        if not paragraphs:
            paragraphs = [
                "%s is a %s provider serving %s, %s. Call through FixProsList to reach them directly."
                % (name, service.lower(), city, state)
            ]
        description_html = "\n".join("    <p>%s</p>" % html.escape(p) for p in paragraphs)

        if lst["_related"]:
            items = "\n".join(
                '      <li><a href="%s">%s</a><br /><small>%s · %s, %s</small></li>'
                % (
                    r["_url"],
                    html.escape(r["business_name"]),
                    html.escape(SERVICE_LABEL.get(r["category"], r["category"])),
                    html.escape(r["city"] or ""),
                    html.escape(r["state"] or ""),
                )
                for r in lst["_related"]
            )
            related_html = '  <h2 class="related">Related local pros</h2>\n  <ul class="related">\n%s\n  </ul>' % items
        else:
            related_html = ""

        ld = {
            "@context": "https://schema.org",
            "@type": "LocalBusiness",
            "name": name,
            "description": desc or "%s provider in %s, %s." % (service, city, state),
            "url": lst["_url"],
            "address": {
                "@type": "PostalAddress",
                "addressLocality": city,
                "addressRegion": state,
                "addressCountry": "US",
            },
            "areaServed": "%s, %s" % (city, state),
        }
        if phone:
            ld["telephone"] = phone
        if website:
            ld["sameAs"] = [website]
        json_ld = json.dumps(ld, indent=2, ensure_ascii=False)

        page = PAGE_TEMPLATE.format(
            site=SITE,
            title=html.escape(title, quote=True),
            meta_desc=html.escape(meta, quote=True),
            page_url=lst["_url"],
            json_ld=json_ld,
            category_label=html.escape(cat_label),
            city=html.escape(city),
            state=html.escape(state),
            h1=html.escape(h1),
            business_name=html.escape(name),
            service_label=html.escape(service),
            call_button=call_button,
            description_html=description_html,
            phone_row=phone_row,
            website_row=website_row,
            related_html=related_html,
        )
        pages[lst["_slug"]] = page
    return pages, no_phone


def update_sitemap(repo_root, new_urls):
    path = os.path.join(repo_root, "sitemap.xml")
    with open(path, encoding="utf-8") as fh:
        existing = fh.read()
    pairs = re.findall(r"<loc>([^<]+)</loc>\s*(?:<lastmod>([^<]+)</lastmod>)?", existing)
    seen = set()
    entries = []
    for loc, lastmod in pairs:
        if loc not in seen:
            seen.add(loc)
            entries.append((loc, lastmod or TODAY))
    added = 0
    for url in new_urls:
        if url not in seen:
            seen.add(url)
            entries.append((url, TODAY))
            added += 1
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, lastmod in entries:
        out.append("  <url>")
        out.append("    <loc>%s</loc>" % loc)
        out.append("    <lastmod>%s</lastmod>" % lastmod)
        out.append("  </url>")
    out.append("</urlset>")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")
    return len(entries), added


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true",
                    help="Build only a 5-listing sample (incl. Boulais Roofing); skip sitemap + cleanup.")
    args = ap.parse_args()

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    listings = fetch_live_listings()
    print("Live listings fetched: %d" % len(listings))

    if args.test:
        boulais = [l for l in listings if "boulais" in (l["business_name"] or "").lower()]
        sample = boulais[:1]
        seen_cats = {sample[0]["category"]} if sample else set()
        for lst in listings:
            if len(sample) >= 5:
                break
            if lst["category"] not in seen_cats and lst not in sample:
                sample.append(lst)
                seen_cats.add(lst["category"])
        for lst in listings:
            if len(sample) >= 5:
                break
            if lst not in sample:
                sample.append(lst)
        listings = sample
        print("TEST MODE: building %d sample pages" % len(listings))

    pages, no_phone = build_pages(listings, repo_root)
    out_dir = os.path.join(repo_root, "listing")
    os.makedirs(out_dir, exist_ok=True)
    for slug, page in pages.items():
        with open(os.path.join(out_dir, slug + ".html"), "w", encoding="utf-8") as fh:
            fh.write(page)
    print("Pages written: %d" % len(pages))
    if no_phone:
        print("Listings WITHOUT phone (page has no call button): %s" % ", ".join(no_phone))

    if not args.test:
        # Remove stale pages for listings no longer live.
        removed = 0
        for fname in os.listdir(out_dir):
            if fname.endswith(".html") and fname[:-5] not in pages:
                os.remove(os.path.join(out_dir, fname))
                removed += 1
        print("Stale pages removed: %d" % removed)
        urls = ["%s/listing/%s.html" % (SITE, s) for s in pages]
        total, added = update_sitemap(repo_root, urls)
        print("Sitemap: %d total entries, %d listing URLs newly added" % (total, added))

    for slug in pages:
        print("  %s/listing/%s.html" % (SITE, slug))


if __name__ == "__main__":
    main()
