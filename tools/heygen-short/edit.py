#!/usr/bin/env python3
"""HeyGen の実写トーク素材を、縦型ショートに編集する。

- センテンスごとの素材の前後の無音を詰めてつなぐ（ジャンプカット）
- センテンスごとに寄り・引きを切り替える
- 上部パネル: 冒頭はフック、その後はティア表（ランクを読み上げた瞬間に埋まる）
- 下部: 字幕（漢字かなまじり、1行ずつ）

使い方:
  python3 edit.py episodes/breakfast-tier.json --work work/breakfast-tier
  出力: work/breakfast-tier/final.mp4
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
FPS = 30
PANEL_H = 760          # 上部パネル（フック・ティア表）
SUB_Y = 1440           # 字幕の中心（下1/3の中、SNSのUIより上）
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
TIER_COLORS = {"S": (255, 77, 79), "A": (255, 159, 64), "B": (255, 214, 77), "C": (111, 211, 111), "D": (77, 163, 255)}
ZOOMS = [1.0, 1.14]


def font(size, path=FONT):
    if not Path(path).exists():
        path = FONT_BOLD
    return ImageFont.truetype(path, size, index=0)  # index 0 = JP


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def duration(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]).stdout
    return float(out.strip())


def speech_bounds(path, pad=0.08):
    """素材の最初と最後の発話位置を返す（前後の無音を詰めるため）。"""
    dur = duration(path)
    log = subprocess.run(["ffmpeg", "-i", str(path), "-af", "silencedetect=noise=-38dB:d=0.12", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
    a, b = 0.0, dur
    if starts and starts[0] < 0.05 and ends:
        a = max(0.0, ends[0] - pad)
    if starts and (len(ends) < len(starts) or ends[-1] >= dur - 0.05):
        b = min(dur, starts[-1] + pad)
    if b - a < 0.5:
        a, b = 0.0, dur
    return a, b


def build_base(clips, work):
    """無音を詰めて連結した素材と、各センテンスの開始・終了時刻を返す。"""
    parts, times, t = [], [], 0.0
    for i, c in enumerate(clips):
        a, b = speech_bounds(c)
        p = work / f"cut_{i + 1:02d}.mp4"
        run(["ffmpeg", "-y", "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", str(c),
             "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS}",
             "-af", "aresample=48000", "-ac", "2",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-c:a", "aac", "-b:a", "192k", str(p)])
        d = duration(p)
        parts.append(p)
        times.append((t, t + d))
        t += d
    lst = work / "concat.txt"
    lst.write_text("".join(f"file '{p.resolve()}'\n" for p in parts), encoding="utf-8")
    base = work / "base.mp4"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(base)])
    return base, times


def find_face(base):
    """数フレームから顔の中心と高さを推定する。見つからなければ画面上寄りの中央。"""
    cap = cv2.VideoCapture(str(base))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    det = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    hits = []
    for k in range(12):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(n * (k + 0.5) / 12))
        ok, fr = cap.read()
        if not ok:
            continue
        g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
        faces = det.detectMultiScale(g, 1.1, 6, minSize=(120, 120))
        if len(faces):
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
            hits.append((x + w / 2, y + h / 2, h))
    cap.release()
    if not hits:
        return W / 2, H * 0.33, H * 0.15
    a = np.median(np.array(hits), axis=0)
    return float(a[0]), float(a[1]), float(a[2])


# ---------- 描画 ----------

def text_size(d, s, f, stroke=0):
    b = d.textbbox((0, 0), s, font=f, stroke_width=stroke)
    return b[2] - b[0], b[3] - b[1], b


def fit_font(s, max_w, size, path=FONT, min_size=28):
    d = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    while size > min_size and text_size(d, s, font(size, path))[0] > max_w:
        size -= 2
    return font(size, path)


def draw_center(d, s, f, cx, cy, fill, stroke=0, stroke_fill=None):
    w, h, b = text_size(d, s, f, stroke)
    d.text((cx - w / 2 - b[0], cy - h / 2 - b[1]), s, font=f, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)


def panel_bg():
    y = np.linspace(0, 1, PANEL_H)[:, None, None]
    top, bot = np.array([18, 22, 36]), np.array([10, 12, 20])
    g = (top * (1 - y) + bot * y).astype(np.uint8)
    return np.repeat(g, W, axis=1)


def render_hook(lines, brand="FITPEAK"):
    im = Image.new("RGBA", (W, PANEL_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f = fit_font(max(lines, key=len), int(W * 0.84), 104)
    lh = int(f.size * 1.32)
    box_h = lh * len(lines) + 70
    y0 = (PANEL_H - box_h) // 2 + 20
    d.rounded_rectangle((40, y0, W - 40, y0 + box_h), radius=36, fill=(0, 0, 0, 170), outline=(255, 214, 77, 255), width=6)
    for k, s in enumerate(lines):
        draw_center(d, s, f, W / 2, y0 + 35 + lh * k + lh / 2, (255, 255, 255, 255))
    draw_center(d, brand, font(34, FONT_BOLD), W / 2, y0 - 40, (255, 214, 77, 255))
    return im


ROW_Y0, ROW_H, ROW_GAP, LABEL_W = 150, 112, 8, 150


def render_board_base(title):
    im = Image.new("RGBA", (W, PANEL_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    draw_center(d, title, fit_font(title, W - 120, 60), W / 2, 82, (255, 255, 255, 255))
    for k, t in enumerate("SABCD"):
        y = ROW_Y0 + k * (ROW_H + ROW_GAP)
        d.rounded_rectangle((30, y, 30 + LABEL_W, y + ROW_H), radius=18, fill=TIER_COLORS[t] + (255,))
        draw_center(d, t, font(80), 30 + LABEL_W / 2, y + ROW_H / 2, (20, 20, 20, 255))
        d.rounded_rectangle((30 + LABEL_W + 12, y, W - 30, y + ROW_H), radius=18, fill=(38, 44, 60, 230))
    return im


def render_item(tier, text):
    """ランクの中身（横からスライドで入れる用の帯）。"""
    w = W - 30 - (30 + LABEL_W + 12)
    im = Image.new("RGBA", (w, ROW_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f = fit_font(text, w - 50, 54)
    _, h, b = text_size(d, text, f)
    d.text((26 - b[0], ROW_H / 2 - h / 2 - b[1]), text, font=f, fill=(255, 255, 255, 255))
    return im


def render_highlight(k):
    im = Image.new("RGBA", (W, PANEL_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    y = ROW_Y0 + k * (ROW_H + ROW_GAP)
    d.rounded_rectangle((26, y - 4, W - 26, y + ROW_H + 4), radius=20, outline=(255, 255, 255, 255), width=5)
    return im


def render_sub(text):
    f = fit_font(text, W - 100, 66)
    d = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    w, h, _ = text_size(d, text, f, 8)
    im = Image.new("RGBA", (w + 40, h + 40), (0, 0, 0, 0))
    draw_center(ImageDraw.Draw(im), text, f, im.width / 2, im.height / 2, (255, 255, 255, 255), 8, (0, 0, 0, 255))
    return im


def blend(dst, im, x, y, alpha=1.0):
    """dst(RGB uint8) の (x,y) に RGBA 画像を重ねる。はみ出しは切る。"""
    a = np.asarray(im, dtype=np.float32)
    h, w = a.shape[:2]
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, dst.shape[1]), min(y + h, dst.shape[0])
    if x0 >= x1 or y0 >= y1:
        return
    a = a[y0 - y:y1 - y, x0 - x:x1 - x]
    m = a[..., 3:4] / 255.0 * alpha
    region = dst[y0:y1, x0:x1].astype(np.float32)
    dst[y0:y1, x0:x1] = (region * (1 - m) + a[..., :3] * m).astype(np.uint8)


def ease(p):
    p = min(max(p, 0.0), 1.0)
    return 1 - (1 - p) ** 3


def sub_timeline(sentences, times):
    """センテンス内の字幕行を、読みの長さ（漢字は2文字分）に比例して割り当てる。"""
    out = []
    for s, (a, b) in zip(sentences, times):
        wts = [sum(2 if "一" <= ch <= "鿿" else 1 for ch in line) for line in s["subs"]]
        tot, t = sum(wts), a
        for line, wgt in zip(s["subs"], wts):
            d = (b - a) * wgt / tot
            out.append((t, t + d, line))
            t += d
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("episode")
    ap.add_argument("--work", required=True)
    ap.add_argument("--out")
    args = ap.parse_args()
    ep = json.loads(Path(args.episode).read_text(encoding="utf-8"))
    work = Path(args.work)
    sents = ep["sentences"]
    clips = [work / "clips" / f"{i + 1:02d}.mp4" for i in range(len(sents))]
    missing = [str(c) for c in clips if not c.exists()]
    if missing:
        raise SystemExit("素材が足りません: " + ", ".join(missing))

    base, times = build_base(clips, work)
    fx, fy, fh = find_face(base)
    total = times[-1][1]
    subs = [(a, b, render_sub(s)) for a, b, s in sub_timeline(sents, times)]

    bg = panel_bg()
    hook = render_hook(ep["hook"])
    board = render_board_base(ep.get("board_title", ep["title"]))
    items = {t: render_item(t, txt) for t, txt in ep["tiers"].items()}
    highlights = {k: render_highlight(k) for k in range(5)}
    reveal_at = {s["reveal"]: times[i][0] for i, s in enumerate(sents) if s.get("reveal")}
    reveal_end = {s["reveal"]: times[i][1] for i, s in enumerate(sents) if s.get("reveal")}
    hook_end = max([times[i][1] for i, s in enumerate(sents) if s.get("show") == "hook"] or [0.0])

    # 上部パネルと素材の境目をなじませるグラデーション
    fade = np.linspace(1, 0, 60)[:, None, None]

    out = Path(args.out or work / "final.mp4")
    enc = subprocess.Popen([
        "ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-i", str(base), "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(out)],
        stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)

    cap = cv2.VideoCapture(str(base))
    vid_h = H - PANEL_H
    fi = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        t = fi / FPS
        fi += 1
        si = next((i for i, (a, b) in enumerate(times) if a <= t < b), len(times) - 1)
        z = ZOOMS[si % len(ZOOMS)]

        # 素材の切り出し（顔を基準に、寄り・引きを交互に）
        cw = W / z
        ch = cw * vid_h / W
        x0 = int(np.clip(fx - cw / 2, 0, W - cw))
        y0 = int(np.clip(fy - ch * 0.36, 0, H - ch))
        crop = fr[y0:y0 + int(ch), x0:x0 + int(cw)]
        crop = cv2.resize(crop, (W, vid_h), interpolation=cv2.INTER_LINEAR)
        frame = np.empty((H, W, 3), np.uint8)
        frame[PANEL_H:] = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        frame[:PANEL_H] = bg
        top = frame[PANEL_H:PANEL_H + 60].astype(np.float32)
        frame[PANEL_H:PANEL_H + 60] = (top * (1 - fade * 0.85) + bg[-1].astype(np.float32) * fade * 0.85).astype(np.uint8)

        if t < hook_end:
            p = ease(t / 0.35)
            blend(frame, hook, 0, int((1 - p) * -40), alpha=p)
        else:
            blend(frame, board, 0, 0)
            for k, tier in enumerate("SABCD"):
                if tier in reveal_at and t >= reveal_at[tier]:
                    p = ease((t - reveal_at[tier]) / 0.3)
                    x = 30 + LABEL_W + 12 + int((1 - p) * 260)
                    blend(frame, items[tier], x, ROW_Y0 + k * (ROW_H + ROW_GAP), alpha=p)
                    if t < reveal_end[tier]:
                        blend(frame, highlights[k], 0, 0)

        for a, b, im in subs:
            if a <= t < b:
                blend(frame, im, (W - im.width) // 2, SUB_Y - im.height // 2)
                break

        enc.stdin.write(frame.tobytes())
    cap.release()
    enc.stdin.close()
    enc.wait()
    print(f"出力: {out}（{total:.1f}秒）")


if __name__ == "__main__":
    main()
