# -*- coding: utf-8 -*-
"""筋トレ最安ナビ 日次ショート自動投稿。
価格DB(Supabase, 公開読み取り) → カテゴリ選択 → ランキング/値下がり算出 → 動画生成 → Upload-Post投稿。
環境変数: SUPABASE_URL, SUPABASE_KEY(公開anon), DRY_RUN(既定true), PUBLISH(trueのときのみ実投稿),
          UPLOAD_POST_API_KEY, UPLOAD_POST_USER, FIXTURE(テスト用: offers/historyのJSON)"""
import json, os, sys, subprocess, datetime as dt, urllib.request, urllib.parse
from zoneinfo import ZoneInfo

JST = ZoneInfo("Asia/Tokyo")
ROOT = os.path.dirname(os.path.abspath(__file__))
MASTER = json.load(open(os.path.join(ROOT, "master.json"), encoding="utf-8"))
MIN_DROP_PCT = 2.0      # これ未満の値動きは「値下がり」として扱わない
MAX_AGE_H = 36          # 価格の取得からこの時間を超えたら古いデータとして除外
SITE = "https://fitpeak.co/pages/compare"

def log(*a): print(*a, flush=True)

def http_json(path):
    base, key = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_KEY"]
    req = urllib.request.Request(f"{base}/rest/v1/{path}", headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)

def load_db(ids, now):
    if os.environ.get("FIXTURE"):
        fx = json.load(open(os.environ["FIXTURE"], encoding="utf-8")); return fx["offers"], fx["history"]
    inl = "in.(" + ",".join(ids) + ")"
    offers = http_json(f"pc_offers?select=item_id,source,price,shop,status,fetched_at&item_id={urllib.parse.quote(inl, safe='(),.')}")
    since = (now - dt.timedelta(days=8)).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    history = http_json(f"pc_price_history?select=item_id,source,price,fetched_at&item_id={urllib.parse.quote(inl, safe='(),.')}&fetched_at=gte.{since}&order=fetched_at.desc&limit=5000")
    return offers, history

def parse_ts(s): return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))

def metric(cat, it, price):
    if cat["basis"] == "protein20":
        return price / (it["size_g"] * it["protein_pct"] / 100.0) * 20.0
    return price / it["size_g"] * cat["dose_g"]

def fmt_metric(v): return f"{v:.0f}円" if v >= 100 else f"{v:.1f}円".replace(".0円", "円")

def best_offers(cat, offers, now):
    """商品ごとに、有効かつ新しい提示の中で最安のものを採用"""
    by = {}
    for o in offers:
        if o.get("price") is None or o["price"] <= 0: continue
        if o.get("status") not in (None, "ok", "OK", "active"): continue
        if o["source"] not in MASTER["channel_map"]: continue
        if (now - parse_ts(o["fetched_at"])).total_seconds() > MAX_AGE_H * 3600: continue
        if o["item_id"] not in by or o["price"] < by[o["item_id"]]["price"]: by[o["item_id"]] = o
    rows = []
    for it in cat["items"]:
        o = by.get(it["id"])
        if not o: continue
        rows.append(dict(it=it, offer=o, price=o["price"], m=metric(cat, it, o["price"])))
    return rows

def find_drop(rows, history):
    """同じ販売先の直近履歴で、最新価格が直前の異なる価格より MIN_DROP_PCT 以上安い商品のうち下落率最大のもの"""
    best = None
    for r in rows:
        h = sorted([x for x in history if x["item_id"] == r["it"]["id"] and x["source"] == r["offer"]["source"]],
                   key=lambda x: x["fetched_at"], reverse=True)
        if not h or h[0]["price"] != r["price"]: continue
        prev = next((x["price"] for x in h if x["price"] != r["price"]), None)
        if prev is None or prev <= r["price"]: continue
        pct = 100.0 * (prev - r["price"]) / prev
        if pct >= MIN_DROP_PCT and (best is None or pct > best[0]): best = (pct, prev, r)
    return best

def img_path(name): return f"assets/canva_cutouts/{name}.png"

def build(cat_key, now):
    cat = MASTER["categories"][cat_key]
    offers, history = load_db([i["id"] for i in cat["items"]], now)
    rows = best_offers(cat, offers, now)
    if len(rows) < 5: log(f"[{cat_key}] 有効な商品が{len(rows)}件のため対象外"); return None
    rows = [r for r in rows if os.path.exists(os.path.join(ROOT, img_path(r["it"]["img"])))]
    if len(rows) < 5: log(f"[{cat_key}] 画像付き商品が不足"); return None
    drop = find_drop(rows, history)
    if not drop: log(f"[{cat_key}] 値下がり商品なし"); return None
    top = sorted(rows, key=lambda r: r["m"])[:5]          # 最安5件
    # 同一ブランド・同一画像の重複（容量違い）は安い方のみ
    seen, uniq = set(), []
    for r in sorted(rows, key=lambda r: r["m"]):
        if r["it"]["img"] in seen: continue
        seen.add(r["it"]["img"]); uniq.append(r)
    top = uniq[:5]
    if len(top) < 5: log(f"[{cat_key}] 重複除外後の商品が不足"); return None
    top_desc = list(reversed(top))                          # 5位→1位
    cm = MASTER["channel_map"]
    when = f"{now.year}年{now.month}月{now.day}日時点"
    ranking = []
    for r in top_desc:
        size = f"{r['it']['size_g']/1000:g}kg" if r["it"]["size_g"] >= 1000 else f"{r['it']['size_g']}g"
        ranking.append(dict(name=r["it"]["name"], size=size, price=r["price"], metric_str=fmt_metric(r["m"]),
                            p20=round(r["m"], 1), channel=cm[r["offer"]["source"]], ship="送料は店舗で異なる",
                            when=when, img=img_path(r["it"]["img"]), brand=r["it"]["brand"]))
    pct, prev, dr = drop
    it = dr["it"]
    psize = f"{it['size_g']/1000:g}kg" if it["size_g"] >= 1000 else f"{it['size_g']}g"
    coll = [r["it"]["img"] for r in top_desc] + [r["it"]["img"] for r in rows if r["it"]["img"] not in {x["it"]["img"] for x in top_desc}] + cat.get("collage_extra", [])
    out, seen = [], set()
    for c in coll:
        if c in seen or not os.path.exists(os.path.join(ROOT, img_path(c))): continue
        seen.add(c); out.append(c)
    base = list(out)
    while len(out) < 11: out.append(base[len(out) % len(base)])
    shop = (dr["offer"].get("shop") or "").strip()
    data = dict(date_label=f"{now.month}/{now.day}", type="price_drop", flavor="", url_label="fitpeak.co/pages/compare",
                date_full=f"{now.year}年{now.month}月{now.day}日",
                fetched_label=f"{now.year}年{now.month}月{now.day}日 {now.hour}:{now.minute:02d}時点",
                category=cat["category"], rank_title=cat["rank_title"], metric_label=cat["metric_label"], ranking=ranking,
                product=f"{it['name']} {psize}", product_brand=it["brand"], product_image=img_path(it["img"]),
                shop=f"{shop}（{cm[dr['offer']['source']]}）" if shop else cm[dr["offer"]["source"]],
                prev_price=prev, price=dr["price"], unit_label=cat["metric_label"], unit_price=round(dr["m"]), collage=out[:11])
    return data, dict(top1=top[0], drop=(pct, prev, dr))

def caption(cat_name, now, info):
    t1 = info["top1"]; pct, prev, dr = info["drop"]
    title = f"【{now.month}/{now.day}最新】{cat_name}最安ランキング＆値下がり情報"
    body = (f"{title}\n1位：{t1['it']['name']}（{fmt_metric(t1['m'])}）\n"
            f"値下がり：{dr['it']['name']} {prev:,}円→{dr['price']:,}円（−{pct:.1f}%）\n"
            f"詳しい比較は筋トレ最安ナビ → {SITE}?utm_source=shorts&utm_medium=social&utm_campaign=daily\n"
            f"※取得時点の価格です。送料・ポイントは店舗で異なり、価格は変動します。\n"
            f"※AIで制作した動画です。\n#プロテイン #筋トレ #最安 #{cat_name.replace('・','')} #筋トレ最安ナビ")
    return title, body

def post(video, title, body):
    import requests
    key, user = os.environ["UPLOAD_POST_API_KEY"], os.environ["UPLOAD_POST_USER"]
    data = [("user", user), ("platform[]", "tiktok"), ("platform[]", "instagram"), ("platform[]", "youtube"),
            ("title", title[:100]), ("description", body), ("tiktok_title", body[:2200]), ("instagram_title", body[:2200]),
            ("youtube_title", title[:100]), ("media_type", "REELS"), ("is_aigc", "true"), ("privacyStatus", "public"),
            ("privacy_level", "PUBLIC_TO_EVERYONE"), ("async_upload", "true"), ("categoryId", "17")]
    with open(video, "rb") as f:
        r = requests.post("https://api.upload-post.com/api/upload", headers={"Authorization": f"Apikey {key}"},
                          data=data, files={"video": (os.path.basename(video), f, "video/mp4")}, timeout=600)
    log("Upload-Post:", r.status_code, r.text[:500]); r.raise_for_status(); return r.json()

def main():
    now = dt.datetime.fromisoformat(os.environ["NOW"]).astimezone(JST) if os.environ.get("NOW") else dt.datetime.now(JST)
    today = now.strftime("%Y-%m-%d")
    st_path = os.path.join(ROOT, "state", "posted.json")
    state = json.load(open(st_path)) if os.path.exists(st_path) else {}
    live = os.environ.get("PUBLISH", "").lower() == "true" and os.environ.get("DRY_RUN", "true").lower() != "true"
    if live and today in state: log("本日は投稿済みのため終了"); return 0
    order = MASTER["rotation"]; k = now.toordinal() % len(order)
    for cat_key in order[k:] + order[:k]:
        res = build(cat_key, now)
        if res: break
    else:
        log("本日は投稿できる値下がりがないためスキップ"); return 0
    data, info = res
    os.makedirs(os.path.join(ROOT, "out"), exist_ok=True)
    jp = os.path.join(ROOT, "out", f"data_{today}_{cat_key}.json"); json.dump(data, open(jp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    video = os.path.join(ROOT, "out", f"{today}_{cat_key}.mp4"); cover = os.path.join(ROOT, "out", f"{today}_{cat_key}_cover.png")
    p = subprocess.run([sys.executable, "make_video_v3.py", jp, video, cover], cwd=ROOT, capture_output=True, text=True)
    log(p.stdout[-400:]); 
    if p.returncode or "violations: 0" not in p.stdout: log(p.stderr[-800:]); log("動画生成または安全領域チェックに失敗"); return 1
    title, body = caption(data["category"], now, info); log(title); log(body)
    if not live: log("ドライラン：投稿しません"); return 0
    res = post(video, title, body)
    state[today] = dict(category=cat_key, result=res); json.dump(state, open(st_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return 0

if __name__ == "__main__": sys.exit(main())
