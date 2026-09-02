# The final cutout pipeline — classical, no neural mask.
#
# History: the v1 flood-fill looked right (crisp, honest) but left a 1-2px
# white halo and could leak into white packaging at high tolerance. U2Net
# fixed the leak but brought its own artefacts: alpha noise veils and smudged
# remnants between objects. This pipeline is the v1 flood with its two real
# defects fixed mathematically:
#
#   1. per-image adaptive tolerance sweep (stop before the cost cliff, so
#      white boxes are never breached) — the proven v1 logic;
#   2. 1px alpha erode + 0.5 blur — trims the JPEG halo and softens the cut;
#   3. white un-premultiply on the soft ring — edge pixels lose the white
#      contamination, so no grey rim on any background.
#
# Backgrounds end at exactly 0 alpha (flood sets none), so there is no veil
# by construction. Merch keeps its frame.

import json, re, subprocess, urllib.request
from pathlib import Path

ROOT = Path(r"C:/Users/Dmitri.MARKIT/source/repos/rempire-web")
IMG = ROOT / "public/shop/img"
SP = Path(r"C:/Users/DMITRI~1.MAR/AppData/Local/Temp/claude/C--Users-Dmitri-MARKIT-source-repos-Rempire/d86fba33-c4c4-4dad-a0f6-a1d47ab1c4e3/scratchpad")
WORK1, WORK2 = SP / "cutout-work", SP / "cutout-new"

FUZZ = [3, 5, 7, 9, 12]
STEP_COST = 0.985
# grey reflective backdrops — the sweep reads the backdrop leaving as a cliff
OVERRIDE = {"creed-creed-aventus-cologne-50ml-0": 9, "handmade-soap-666-0": 9, "handmade-soap-rule-nr-1-0": 9}

merch = set((SP / "merch-ids.txt").read_text().split())

def sh(args):
    return subprocess.run(["magick", *args], check=True, capture_output=True, text=True).stdout

def source_for(slug, idx):
    for cand in (WORK1 / f"{slug}-{idx}.jpg", WORK2 / f"{slug}-{idx}.src"):
        if cand.exists():
            return cand
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
        p = WORK1 / f"{slug}-{idx}.jpg"
        p.write_bytes(data)
        return p
    except Exception as e:
        print(f"FETCH-FAIL {slug}-{idx}: {e}", flush=True)
        return None

def opaque_at(src, corner, fuzz):
    out = sh([str(src), "-alpha", "set", "-bordercolor", corner, "-border", "2",
              "-channel", "RGBA", "-fuzz", f"{fuzz}%", "-fill", "none",
              "-floodfill", "+0+0", corner, "+channel",
              "-shave", "2x2", "-alpha", "extract", "-format", "%[fx:mean*w*h]", "info:"])
    return float(out.strip())

targets = []
for f in sorted(IMG.glob("*.webp")):
    m = re.match(r"(.+)-(\d)\.webp$", f.name)
    if not m:
        continue
    targets.append((m.group(1), int(m.group(2)), f, m.group(1) in merch))

print(f"{len(targets)} images", flush=True)
done = failed = 0
notes = []
for n, (slug, idx, dest, is_merch) in enumerate(targets, 1):
    src = source_for(slug, idx)
    if src is None:
        failed += 1
        notes.append(f"no-source {slug}-{idx}")
        continue
    try:
        if is_merch:
            sh([str(src), "-resize", "900x900>", "-quality", "86", str(dest)])
        else:
            corner = sh([str(src), "-format", "%[pixel:p{2,2}]", "info:"]).strip()
            counts = [opaque_at(src, corner, f) for f in FUZZ]
            pick = 0
            for i in range(1, len(FUZZ)):
                if counts[i] >= counts[i - 1] * STEP_COST:
                    pick = i
                else:
                    break
            fuzz = OVERRIDE.get(f"{slug}-{idx}", FUZZ[pick])
            sh([str(src), "-alpha", "set", "-bordercolor", corner, "-border", "2",
                "-channel", "RGBA", "-fuzz", f"{fuzz}%", "-fill", "none",
                "-floodfill", "+0+0", corner, "+channel", "-shave", "2x2",
                "-channel", "A", "-morphology", "Erode", "Disk:1", "-blur", "0x0.5", "+channel",
                "-channel", "RGB", "-fx", "u.a<=0?u:min(1,max(0,(u-1+u.a)/u.a))", "+channel",
                "-trim", "+repage", "-bordercolor", "none", "-border", "24",
                "-resize", "900x900>", "-quality", "86", str(dest)])
        done += 1
    except Exception as e:
        failed += 1
        notes.append(f"err {slug}-{idx}: {e}")
    if n % 25 == 0:
        print(f"  {n}/{len(targets)}", flush=True)

print(json.dumps({"done": done, "failed": failed, "notes": notes[:30]}, indent=1), flush=True)
