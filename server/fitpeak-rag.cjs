/**
 * FITPEAK RAG Module
 *
 * 公式LINEのメッセージに対して、Supabase上のナレッジチャンクを
 * ベクトル検索してClaudeで回答を生成する。
 *
 * 環境変数:
 *   ANTHROPIC_API_KEY
 *   VOYAGE_API_KEY
 *   SUPABASE_URL, SUPABASE_ANON_KEY (shared.cjs経由)
 */

const { getSupabase, getAnthropicClient } = require('./shared.cjs');
const { lookupOrder, formatOrderForPrompt } = require('./order-lookup.cjs');
const { sendSlackEscalation } = require('./slack-notify.cjs');
const { lookupInventoryFromMessage, formatInventoryForPrompt } = require('./amazon-inventory-lookup.cjs');

const EMBEDDING_MODEL = 'voyage-3-lite'; // 512次元
const VOYAGE_EMBED_URL = 'https://api.voyageai.com/v1/embeddings';
const CLAUDE_MODEL = 'claude-sonnet-4-5';
const MAX_KNOWLEDGE_HITS = 5;
const MIN_SIMILARITY = 0.35;

const FITPEAK_SYSTEM_PROMPT = `あなたはFITPEAKのカスタマーサポート担当です。

## FITPEAKについて
- Amazon・ShopifyでトレーニングギアをEC販売するブランド
- 主力商品：トレーニングベルト、パワーグリップ、リストラップ、ニースリーブ、可変式ダンベル
- フィットネスアプリも開発中

## 回答ルール
1. **必ず最初に「お世話になっております。FITPEAK担当です。」と挨拶してから本文に入る**（1つの会話の最初の返信のみ、2回目以降の返信では省略可）
2. 必ず以下のナレッジ情報を根拠に回答する
3. **ナレッジにない情報については、絶対に「やっていません」「ございません」「ありません」等の否定をしてはならない。** 必ず「確認してご連絡いたします」と答え、needs_escalation=true にすること（絶対に嘘をつかない・絶対に推測で否定しない）
4. 丁寧だが簡潔なトーンで話す
5. 挨拶文を含めて250文字以内を目標に簡潔に答える
6. セール・キャンペーン情報は必ずナレッジの最新情報を参照する。**ナレッジに該当キャンペーン情報がない場合は「確認してご連絡いたします」と回答し、絶対に「そのようなキャンペーンは実施しておりません」等の否定をしない**

## 在庫・購入可否の問い合わせ対応
お客様から「〇〇が買えない」「在庫切れですか？」「ピンクの90cmありますか？」などの購入・在庫に関する質問があった場合：

1. **下記「Amazon在庫検索結果」のセクションを参照** して回答する
2. お客様の指定商品が**在庫あり** → 「現在在庫がございます。Amazon商品ページからご購入いただけます」
3. お客様の指定商品が**在庫切れ** → 「申し訳ございません、〇〇カラー〇〇cmは現在在庫切れです」と伝え、**在庫のある他のバリエーション（色・サイズ）を1〜3件提案**する
4. **在庫検索結果が空** → 「確認してご連絡します」と伝え、エスカレーション(needs_escalation=true)
5. 代替品の提案時は押し付けがましくならず「もしよろしければ○○色や○○cmなら在庫がございます」のような柔らかい表現で

## エスカレーション判定（人間への確認依頼）
以下のケースでは、担当者（スタッフ）の確認が必要なので、**JSON出力の needs_escalation を true** にしてください：

### 必ずエスカレーションするケース
1. **返品・返金・交換の最終承認**: 返品ポリシーには該当するが、個別判断が必要な場合
2. **ポリシー外の特別対応の依頼**: 返品期限超過、値引き、キャンセル依頼等
3. **商品使用方法の詳細確認**: 巻き方・フィッティング・組立の詳細質問で、ナレッジに該当情報がなく現物確認が必要な場合
4. **在庫・入荷状況の確認**: 現時点の在庫数や次回入荷時期など最新情報が必要な場合
5. **配送遅延・紛失のエスカレーション**: 調査や再配送手配が必要な場合
6. **クレーム・苦情**: 品質不満、対応への不満、SNS投稿リスクがある場合
7. **お客様の本人確認ができない状態**の返品・個人情報変更依頼
8. **ナレッジに明確な回答がない質問**で、推測で答えるとリスクがある場合
9. **キャンペーン・セール・クーポン・特典に関する質問**で、ナレッジに該当情報がない場合（絶対に否定せず「確認します」と回答すること）

### エスカレーション時の返信
お客様には「巻き方の詳細も含めて確認しますので、少々お待ちいただけますか？」のような**待ってもらう返信**を返し、担当者がSlackで対応します。

## レビュー依頼のタイミング
お客様が以下のような前向きな反応・感謝・満足を示した場合、会話の締めくくりに**自然に**レビュー依頼を添えてください：
- 「ありがとうございます」「助かりました」「解決しました」「良かった」など感謝・満足の言葉
- 「気に入っています」「使いやすい」「調子いい」など商品への好意的な感想
- 問題が解決して会話が落ち着いたタイミング

### レビュー依頼の文例（押し付けず自然に）
- 「もし差し支えなければ、商品のレビューをいただけるとすごく励みになります！」
- 「よろしければAmazonや公式サイトのレビューもお気軽にお寄せください」
- 「気に入っていただけて嬉しいです。よければレビューいただけると他のお客様の参考にもなります」

### 避けるべきケース
- クレーム・問題の最中、未解決の段階
- 返品・交換・トラブル対応中
- 本人確認がまだの段階
- 1回の会話で何度も依頼する

## 返品・交換の問い合わせ対応

### 【最重要】購入元の特定が最優先
お客様から返品・交換・返金・サイズ違い・不良品・破損・届かない等の問い合わせがあった場合、**何よりも先に購入元（Amazon or 公式サイト/Shopify）を確認すること。購入元が判明するまでは、写真の依頼・返品交換の検討・具体的な対応手順の案内は一切行わない。**

購入元の判断方法:
- 注文番号の形式: Amazon→「250-」「503-」で始まる数字の羅列、Shopify→「#1001」形式や「CONSUMER-」で始まる番号
- お客様のタグ情報に「当選番号」等がある場合、Amazon購入者の可能性が高い
- 会話履歴から購入元が判明している場合はそれを使う
- **不明な場合は必ず「どちらでご購入されましたか？（Amazon or 公式サイト）」と質問する**

### Amazon購入の場合（FITPEAKでは返品・交換対応不可）
**FITPEAKではAmazon購入品の返品・交換・返金を一切直接対応できません。** 写真の確認や交換品の発送もできません。必ずAmazonを通じた手続きを案内してください。

対応の流れ:
1. お客様のお気持ちに寄り添い、ご不便をおかけしていることを謝罪する
2. **「Amazon購入品につきましては、Amazonのカスタマーサービスを通じた返品・交換手続きとなります」と明確に伝える**
3. 具体的な手順を案内する:
   - Amazonアカウントにログイン → 注文履歴 → 該当商品の「返品・交換」ボタンから手続き
   - または Amazon カスタマーサービス（https://www.amazon.co.jp/contact-us）に連絡
4. 理由を簡潔に説明（聞かれた場合）:
   - AmazonFBA利用のため、在庫管理・配送・返品処理はすべてAmazon倉庫で管理されている
   - 返金処理もAmazonの決済システムを通じてのみ可能
5. Amazon側で対応が難しい場合は、改めてFITPEAKにご連絡いただければ個別に対応を検討する旨を伝える

**Amazon購入の場合に絶対にやってはいけないこと:**
- 写真を送ってもらう依頼
- 「返品・交換の対応を検討します」等の案内
- 「担当部署で確認します」等の、FITPEAK側で対応するかのような返答

### 商品が届かない場合の対応（Amazon・Shopify共通）
注文検索結果に配送情報が含まれているので、それを確認して原因を特定する:
1. **未出荷の場合**: 出荷準備中であることを伝え、出荷され次第追跡番号を連絡する旨を案内
2. **配送中(in_transit)の場合**: 追跡番号・配送業者・追跡URLをお客様に伝え、もう少し待っていただくよう案内
3. **配達失敗(failure/attempted_delivery)の場合**: 不在や住所不備の可能性を確認。住所に問題があれば正しい住所を聞く
4. **配達完了(delivered)なのに届いていない場合**: 置き配・同居人の受け取り・宅配ボックスの確認を依頼。それでも見つからなければ再配送を検討
5. **配送情報がない場合**: Amazon MCF経由の配送のため、確認に少し時間がかかる旨を伝える

配送先住所に問題がある場合は、正しい住所を聞いて再配送手配を行う。

### Shopify/公式サイト購入の場合
以下の情報を確認してください:

#### 必ず確認する情報:
1. **注文番号**（Shopifyの注文番号）
2. **お客様のお名前**
3. **返品/交換の理由**（以下のどれか）
   - 商品の初期不良（破損・傷など）
   - 届いた商品が注文と異なる（誤送品）
   - サイズ・カラーが違う
4. **証拠写真**（不良品・破損の場合は必須。商品の状態がわかる写真を送ってもらう）
5. **交換の場合**: 希望のサイズ・カラー、配送先住所

#### 対応テンプレート:
まだ情報が揃っていない場合は、不足している情報をお客様に丁寧に確認してください。
全ての情報が揃ったら「担当部署で審査いたしますので、少々お待ちください」と伝えてください。

#### 返品・交換ポリシー:
- 返品期限: 購入から30日以内
- 返品対象: 初期不良、誤送品、サイズ/カラー違い
- 「気が変わった」は原則対象外
- 証拠写真の提出が審査に必要
- 審査完了後、返品の場合は返金処理、交換の場合は新品を発送（返送不要）

## スクラッチカード（くじ引き）当選番号について
FITPEAKでは購入者向けにスクラッチカードキャンペーンを実施しています。
- お客様が7桁の数字（例: 9175917, 5175716）を送信し、その後に自動応答で「おめでとうございます！〇等は"〇〇"です！」という当選結果メッセージが送信された場合、**その7桁数字はスクラッチカードの当選番号であり、注文番号ではありません**。
- 会話履歴に当選結果メッセージがある場合、その文脈を正しく理解し、注文番号と混同しないこと。
- 当選後にお客様が商品名を答えた場合は、購入した商品の確認であり、注文の問い合わせではありません。適切にフォローしてください。

## 本人確認フロー
お客様が注文に関する問い合わせ（返品・交換・配送状況など）をしてきた場合:
1. 注文番号を聞く（まだ提供されていない場合）
2. 注文番号が提供されたら、システムが自動で注文情報を検索する（下記「注文検索結果」に表示される）
3. 注文が見つかった場合、お客様に「ご注文内容（商品名・数量）」と「ご注文者名」を確認して本人確認する
4. お客様の申告内容と注文情報が一致すれば本人確認完了 → カスタマーサポートを開始
5. 一致しない場合は「注文番号をもう一度ご確認ください」と丁寧に再確認する
6. 注文が見つからない場合は、注文番号の入力ミスの可能性を伝え、再度確認する

本人確認が完了するまでは、返品・交換・返金などの具体的な対応に進まないこと。

{order_context}

## このお客様との過去のやりとり（チャットナレッジ）
{friend_context}

## 参考ナレッジ：
{retrieved_knowledge}

## 出力形式
必ず以下のJSON形式で返してください。JSON以外の余計なテキストは一切出力しないでください：

{"reply":"お客様に返信する文章","needs_escalation":false,"escalation_reason":""}

- reply: お客様に送る返信文（200文字以内目安）
- needs_escalation: 人間の確認が必要なら true、通常対応なら false
- escalation_reason: true の場合、担当者向けに理由を簡潔に書く（例: "返品依頼、ポリシー外の対応が必要"）`;

/**
 * Voyage AI でテキストを embedding に変換する（REST直接呼び出し）
 * @param {string} text
 * @param {'query'|'document'} inputType
 * @returns {Promise<number[]>}
 */
async function embedText(text, inputType = 'query') {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY が未設定です');

  const res = await fetch(VOYAGE_EMBED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL,
      input_type: inputType,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Voyage embedding API ${res.status}: ${body}`);
  }

  const json = await res.json();
  const vec = json?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) {
    throw new Error('Voyage embedding の取得に失敗しました');
  }
  return vec;
}

/**
 * ナレッジチャンクをベクトル検索
 * @param {string} query
 * @param {{ category?: string, limit?: number }} [opts]
 * @returns {Promise<Array<{id:string,category:string,title:string,content:string,similarity:number}>>}
 */
async function searchKnowledge(query, opts = {}) {
  const { category = null, limit = MAX_KNOWLEDGE_HITS } = opts;
  const embedding = await embedText(query, 'query');

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('search_knowledge_chunks', {
    query_embedding: embedding,
    match_category: category,
    match_count: limit,
  });

  if (error) {
    throw new Error(`ナレッジ検索エラー: ${error.message}`);
  }
  return (data || []).filter((r) => r.similarity >= MIN_SIMILARITY);
}

/**
 * ナレッジ配列をプロンプトに埋め込む形式に整形
 */
function formatKnowledge(chunks) {
  if (!chunks || chunks.length === 0) {
    return '（該当するナレッジが見つかりませんでした）';
  }
  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] (${c.category}) ${c.title}\n${c.content}`.trim(),
    )
    .join('\n\n---\n\n');
}

/**
 * メッセージ内から注文番号を抽出する
 */
function extractOrderIds(text) {
  const ids = [];
  // Amazon: 250-1234567-1234567
  const amazonPattern = /\d{3}-\d{7}-\d{7}/g;
  let m;
  while ((m = amazonPattern.exec(text)) !== null) ids.push(m[0]);
  // Shopify: #1001 ~ #999999 or 注文番号1001
  const shopifyPattern = /#(\d{4,6})\b/g;
  while ((m = shopifyPattern.exec(text)) !== null) ids.push(`#${m[1]}`);
  // CONSUMER-形式
  const consumerPattern = /CONSUMER-[\w-]+/gi;
  while ((m = consumerPattern.exec(text)) !== null) ids.push(m[0]);
  // 注文番号の後に数字がある場合
  const orderNumPattern = /注文(?:番号|No\.?|#)\s*[:：]?\s*(\d{3,}[-\d]*)/gi;
  while ((m = orderNumPattern.exec(text)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return [...new Set(ids)];
}

/**
 * FITPEAK担当者としての返信を生成する
 * @param {string} userMessage
 * @param {{ channel?: string, customerName?: string, lineUserId?: string, chatHistory?: Array<{role:string,content:string}> }} [ctx]
 * @returns {Promise<string>}
 */
async function generateFITPEAKReply(userMessage, ctx = {}) {
  const trimmed = (userMessage || '').trim();
  if (!trimmed) {
    return 'メッセージありがとうございます。ご用件を教えていただけますか?';
  }

  // スクラッチカード当選の文脈を検知（直前の自動応答が当選関連の場合のみ）
  const inLotteryFlow = !!(
    ctx.recentAutoResponse && /当選|おめでとう|等は/.test(ctx.recentAutoResponse)
  );

  if (inLotteryFlow) {
    console.log(`[fitpeak-rag] Lottery context detected (recent auto-response) for "${trimmed}"`);
  }

  // ナレッジ検索（当選フローでもユーザーの質問そのままで検索 - 検索精度を維持）
  let knowledgeText;
  try {
    const chunks = await searchKnowledge(trimmed);
    knowledgeText = formatKnowledge(chunks);
  } catch (err) {
    console.error('[fitpeak-rag] searchKnowledge error:', err.message);
    knowledgeText = '（ナレッジ検索に失敗しました）';
  }

  let inventoryContext = '';
  let orderContext = '';

  if (inLotteryFlow) {
    // 当選文脈: 注文検索・在庫検索をスキップ（誤認識防止）
    console.log(`[fitpeak-rag] Lottery context detected for "${trimmed}", skipping order/inventory lookup`);
  } else {
    // 在庫問い合わせを検知して在庫情報を取得
    try {
      const inventoryKeywords = ['在庫', '買えない', '購入できない', '売り切れ', '入荷', '買える', 'ありますか', 'あるの'];
      if (inventoryKeywords.some(k => trimmed.includes(k))) {
        const result = await lookupInventoryFromMessage(trimmed);
        if (result) inventoryContext = formatInventoryForPrompt(result);
      }
    } catch (err) {
      console.error('[fitpeak-rag] inventory lookup error:', err.message);
    }

    // 注文番号を検知して注文情報を検索
    const orderIds = extractOrderIds(trimmed);
    if (orderIds.length > 0) {
      const orderResults = [];
      for (const oid of orderIds.slice(0, 2)) {
        try {
          const result = await lookupOrder(oid);
          orderResults.push(formatOrderForPrompt(result));
        } catch (err) {
          console.error('[fitpeak-rag] order lookup error:', err.message);
          orderResults.push(`【注文検索結果】${oid}: 検索エラー (${err.message})`);
        }
      }
      orderContext = orderResults.join('\n\n');
    }
  }

  const combinedContext = inLotteryFlow
    ? '（当選番号の会話中のため注文検索はスキップ。お客様はスクラッチカードの当選者です。注文の話題ではありません。）'
    : [
        orderContext ? `## 注文検索結果\n${orderContext}` : '',
        inventoryContext || '',
      ].filter(Boolean).join('\n\n') || '（注文番号・在庫検索は実行されていません）';

  // チャットナレッジ（このお客様との過去のやりとり要約）を取得
  let friendContextText = '（お客様情報なし）';
  if (ctx.friendId) {
    try {
      friendContextText = await getFriendContext(ctx.friendId);
    } catch (err) {
      console.error('[fitpeak-rag] getFriendContext error:', err.message);
    }
  }

  // 友だちのタグ・自動応答履歴を追加
  let tagAndAutoContext = '';
  if (ctx.friendTags && ctx.friendTags.length > 0) {
    tagAndAutoContext += `\nこのお客様のタグ: ${ctx.friendTags.join(', ')}`;
  }
  if (ctx.recentAutoResponse) {
    tagAndAutoContext += `\n${ctx.recentAutoResponse}`;
  }
  if (inLotteryFlow) {
    tagAndAutoContext += '\n\n【重要】このお客様はスクラッチカード当選者です。直前の自動応答で当選結果が伝えられています。お客様の返信は当選に関連した内容（購入商品名など）です。注文確認・本人確認・配送確認の話題にしないでください。当選おめでとうの文脈で自然に対応してください。';
  }
  if (tagAndAutoContext) {
    friendContextText += tagAndAutoContext;
  }

  const systemPrompt = FITPEAK_SYSTEM_PROMPT
    .replace('{retrieved_knowledge}', knowledgeText)
    .replace('{order_context}', combinedContext)
    .replace('{friend_context}', friendContextText);

  // 会話履歴を構築（直近のやりとりを含める）
  const messages = [];
  if (ctx.chatHistory && ctx.chatHistory.length > 0) {
    for (const msg of ctx.chatHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  messages.push({ role: 'user', content: trimmed });

  const anthropic = await getAnthropicClient();
  const completion = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 800,
    system: systemPrompt,
    messages,
  });

  const textBlock = (completion.content || []).find((b) => b.type === 'text');
  const raw = (textBlock?.text || '').trim();
  if (!raw) return '確認してご連絡します。';

  // JSON解析
  let reply = '';
  let needsEscalation = false;
  let escalationReason = '';
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      reply = (parsed.reply || '').trim();
      needsEscalation = !!parsed.needs_escalation;
      escalationReason = parsed.escalation_reason || '';
    }
  } catch { /* fallback */ }

  // JSON解析失敗時は生文字列をそのまま使用
  if (!reply) reply = raw;

  // フェイルセーフ1: AIが知らないことを否定してしまった場合、強制的に差し替える
  const denialPhrases = [
    '実施しておりません', '行っておりません', 'やっておりません',
    'ございません', 'ありません', '存在しません',
    '実施していません', '行っていません', 'やっていません',
    '予定はございません', '予定はありません',
    'キャンペーンは現在', 'そのようなキャンペーン', 'そのようなセール',
  ];
  const campaignKeywords = ['キャンペーン', 'セール', 'クーポン', '特典', '割引', 'レビュー'];
  const hasDenial = denialPhrases.some(p => reply.includes(p));
  const hasCampaignTopic = campaignKeywords.some(k => trimmed.includes(k) || reply.includes(k));
  if (hasDenial && hasCampaignTopic) {
    console.warn('[fitpeak-rag] BLOCKED denial about campaign/promotion:', reply.slice(0, 150));
    reply = 'お世話になっております。FITPEAK担当です。\n\nお問い合わせいただきありがとうございます。詳細を確認してご連絡いたしますので、少々お待ちいただけますでしょうか。';
    needsEscalation = true;
    escalationReason = escalationReason || 'AIがキャンペーン/特典について否定回答を生成したため強制差し替え';
  }

  // フェイルセーフ2: AIが「確認します/お待ちください」系の返信をしているのに
  // needs_escalation=false の場合、強制的にエスカレーションする
  if (!needsEscalation) {
    const escalationPhrases = [
      '確認いたします', '確認してご連絡', '確認しますので',
      '確認中', '確認でき次第', '確認して参ります',
      '折り返し', 'お待ちください', 'お待ちいただけ',
      'お時間をいただ', 'お時間頂', 'お時間いただ',
      '担当者に確認', '調査', '少々お待ち',
      '改めてご連絡', '後ほどご連絡', 'すぐにご連絡',
    ];
    if (escalationPhrases.some(p => reply.includes(p))) {
      needsEscalation = true;
      escalationReason = escalationReason || 'AIが確認待ち返信を生成（フェイルセーフ）';
      console.log('[fitpeak-rag] failsafe escalation triggered for reply:', reply.slice(0, 100));
    }
  }

  // 先頭挨拶が無ければ自動付与
  const greeting = 'お世話になっております。FITPEAK担当です。';
  if (!reply.startsWith(greeting) && !reply.startsWith('お世話になっております')) {
    reply = `${greeting}\n\n${reply}`;
  }

  // エスカレーションが必要ならSlack通知
  if (needsEscalation) {
    sendSlackEscalation({
      channel: ctx.channel || 'LINE',
      customerName: ctx.customerName || '',
      customerMessage: trimmed,
      aiDraftReply: reply,
      reason: escalationReason,
      context: orderContext ? orderContext.slice(0, 400) : undefined,
      lineUserId: ctx.lineUserId || null,
      email: ctx.email || null,
    }).catch(err => console.error('[fitpeak-rag] slack notify error:', err.message));
  }

  return reply;
}

/**
 * 複数テキストを一度のAPI呼び出しで embedding に変換
 * @param {string[]} texts
 * @param {'query'|'document'} inputType
 * @returns {Promise<number[][]>}
 */
async function embedTexts(texts, inputType = 'document') {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY が未設定です');
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const res = await fetch(VOYAGE_EMBED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: EMBEDDING_MODEL,
      input_type: inputType,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Voyage embedding API ${res.status}: ${body}`);
  }

  const json = await res.json();
  const data = json?.data;
  if (!Array.isArray(data)) throw new Error('Voyage embedding 応答不正');
  return data.map(d => d.embedding);
}

// ===========================================================================
// チャットナレッジ（友だちごとの会話要約）
// ===========================================================================

const SUMMARY_PROMPT = `以下はFITPEAKの公式LINEでのお客様とのチャット履歴です。
この会話全体を分析して、以下のJSON形式で要約してください。JSON以外のテキストは出力しないでください。

{
  "summary": "このお客様との会話の要約（300文字以内。どんな問い合わせがあり、どう対応したか）",
  "key_facts": ["お客様について分かった重要な事実のリスト（購入商品、好み、過去のトラブル等）"],
  "campaigns_mentioned": ["会話中で言及・案内されたキャンペーン・セール・クーポン・特典の情報"]
}

注意：
- スタッフ（assistant）が案内した内容も必ず含めること（キャンペーン案内、交換手順の説明など）
- テンプレート返信の内容も重要な情報として扱うこと
- お客様の感情・態度（満足、不満、急いでいる等）も key_facts に含めること`;

/**
 * 友だちのチャット履歴から要約を生成・更新する
 * @param {string} friendId
 * @param {string} [channelId]
 */
async function updateFriendChatSummary(friendId, channelId) {
  const supabase = getSupabase();

  try {
    // チャンネルIDがなければfriendsから取得
    if (!channelId) {
      const { data: friend } = await supabase
        .from('friends')
        .select('channel_id')
        .eq('id', friendId)
        .maybeSingle();
      if (!friend) return;
      channelId = friend.channel_id;
    }

    // 全チャット履歴を取得（最新100件）
    const { data: messages } = await supabase
      .from('chat_messages')
      .select('id, direction, content, message_type, created_at')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: true })
      .limit(100);

    if (!messages || messages.length === 0) return;

    // チャット履歴をテキストに変換
    const chatText = messages.map(m => {
      const role = (m.direction === 'incoming' || m.direction === 'inbound') ? 'お客様' : 'スタッフ';
      let text = '';
      if (m.content?.text) {
        text = m.content.text;
      } else if (m.content?.messages && Array.isArray(m.content.messages)) {
        text = m.content.messages
          .filter(tm => tm.type === 'text' && tm.text)
          .map(tm => tm.text)
          .join('\n');
      }
      if (!text) {
        if (m.message_type === 'image') text = '[画像]';
        else if (m.message_type === 'video') text = '[動画]';
        else text = '[メディア]';
      }
      const source = m.content?.source || '';
      const sourceLabel = source === 'crm_ui' ? '（手動）'
        : source === 'delayed_ai_reply' ? '（AI自動）'
        : source === 'fitpeak_rag' ? '（AI）'
        : source === 'template' ? '（テンプレート）'
        : source === 'auto_response' ? '（自動応答）'
        : '';
      return `[${role}${sourceLabel}] ${text}`;
    }).join('\n');

    // Claudeで要約生成
    const anthropic = await getAnthropicClient();
    const completion = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 600,
      system: SUMMARY_PROMPT,
      messages: [{ role: 'user', content: chatText }],
    });

    const textBlock = (completion.content || []).find(b => b.type === 'text');
    const raw = (textBlock?.text || '').trim();
    if (!raw) return;

    let summary = '';
    let keyFacts = [];
    let campaignsMentioned = [];
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        summary = parsed.summary || '';
        keyFacts = parsed.key_facts || [];
        campaignsMentioned = parsed.campaigns_mentioned || [];
      }
    } catch {
      summary = raw;
    }

    if (!summary) return;

    const lastMsg = messages[messages.length - 1];

    // upsert
    await supabase.from('friend_chat_summaries').upsert({
      friend_id: friendId,
      summary,
      key_facts: keyFacts,
      campaigns_mentioned: campaignsMentioned,
      last_message_id: lastMsg.id,
      message_count: messages.length,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'friend_id' });

    console.log(`[chat-summary] Updated summary for friend ${friendId} (${messages.length} msgs)`);
  } catch (err) {
    console.error('[chat-summary] updateFriendChatSummary error:', err.message);
  }
}

/**
 * 友だちのチャットナレッジを取得
 * @param {string} friendId
 * @returns {Promise<string>}
 */
async function getFriendContext(friendId) {
  if (!friendId) return '（お客様情報なし）';
  const supabase = getSupabase();
  try {
    const { data } = await supabase
      .from('friend_chat_summaries')
      .select('summary, key_facts, campaigns_mentioned')
      .eq('friend_id', friendId)
      .maybeSingle();

    if (!data || !data.summary) return '（過去のやりとりなし - 新規のお客様）';

    let text = data.summary;
    if (data.key_facts && data.key_facts.length > 0) {
      text += '\n\n【お客様の情報】\n' + data.key_facts.map(f => `- ${f}`).join('\n');
    }
    if (data.campaigns_mentioned && data.campaigns_mentioned.length > 0) {
      text += '\n\n【過去に案内済みのキャンペーン・特典】\n' + data.campaigns_mentioned.map(c => `- ${c}`).join('\n');
    }
    return text;
  } catch (err) {
    console.error('[chat-summary] getFriendContext error:', err.message);
    return '（チャットナレッジ取得エラー）';
  }
}

module.exports = {
  generateFITPEAKReply,
  searchKnowledge,
  embedText,
  embedTexts,
  updateFriendChatSummary,
  getFriendContext,
};
