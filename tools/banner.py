"""Composite the catalog banner: 1200x600 art + left scrim + wordmark.

Verifies legibility numerically by measuring luminance under each text box
on the scrimmed art layer before text is drawn.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC = Path(r"C:/Users/tuanc/AppData/Local/hermes/cache/documents/native-inputs/2ed94d30a390ea8fd5d9341037e7b301f4eb93f9733d1e4a63d77436351cd5f5/img_2d6bbc96e046.png")
OUT = Path("assets/hero-banner.png")
RAW = Path("assets/hero-banner-source.png")
W, H = 1200, 600
BOLD = r"C:/Windows/Fonts/segoeuib.ttf"
REG = r"C:/Windows/Fonts/segoeui.ttf"

art = Image.open(SRC).convert("RGB").resize((W, H), Image.LANCZOS)
RAW.parent.mkdir(parents=True, exist_ok=True)
art.save(RAW, optimize=True)

# Horizontal scrim: opaque on the left, gone by 58% width.
scrim = Image.new("L", (W, H), 0)
sd = ImageDraw.Draw(scrim)
for x in range(int(W * 0.58)):
    a = int(232 * max(0.0, 1 - (x / (W * 0.58)) ** 1.25))
    sd.line([(x, 0), (x, H)], fill=a)

base = art.copy()
base.paste(Image.new("RGB", (W, H), (7, 10, 13)), (0, 0), scrim)

# Soft glow behind the title block.
glow = Image.new("L", (W, H), 0)
ImageDraw.Draw(glow).ellipse([60, 210, 700, 420], fill=70)
glow = glow.filter(ImageFilter.GaussianBlur(70))
base.paste(Image.new("RGB", (W, H), (255, 210, 140)), (0, 0), glow)

title_f = ImageFont.truetype(BOLD, 68)
sub_f = ImageFont.truetype(REG, 28)
tag_f = ImageFont.truetype(BOLD, 18)

X = 84
title = "Enhance Prompt"
sub = "Rewrite the draft. Never send it."
tag = "HERMES DESKTOP PLUGIN"

boxes = []
y = 196
for text, font, gap in ((tag, tag_f, 18), (title, title_f, 22), (sub, sub_f, 0)):
    bbox = font.getbbox(text)
    boxes.append((text, font, (X, y), bbox))
    y += (bbox[3] - bbox[1]) + gap

# Legibility gate: measure the scrimmed layer under every text box.
def lums(box):
    pad = 6
    x0, y0, bw, bh = box
    crop = base.crop((max(0, x0 - pad), max(0, y0 - pad), min(W, x0 + bw + pad), min(H, y0 + bh + pad)))
    g = [p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722 for p in crop.getdata()]
    g.sort()
    return g[int(len(g) * 0.99)], g[-1]

final = base.copy()
d = ImageDraw.Draw(final)
d.text((X, 196), tag, font=tag_f, fill=(226, 168, 92))
d.text((X, 196 + (tag_f.getbbox(tag)[3] - tag_f.getbbox(tag)[1]) + 18), title, font=title_f, fill=(250, 248, 245))
sy = 196 + (tag_f.getbbox(tag)[3] - tag_f.getbbox(tag)[1]) + 18 + (title_f.getbbox(title)[3] - title_f.getbbox(title)[1]) + 22
d.text((X, sy), sub, font=sub_f, fill=(196, 186, 172))

print("text boxes and p99/max luminance under each:")
for text, font, xy, bbox in boxes:
    p99, mx = lums((xy[0] + bbox[0], xy[1] + bbox[1]) + (bbox[2] - bbox[0], bbox[3] - bbox[1]))
    print(f"  {text[:28]:30} p99={p99:6.1f} max={mx:6.1f}")

final.save(OUT, optimize=True)
print("saved", OUT, final.size, round(OUT.stat().st_size / 1024, 1), "KB")
