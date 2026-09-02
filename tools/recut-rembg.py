# Re-cut every cosmetic product photo with U2Net (rembg) instead of the
# corner flood-fill. The flood is blind to white-on-white: on a white box it
# leaks through the lit top edge and eats the face of the packaging (see
# system-4-bio-botanical-shampoo-1). A segmentation model sees the object.
#
# Sources: scratchpad/cutout-work/<slug>-<i>.jpg   (curated, idx 0)
#          scratchpad/cutout-new/<slug>-<i>.src    (new products, all idx)
#          missing ones are fetched from the live shop's public product JSON.
# Output replaces public/shop/img/<slug>-<i>.webp (same geometry contract:
# trim + 24px margin + max 900px + webp q86). Merch untouched.

import io, json, os, re, subprocess, sys, urllib.request
from pathlib import Path

ROOT = Path(r"C:/Users/Dmitri.MARKIT/source/repos/rempire-web")
IMG = ROOT / "public/shop/img"
SP = Path(r"C:/Users/DMITRI~1.MAR/AppData/Local/Temp/claude/C--Users-Dmitri-MARKIT-source-repos-Rempire/d86fba33-c4c4-4dad-a0f6-a1d47ab1c4e3/scratchpad")
WORK1, WORK2 = SP / "cutout-work", SP / "cutout-new"
OUT = SP / "rembg-out"
OUT.mkdir(exist_ok=True)

merch = set((SP / "merch-ids.txt").read_text().split())

from rembg import remove, new_session
session = new_session("u2net")

def source_for(slug, idx):
    for cand in (WORK1 / f"{slug}-{idx}.jpg", WORK2 / f"{slug}-{idx}.src"):
        if cand.exists():
            return cand.read_bytes()
    # fetch from the live shop
    try:
        req = urllib.request.Request(f"https://rempireshop.com/products/{slug}.json",
                                     headers={"User-Agent": "Mozilla/5.0"})
        j = json.loads(urllib.request.urlopen(req, timeout=20).read())
        imgs = [i["src"] for i in j["product"]["images"]]
        if idx >= len(imgs):
            return None
        url = re.sub(r"(\?|&)width=\d+", "", imgs[idx])
        url += ("&" if "?" in url else "?") + "width=1200"
        req2 = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req2, timeout=30).read()
        (WORK1 / f"{slug}-{idx}.jpg").write_bytes(data)
        return data
    except Exception as e:
        print(f"FETCH-FAIL {slug}-{idx}: {e}", flush=True)
        return None

def magick(*args):
    subprocess.run(["magick", *args], check=True, capture_output=True)

targets = []
for f in sorted(IMG.glob("*.webp")):
    m = re.match(r"(.+)-(\d)\.webp$", f.name)
    if not m or m.group(1) in merch:
        continue
    targets.append((m.group(1), int(m.group(2)), f))

print(f"{len(targets)} images", flush=True)
swapped = failed = kept = 0
report = []
for n, (slug, idx, dest) in enumerate(targets, 1):
    src = source_for(slug, idx)
    if src is None:
        failed += 1
        report.append(f"no-source {slug}-{idx}")
        continue
    try:
        cut = remove(src, session=session)  # PNG bytes, RGBA
        raw = OUT / f"{slug}-{idx}.png"
        raw.write_bytes(cut)
        tmp = OUT / f"{slug}-{idx}.webp"
        # un-premultiply the white matte: edge pixels are product colour
        # blended with the old white background; solving F=(O-(1-a))/a per
        # channel removes the white, so no grey rim on any tinted ground
        magick(str(raw), "-channel", "RGB",
               "-fx", "u.a<=0?u:min(1,max(0,(u-1+u.a)/u.a))", "+channel",
               "-trim", "+repage",
               "-bordercolor", "none", "-border", "24",
               "-resize", "900x900>", "-quality", "86", str(tmp))
        # sanity: the model must not have lost the product
        p = subprocess.run(["magick", str(tmp), "-alpha", "extract",
                            "-format", "%[fx:mean*w*h]", "info:"],
                           check=True, capture_output=True, text=True)
        area = float(p.stdout.strip() or 0)
        if area < 40000:  # a real product at ~900px is far above this
            failed += 1
            report.append(f"too-small {slug}-{idx} area={int(area)}")
            continue
        tmp.replace(dest)
        raw.unlink(missing_ok=True)
        swapped += 1
    except Exception as e:
        failed += 1
        report.append(f"err {slug}-{idx}: {e}")
    if n % 25 == 0:
        print(f"  {n}/{len(targets)}", flush=True)

print(json.dumps({"swapped": swapped, "failed": failed, "kept": kept,
                  "notes": report[:40]}, indent=1), flush=True)
