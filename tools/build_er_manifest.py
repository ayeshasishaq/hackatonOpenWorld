"""Pick ER-relevant models out of the poly.pizza scrape, verify each GLB, write a manifest."""
import json
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

SRC = "/tmp/pp.json"

# (role, name, author) -- role is how the asset would be used in the ER scene
WANTED = [
    ("room",      "GRADD Hospital Room", "GRADD CO"),
    ("building",  "Hospital", "Poly by Google"),
    ("ambulance", "Ambulance", "Jarlan Perez"),
    ("wheelchair", "Wheelchair", "Poly by Google"),
    ("gurney", "Dentist chair V2", "li chang"),
    ("triage_cot", "camp bed", "Steve B"),
    ("triage_cot", "camp bed blue", "Steve B"),
    ("patient_bed", "Bed Single", "Quaternius"),
    ("patient_bed", "Bed", "CreativeTrio"),
    ("bedside_table", "Nightstand / Bedside Table", "Alex Safayan"),
    ("privacy_curtain", "Curtains Double", "Quaternius"),
    ("vitals_monitor", "Monitor", "Armory_3D"),
    ("vitals_monitor", "Monitor", "CreativeTrio"),
    ("waiting_chair", "Chair Rounded", "Kenney"),
    ("waiting_chair", "Lounge Design Chair", "Kenney"),
    ("desk_chair", "Desk Chair", "Kenney"),
    ("reception_bell", "Desk Bell", "Jarlan Perez"),
    ("hospital_sign", "Sign Hospital", "Kenney"),
    ("exit_sign", "Fire Exit Sign", "J-Toastie"),
    ("first_aid", "First Aid Kit", "Quaternius"),
    ("biohazard_bin", "Trashcan", "Kenney"),
    ("biohazard_bin", "Trash Bin", "CreativeTrio"),
    ("extinguisher", "Fire Extinguisher", "dook"),
    ("vending", "Vending Machine", "dook"),
    ("doctor", "Doctor", "jeremy"),
    ("stethoscope", "Stethoscope", "Poly by Google"),
    ("syringe", "Syringe", "J-Toastie"),
    ("crutches", "Crutches", "Poly by Google"),
    ("bandage", "Bandage", "Poly by Google"),
    ("pill_bottle", "Pill bottle", "Poly by Google"),
    ("door", "Door", "Quaternius"),
]

rows = json.load(open(SRC))
by_key = {}
for r in rows:
    by_key.setdefault((r["name"].lower(), r["author"].lower()), r)

picked, missing = [], []
for role, name, author in WANTED:
    r = by_key.get((name.lower(), author.lower()))
    if r:
        picked.append(dict(r, role=role))
    else:
        missing.append((role, name, author))


def check(r):
    req = urllib.request.Request(r["glb"], method="GET",
                                 headers={"Range": "bytes=0-11",
                                          "User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            head = resp.read(12)
            size = resp.headers.get("Content-Range", "").split("/")[-1]
            r["ok"] = head[:4] == b"glTF"
            r["bytes"] = int(size) if size.isdigit() else None
    except Exception as e:
        r["ok"] = False
        r["error"] = str(e)
    return r


with ThreadPoolExecutor(12) as pool:
    picked = list(pool.map(check, picked))

for role, name, author in missing:
    print(f"NOT FOUND in scrape: {role} <- {name} by {author}", file=sys.stderr)

json.dump(picked, open("assets/er-assets.json", "w"), indent=1)

lines = ["# Third-party asset attribution", "",
         "3D models loaded by this project, all free to use.",
         "CC0 models need no credit; CC-BY models must keep the credit below.", ""]
for lic in ("CC0", "CC-BY"):
    group = [r for r in picked if r["license"] == lic and r["ok"]]
    if not group:
        continue
    lines.append(f"## {lic}" + (" (attribution required)" if lic == "CC-BY" else ""))
    lines.append("")
    for r in sorted(group, key=lambda x: x["role"]):
        lines.append(f'- **{r["name"]}** by {r["author"]} — [{r["page"]}]({r["page"]}) '
                     f'(used as `{r["role"]}`)')
    lines.append("")
lines.append("Source: [Poly Pizza](https://poly.pizza)")
open("assets/ATTRIBUTION.md", "w").write("\n".join(lines) + "\n")

ok = [r for r in picked if r["ok"]]
print(f"{len(ok)}/{len(picked)} verified, "
      f"{sum(r['bytes'] or 0 for r in ok)/1e6:.1f} MB total")
for r in sorted(picked, key=lambda x: x["role"]):
    flag = "ok " if r["ok"] else "DEAD"
    kb = f'{(r["bytes"] or 0)/1024:.0f}kB'
    print(f'{flag} {r["license"]:5} {r["role"]:16} {r["name"][:26]:27} {kb:>8}  {r["glb"]}')
