"""Download the ER GLBs into assets/models/ and report any glTF extensions the loader must support."""
import json
import os
import struct
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

# The whole-room and exterior-building models are skipped: the scene builds its own interior.
SKIP_ROLES = {"room", "building"}
OUT = "assets/models"

rows = [r for r in json.load(open("assets/er-assets.json"))
        if r["ok"] and r["role"] not in SKIP_ROLES]

# Roles with more than one model get a numeric suffix so both variants survive.
counts = Counter(r["role"] for r in rows)
seen = Counter()
for r in rows:
    seen[r["role"]] += 1
    r["file"] = (f'{r["role"]}_{seen[r["role"]]}.glb'
                 if counts[r["role"]] > 1 else f'{r["role"]}.glb')

os.makedirs(OUT, exist_ok=True)


def gltf_json(blob):
    """Pull the JSON chunk out of a binary glTF container."""
    magic, _, _ = struct.unpack_from("<4sII", blob, 0)
    assert magic == b"glTF", "not a GLB"
    length, kind = struct.unpack_from("<II", blob, 12)
    assert kind == 0x4E4F534A, "first chunk is not JSON"
    return json.loads(blob[20:20 + length])


def fetch(r):
    path = os.path.join(OUT, r["file"])
    req = urllib.request.Request(r["glb"], headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        blob = resp.read()
    with open(path, "wb") as fh:
        fh.write(blob)
    g = gltf_json(blob)
    r["used"] = g.get("extensionsUsed", [])
    r["required"] = g.get("extensionsRequired", [])
    r["kb"] = len(blob) // 1024
    return r


with ThreadPoolExecutor(10) as pool:
    rows = list(pool.map(fetch, rows))

json.dump(rows, open("assets/er-assets.json", "w"), indent=1)

for r in sorted(rows, key=lambda x: x["file"]):
    extra = ""
    if r["required"]:
        extra = "  REQUIRES: " + ", ".join(r["required"])
    elif r["used"]:
        extra = "  uses: " + ", ".join(r["used"])
    print(f'{r["file"]:22} {r["kb"]:5} kB  {r["license"]:5}{extra}')

print("\ntotal", sum(r["kb"] for r in rows) // 1024, "MB")
allreq = sorted({e for r in rows for e in r["required"]})
print("extensions required across all models:", allreq or "none")
