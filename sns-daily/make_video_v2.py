# -*- coding: utf-8 -*-
"""筋トレ最安ナビ 日次ショート動画ジェネレーター v2（ファーストビュー重視）
使い方: python3 make_video_v2.py data_YYYY-MM-DD.json out.mp4 [cover.png]
1080x1920 / 30fps / 約19秒。日本語（Noto Sans CJK JP）のみ。効果音は合成（著作権問題なし）。
設計の要点:
 - 0秒目の1コマ目から完成した画面（サムネイル兼用）。真っ黒スタートにしない
 - 冒頭2.5秒で「何が・どれだけ・どの商品」を全部見せる
 - 文字はTikTok/Instagram/Shortsのボタン・字幕と重ならない安全領域（上220px〜下420px、右120px）に収める
"""
import json, sys, subprocess, math, wave, os, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1080, 1920, 30
DUR = 19.0
BLACK, WHITE, RED, GRAY, YEL = (0, 0, 0), (255, 255, 255), (255, 45, 40), (150, 150, 150), (255, 214, 10)
FONT_B = "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc"
FONT_M = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
_fc = {}
def F(kind, size):
    size = max(8, int(round(size / 2.0)) * 2)
    k = (kind, size)
    if k not in _fc:
        _fc[k] = ImageFont.truetype(FONT_B if kind == "b" else FONT_M, size, index=0)  # index 0 = 日本語(JP)
    return _fc[k]

def clamp(x): return max(0.0, min(1.0, x))
def ease_out(t): t = clamp(t); return 1 - (1 - t) ** 3
def ease_back(t):  # 行き過ぎて戻る（パンチ感）
    t = clamp(t); c1 = 1.9; c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
def yen(n): return f"{int(round(n)):,}"
def mix(c, a): return tuple(int(v * clamp(a)) for v in c)  # 黒背景上のフェード

def tw(d, s, f):
    b = d.multiline_textbbox((0, 0), s, font=f, align="center", spacing=8)
    return b[2] - b[0], b[3] - b[1], b[0], b[1]

def text_c(d, cy, s, f, fill=WHITE, a=1.0, dx=0, dy=0, stroke=0, stroke_fill=BLACK):
    """cy = テキストブロックの上端Y。中央そろえ"""
    w, h, ox, oy = tw(d, s, f)
    d.multiline_text(((W - w) / 2 + dx - ox, cy + dy - oy), s, font=f, fill=mix(fill, a),
                     align="center", spacing=8, stroke_width=stroke, stroke_fill=stroke_fill)
    return h

def shake(t, t0, amp=14, dur=0.35):
    u = t - t0
    if u < 0 or u > dur: return 0, 0
    k = (1 - u / dur) ** 2
    return math.sin(u * 90) * amp * k, math.cos(u * 70) * amp * 0.6 * k

def stamp(img, s, t, t0):
    """赤い値札風スタンプ（−16%）。傾けて貼る。t0から0.3秒でドンと出る"""
    u = t - t0
    sc = 1.0 if u > 0.45 else (1.06 - 0.06 * ease_back(u / 0.3) if u >= 0 else 1.06)
    fs = 300 * sc
    f = F("b", fs)
    tmp = Image.new("RGBA", (1080, 620), (0, 0, 0, 0))
    td = ImageDraw.Draw(tmp)
    w, h, ox, oy = tw(td, s, f)
    pw, ph = w + 110, h + 90
    x0, y0 = (1080 - pw) / 2, (620 - ph) / 2
    td.rounded_rectangle([x0, y0, x0 + pw, y0 + ph], radius=34, fill=RED)
    td.rounded_rectangle([x0 + 12, y0 + 12, x0 + pw - 12, y0 + ph - 12], radius=26, outline=WHITE, width=6)
    td.text(((1080 - w) / 2 - ox, (620 - h) / 2 - oy - 6), s, font=f, fill=WHITE)
    tmp = tmp.rotate(6, resample=Image.BICUBIC, expand=False)
    return tmp

def draw_chart(d, t, t0, data, x0=140, x1=900, ytop=560, ybot=1000):
    """右下がりの折れ線。t0から1.4秒で描く"""
    p = ease_out((t - t0) / 1.4)
    pts = [(x0, ytop), (x0 + (x1 - x0) * 0.32, ytop + 8), (x0 + (x1 - x0) * 0.58, ytop + 30), (x1, ybot)]
    # 段差の分かる折れ線
    n = 60
    line = []
    for i in range(n + 1):
        u = i / n
        xx = x0 + (x1 - x0) * u
        yy = ytop + (ybot - ytop) * (1 / (1 + math.exp(-14 * (u - 0.72))))
        line.append((xx, yy))
    k = int(len(line) * p)
    if k >= 2:
        d.line(line[:k], fill=RED, width=14, joint="curve")
        ex, ey = line[k - 1]
        d.ellipse([ex - 20, ey - 20, ex + 20, ey + 20], fill=WHITE, outline=RED, width=8)
    d.line([(x0, ytop - 30), (x1, ytop - 30)], fill=(70, 70, 70), width=3)   # 前回の価格線
    d.line([(x0, ybot + 30), (x1, ybot + 30)], fill=(70, 70, 70), width=3)


_imgcache = {}
def product_card(path, size, radius=36, pad=22):
    """商品画像を白い角丸カードに収める（縦横比を保つ）。pathが無ければNone"""
    if not path or not os.path.exists(path):
        return None
    k = (path, size)
    if k in _imgcache: return _imgcache[k]
    im = Image.open(path).convert("RGBA")
    box = size - pad * 2
    r = min(box / im.width, box / im.height)
    im = im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))), Image.LANCZOS)
    card = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    card.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    card.putalpha(mask)
    _imgcache[k] = card
    return card

def product_cut(path, h):
    """切り抜き画像を高さhにそろえて返す（白カードなし）"""
    if not path or not os.path.exists(path): return None
    k = (path, "cut", h)
    if k in _imgcache: return _imgcache[k]
    im = Image.open(path).convert("RGBA")
    r = h / im.height
    im = im.resize((max(1, int(im.width * r)), h), Image.LANCZOS)
    _imgcache[k] = im
    return im


COLLAGE = [  # (切り抜き名, 中心x, 中心y, 高さ, 回転)
 ("xplosion_whey_3kg_milkchoco",   90, 300, 760, -8),
 ("savas_whey100_1kg_richchocolat",   520, 230, 640, 5),
 ("optimum_goldstandard_704g_milkchoco", 960, 330, 720, 9),
 ("lohastyle_grassfed_whey_1kg_plain",  120, 820, 700, 6),
 ("verifyst_whey_3kg_choco",   980, 860, 760, -6),
 ("alpron_wpi_900g_doublechoco",  250, 1300, 700, -7),
 ("kentai_powerbody_350g_milkchoco", 860, 1330, 640, 7),
 ("limitest_whey_peptide_500g_plain", 540, 1520, 640, -4),
 ("xplosion_whey_goldeneggs_milkchoco", 110, 1660, 640, 8),
 ("reys_whey_protein_cafe_au_lait_1kg", 980, 1680, 660, -9),
 ("valx_whey_1kg_plain", 560, 1760, 560, 3),
]
_coll = {}
def collage_bg(kind="hook"):
    """プロテイン袋を敷き詰めた背景（暗く落として文字を読ませる）"""
    if kind in _coll: return _coll[kind]
    base = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    for name, cx, cy, h, rot in COLLAGE:
        p = f"assets/canva_cutouts/{name}.png"
        if not os.path.exists(p): continue
        im = Image.open(p).convert("RGBA")
        r = h / im.height
        im = im.resize((max(1, int(im.width * r)), h), Image.LANCZOS).rotate(rot, expand=True, resample=Image.BICUBIC)
        # 影
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0)); sh.putalpha(im.getchannel("A").point(lambda v: int(v * 0.7)))
        base.alpha_composite(sh, (int(cx - im.width / 2 + 14), int(cy - im.height / 2 + 18)))
        base.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))
    rgb = base.convert("RGB")
    dim = Image.eval(rgb, lambda v: int(v * 0.78))
    # 文字帯の暗幕（上：見出し／下：商品名・価格）
    ov = Image.new("L", (W, H), 0); od = ImageDraw.Draw(ov)
    for y in range(H):
        a = 0
        if kind == 'cta':
            if 230 <= y <= 1420: a = 185
            elif 130 < y < 230: a = int(185 * (y - 130) / 100)
            elif 1420 < y < 1520: a = int(185 * (1520 - y) / 100)
            od.line([(0, y), (W, y)], fill=a); continue
        if 180 <= y <= 720: a = 165
        elif 720 < y < 820: a = int(150 * (820 - y) / 100)
        elif 1150 <= y <= 1560: a = 175
        elif 1100 < y < 1150: a = int(175 * (y - 1100) / 50)
        od.line([(0, y), (W, y)], fill=a)
    from PIL import ImageFilter
    ov = ov.filter(ImageFilter.GaussianBlur(45))
    dim = Image.composite(Image.new("RGB", (W, H), (0, 0, 0)), dim, ov)
    _coll[kind] = dim
    return dim

def paste_card(img, card, x, y, a=1.0):
    if card is None: return
    if a < 1.0:
        c = card.copy(); al = c.getchannel("A").point(lambda v: int(v * a)); c.putalpha(al); card = c
    img.paste(card, (int(x), int(y)), card)

def scene(img, d, data, t):
    drop = data["prev_price"] - data["price"]
    pct = 100.0 * drop / data["prev_price"]
    S_SAFE_BOTTOM = 1500

    # 共通：取得日時（安全領域内・小さく）
    fade_note = ease_out((t - 0.3) / 0.4)
    text_c(d, 1490, f"取得：{data['fetched_label']}｜筋トレ最安ナビ調べ", F("m", 30), GRAY, fade_note)

    card = product_card(data.get("product_image"), 500)
    if t < 2.6 and card is not None:  # ===== フック（商品画像あり）=====
        img.paste(collage_bg(), (0, 0))
        d = ImageDraw.Draw(img)
        sx, sy = shake(t, 0.05)
        d.rounded_rectangle([340, 250, 740, 336], radius=43, fill=YEL)
        text_c(d, 262, f"{data['date_label']} 速報", F("b", 58), BLACK, 1, sx * 0.3, sy * 0.3)
        text_c(d, 360, f"{data['category']}が", F("b", 104), WHITE, 1, sx * 0.5, stroke=6)
        text_c(d, 480, "値下がり！", F("b", 150), YEL, 1, sx * 0.5, sy * 0.5, stroke=8)
        # 左：値札スタンプ／右：商品画像（重ねない）
        cut = product_cut(data.get("product_image"), 640)
        cx_img, top = 740, 650
        img.paste(cut, (int(cx_img - cut.width / 2 + sx * 0.3), int(top + sy * 0.3)), cut)
        st = stamp(img, f"−{pct:.0f}%", t, 0.0)
        st = st.resize((int(st.width * 0.62), int(st.height * 0.62)))
        img.paste(st, (int(300 - st.width / 2 + sx), int(top + 280 - st.height / 2 + sy)), st)
        text_c(d, 1270, data["product"].replace("\n", " "), F("b", 58), WHITE, 1, stroke=5)
        text_c(d, 1352, f"{yen(data['prev_price'])}円 → {yen(data['price'])}円", F("b", 76), WHITE, 1, stroke=5)
        return
    if t < 2.6:  # ===== フック（0秒の1コマ目から完成）=====
        sx, sy = shake(t, 0.05)
        # 上部：速報ピル
        D=90
        d.rounded_rectangle([340, 250 + D, 740, 336 + D], radius=43, fill=YEL)
        text_c(d, 262 + D, f"{data['date_label']} 速報", F("b", 58), BLACK, 1, sx * 0.3, sy * 0.3)
        # 見出し
        text_c(d, 380 + D, f"{data['category']}が", F("b", 132), WHITE, 1, sx * 0.5)
        text_c(d, 540 + D, "値下がり！", F("b", 190), YEL, 1, sx * 0.5, sy * 0.5)
        # スタンプ
        st = stamp(img, f"−{pct:.0f}%", t, 0.0)
        img.paste(st, (int(0 + sx), int(690 + D + sy - 70)), st)
        # 商品名（最初の2.6秒で必ず見せる）
        text_c(d, 1180 + D, data["product"].replace("\n", " "), F("b", 62), WHITE, 1)
        # 価格の前後
        text_c(d, 1280 + D, f"{yen(data['prev_price'])}円 → {yen(data['price'])}円", F("b", 84), WHITE, ease_out((t - 0.5) / 0.3))
        if t > 0.7:
            wv, hv, _, _ = tw(d, f"{yen(data['prev_price'])}円", F("b", 84))
        # フラッシュ（最初の3フレームだけ白く光る→サムネは通常版を別出力）
        return

    if t < 9.0:  # ===== 価格の変化 =====
        u = t - 2.6
        a = ease_out(u / 0.3)
        text_c(d, 250, "値下がり情報", F("b", 84), WHITE, a)
        text_c(d, 380, "前回", F("m", 52), GRAY, a)
        text_c(d, 445, f"{yen(data['prev_price'])}円", F("b", 120), GRAY, a)
        wv, hv, _, _ = tw(d, f"{yen(data['prev_price'])}円", F("b", 120))
        if u > 0.6:  # 打ち消し線が走る
            pr = ease_out((u - 0.6) / 0.35)
            x_a = (W - wv) / 2 - 10
            d.line([x_a, 520, x_a + (wv + 20) * pr, 520], fill=RED, width=12)
        draw_chart(d, t, 2.6 + 0.9, data, ytop=690, ybot=1050)
        # カウントダウン
        p = ease_out((u - 1.0) / 1.7)
        cur = data["prev_price"] - drop * p
        arrive = (u - 2.7)
        col = RED if p >= 1 else WHITE
        fs = 200 * (1 + 0.06 * max(0, 1 - arrive * 4) if arrive > 0 else 1)
        text_c(d, 1120, f"{yen(cur)}円", F("b", fs), col, ease_out((u - 0.8) / 0.3))
        text_c(d, 1350, f"−{yen(drop)}円（−{pct:.1f}%）", F("b", 70), WHITE, ease_out((u - 3.0) / 0.4))
        return

    if t < 14.0:  # ===== 店・単価 =====
        u = t - 9.0
        a = ease_out(u / 0.3)
        text_c(d, 250, "買う前に確認", F("b", 84), WHITE, a)
        # カード1：単価
        d.rounded_rectangle([60, 420, 910, 800], radius=36, outline=(90, 90, 90), width=5)
        sm = product_card(data.get("product_image"), 260)
        paste_card(img, sm, 95, 480, ease_out((u - 0.1) / 0.3))
        ox = 175 if sm is not None else 0
        text_c(d, 470, data["unit_label"], F("m", 56), GRAY, ease_out((u - 0.2) / 0.3), dx=ox)
        text_c(d, 548, f"{yen(data['unit_price'])}円", F("b", 170 if sm is not None else 210), WHITE, ease_out((u - 0.35) / 0.3), dx=ox)
        # カード2：販売店
        d.rounded_rectangle([60, 860, 910, 1120], radius=36, outline=(90, 90, 90), width=5)
        text_c(d, 890, "販売店", F("m", 50), GRAY, ease_out((u - 1.0) / 0.3))
        text_c(d, 960, data["shop"], F("b", 66), WHITE, ease_out((u - 1.1) / 0.3))
        text_c(d, 1180, "※送料・ポイントは店舗で異なります", F("m", 44), GRAY, ease_out((u - 1.8) / 0.4))
        text_c(d, 1250, "※価格は常に変動します", F("m", 44), GRAY, ease_out((u - 2.1) / 0.4))
        return

    # ===== CTA =====
    u = t - 14.0
    a = ease_out(u / 0.3)
    text_c(d, 330, "毎日、最新の安値を更新", F("b", 74), WHITE, a)
    text_c(d, 480, "筋トレ", F("b", 200), RED, ease_out((u - 0.3) / 0.3))
    text_c(d, 700, "最安ナビ", F("b", 200), WHITE, ease_out((u - 0.5) / 0.3))
    text_c(d, 1050, "フォローで毎日チェック", F("b", 66), YEL, ease_out((u - 1.2) / 0.3))
    text_c(d, 1170, data["url_label"], F("m", 52), WHITE, ease_out((u - 1.6) / 0.3))
    text_c(d, 1270, "プロテイン・クレアチン・ジム", F("m", 44), GRAY, ease_out((u - 2.0) / 0.3))

def frame(data, t):
    img = Image.new("RGB", (W, H), BLACK)
    d = ImageDraw.Draw(img)
    scene(img, d, data, t)
    # フラッシュ（0〜0.12秒、動画の演出のみ）
    if 0.0 <= t < 0.12 and False:
        pass
    return img

# ---------- 効果音（合成）----------
SR = 44100
def _add(buf, sig, t0, gain=1.0):
    i = int(t0 * SR); n = min(len(sig), len(buf) - i)
    if n > 0: buf[i:i + n] += sig[:n] * gain
def kick(dur=0.35):
    t = np.arange(int(SR * dur)) / SR
    f = 45 + 120 * np.exp(-t * 18)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
def hat(dur=0.05):
    t = np.arange(int(SR * dur)) / SR
    return np.random.RandomState(1).randn(len(t)) * np.exp(-t * 80) * 0.5
def whoosh(dur=0.5):
    t = np.arange(int(SR * dur)) / SR
    n = np.random.RandomState(2).randn(len(t))
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2
    # 簡易ローパス→ハイパスで空気感
    k = np.convolve(n, np.ones(24) / 24, mode="same")
    return k * env * 1.4
def tick(dur=0.03):
    t = np.arange(int(SR * dur)) / SR
    return np.sin(2 * np.pi * 1800 * t) * np.exp(-t * 120) * 0.6
def ding(dur=0.9):
    t = np.arange(int(SR * dur)) / SR
    return (np.sin(2 * np.pi * 1318 * t) + 0.5 * np.sin(2 * np.pi * 1975 * t)) * np.exp(-t * 4.5) * 0.5

def make_audio(path):
    buf = np.zeros(int(SR * DUR))
    # 冒頭のインパクト（0.0秒）
    _add(buf, kick(0.6), 0.0, 1.1)
    _add(buf, whoosh(0.35), 0.0, 0.5)
    # 軽いビート（0.5秒刻みのキック弱め＋ハイハット）
    bt = 0.5
    k = 1
    while k * bt < DUR - 0.2:
        _add(buf, kick(0.25), k * bt, 0.28)
        _add(buf, hat(), k * bt + bt / 2, 0.22)
        k += 1
    # シーン切り替えのウッシュ
    for ts in (2.6, 9.0, 14.0):
        _add(buf, whoosh(0.45), ts - 0.15, 0.55)
        _add(buf, kick(0.4), ts, 0.7)
    # カウントダウンのティック（3.6〜5.3秒）
    for i in range(18):
        _add(buf, tick(), 3.6 + i * 0.1, 0.5)
    # 到達のチャイム
    _add(buf, ding(), 5.3, 0.9)
    _add(buf, ding(), 14.4, 0.5)
    buf = np.tanh(buf * 0.9) * 0.8
    pcm = (buf * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

def main():
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    out = sys.argv[2]
    cover = sys.argv[3] if len(sys.argv) > 3 else None
    wav = os.path.join(tempfile.gettempdir(), "kintore_sfx.wav")
    make_audio(wav)
    if cover:
        frame(data, 1.0).save(cover)  # カバー画像：スタンプが出そろった状態
    cmd = ["ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-i", wav, "-t", str(DUR),
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "medium",
           "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    for i in range(int(DUR * FPS)):
        p.stdin.write(frame(data, i / FPS).tobytes())
    p.stdin.close(); p.wait()
    print("done", out)

if __name__ == "__main__":
    main()
