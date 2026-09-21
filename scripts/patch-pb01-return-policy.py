# -*- coding: utf-8 -*-
"""
PB-01 ナレッジ：返品条件を「未開封・未使用に限る」で確定させる更新。
2026-08-21 のオーナー判断（30日返品は未開封の場合のみ）を反映する。

使い方（~/business-hub で実行）:
    python3 scripts/patch-pb01-return-policy.py
そのあと:
    node scripts/sync-pb01-knowledge.cjs
"""
import io, json, os, sys, shutil, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
KB   = os.path.join(HERE, 'pb01-knowledge.json')

if not os.path.exists(KB):
    sys.exit(u'見つかりません: %s' % KB)

shutil.copy(KB, KB + '.bak-' + datetime.datetime.now().strftime('%Y%m%d%H%M%S'))

data = json.load(io.open(KB, encoding='utf-8'))
by = {c['source_id']: c for c in data}

def setc(sid, content, title=None):
    if sid not in by:
        c = {'source_id': sid, 'category': 'product', 'title': title or sid, 'content': content}
        data.append(c); by[sid] = c
        print(u'  (新規) %s' % sid)
    else:
        by[sid]['content'] = content
        if title: by[sid]['title'] = title
        print(u'  更新: %s' % sid)

setc('pb01:return-warranty', u"""保証: 1年間のメーカー保証（日本語サポート）
サポート: 公式LINEのサポート窓口（AIアシスタントが一次対応、込み入ったご相談は担当者が対応）

返品について（この内容のとおりに案内すること）:
・お客様のご都合による返品は、未開封・未使用の商品に限り、商品到着後30日以内に承ります。
・一度開封された商品、ご使用になった商品は、お客様のご都合ではご返品いただけません。
・初期不良、配送中の破損、説明と著しく異なる場合は、開封後でも交換・返品で対応します。
　この場合の返送料は当社が負担します。商品の状態がわかる写真をお送りいただけると対応がスムーズです。
・お客様のご都合による返品の返送料は、お客様のご負担となります。
・セール商品、アウトレット商品、特別キャンペーン対象商品は返品の対象外です。
・返品ポリシー: https://fitpeak.co/policies/refund-policy

よくある質問への回答例:
Q「30日以内なら返品できますか？」
A「未開封・未使用の状態でしたら、到着後30日以内のご返品を承ります。すでに開封されている場合は、
　お客様のご都合でのご返品はお受けできません。商品に不具合や破損がある場合は、開封後でも
　交換・返品で対応いたしますので、状態がわかるお写真とあわせてご連絡ください。」

Q「使ってみて合わなかったら返せますか？」
A「申し訳ありません。一度ご使用になった商品は、お客様のご都合でのご返品はお受けできません。
　サイズや使い方でご不安な点があれば、ご購入前にこちらでお答えしますのでお気軽にご相談ください。」

【回答時の注意】
・「30日間、理由を問わず返品できます」「使ったあとでも返品できます」といった無条件の案内は
　絶対にしないでください。返品ポリシーおよび商品ページの表記と食い違います。
・「30日間返品OK」という言い方はしないでください。必ず「未開封・未使用の場合に限り」を添えてください。
・返品・返金・交換の最終承認、30日を超えた依頼、ポリシー外の特別対応は、
　必ず担当者に確認のうえ回答してください（エスカレーション対象）。""",
u"PB-01 保証・返品・サポート")

json.dump(data, io.open(KB, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(u'\n完了: %s（合計 %d チャンク）' % (KB, len(data)))
print(u'次に実行してください:  node scripts/sync-pb01-knowledge.cjs')
