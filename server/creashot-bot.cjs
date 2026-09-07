/**
 * クレアショット専用 AIチャットボット
 *
 * 対象: 「クレアショット」タグが付いた友だち（＝クレアショット広告/LP経由のLINE登録者）。
 * このボットが担当する友だちには、FITPEAK AI（fitpeak-rag.cjs）の汎用AI返信は一切走らせない。
 *
 * 目的は2つ。
 *  1. 会話しながらトレーニング/クレアチン周りの情報をヒアリングし、構造化して蓄積する
 *     （creashot_profiles）。以降のセグメント配信の精度を上げるため。
 *  2. 予約販売のCVRを上げる。押し売りはせず、相手の状況に紐づけて価値を伝え、
 *     予約開始の先行案内を受け取る前提を作る。
 *
 * ナレッジは creashot_bot_settings.knowledge に入っている内容だけを根拠にする。
 * そこから答えられない質問は憶測せず、担当者にエスカレーションする。
 */

const { getAnthropicClient, getSupabase } = require('./shared.cjs');
const { sendSlackEscalation } = require('./slack-notify.cjs');

const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

const DEFAULT_MODEL = 'claude-sonnet-4-5';

const FALLBACK_REPLY =
  'ご連絡ありがとうございます。担当者が内容を確認して、あらためてご連絡いたします。';

// AIが返してくる creatine_status → 既存タグ名 のマッピング
const CREATINE_STATUS_TAGS = {
  drinking: 'クレアチン（飲んでいる）',
  quit: 'クレアチン（買ったけど、やめた）',
  never: 'クレアチン（飲んだことがない）',
};

// ヒアリングしたい項目（プロンプトにもDBカラムにも同じ順で使う）
const PROFILE_FIELDS = [
  ['training_frequency', 'トレーニング頻度（週何回か）'],
  ['training_years', 'トレーニング歴'],
  ['training_place', 'どこでトレーニングしているか（ジム/自宅/外 など）'],
  ['goal', '目的（増量・減量・体型維持・パフォーマンス など）'],
  ['creatine_status', 'クレアチンの状況。drinking=今飲んでいる / quit=買ったけどやめた / never=飲んだことがない / unknown'],
  ['creatine_pain', 'クレアチンで困っていること（飲み忘れる・持ち運べない・味 など）'],
  ['outing_frequency', '外出・出張・移動の多さ'],
  ['supplements', '今使っているサプリ'],
  ['age_range', '年代'],
  ['gender', '性別'],
];

let cachedSettings = null;
let cachedAt = 0;
const SETTINGS_TTL_MS = 60 * 1000;

async function getCreashotSettings({ force = false } = {}) {
  if (!force && cachedSettings && Date.now() - cachedAt < SETTINGS_TTL_MS) {
    return cachedSettings;
  }
  const { data, error } = await supabase
    .from('creashot_bot_settings')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[creashot-bot] settings fetch error:', error.message);
    return cachedSettings || null;
  }
  cachedSettings = data || null;
  cachedAt = Date.now();
  return cachedSettings;
}

function invalidateCreashotSettingsCache() {
  cachedSettings = null;
  cachedAt = 0;
}

/**
 * この友だちがクレアショットボットの担当かどうか。
 * 「クレアショット」タグが付いていれば true（ボットが無効でも true を返す＝通常AIは走らせない）。
 */
async function isCreashotFriend(friendId, settings) {
  if (!friendId) return false;
  const tagId = settings?.tag_id;
  if (!tagId) return false;
  const { data } = await supabase
    .from('friend_tags')
    .select('tag_id')
    .eq('friend_id', friendId)
    .eq('tag_id', tagId)
    .maybeSingle();
  return !!data;
}

async function getProfile(friendId) {
  const { data } = await supabase
    .from('creashot_profiles')
    .select('*')
    .eq('friend_id', friendId)
    .maybeSingle();
  return data || null;
}

function formatProfileForPrompt(profile) {
  if (!profile) return '（まだ何も聞けていない。初回の会話。）';
  const known = [];
  const unknown = [];
  for (const [key, label] of PROFILE_FIELDS) {
    const v = profile[key];
    if (v) known.push(`- ${label}: ${v}`);
    else unknown.push(`- ${label}`);
  }
  const lines = [];
  lines.push(known.length ? `【すでに分かっていること】\n${known.join('\n')}` : '【すでに分かっていること】\n（なし）');
  lines.push(unknown.length ? `【まだ聞けていないこと】\n${unknown.join('\n')}` : '【まだ聞けていないこと】\n（すべて聞き終えている）');
  if (profile.concerns && Array.isArray(profile.concerns) && profile.concerns.length > 0) {
    lines.push(`【これまでに出た懸念・質問】\n${profile.concerns.map((c) => `- ${c}`).join('\n')}`);
  }
  if (profile.notes) lines.push(`【メモ】\n${profile.notes}`);
  if (profile.interest_level) lines.push(`【現在の関心度】${profile.interest_level}`);
  if (profile.purchase_intent) lines.push(`【現在の購入意向】${profile.purchase_intent}`);
  lines.push(`【これまでのやりとり回数】${profile.turn_count || 0}回`);
  return lines.join('\n\n');
}

function buildSystemPrompt({ knowledge, extraInstructions, ctaUrl, profileText, customerName, lastOutgoing }) {
  return [
    'あなたはフィットネスブランド //FITPEAK の公式LINEで、サプリメント「クレアショット（CREASHOT）」の担当をしているスタッフです。',
    'お客様は、クレアショットの広告・LPを見て公式LINEに登録してくださった方です。まだ発売前で、これから予約販売を行います。',
    '',
    '## あなたの目的（この2つを、1回の返信のなかで自然に両立させる）',
    '1. 会話しながら、お客様のトレーニングやクレアチンに関する状況を少しずつ聞き出すこと。',
    '   聞けた情報は今後の配信内容の出し分けに使う。アンケートではなく雑談のなかで自然に聞く。',
    '2. 予約販売の申し込みにつなげること。ただし押し売りは絶対にしない。',
    '   相手が話してくれた状況（外出が多い/飲み忘れる/続かない 等）に紐づけて、クレアショットが',
    '   その状況にどう効くのかを具体的に伝える。相手の課題が見えていない段階で商品の話を長々としない。',
    '',
    '## 会話のルール（最重要）',
    '- 1回の返信で質問するのは「1つだけ」。複数の質問を並べない。',
    '- 返信は短く。LINEで読める長さ（2〜4文、150文字前後）を目安にする。長文にしない。',
    '- 「まだ聞けていないこと」から、いま話している流れに一番近いものを1つ選んで聞く。脈絡なく質問を差し込まない。',
    '- お客様が質問してきたときは、まずその質問にきちんと答える。答えてから、必要なら短く1つ質問を添える。',
    '- すでに分かっていることを聞き直さない。',
    '- お客様が答えたくなさそう・話を切り上げたそうなときは、追いかけずに引く。会話を終える。',
    '- 相手の話（種目・重量・目的など）にはまず具体的に反応する。テンプレ的な相づちで流さない。',
    '- 予約の話は、相手の課題が1つ以上見えてから出す。それまでは会話と情報収集を優先する。',
    '- 購入を迷っている様子・価格に触れてきた様子があれば、値引きではなく「持ち物が3つから1つになる」',
    '  「一番高いクレアチンは、飲まなかったクレアチン」という考え方で受ける。',
    '- 大容量のクレアチンのほうが1回あたりの価格は安い、という事実は隠さず正直に認める。',
    '',
    '## 表現のガードレール（違反は不可）',
    '- クレアショットは食品であり医薬品ではない。効果・効能の断定や暗示をしない',
    '  （筋肉が増える／痩せる／疲労が取れる／効く／治る 等は禁止）。',
    '- 治療・予防・診断を想起させる表現をしない。',
    '- 「必ず」「No.1」「最強」「日本初」などの根拠のない最上級表現を使わない。',
    '- 「無添加」「添加物不使用」は使わない。',
    '- 電解質を「スポーツドリンク代わり」「汗対策」と表現しない。',
    '- 話してよいのは利便性（持ち運べる・手軽・2WAY・続けやすい・飲み忘れにくい・爽やかな味）まで。',
    '- 絵文字・顔文字は一切使わない（1つでも入れてはいけない）。',
    '- 敬語で、フランクすぎず硬すぎない口語。',
    '',
    '## 使ってよい情報（これ以外の商品知識・数値・キャンペーンは一切使わない）',
    knowledge && knowledge.trim() ? knowledge.trim() : '（ナレッジ未設定。商品の詳細には答えず、担当者に確認する旨を伝える）',
    '',
    ctaUrl && ctaUrl.trim() ? `## 予約・詳細の案内先URL（相手が明確に希望したときだけ送る）\n${ctaUrl.trim()}\n` : null,
    extraInstructions && extraInstructions.trim() ? `## 追加の指示\n${extraInstructions.trim()}\n` : null,
    '',
    '## 分からないことへの対応',
    '上のナレッジでは回答できない質問（発売日・在庫・個別の注文状況・体調や既往症に関わる相談・',
    'クレーム・返金など）には、絶対に推測で答えないこと。その場合は reply を',
    '「担当者が確認してご連絡します」という趣旨にし、needs_escalation を true にする。',
    '',
    `## お客様の表示名\n${customerName || '（不明）'}`,
    '',
    `## このお客様について現在分かっていること\n${profileText}`,
    lastOutgoing ? `\n## こちらから直前に送ったメッセージ\n${lastOutgoing}` : null,
    '',
    '## 出力形式',
    '以下のJSONのみを出力する（前後に説明文やコードフェンスを付けない）。値が判断できない項目は null にする。',
    '{',
    '  "reply": "お客様に送る返信文",',
    '  "profile": {',
    '    "training_frequency": null,',
    '    "training_years": null,',
    '    "training_place": null,',
    '    "goal": null,',
    '    "creatine_status": null,',
    '    "creatine_pain": null,',
    '    "outing_frequency": null,',
    '    "supplements": null,',
    '    "age_range": null,',
    '    "gender": null',
    '  },',
    '  "new_concerns": ["今回の発言から読み取れた懸念・疑問。無ければ空配列"],',
    '  "notes": "次回の会話に効く一言メモ（60字以内・1文）。すでに分かっている内容の要約は書かない。無ければnull",',
    '  "interest_level": "low | medium | high",',
    '  "purchase_intent": "unknown | considering | ready | declined",',
    '  "needs_escalation": false,',
    '  "escalation_reason": null',
    '}',
    '',
    'profile には「今回のお客様の発言から新たに分かったこと」だけを入れる。推測で埋めない。',
    'creatine_status は drinking / quit / never / unknown のいずれかの英単語で返す。',
    'purchase_intent は、予約したい・買いたいと明言されたら ready、前向きに検討中なら considering、',
    '断られたら declined、判断できなければ unknown。',
  ].filter((l) => l !== null).join('\n');
}

// LINEの返信から絵文字を確実に取り除く（プロンプトだけだと稀に混ざるため）
function stripEmoji(text) {
  return String(text || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function normalizeProfileValue(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (['null', 'unknown', '不明', '未回答', 'なし'].includes(s.toLowerCase())) return null;
  return s.slice(0, 500);
}

/**
 * 会話から抽出した情報を creashot_profiles にマージする（null は上書きしない）。
 */
async function mergeProfile(friendId, parsed, existing) {
  const patch = { friend_id: friendId, updated_at: new Date().toISOString(), last_replied_at: new Date().toISOString() };
  const incoming = parsed.profile || {};
  for (const [key] of PROFILE_FIELDS) {
    const v = normalizeProfileValue(incoming[key]);
    if (v) patch[key] = v;
  }

  const concerns = Array.isArray(existing?.concerns) ? [...existing.concerns] : [];
  for (const c of Array.isArray(parsed.new_concerns) ? parsed.new_concerns : []) {
    const s = normalizeProfileValue(c);
    if (s && !concerns.includes(s)) concerns.push(s);
  }
  if (concerns.length > 0) patch.concerns = concerns.slice(-20);

  const note = normalizeProfileValue(parsed.notes);
  if (note) {
    const prev = existing?.notes ? existing.notes.split('\n') : [];
    const short = note.slice(0, 120);
    if (!prev.some((line) => line === short || line.includes(short) || short.includes(line))) {
      patch.notes = [...prev, short].slice(-8).join('\n');
    }
  }

  if (['low', 'medium', 'high'].includes(parsed.interest_level)) patch.interest_level = parsed.interest_level;
  if (['unknown', 'considering', 'ready', 'declined'].includes(parsed.purchase_intent)) {
    patch.purchase_intent = parsed.purchase_intent;
  }
  patch.turn_count = (existing?.turn_count || 0) + 1;

  try {
    if (existing) {
      await supabase.from('creashot_profiles').update(patch).eq('friend_id', friendId);
    } else {
      await supabase.from('creashot_profiles').insert(patch);
    }
  } catch (err) {
    console.error('[creashot-bot] profile merge error:', err.message);
  }
  return { ...(existing || {}), ...patch };
}

/**
 * 会話で分かったことを既存タグに反映する。
 * タグ連動配信（enqueueTagDelivery）は意図的に発火させない（付与のみ）。
 */
async function applyAutoTags(friendId, parsed, settings) {
  if (!settings?.auto_tagging) return [];
  const wanted = [];

  const status = normalizeProfileValue(parsed.profile?.creatine_status);
  if (status && CREATINE_STATUS_TAGS[status]) wanted.push(CREATINE_STATUS_TAGS[status]);

  const applied = [];
  try {
    if (wanted.length > 0) {
      const { data: tagRows } = await supabase.from('tags').select('id, name').in('name', wanted);
      for (const t of tagRows || []) {
        const { data: has } = await supabase
          .from('friend_tags')
          .select('tag_id')
          .eq('friend_id', friendId)
          .eq('tag_id', t.id)
          .maybeSingle();
        if (!has) {
          await supabase.from('friend_tags').insert({ friend_id: friendId, tag_id: t.id });
          applied.push(t.name);
        }
      }
    }

    // 購入意向タグ
    const intentTagId = settings.high_intent_tag_id;
    if (intentTagId && (parsed.purchase_intent === 'ready' || parsed.purchase_intent === 'considering')) {
      const { data: has } = await supabase
        .from('friend_tags')
        .select('tag_id')
        .eq('friend_id', friendId)
        .eq('tag_id', intentTagId)
        .maybeSingle();
      if (!has) {
        await supabase.from('friend_tags').insert({ friend_id: friendId, tag_id: intentTagId });
        applied.push('クレアショット_予約意向あり');
      }
    }
  } catch (err) {
    console.error('[creashot-bot] auto tag error:', err.message);
  }
  return applied;
}

/**
 * クレアショット担当としての返信を生成し、プロフィール更新・自動タグ付けまで行う。
 *
 * @param {string} userMessage お客様からの受信テキスト
 * @param {{ friendId: string, customerName?: string, lineUserId?: string,
 *           chatHistory?: Array<{role:string, content:string}>, lastOutgoing?: string,
 *           settings?: object }} ctx
 * @returns {Promise<{ reply: string, needsEscalation: boolean, appliedTags: string[] }>}
 */
async function generateCreashotReply(userMessage, ctx = {}) {
  const trimmed = (userMessage || '').trim();
  if (!trimmed) return { reply: '', needsEscalation: false, appliedTags: [] };

  const settings = ctx.settings || (await getCreashotSettings());
  const existing = ctx.friendId ? await getProfile(ctx.friendId) : null;

  const systemPrompt = buildSystemPrompt({
    knowledge: settings?.knowledge,
    extraInstructions: settings?.extra_instructions,
    ctaUrl: settings?.cta_url,
    profileText: formatProfileForPrompt(existing),
    customerName: ctx.customerName,
    lastOutgoing: ctx.lastOutgoing,
  });

  const messages = [];
  for (const m of Array.isArray(ctx.chatHistory) ? ctx.chatHistory : []) {
    if (m && m.role && m.content) messages.push({ role: m.role, content: m.content });
  }
  messages.push({ role: 'user', content: trimmed });
  // Anthropic Messages API は先頭が user でないと 400 になる
  while (messages.length > 1 && messages[0].role !== 'user') messages.shift();

  let parsed = null;
  let reply = FALLBACK_REPLY;
  let needsEscalation = false;
  let escalationReason = '';

  try {
    const anthropic = await getAnthropicClient();
    const completion = await anthropic.messages.create({
      model: settings?.model || DEFAULT_MODEL,
      max_tokens: 1200,
      system: systemPrompt,
      messages,
    });
    const textBlock = (completion.content || []).find((b) => b.type === 'text');
    const raw = (textBlock?.text || '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
      if (parsed.reply) reply = stripEmoji(parsed.reply);
      needsEscalation = !!parsed.needs_escalation;
      escalationReason = parsed.escalation_reason || '';
    } else if (raw) {
      reply = stripEmoji(raw);
    }
    if (!reply) reply = FALLBACK_REPLY;
  } catch (err) {
    console.error('[creashot-bot] generation error:', err.message);
    reply = FALLBACK_REPLY;
    needsEscalation = true;
    escalationReason = `AI生成エラー: ${err.message}`;
  }

  let appliedTags = [];
  if (parsed && ctx.friendId) {
    await mergeProfile(ctx.friendId, parsed, existing);
    appliedTags = await applyAutoTags(ctx.friendId, parsed, settings);
  }

  if (needsEscalation) {
    sendSlackEscalation({
      channel: 'LINE',
      customerName: ctx.customerName || '',
      customerMessage: trimmed,
      aiDraftReply: reply,
      reason: escalationReason || 'クレアショットAIが回答できず',
      lineUserId: ctx.lineUserId || null,
    }).catch((err) => console.error('[creashot-bot] slack notify error:', err.message));
  }

  return { reply, needsEscalation, appliedTags };
}

module.exports = {
  generateCreashotReply,
  getCreashotSettings,
  invalidateCreashotSettingsCache,
  isCreashotFriend,
  CREATINE_STATUS_TAGS,
  PROFILE_FIELDS,
};
