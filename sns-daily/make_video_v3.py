# -*- coding: utf-8 -*-
"""筋トレ最安ナビ 日次ショート v3：ランキング5位→1位 → 値下がり → お得情報 → クロージング
使い方: python3 make_video_v3.py data_v3.json out.mp4 [cover.png]"""
import json, sys, subprocess, os, tempfile, wave
import numpy as np
from PIL import Image, ImageDraw
import make_video_v2 as m
from make_video_v2 import *


# ---- 安全領域：上200px・下400px・右160px・左50px を空ける（文字はこの内側のみ）----
SAFE = (50, 200, 920, 1520)   # 余白：左50・右160・上200・下400（左右対称に使うため実効幅は x160〜920）
VIOL = []
def text_c(d, cy, s, f, fill=WHITE, a=1.0, dx=0, dy=0, stroke=0, stroke_fill=BLACK):
    w, h, ox, oy = m.tw(d, s, f)
    lim = 2 * (SAFE[2] - 540) - 10 - 2 * stroke   # 画面中央540を軸に左右対称（右余白160に合わせる）
    if w > lim:                                   # 幅超過は自動で縮小
        f = f.font_variant(size=max(20, int(f.size * lim / w)))
        w, h, ox, oy = m.tw(d, s, f)
    cx = 540                                        # 画面の真ん中
    x = cx - w / 2 + dx
    y = cy + dy
    if x - stroke < 1080 - SAFE[2] - 1 or x + w + stroke > SAFE[2] + 1 or y < SAFE[1] - 1 or y + h > SAFE[3] + 1:
        VIOL.append((s[:12], int(x), int(y), int(x + w), int(y + h)))
    d.multiline_text((x - ox, y - oy), s, font=f, fill=mix(fill, a), align="center", spacing=8,
                     stroke_width=stroke, stroke_fill=stroke_fill)
    return h
m.text_c = text_c

HOOK_END = 3.0
RANK_T0, RANK_DUR = 3.0, 3.0      # 5位〜2位は各3.0秒、1位は3.6秒
RANK_LAST = 3.6
DROP_T0 = RANK_T0 + RANK_DUR * 4 + RANK_LAST   # 18.6
DROP_DUR = 8.0
CTA_T0 = DROP_T0 + DROP_DUR
OFF = CTA_T0 - 14.0                              # 旧CTAシーンの時間へ換算
DUR3 = CTA_T0 + 5.0
GOLD = (255, 200, 30)

def placeholder_card(brand, h=540):
    """画像が無い商品用：ブランド名の白いカード"""
    key = ("ph", brand, h)
    if key in m._imgcache: return m._imgcache[key]
    w = int(h * 0.74)
    card = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    dd = ImageDraw.Draw(card)
    lines = brand.split("\n")
    fs = 70
    f = F("b", fs)
    while max(dd.textlength(l, font=f) for l in lines) > w - 50 and fs > 24:
        fs -= 4; f = F("b", fs)
    y = h / 2 - len(lines) * fs * 0.75
    for l in lines:
        dd.text(((w - dd.textlength(l, font=f)) / 2, y), l, font=f, fill=(20, 20, 20)); y += fs * 1.5
    mask = Image.new("L", (w, h), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=36, fill=255)
    card.putalpha(mask)
    m._imgcache[key] = card
    return card

def get_cut(path, brand, h):
    c = product_cut(path, h) if path and os.path.exists(path) else None
    return c if c is not None else placeholder_card(brand or "", h)

def rank_scene(img, d, r, k, u, n_total=5):
    top1 = (k == 1)
    a = ease_out(u / 0.25)
    sx, sy = shake(u, 0.0, 8, 0.3)
    if top1:
        glow = Image.new("RGB", (W, H), (0, 0, 0)); gd = ImageDraw.Draw(glow)
        for i in range(12):
            rr = 900 - i * 60; c = int(70 * (i + 1) / 12)
            gd.ellipse([540 - rr, 900 - rr, 540 + rr, 900 + rr], fill=(c, int(c * 0.75), 0))
        img.paste(glow, (0, 0)); d = ImageDraw.Draw(img)
    text_c(d, 210, r.get("rank_title", "プロテイン最安ランキング"), F("b", 46), GOLD if top1 else GRAY, a)
    col = GOLD if top1 else (RED if k <= 3 else WHITE)
    fs = 200 * (1 + 0.2 * (1 - ease_back(u / 0.35)) if u < 0.35 else 1)
    text_c(d, 262, f"第{k}位", F("b", fs), col, a, sx, sy, stroke=5)
    cut = get_cut(r.get("img"), r.get("brand", r["name"]), 540)
    slide = (1 - ease_back((u - 0.05) / 0.4)) * 500
    if cut is not None:
        img.paste(cut, (int(540 - cut.width / 2 + slide), int(535 + sy * 0.5)), cut)
    text_c(d, 1085, r["name"], F("b", 50), WHITE, ease_out((u - 0.25) / 0.25), stroke=4)
    text_c(d, 1150, f"{r['size']}｜{r['price']:,}円（{r.get('ship', '送料込み')}）", F("b", 52), WHITE, ease_out((u - 0.4) / 0.25))
    ch = r["channel"]; bc = {"楽天市場": (191, 0, 13), "Amazon": (255, 153, 0), "公式サイト": (0, 150, 90)}[ch]
    ba = ease_out((u - 0.5) / 0.25)
    if ba > 0:
        d.rounded_rectangle([340, 1220, 740, 1284], radius=32, fill=tuple(int(c * ba) for c in bc))
        text_c(d, 1229, f"販売：{ch}", F("b", 42), BLACK if ch == "Amazon" else WHITE, ba)
    text_c(d, 1305, r.get("metric_label", "タンパク質20gあたり"), F("m", 34), GRAY, ease_out((u - 0.6) / 0.25))
    text_c(d, 1345, r.get("metric_str", f"{r.get('p20')}円"), F("b", 96), GOLD if top1 else YEL, ease_out((u - 0.7) / 0.25))
    for i in range(5, 0, -1):
        cx = 540 + (3 - i) * 60
        on = i >= k
        d.ellipse([cx - 12, 1465 - 12, cx + 12, 1465 + 12], fill=(GOLD if i == k else (WHITE if on else (70, 70, 70))))
    text_c(d, 1480, f"取得：{r['when']}｜筋トレ最安ナビ調べ", F("m", 28), GRAY, a)


def drop_scene(img, d, data, u):
    """値下がり情報：商品名・パッケージ・販売先・前後の価格・100g単価を1画面に"""
    prev, price = data["prev_price"], data["price"]
    drop = prev - price; pct = 100.0 * drop / prev
    a = ease_out(u / 0.3)
    sx, sy = shake(u, 1.6, 10, 0.35)
    text_c(d, 210, data.get("drop_title", "値下がり情報"), F("b", 76), WHITE, a, stroke=3)
    cut = get_cut(data.get("product_image"), data.get("product_brand", data["product"].split("\n")[0]), 470)
    if cut is not None:
        ia = ease_out((u - 0.1) / 0.35)
        img.paste(cut, (int(540 - cut.width / 2), int(310 - (1 - ia) * 60)), cut) if ia > 0.99 else None
        if ia <= 0.99:
            c2 = cut.copy(); c2.putalpha(cut.getchannel("A").point(lambda x: int(x * ia)))
            img.paste(c2, (int(540 - cut.width / 2), int(310 - (1 - ia) * 60)), c2)
    # 値引き率バッジ（画像の左肩）
    if u > 0.5:
        s = 1.0 if u > 0.85 else 0.9 + 0.1 * ease_back((u - 0.5) / 0.35)
        bw, bh = int(270 * s), int(120 * s)
        bx, by = 165, 340
        d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=22, fill=RED, outline=WHITE, width=5)
        text_c(d, by + bh / 2 - 40 * s, (f"−{pct:.0f}%" if pct >= 10 else f"−{pct:.1f}%"), F("b", 84 * s), WHITE, 1, dx=bx + bw / 2 - 540)
    text_c(d, 800, data["product"].replace("\n", " "), F("b", 54), WHITE, ease_out((u - 0.3) / 0.3), stroke=3)
    # 前回 → 今回
    pa = ease_out((u - 0.6) / 0.3)
    text_c(d, 885, f"{data.get('prev_label', '前回')} {yen(prev)}円", F("b", 58), GRAY, pa)
    if u > 1.0:
        wv, hv, _, _ = tw(d, f"{data.get('prev_label', '前回')} {yen(prev)}円", F("b", 58))
        pr = ease_out((u - 1.0) / 0.3)
        d.line([540 - wv / 2, 915, 540 - wv / 2 + wv * pr, 915], fill=RED, width=8)
    p = ease_out((u - 1.2) / 1.4)
    cur = prev - drop * p
    fs = 170 * (1 + 0.06 * max(0, 1 - (u - 2.6) * 4) if u > 2.6 else 1)
    text_c(d, 965, f"{yen(cur)}円", F("b", fs), RED if p >= 1 else WHITE, ease_out((u - 1.1) / 0.3), sx * 0.5, sy * 0.5, stroke=2)
    text_c(d, 1170, f"−{yen(drop)}円（−{pct:.1f}%）", F("b", 60), YEL, ease_out((u - 2.7) / 0.4))
    # 販売先
    sa = ease_out((u - 3.2) / 0.4)
    fs_shop = 52
    while fs_shop > 30 and d.textlength(data["shop"], font=F("b", fs_shop)) > 640:
        fs_shop -= 2
    half = min(380, max(340, d.textlength(data["shop"], font=F("b", fs_shop)) / 2 + 50))
    d.rounded_rectangle([540 - half, 1262, 540 + half, 1400], radius=34, outline=(110, 110, 110), width=4)
    text_c(d, 1276, "販売先", F("m", 36), GRAY, sa)
    text_c(d, 1322 + (52 - fs_shop) // 2, data["shop"], F("b", fs_shop), WHITE, sa)
    text_c(d, 1418, f"{data['unit_label']} {yen(data['unit_price'])}円", F("b", 56), WHITE, ease_out((u - 3.9) / 0.4))
    text_c(d, 1490, f"取得：{data['fetched_label']}｜※送料・ポイントは店舗で異なります", F("m", 26), GRAY, a)


def cta_scene(img, d, data, u):
    """クロージング：ファーストビューと同じプロテイン袋の背景"""
    img.paste(collage_bg("cta"), (0, 0)); d = ImageDraw.Draw(img)
    a = ease_out(u / 0.3)
    text_c(d, 330, "毎日、最新の安値を更新", F("b", 70), WHITE, a, stroke=6)
    text_c(d, 450, "筋トレ", F("b", 200), RED, ease_out((u - 0.3) / 0.3), stroke=8, stroke_fill=WHITE)
    text_c(d, 680, "最安ナビ", F("b", 200), WHITE, ease_out((u - 0.5) / 0.3), stroke=8)
    text_c(d, 990, "フォローで毎日チェック", F("b", 66), YEL, ease_out((u - 1.2) / 0.3), stroke=6)
    text_c(d, 1100, data["url_label"], F("b", 56), WHITE, ease_out((u - 1.6) / 0.3), stroke=5)
    text_c(d, 1200, "プロテイン・クレアチン・ジム", F("b", 46), WHITE, ease_out((u - 2.0) / 0.3), stroke=4)

def hook(img, d, data, t):
    img.paste(collage_bg(), (0, 0)); d = ImageDraw.Draw(img)
    sx, sy = shake(t, 0.05)
    lab = f"{data.get('date_full', data['date_label'])} 最新"
    f = F("b", 54); w = m.tw(d, lab, f)[0]
    d.rounded_rectangle([540 - w / 2 - 36, 250, 540 + w / 2 + 36, 336], radius=43, fill=YEL)
    text_c(d, 262, lab, f, BLACK, 1, sx * 0.3, sy * 0.3)
    text_c(d, 350, data.get("category", "プロテイン"), F("b", 150), WHITE, 1, sx * 0.5, stroke=8)
    text_c(d, 495, "最安ランキング", F("b", 112), YEL, 1, sx * 0.5, sy * 0.5, stroke=8)
    text_c(d, 690, "5位→1位まで発表", F("b", 76), WHITE, 1, stroke=6)
    # 下：1位予告
    text_c(d, 1230, "1位は", F("b", 70), WHITE, 1, stroke=5)
    text_c(d, 1330, f"{data.get('metric_label', 'タンパク質20gあたり')}{data['ranking'][4].get('metric_str', '109円')}", F("b", 60), YEL, 1, stroke=6)
    text_c(d, 1440, "最後に値下がり情報も", F("m", 44), WHITE, 1, stroke=4)

def frame3(data, t):
    img = Image.new("RGB", (W, H), BLACK); d = ImageDraw.Draw(img)
    if t < HOOK_END:
        hook(img, d, data, t); return img
    if t < DROP_T0:
        u = t - RANK_T0
        idx = min(3, int(u // RANK_DUR))
        if u >= RANK_DUR * 4: idx = 4
        start = RANK_DUR * idx
        rank_scene(img, d, dict(data["ranking"][idx], rank_title=data.get("rank_title", "プロテイン最安ランキング"), metric_label=data.get("metric_label", "タンパク質20gあたり")), 5 - idx, u - start)
        return img
    if t < CTA_T0:
        drop_scene(img, d, data, t - DROP_T0); return img
    cta_scene(img, d, data, t - CTA_T0)
    return img

def make_audio3(path):
    buf = np.zeros(int(SR * DUR3))
    m._add(buf, kick(0.6), 0.0, 1.1); m._add(buf, whoosh(0.35), 0.0, 0.5)
    k = 1
    while k * 0.5 < DUR3 - 0.2:
        m._add(buf, kick(0.25), k * 0.5, 0.26); m._add(buf, hat(), k * 0.5 + 0.25, 0.2); k += 1
    marks = [HOOK_END] + [RANK_T0 + RANK_DUR * i for i in range(1, 4)] + [RANK_T0 + RANK_DUR * 4, DROP_T0, CTA_T0]
    for ts in marks:
        m._add(buf, whoosh(0.45), ts - 0.15, 0.55); m._add(buf, kick(0.4), ts, 0.7)
    m._add(buf, ding(), RANK_T0 + RANK_DUR * 4 + 0.35, 1.0)     # 1位発表
    for i in range(14): m._add(buf, tick(), DROP_T0 + 1.2 + i * 0.1, 0.5)
    m._add(buf, ding(), DROP_T0 + 2.6, 0.9); m._add(buf, ding(), DUR3 - 4.6, 0.5)
    buf = np.tanh(buf * 0.9) * 0.8
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((buf * 32767).astype(np.int16).tobytes())

def apply_collage(data):
    if not data.get("collage"): return
    slots = [(c[1], c[2], c[3], c[4]) for c in m.COLLAGE]
    big = {"myprotein_impact_eaa", "reys_eaa_lemon_lime_600g"}
    m.COLLAGE = [(n, *s) for n, s in zip(data["collage"], slots)]
    m._coll.clear()

def main():
    data = json.load(open(sys.argv[1], encoding="utf-8")); out = sys.argv[2]
    apply_collage(data)
    cover = sys.argv[3] if len(sys.argv) > 3 else None
    wav = os.path.join(tempfile.gettempdir(), "kintore_sfx3.wav"); make_audio3(wav)
    if cover: frame3(data, 1.0).save(cover)
    cmd = ["ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-i", wav,
           "-t", str(DUR3), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "medium",
           "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    for i in range(int(DUR3 * FPS)): p.stdin.write(frame3(data, i / FPS).tobytes())
    p.stdin.close(); p.wait(); print("done", out, DUR3, "violations:", len(set(VIOL)), sorted(set(VIOL))[:8])

if __name__ == "__main__": main()
