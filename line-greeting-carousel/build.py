"""公式LINE(FITPEAK)の友だち追加あいさつ: 短い自己紹介 + リッチカルーセル(Flex)を作る。

画像は ChatGPT で作成 → img/<key>.jpg → Supabase Storage line-media/greeting/ に上げて、そのURLを使う。
出力: greeting.json（message_templates.content にそのまま入れる形 {messages:[...]}）

python3 line-greeting-carousel/build.py  （画像はShopifyのファイル line-greeting-<key>.jpg）
"""
import json
import sys
from urllib.parse import quote, urlencode

IMG_BASE = sys.argv[1] if len(sys.argv) > 1 else 'https://cdn.shopify.com/s/files/1/0632/0658/8551/files/line-greeting-'
VER = sys.argv[2] if len(sys.argv) > 2 else '1'
LIFF = 'https://liff.line.me/2006537445-rcvSBpCP'


def site(path, key):
    q = urlencode({'utm_source': 'line', 'utm_medium': 'greeting', 'utm_campaign': 'welcome_carousel', 'utm_content': key})
    return f'{path}{"&" if "?" in path else "?"}{q}'


def myfp(redirect):
    # LINEの中で開くと、そのままLINEでMy FITPEAKにログインされる
    return f'{LIFF}?{urlencode({"mode": "myfp", "redirect": redirect})}'


CARDS = [
    ('myfitpeak', 'MY FITPEAK', '毎日ひらいて、ポイントを貯める',
     'LINEでそのままログイン。ご注文・クーポン・ポイントをひとつの場所で。', 'マイページを開く', myfp('/my-fitpeak')),
    ('creashot', 'CREASHOT', '持ち運べるクレアチン',
     'スティック1本で、いつでもどこでも。定期便のお申し込み・ご予約はこちら。', 'クレアショットを見る',
     site('https://fitpeak.co/products/' + quote('持ち運びクレアチン-creashot'), 'creashot')),
    ('gear', 'TRAINING GEAR', 'FITPEAKのトレーニングギア',
     'リストラップ、パワーグリップ、トレーニングベルト。自社開発のギアをそろえています。', 'ギアを見る',
     site('https://fitpeak.co/collections/' + quote('fitpeak筋トレギア一覧'), 'gear')),
    ('navi', 'FITPEAK NAVI', 'ホームジムの機材選び',
     '部屋の広さと予算に合わせて、ホームジムの機材をさがせます。', 'NAVIを開く',
     site('https://navi.fitpeak.co/', 'navi')),
    ('gotore', '合トレナビ', '近くのジムで、合トレ仲間を',
     'ジムごとの掲示板で、一緒にトレーニングする仲間をさがせます。', '掲示板を見る', myfp('/my-fitpeak/gotore')),
    ('compare', '筋トレ最安ナビ', 'プロテインの最安値がわかる',
     'プロテイン・クレアチン・アミノ酸の最安ランキングと、大型セールの日程。', '最安値を見る',
     site('https://fitpeak.co/pages/compare', 'compare')),
    ('score', '筋トレ偏差値', 'あなたの重量は、何位？',
     '筋トレ偏差値、1RM、総負荷量、PFC。トレーニングに役立つ計算ツール。', '測ってみる',
     site('https://fitpeak.co/pages/strength-score', 'score')),
]


def bubble(key, label, title, desc, btn, url):
    return {
        'type': 'bubble',
        'size': 'kilo',
        'hero': {
            'type': 'image', 'url': f'{IMG_BASE}{key}.jpg?v={VER}', 'size': 'full',
            'aspectRatio': '1:1', 'aspectMode': 'cover', 'action': {'type': 'uri', 'uri': url},
        },
        'body': {
            'type': 'box', 'layout': 'vertical', 'spacing': 'sm', 'paddingAll': '18px', 'paddingBottom': '8px',
            'contents': [
                {'type': 'text', 'text': label, 'size': 'xxs', 'weight': 'bold', 'color': '#86868b'},
                {'type': 'text', 'text': title, 'size': 'md', 'weight': 'bold', 'color': '#1d1d1f', 'wrap': True},
                {'type': 'text', 'text': desc, 'size': 'xs', 'color': '#6e6e73', 'wrap': True, 'maxLines': 3},
            ],
        },
        'footer': {
            'type': 'box', 'layout': 'vertical', 'paddingAll': '14px', 'paddingTop': '6px',
            'contents': [{
                'type': 'box', 'layout': 'vertical', 'cornerRadius': '999px', 'backgroundColor': '#111111',
                'paddingAll': '10px', 'action': {'type': 'uri', 'label': btn, 'uri': url},
                'contents': [{'type': 'text', 'text': btn, 'size': 'sm', 'weight': 'bold', 'color': '#ffffff', 'align': 'center'}],
            }],
        },
        'styles': {'body': {'backgroundColor': '#ffffff'}, 'footer': {'backgroundColor': '#ffffff'}},
    }


INTRO = (
    'はじめまして、FITPEAK代表のTakuです。\n'
    '友だち追加ありがとうございます！\n\n'
    '筋トレの楽しさを、もっと多くの人に。\n'
    'FITPEAKのサービスを下にまとめました。気になるものから、のぞいてみてください。\n\n'
    '目指せ日本総筋量1%UP！'
)

messages = [
    {'type': 'text', 'text': INTRO},
    {
        'type': 'flex',
        'altText': 'FITPEAKのサービス一覧（マイページ・クレアショット・ギア・NAVI・合トレナビ・最安ナビ・筋トレ偏差値）',
        'contents': {'type': 'carousel', 'contents': [bubble(*c) for c in CARDS]},
    },
]

out = json.dumps({'messages': messages}, ensure_ascii=False, indent=1)
open(__file__.rsplit('/', 1)[0] + '/greeting.json', 'w').write(out)
print(f'{len(CARDS)} cards, {len(out)} bytes')
