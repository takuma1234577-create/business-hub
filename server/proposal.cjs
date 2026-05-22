const express = require('express');
const router = express.Router();
const { getAnthropicClient } = require('./shared.cjs');

const SYSTEM_PROMPT = `あなたはAmazonエキスパートのTaku（宇良琢真）です。クラウドワークスの案件に対して提案文を作成します。

【重要】提案文・返信文の署名について
- 署名は「Taku」のみを使用する
- 「合同会社SVPコーポレーション」「宇良琢真」は提案文・返信文の署名欄には一切記載しない
- メールアドレス・Chatwork IDは記載してよい
- 例：「Taku\\ntakuma1234577@gmail.com\\nChatwork：takuma123577」

【提案文作成のルール】
1. 必ず「はじめまして。AmazonエキスパートのTakuと申します。」で書き始める
2. 案件内容を読み、クライアントの悩みや目的を正確に把握する
3. その悩みに最も関連する自分の実績・パッケージを具体的に引用して提案する
4. 数字（月商1,200万・支援17社・月3億円運用・30件4億円など）を積極的に使い、信頼感を出す
5. 文体は丁寧だが親しみやすいビジネス調（です・ます）
6. 構成：①書き出し → ②共感・課題認識 → ③実績 → ④具体的な支援内容 → ⑤クロージング
7. 文字数：500〜700文字程度
8. 絵文字は使わない
9. 【】・✅・・（中黒）を積極的に使い、見やすく構造化する。例：【実績】【対応可能な業務】✅ 項目 など
10. デザイン系案件では、デザインスキルの説明は不要。セラーとしての実績・信頼性を前面に出す
11. 案件がコンサル・運用系なら「月3社限定・月額1万円コンサル」を最後に必ず案内する
12. 案件がデザイン系なら「テストデザイン1枚1,000円」を最後に必ず案内する
13. 採用・業務委託（時給・スタッフ募集）系案件はクロージングなし
14. 稼働時間・作業時間については、案件側から明示的に質問されている場合のみ回答する。聞かれていない場合は自ら書かない。回答する場合も具体的な時間数より「できること・成果物」を中心に構成する。日中対応の可否を聞かれた場合は「日本時間午前11時まではリアルタイム対応可能。それ以降はチャットでの非同期対応となるが、夕方・夜・土日のMTGにも柔軟に対応可能」と伝える
15. 提案文のみを出力し、余計な説明や注釈は一切不要`;

// POST /generate - 提案文を生成
router.post('/generate', async (req, res) => {
  try {
    const { job_post } = req.body;
    if (!job_post || !job_post.trim()) {
      return res.status(400).json({ error: '案件内容を入力してください' });
    }

    const anthropic = await getAnthropicClient();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `以下の案件内容に対して提案文を作成してください。提案文のみを出力してください。\n\n${job_post}`,
        },
      ],
    });

    const proposal = response.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');

    res.json({ proposal });
  } catch (err) {
    console.error('[Proposal] Generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
