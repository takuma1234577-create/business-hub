#!/usr/bin/env python3
"""HeyGen API でアバターの実写トーク素材だけを生成する。

台本 JSON の各センテンスを 1 本ずつ生成し、clips/ に保存する。
字幕・テロップ・ティア表は付けない（edit.py で後から合成する）。

必要な環境変数: HEYGEN_API_KEY
使い方:
  python3 heygen_generate.py episodes/breakfast-tier.json --out work/breakfast-tier
  python3 heygen_generate.py --list   # アバターとボイスの一覧を表示
"""
import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

API = "https://api.heygen.com"
AVATAR_NAME = "SNS TAKUMA"
VOICE_NAME = "Ta U"


def session():
    key = os.environ.get("HEYGEN_API_KEY")
    if not key:
        sys.exit("HEYGEN_API_KEY が設定されていません。")
    s = requests.Session()
    s.headers.update({"X-Api-Key": key, "Accept": "application/json"})
    return s


def get(s, path, **params):
    r = s.get(API + path, params=params, timeout=60)
    r.raise_for_status()
    return r.json().get("data") or {}


def list_avatars(s):
    """通常アバター＋アバターグループ（デジタルツイン）内のルックをまとめて返す。"""
    found = []
    data = get(s, "/v2/avatars")
    for a in data.get("avatars", []):
        found.append(("avatar", a.get("avatar_id"), a.get("avatar_name", "")))
    for t in data.get("talking_photos", []):
        found.append(("talking_photo", t.get("talking_photo_id"), t.get("talking_photo_name", "")))
    try:
        groups = get(s, "/v2/avatar_group.list", include_public="false").get("avatar_group_list", [])
    except requests.HTTPError:
        groups = []
    for g in groups:
        try:
            looks = get(s, f"/v2/avatar_group/{g['id']}/avatars").get("avatar_list", [])
        except requests.HTTPError:
            continue
        for a in looks:
            found.append(("avatar", a.get("avatar_id") or a.get("id"), f"{g.get('name', '')} / {a.get('avatar_name') or a.get('name', '')}"))
    return found


def list_voices(s):
    return [(v.get("voice_id"), v.get("name", ""), v.get("language", "")) for v in get(s, "/v2/voices").get("voices", [])]


def pick(items, name, key):
    exact = [i for i in items if key(i).strip() == name]
    if exact:
        return exact[0]
    loose = [i for i in items if name.lower() in key(i).lower()]
    if loose:
        return loose[0]
    sys.exit(f"「{name}」が見つかりません。--list で名前を確認し、--avatar-id / --voice-id で指定してください。")


def submit(s, text, avatar, voice_id, speed, avatar_iv):
    kind, avatar_id = avatar
    character = {"type": kind}
    if kind == "talking_photo":
        character["talking_photo_id"] = avatar_id
    else:
        character.update({"avatar_id": avatar_id, "avatar_style": "normal"})
    if avatar_iv:
        character["use_avatar_iv_model"] = True
    body = {
        "video_inputs": [{
            "character": character,
            "voice": {"type": "text", "input_text": text, "voice_id": voice_id, "speed": speed},
        }],
        "dimension": {"width": 1080, "height": 1920},
        "caption": False,
    }
    r = s.post(API + "/v2/video/generate", json=body, timeout=60)
    if r.status_code >= 400:
        raise RuntimeError(f"生成の依頼に失敗: {r.status_code} {r.text[:300]}")
    return r.json()["data"]["video_id"]


def wait_and_download(s, video_id, dest):
    while True:
        d = get(s, "/v1/video_status.get", video_id=video_id)
        st = d.get("status")
        if st == "completed":
            with s.get(d["video_url"], stream=True, timeout=300) as r:
                r.raise_for_status()
                with open(dest, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            return dest
        if st == "failed":
            raise RuntimeError(f"{video_id} の生成に失敗: {d.get('error')}")
        time.sleep(15)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("episode", nargs="?")
    ap.add_argument("--out")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--avatar-id")
    ap.add_argument("--avatar-type", default="avatar", choices=["avatar", "talking_photo"])
    ap.add_argument("--voice-id")
    ap.add_argument("--speed", type=float, default=1.2)
    ap.add_argument("--avatar-iv", action="store_true", help="Avatar IV（表情豊かなモデル）を使う")
    ap.add_argument("--only", help="作り直すセンテンス番号（1始まり、カンマ区切り）")
    args = ap.parse_args()
    s = session()

    if args.list:
        print("# アバター")
        for kind, aid, name in list_avatars(s):
            print(f"{kind}\t{aid}\t{name}")
        print("# ボイス（日本語）")
        for vid, name, lang in list_voices(s):
            if "ja" in (lang or "").lower() or "japan" in (lang or "").lower() or name == VOICE_NAME:
                print(f"{vid}\t{name}\t{lang}")
        return

    ep = json.loads(Path(args.episode).read_text(encoding="utf-8"))
    out = Path(args.out or f"work/{ep['id']}")
    (out / "clips").mkdir(parents=True, exist_ok=True)

    if args.avatar_id:
        avatar = (args.avatar_type, args.avatar_id)
    else:
        kind, aid, _ = pick(list_avatars(s), AVATAR_NAME, key=lambda a: a[2])
        avatar = (kind, aid)
    voice_id = args.voice_id or pick(list_voices(s), VOICE_NAME, key=lambda v: v[1])[0]
    print(f"アバター {avatar} / ボイス {voice_id}")

    targets = range(len(ep["sentences"]))
    if args.only:
        targets = [int(x) - 1 for x in args.only.split(",")]

    jobs = {}
    for i in targets:
        vid = submit(s, ep["sentences"][i]["voice"], avatar, voice_id, args.speed, args.avatar_iv)
        jobs[i] = vid
        print(f"依頼 {i + 1:02d}: {vid}")
    (out / "jobs.json").write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")

    with ThreadPoolExecutor(max_workers=5) as ex:
        futs = {i: ex.submit(wait_and_download, s, vid, out / "clips" / f"{i + 1:02d}.mp4") for i, vid in jobs.items()}
        for i, f in futs.items():
            print(f"完了 {i + 1:02d}: {f.result()}")


if __name__ == "__main__":
    main()
