/**
 * 営業（セールス）エージェント Module
 *
 * 既存のLINE友だち一人ひとりを分析し、購入につながる「次の一手」提案を生成する。
 * 安全設計: 既定は承認制（proposalモード）。人が管理画面でワンタップ承認→送信。
 * mode='auto' にすると cron が自動送信する（信頼できるセグメントに限定して使う想定）。
 *
 * フロー:
 *   1. アクティブな友だちから対象を抽出（クールダウン・未対応問い合わせ・エスカレ中は除外）
 *   2. 友だちの会話要約・タグ・購入有無・経過日数・現行キャンペーンをコンテキストにClaudeが提案
 *   3. 提案を sales_agent_proposals にキュー（status='pending'）
 *   4. 承認時: LINE送信 + 必要ならShopifyクーポン発行 + 購入リンク付加 + chat_messagesに記録
 *
 * 依存: shared.cjs (Supabase/Anthropic), fitpeak-rag.cjs (searchKnowledge/getFriendContext),
 *       shopify-line.cjs (generateAutoLoginUrl)
 *
 * エンドポイント (/api/sales-agent):
 *   GET    /settings
 *   PUT    /settings
 *   GET    /proposals?status=pending
 *   POST   /generate            提案を即時生成（手動トリガー）
 *   PUT    /proposals/:id        提案の編集（本文・クーポン額・リンク）
 *   POST   /proposals/:id/send   承認して送信
 *   POST   /proposals/:id/skip   スキップ
 *   GET    /stats
 *   GET    /cron                 日次: enabled時に提案生成（mode='auto'なら送信まで）
 */

const express = require('express');
const router = express.Router();

const { getSupabase, getAnthropicClient, getLineCredentials } = require('./shared.cjs');
const { searchKnowledge, getFriendContext } = require('./fitpeak-rag.cjs');
const { generateAutoLoginUrl } = require('./shopify-line.cjs');

const CLAUDE_MODEL = 'claude-sonnet-4-5';
const FRIEND_POOL_SIZE = 200; // 1回の生成でスキャンする友だちの母数

// ── 設定 ──────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  id: 'default',
  enabled: false,
  mode: 'proposal',
  cooldown_days: 7,
  daily_limit: 20,
  max_coupon_amount: 1000,
  amazon_url: 'https://www.amazon.co.jp/stores/page/FITPEAK',
  shopify_url: 'https://fitpeak.co',
  extra_instructions: '',
};

async function getSettings() {
  const sb = getSupabase();
  const { data } = await sb.from('sales_agent_settings').select('*').eq('id', 'default').maybeSingle();
  return { ...DEFAULT_SETTINGS, ...(data || {}) };
}

// ── 営業エージェントのシステムプロンプト ──────────────────
const SALES_SYSTEM_PROMPT = `あなたはFITPEAKの優秀なセールス担当です。公式LINEの友だち一人ひとりに対し、押し売りにならず、相手にとって価値ある提案を行い、AmazonまたはShopify（公式サイト）での購入につなげます。

## FITPEAKについて
- Amazon・Shopifyでトレーニングギアを販売するブランド
- 主力商品：トレーニングベルト、パワーグリップ、リストラップ、ニースリーブ、可変式ダンベル
- 公式サイト: https://fitpeak.co/

## あなたの仕事
与えられた1人のお客様の情報（過去の会話要約・タグ・購入有無・最終接触からの経過日数）と、現在のキャンペーン/商品ナレッジをもとに、
このお客様に「いま送るべき1通のLINEメッセージ」を設計してください。

## セグメントと目的の考え方
- 新規未購入（購入歴なし・会話浅い）→ 目的「初回購入促進」。共感→価値訴求→おすすめ1商品→背中を押すクーポン
- リピーター（購入歴あり/満足）→ 目的「リピート促進・クロスセル」。関連商品やまとめ買いを自然に提案
- 離脱気味（最終接触から日数が経過）→ 目的「再活性化」。近況に触れつつ新商品やキャンペーンで再来訪を促す

## 送信可否の判断（重要）
以下は should_contact=false にして送らないこと:
- 直近で未解決のクレーム・トラブル・返品交換対応中の様子がある
- 会話要約から、今セールスすると不快に感じる可能性が高い
- 提案できる価値（合う商品・キャンペーン）が見当たらない

## クーポンの方針
- 初回購入の後押し、または離脱客の再活性化に効果的なときだけ提案する
- 金額は控えめに。最大は指示された上限まで（coupon_amount に円で指定、不要なら0）
- リピーターには毎回クーポンを出さない（利益を守る）

## メッセージのルール
- 冒頭は「お世話になっております。FITPEAKです。」のような自然な挨拶から
- 200〜300文字程度。絵文字は使わない
- 1つの明確なおすすめ商品と、1つの行動（購入）に絞る
- 購入リンク本文やクーポンコードは書かない（システムが送信時に自動付加する）
- ナレッジにない在庫・価格・キャンペーンを断定しない

## 購入リンクの選択 (link_type)
- "amazon": Amazonでの購入を促す場合（レビュー・配送の安心感を重視する人向け）
- "shopify": 公式サイトでの購入を促す場合（クーポン併用・限定商品向け）
- "my_fitpeak": 既存購入者で、注文確認やマイページ経由が自然な場合
- "none": リンクを付けない場合

## 出力形式（JSONのみ。前後に余計なテキストを出力しない）
{"should_contact":true,"segment":"新規未購入","objective":"初回購入促進","recommended_product":"トレーニングベルト","link_type":"amazon","coupon_amount":0,"confidence":0.7,"reasoning":"判断根拠を社内向けに簡潔に","message":"お客様に送るLINE本文"}`;

// 現行キャンペーン/おすすめ商品ナレッジ（バッチ内で使い回す）
async function getCampaignKnowledge() {
  try {
    const chunks = await searchKnowledge('キャンペーン セール 新商品 おすすめ 割引 特典', { limit: 6 });
    if (!chunks || chunks.length === 0) return '（現在の特記キャンペーン情報なし）';
    return chunks.map((c, i) => `[${i + 1}] (${c.category}) ${c.title}\n${c.content}`).join('\n\n');
  } catch (e) {
    console.error('[sales-agent] getCampaignKnowledge error:', e.message);
    return '（キャンペーンナレッジ取得失敗）';
  }
}

// ── 対象友だちの抽出 ─────────────────────────────────────
async function selectEligibleFriends(settings, limit) {
  const sb = getSupabase();
  const cooldownMs = (settings.cooldown_days || 7) * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - cooldownMs).toISOString();

  // アクティブ友だち母数（未読がある=対応中なので除外）
  const { data: friends } = await sb
    .from('friends')
    .select('id, line_user_id, display_name, unread_count, status, updated_at')
    .eq('status', 'active')
    .eq('unread_count', 0)
    .order('updated_at', { ascending: true }) // 接触が古い順を優先
    .limit(FRIEND_POOL_SIZE);

  if (!friends || friends.length === 0) return [];

  const friendIds = friends.map((f) => f.id);
  const lineIds = friends.map((f) => f.line_user_id).filter(Boolean);

  // クールダウン内に送信済み / 既にpending提案がある友だちを除外
  const { data: recentProps } = await sb
    .from('sales_agent_proposals')
    .select('friend_id, status, sent_at, created_at')
    .in('friend_id', friendIds)
    .or(`status.eq.pending,sent_at.gte.${cutoff}`);
  const excluded = new Set((recentProps || []).map((p) => p.friend_id));

  // 対応待ち（pending）のSlackエスカレがある友だちを除外
  let escalatedLineIds = new Set();
  if (lineIds.length > 0) {
    const { data: escs } = await sb
      .from('slack_escalations')
      .select('line_user_id')
      .eq('status', 'pending')
      .in('line_user_id', lineIds);
    escalatedLineIds = new Set((escs || []).map((e) => e.line_user_id));
  }

  const eligible = friends.filter(
    (f) => !excluded.has(f.id) && !escalatedLineIds.has(f.line_user_id),
  );
  return eligible.slice(0, limit);
}

// 友だち1人の購入有無を判定（Shopifyリンク有無）
async function hasPurchased(friendId) {
  const sb = getSupabase();
  const { data } = await sb
    .from('line_shopify_links')
    .select('id')
    .eq('friend_id', friendId)
    .limit(1)
    .maybeSingle();
  return !!data;
}

// ── Claudeで1人分の提案を生成 ───────────────────────────
async function buildProposalForFriend(friend, campaignKnowledge, settings) {
  const sb = getSupabase();

  let friendContext = '（過去のやりとりなし - 新規のお客様）';
  try {
    friendContext = await getFriendContext(friend.id);
  } catch { /* noop */ }

  // タグ
  let tags = [];
  try {
    const { data: ft } = await sb
      .from('friend_tags')
      .select('tags(name)')
      .eq('friend_id', friend.id);
    tags = (ft || []).map((r) => r.tags?.name).filter(Boolean);
  } catch { /* noop */ }

  const purchased = await hasPurchased(friend.id);
  const daysSince = friend.updated_at
    ? Math.floor((Date.now() - new Date(friend.updated_at).getTime()) / (24 * 60 * 60 * 1000))
    : null;

  const userBlock = `## このお客様の情報
- 表示名: ${friend.display_name || '（不明）'}
- 購入歴: ${purchased ? 'あり（公式サイト連携済み）' : '不明 / なし'}
- タグ: ${tags.length ? tags.join(', ') : 'なし'}
- 最終接触からの経過: ${daysSince != null ? `${daysSince}日` : '不明'}

## 過去のやりとり（チャットナレッジ）
${friendContext}

## 現在のキャンペーン・おすすめ商品ナレッジ
${campaignKnowledge}

${settings.extra_instructions ? `## 営業方針（追加指示）\n${settings.extra_instructions}\n` : ''}
上記をもとに、このお客様に今送るべき提案をJSONで出力してください。クーポン上限は${settings.max_coupon_amount}円です。`;

  const anthropic = await getAnthropicClient();
  const completion = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 900,
    system: SALES_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userBlock }],
  });

  const textBlock = (completion.content || []).find((b) => b.type === 'text');
  const raw = (textBlock?.text || '').trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  if (!parsed.should_contact || !parsed.message) return null;

  // クーポン額を上限でクランプ
  let couponAmount = Number(parsed.coupon_amount) || 0;
  if (couponAmount < 0) couponAmount = 0;
  if (couponAmount > settings.max_coupon_amount) couponAmount = settings.max_coupon_amount;

  // 静的リンクを解決（my_fitpeakは送信時に発行）
  const linkType = ['amazon', 'shopify', 'my_fitpeak', 'none'].includes(parsed.link_type)
    ? parsed.link_type
    : 'none';
  let linkUrl = '';
  if (linkType === 'amazon') linkUrl = settings.amazon_url || '';
  else if (linkType === 'shopify') linkUrl = settings.shopify_url || '';

  return {
    friend_id: friend.id,
    line_user_id: friend.line_user_id,
    display_name: friend.display_name || null,
    segment: parsed.segment || null,
    objective: parsed.objective || null,
    recommended_product: parsed.recommended_product || null,
    message: parsed.message.trim(),
    link_type: linkType,
    link_url: linkUrl || null,
    coupon_amount: couponAmount,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
    reasoning: parsed.reasoning || null,
    status: 'pending',
  };
}

// ── 提案生成（バッチ） ───────────────────────────────────
async function generateProposals(limit) {
  const sb = getSupabase();
  const settings = await getSettings();
  const cap = Math.min(limit || settings.daily_limit, settings.daily_limit);

  const friends = await selectEligibleFriends(settings, cap);
  if (friends.length === 0) return { generated: 0, scanned: 0, proposals: [] };

  const campaignKnowledge = await getCampaignKnowledge();
  const created = [];

  for (const friend of friends) {
    try {
      const proposal = await buildProposalForFriend(friend, campaignKnowledge, settings);
      if (!proposal) continue;
      const { data, error } = await sb
        .from('sales_agent_proposals')
        .insert(proposal)
        .select()
        .single();
      if (error) {
        console.error('[sales-agent] insert error:', error.message);
        continue;
      }
      created.push(data);
    } catch (e) {
      console.error('[sales-agent] buildProposal error for', friend.id, e.message);
    }
  }

  return { generated: created.length, scanned: friends.length, proposals: created };
}

// ── Shopifyクーポン発行（line-crmのパターンを踏襲） ──────────
async function issueShopifyCoupon(amount, friendId) {
  const sb = getSupabase();
  const { data: store } = await sb
    .from('channel_stores')
    .select('shop_domain, access_token')
    .eq('channel', 'SHOPIFY')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (!store) throw new Error('有効なShopifyストアが見つかりません');

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'FP-';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const prRes = await fetch(`https://${store.shop_domain}/admin/api/2025-01/price_rules.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': store.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      price_rule: {
        title: `SalesAgent - ${code}`,
        target_type: 'line_item',
        target_selection: 'all',
        allocation_method: 'across',
        value_type: 'fixed_amount',
        value: `-${amount}`,
        customer_selection: 'all',
        starts_at: new Date().toISOString(),
        ends_at: expiresAt.toISOString(),
        usage_limit: 1,
        once_per_customer: true,
      },
    }),
  });
  if (!prRes.ok) throw new Error(`Shopify price_rule作成失敗 ${prRes.status}`);
  const priceRule = (await prRes.json()).price_rule;

  await fetch(
    `https://${store.shop_domain}/admin/api/2025-01/price_rules/${priceRule.id}/discount_codes.json`,
    {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': store.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ discount_code: { code } }),
    },
  );

  // couponsテーブルにも記録
  try {
    await sb.from('coupons').insert({
      code,
      discount_type: 'fixed',
      discount_value: amount,
      expires_at: expiresAt.toISOString(),
      is_active: true,
      issued_to: friendId || null,
    });
  } catch { /* 記録失敗は致命的ではない */ }

  return code;
}

// ── LINE送信 ───────────────────────────────────────────
async function pushLine(channelId, lineUserId, text) {
  const { accessToken: token } = await getLineCredentials(channelId);
  if (!token) throw new Error('LINEアカウントの認証情報が未設定です');
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LINE push失敗 ${res.status}: ${body}`);
  }
}

// 提案を最終メッセージに組み立て（リンク・クーポンを付加）
async function composeFinalMessage(proposal) {
  let text = proposal.message;
  let couponCode = null;

  if (proposal.coupon_amount && proposal.coupon_amount > 0) {
    couponCode = await issueShopifyCoupon(proposal.coupon_amount, proposal.friend_id);
  }

  // リンク解決
  let url = proposal.link_url || '';
  if (proposal.link_type === 'my_fitpeak') {
    try {
      url = await generateAutoLoginUrl(proposal.line_user_id, '/');
    } catch (e) {
      console.error('[sales-agent] my_fitpeakリンク発行失敗:', e.message);
      url = '';
    }
  }

  if (url) text += `\n\n▼こちらからどうぞ\n${url}`;
  if (couponCode) {
    text += `\n\nクーポンコード: ${couponCode}\n（公式サイトで${proposal.coupon_amount}円OFF / 30日間有効）`;
  }

  return { text, couponCode };
}

// 提案を送信する（承認後 / autoモードのcron両方から使用）
async function sendProposal(proposal) {
  const sb = getSupabase();
  const { text, couponCode } = await composeFinalMessage(proposal);

  const { data: friend } = await sb
    .from('friends')
    .select('channel_id')
    .eq('id', proposal.friend_id)
    .maybeSingle();

  await pushLine(friend?.channel_id, proposal.line_user_id, text);

  // chat_messagesに送信ログを残す（営業エージェント発と分かるようsourceを付与）
  try {
    await sb.from('chat_messages').insert({
      friend_id: proposal.friend_id,
      channel_id: friend?.channel_id || null,
      direction: 'outgoing',
      message_type: 'text',
      content: { text, source: 'sales_agent', proposal_id: proposal.id },
    });
  } catch (e) {
    console.error('[sales-agent] chat_messages記録失敗:', e.message);
  }

  const { data: updated } = await sb
    .from('sales_agent_proposals')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      message: text,
      coupon_code: couponCode,
      error: null,
    })
    .eq('id', proposal.id)
    .select()
    .single();

  return updated;
}

// ===========================================================================
// ルート
// ===========================================================================

router.get('/settings', async (_req, res) => {
  try {
    res.json(await getSettings());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const sb = getSupabase();
    const allowed = [
      'enabled', 'mode', 'cooldown_days', 'daily_limit',
      'max_coupon_amount', 'amazon_url', 'shopify_url', 'extra_instructions',
    ];
    const patch = { id: 'default', updated_at: new Date().toISOString() };
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
    const { data, error } = await sb
      .from('sales_agent_settings')
      .upsert(patch, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;
    res.json({ ...DEFAULT_SETTINGS, ...data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/proposals', async (req, res) => {
  try {
    const sb = getSupabase();
    let q = sb.from('sales_agent_proposals').select('*').order('created_at', { ascending: false }).limit(200);
    if (req.query.status) q = q.eq('status', req.query.status);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const limit = req.body?.limit ? Number(req.body.limit) : undefined;
    const result = await generateProposals(limit);
    res.json(result);
  } catch (e) {
    console.error('[sales-agent] /generate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put('/proposals/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const allowed = ['message', 'coupon_amount', 'link_type', 'link_url', 'recommended_product'];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
    const { data, error } = await sb
      .from('sales_agent_proposals')
      .update(patch)
      .eq('id', req.params.id)
      .eq('status', 'pending')
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/proposals/:id/send', async (req, res) => {
  const sb = getSupabase();
  try {
    const { data: proposal } = await sb
      .from('sales_agent_proposals')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!proposal) return res.status(404).json({ error: '提案が見つかりません' });
    if (proposal.status === 'sent') return res.status(400).json({ error: '既に送信済みです' });

    const updated = await sendProposal(proposal);
    res.json(updated);
  } catch (e) {
    console.error('[sales-agent] send error:', e.message);
    await sb.from('sales_agent_proposals')
      .update({ status: 'failed', error: e.message })
      .eq('id', req.params.id);
    res.status(500).json({ error: e.message });
  }
});

router.post('/proposals/:id/skip', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('sales_agent_proposals')
      .update({ status: 'skipped' })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/stats', async (_req, res) => {
  try {
    const sb = getSupabase();
    const { data } = await sb.from('sales_agent_proposals').select('status');
    const counts = { pending: 0, sent: 0, skipped: 0, rejected: 0, failed: 0 };
    for (const r of data || []) if (r.status in counts) counts[r.status]++;
    res.json({ counts, total: (data || []).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 日次cron: enabled時のみ提案生成。mode='auto'なら生成した提案を送信まで実行
router.get('/cron', async (_req, res) => {
  try {
    const settings = await getSettings();
    if (!settings.enabled) {
      return res.json({ skipped: true, reason: 'disabled' });
    }

    const result = await generateProposals(settings.daily_limit);

    let sent = 0;
    if (settings.mode === 'auto' && result.proposals.length > 0) {
      for (const proposal of result.proposals) {
        try {
          await sendProposal(proposal);
          sent++;
        } catch (e) {
          console.error('[sales-agent] auto-send error:', e.message);
          await getSupabase()
            .from('sales_agent_proposals')
            .update({ status: 'failed', error: e.message })
            .eq('id', proposal.id);
        }
      }
    }

    res.json({ generated: result.generated, scanned: result.scanned, auto_sent: sent, mode: settings.mode });
  } catch (e) {
    console.error('[sales-agent] cron error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
