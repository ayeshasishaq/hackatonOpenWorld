"""Scrape poly.pizza search pages for ER-themed models and print name/author/license/GLB URL."""
import json
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

TERMS = [
    "hospital", "hospital bed", "wheelchair", "ambulance", "stethoscope",
    "medical", "doctor", "nurse", "first aid", "syringe", "crutches",
    "pills", "medicine", "bandage", "heart", "clipboard", "camp bed",
    "office chair", "reception desk", "trash can", "vending machine",
    "fire extinguisher", "curtain", "sign", "monitor", "oxygen",
]

UA = {"User-Agent": "Mozilla/5.0"}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def ids_for(term):
    html = get("https://poly.pizza/search/" + urllib.parse.quote(term))
    return set(re.findall(r"/m/([A-Za-z0-9_\-]+)", html))


def model(mid):
    try:
        html = get("https://poly.pizza/m/" + mid)
    except Exception:
        return None
    # The page is client-rendered; the server HTML still carries the h1 and license text.
    name = re.search(r"<h1[^>]*>([^<]*)</h1>", html)
    glb = re.search(r"https://static\.poly\.pizza/[a-z0-9\-]+\.glb", html)
    author = re.search(r'href="/u/([^"]+)"', html)
    if not (name and glb):
        return None
    lic = "CC0" if "Public Domain (CC0)" in html else (
        "CC-BY" if "Creative Commons Attribution" in html else "?")
    return {
        "id": mid,
        "name": name.group(1).strip(),
        "author": urllib.parse.unquote(author.group(1)) if author else "?",
        "license": lic,
        "glb": glb.group(0),
        "page": "https://poly.pizza/m/" + mid,
    }


with ThreadPoolExecutor(16) as pool:
    all_ids = set()
    for got in pool.map(lambda t: ids_for(t), TERMS):
        all_ids |= got
    print(f"{len(all_ids)} candidate models", file=sys.stderr)
    rows = [r for r in pool.map(model, sorted(all_ids)) if r]

rows.sort(key=lambda r: (r["license"] != "CC0", r["name"].lower()))
print(json.dumps(rows, indent=1))
