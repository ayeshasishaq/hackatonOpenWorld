"""Build a labelled contact sheet of the ER assets from their poly.pizza posters."""
import io
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageDraw, ImageFont

CELL, PAD, LABEL, COLS = 240, 10, 34, 6
BG, FG, DIM = (14, 17, 27), (223, 230, 245), (135, 146, 173)

rows = [r for r in json.load(open("assets/er-assets.json")) if r["ok"]]


def poster(r):
    url = r["glb"].replace(".glb", ".jpg")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            im = Image.open(io.BytesIO(resp.read())).convert("RGB")
        im.thumbnail((CELL, CELL))
        return im
    except Exception:
        return None


with ThreadPoolExecutor(12) as pool:
    imgs = list(pool.map(poster, rows))

cells = [(r, im) for r, im in zip(rows, imgs) if im]
n = len(cells)
r_count = (n + COLS - 1) // COLS
W = COLS * (CELL + PAD) + PAD
H = r_count * (CELL + LABEL + PAD) + PAD

sheet = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(sheet)
try:
    f1 = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
    f2 = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
except OSError:
    f1 = f2 = ImageFont.load_default()

for i, (r, im) in enumerate(cells):
    cx = PAD + (i % COLS) * (CELL + PAD)
    cy = PAD + (i // COLS) * (CELL + LABEL + PAD)
    sheet.paste(im, (cx + (CELL - im.width) // 2, cy + (CELL - im.height) // 2))
    draw.text((cx + 2, cy + CELL + 2), r["role"], font=f1, fill=FG)
    draw.text((cx + 2, cy + CELL + 18), f'{r["license"]} · {r["author"]}'[:34],
              font=f2, fill=DIM)

sheet.save("assets/er-assets-preview.png")
print(f"assets/er-assets-preview.png  {n} tiles  {W}x{H}")
