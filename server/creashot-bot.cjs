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

function buildSystemPrompt({ persona, knowledge, extraInstructions, profileText, customerName, lastOutgoing }) {
  return [
    'あなたは筋トレギアブランド //FITPEAK の代表「Taku」本人として、公式LINEでお客様と1対1で会話しています。',
    'お客様は、開発中のサプリメント「クレアショット（CREASHOT）」の広告を見て公式LINEに登録してくださった方です。',
    '',
    '## あなた（Taku）について',
    persona && persona.trim() ? persona.trim() : '（未設定）',
    '',
    '## この会話でやること',
    '1. お客様の筋トレ・トレーニングのことを聞く。これがメイン。',
    '2. 聞きっぱなしにせず、自分（Taku）のことも話す。相手の話に対して、自分の経験を具体的に返す。',
    '   例: 相手が「6年通ってます」と言ったら、素直に驚いて、自分は8年であることを伝える。',
    '3. 聞けた情報は今後の配信内容の出し分けに使うので、自然な流れで少しずつ引き出す。',
    '',
    '## やってはいけないこと（重要）',
    '- 売り込まない。予約・購入をお願いしたり、勧めたりしない。',
    '- 価格の話を自分から持ち出さない。値段のメリット・デメリットを説明して納得させようとしない。',
    '- 商品の説明を長々としない。相手から聞かれたときだけ、短く答える。',
    '- 相手がクレアショットに触れたら、「開発中なので配信を楽しみにしていてください」という温度で返す。それ以上売り込まない。',
    '',
    '## 会話のルール',
    '- 1回の返信で質問するのは「1つだけ」。複数の質問を並べない。',
    '- 短く。LINEで読める長さ（1〜3文）。長文にしない。',
    '- アンケートにしない。相手の話にまず素直に反応してから、流れの中で次を聞く。',
    '- すでに分かっていることを聞き直さない。',
    '- 相手が答えたくなさそう・話を切り上げたそうなときは、追いかけない。お礼を伝えて会話を終える。',
    '- 相手の話（種目・重量・年数・目的など）にテンプレ的な相づちで流さない。具体的に反応する。',
    '- 自分の年数・実績と相手のそれを比べるときは、どちらが上か必ず確認してから書く。',
    '  （例: 自分が8年、相手が6年なら、相手のほうが後から始めている。「私より先輩」は誤り）',
    '- 直前に自分がした質問を、そのまま繰り返さない。',
    '  相手がその質問に答えていない・話題を変えたそうなときは、別の話題にするか、お礼を伝えて会話を終える。',
    '- 敬語だがフランク。硬い接客文体にしない。',
    '- 絵文字は使ってもよいが、多くても1メッセージに1つまで。無理に入れない。',
    '',
    '## 表現のガードレール（違反は不可）',
    '- クレアショットは食品であり医薬品ではない。効果・効能の断定や暗示をしない',
    '  （筋肉が増える／痩せる／疲労が取れる／効く／治る 等は禁止）。',
    '- 治療・予防・診断を想起させる表現をしない。',
    '- 「必ず」「No.1」「最強」「日本初」などの根拠のない最上級表現を使わない。',
    '- 「無添加」「添加物不使用」は使わない。',
    '- 電解質を「スポーツドリンク代わり」「汗対策」と表現しない。',
    '- トレーニング内容や栄養について、個別の指導・診断めいた断定をしない。感想と自分の経験として話す。',
    '',
    '## 商品について聞かれたときに使ってよい情報（これ以外の商品知識・数値は一切使わない）',
    knowledge && knowledge.trim() ? knowledge.trim() : '（ナレッジ未設定。商品の詳細には答えず、開発中である旨だけ伝える）',
    '',
    extraInstructions && extraInstructions.trim() ? `## 追加の指示\n${extraInstructions.trim()}\n` : null,
    '## 分からないことへの対応',
    '上のナレッジでは答えられない質問（発売日・在庫・個別の注文状況・体調や既往症に関わる相談・',
    'クレーム・返金など）には、絶対に推測で答えないこと。その場合は reply を',
    '「確認してあらためてご連絡します」という趣旨にし、needs_escalation を true にする。',
    '',
    `## お客様の表示名\n${customerName || '（不明）'}`,
    '',
    `## このお客様について現在分かっていること\n${profileText}`,
    lastOutgoing
      ? `\n## 直前に自分（Taku）が送ったメッセージ\n${lastOutgoing}\n\n` +
        'これと同じ意図の質問を、今回の返信に入れてはいけない（言い回しを変えるのも不可）。\n' +
        'このメッセージで投げた質問に相手が答えていない場合は、それ以上聞かず、\n' +
        '相手の返答を受け止めて会話を締めるか、まったく別の話題にすること。'
      : null,
    '',
    '## 出力形式',
    '以下のJSONのみを出力する（前後に説明文やコードフェンスを付けない）。値が判断できない項目は null にする。',
    '{',
    '  "reply": "お客様に送るメッセージ",',
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
    'profile の値は日本語で、単位まで含めて書く（例: 「6年」「週4回」「ジム」「増量」）。英単語や数字だけにしない。',
    'creatine_status は drinking / quit / never / unknown のいずれかの英単語で返す。',
    'interest_level と purchase_intent は、こちらから聞き出すためのものではなく、',
    '会話に自然に出てきた範囲での記録用。判断できなければ unknown のままでよい。',
  ].filter((l) => l !== null).join('\n');
}

// 返信の見た目を整える。Taku本人として話すので絵文字は許可（プロンプト側で1つまでに制限）。
function tidyReply(text) {
  return String(text || '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
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
    persona: settings?.persona,
    knowledge: settings?.knowledge,
    extraInstructions: settings?.extra_instructions,
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
      if (parsed.reply) reply = tidyReply(parsed.reply);
      needsEscalation = !!parsed.needs_escalation;
      escalationReason = parsed.escalation_reason || '';
    } else if (raw) {
      reply = tidyReply(raw);
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

// ===========================================================================
// スケジューリング
// 即レスは「人間が返している感じ」を壊すので、受信も初回接触も一定時間空けて送る。
// 送信は cron（daily-cron 経由・10分間隔）と webhook のpiggybackから processCreashotQueue() で行う。
// ===========================================================================

/**
 * お客様からの受信に対する返信を、reply_delay_minutes 後に送るよう予約する。
 * 既に未送信の予約があれば、そちらに最新の発言を反映するだけにする
 * （連投されても返信は1通。予約時刻は最初の受信基準のまま＝待たせすぎない）。
 */
async function enqueueCreashotReply(friendId, userMessage, settings) {
  const delayMin = Number(settings?.reply_delay_minutes ?? 120);
  const scheduledAt = new Date(Date.now() + delayMin * 60 * 1000).toISOString();
  try {
    const { data: pending } = await supabase
      .from('creashot_queue')
      .select('id, trigger_text')
      .eq('friend_id', friendId)
      .eq('kind', 'reply')
      .eq('status', 'pending')
      .maybeSingle();

    if (pending) {
      const merged = [pending.trigger_text, userMessage].filter(Boolean).join('\n').slice(-2000);
      await supabase.from('creashot_queue').update({ trigger_text: merged }).eq('id', pending.id);
      return { queued: true, scheduledAt: null, merged: true };
    }

    await supabase.from('creashot_queue').insert({
      friend_id: friendId,
      kind: 'reply',
      trigger_text: userMessage,
      scheduled_at: scheduledAt,
    });
    return { queued: true, scheduledAt, merged: false };
  } catch (err) {
    console.error('[creashot-bot] enqueue reply error:', err.message);
    return { queued: false, scheduledAt: null, merged: false };
  }
}

/**
 * 対象タグが付いてから opening_delay_minutes 経った友だちに、初回メッセージを予約する。
 * タグ付与の経路（流入経路・キーワード自動応答・手動）ごとにフックを差し込むのは漏れるので、
 * friend_tags.created_at を定期的にスキャンする方式にしている。
 */
async function enqueueDueOpenings(settings, limit = 50) {
  const tagId = settings?.tag_id;
  if (!tagId) return 0;
  const delayMin = Number(settings?.opening_delay_minutes ?? 120);
  const cutoff = new Date(Date.now() - delayMin * 60 * 1000).toISOString();

  const { data: tagged } = await supabase
    .from('friend_tags')
    .select('friend_id, created_at')
    .eq('tag_id', tagId)
    .lte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(limit * 4);
  if (!tagged || tagged.length === 0) return 0;

  const ids = [...new Set(tagged.map((r) => r.friend_id))];
  const { data: already } = await supabase
    .from('creashot_queue')
    .select('friend_id')
    .eq('kind', 'opening')
    .in('friend_id', ids);
  const done = new Set((already || []).map((r) => r.friend_id));

  const targets = ids.filter((id) => !done.has(id)).slice(0, limit);
  let queued = 0;
  for (const friendId of targets) {
    // 友だち追加の挨拶以外に、こちらから何か送っている／向こうから話しかけられている場合は
    // 「改めまして」の初回文が不自然になるので出さない。
    const { data: convo } = await supabase
      .from('chat_messages')
      .select('id, direction, content')
      .eq('friend_id', friendId)
      .limit(20);
    const hasConversation = (convo || []).some((m) => {
      if (m.direction === 'incoming' || m.direction === 'inbound') return true;
      const src = m.content?.source;
      return src && src !== 'greeting';
    });
    if (hasConversation) {
      await supabase.from('creashot_queue').insert({
        friend_id: friendId,
        kind: 'opening',
        scheduled_at: new Date().toISOString(),
        status: 'skipped',
        error: 'すでに会話が始まっているため初回メッセージは送らない',
      }).then(() => {}, () => {});
      continue;
    }
    const { error } = await supabase.from('creashot_queue').insert({
      friend_id: friendId,
      kind: 'opening',
      scheduled_at: new Date().toISOString(),
    });
    if (!error) queued += 1;
  }
  return queued;
}

// 担当者が手で返信していたら、予約していたAIの返信は送らない
async function hasHumanReplySince(friendId, sinceIso) {
  const { data } = await supabase
    .from('chat_messages')
    .select('id, content')
    .eq('friend_id', friendId)
    .in('direction', ['outgoing', 'outbound'])
    .gte('created_at', sinceIso)
    .limit(20);
  return (data || []).some((m) => {
    const src = m.content?.source;
    return !src || src === 'crm_ui' || src === 'slack_escalation';
  });
}

/**
 * 送信期限が来たキューを処理する。cronとwebhookの両方から呼ばれる。
 * @param {(channelId: string, lineUserId: string, text: string) => Promise<boolean>} pushFn
 */
async function processCreashotQueue(pushFn, limit = 10) {
  const settings = await getCreashotSettings();
  if (!settings?.enabled || !settings.tag_id) return { processed: 0, queued: 0 };

  const queued = await enqueueDueOpenings(settings);

  const { data: due } = await supabase
    .from('creashot_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(limit);
  if (!due || due.length === 0) return { processed: 0, queued };

  let processed = 0;
  for (const item of due) {
    try {
      const { data: friend } = await supabase
        .from('friends')
        .select('id, display_name, line_user_id, channel_id, status')
        .eq('id', item.friend_id)
        .maybeSingle();

      if (!friend || !friend.line_user_id || friend.status === 'unfollowed') {
        await supabase.from('creashot_queue')
          .update({ status: 'skipped', error: '友だちが見つからない、またはブロック済み' })
          .eq('id', item.id);
        continue;
      }

      if (await hasHumanReplySince(item.friend_id, item.created_at)) {
        await supabase.from('creashot_queue')
          .update({ status: 'skipped', error: '担当者が手動で返信済み' })
          .eq('id', item.id);
        continue;
      }

      let text = '';
      if (item.kind === 'opening') {
        const template = settings.opening_message || '';
        if (!template.trim()) {
          await supabase.from('creashot_queue')
            .update({ status: 'skipped', error: '初回メッセージが未設定' })
            .eq('id', item.id);
          continue;
        }
        text = template.replace(/\{name\}/g, friend.display_name || 'さん').trim();
      } else {
        const history = await loadChatHistory(item.friend_id);
        const { reply } = await generateCreashotReply(item.trigger_text || '', {
          friendId: friend.id,
          customerName: friend.display_name || '',
          lineUserId: friend.line_user_id,
          chatHistory: history.messages,
          lastOutgoing: history.lastOutgoing,
          settings,
        });
        text = reply;
      }

      if (!text) {
        await supabase.from('creashot_queue')
          .update({ status: 'skipped', error: '送信内容が空' })
          .eq('id', item.id);
        continue;
      }

      const ok = await pushFn(friend.channel_id, friend.line_user_id, text);
      if (!ok) {
        await supabase.from('creashot_queue')
          .update({ status: 'error', error: 'LINEへの送信に失敗' })
          .eq('id', item.id);
        continue;
      }

      await supabase.from('chat_messages').insert({
        channel_id: friend.channel_id,
        friend_id: friend.id,
        direction: 'outgoing',
        message_type: 'text',
        content: { text, source: item.kind === 'opening' ? 'creashot_bot_opening' : 'creashot_bot' },
      });
      await supabase.from('creashot_queue')
        .update({ status: 'sent', sent_at: new Date().toISOString(), reply_text: text })
        .eq('id', item.id);
      processed += 1;
      console.log(`[creashot-bot] ${item.kind} sent to ${friend.display_name}`);
    } catch (err) {
      console.error('[creashot-bot] queue item error:', err.message);
      await supabase.from('creashot_queue')
        .update({ status: 'error', error: err.message })
        .eq('id', item.id)
        .then(() => {}, () => {});
    }
  }
  return { processed, queued };
}

// 直近の会話を、AIに渡せる形（role/content）で取り出す
async function loadChatHistory(friendId, limit = 20) {
  const { data: history } = await supabase
    .from('chat_messages')
    .select('direction, content, created_at')
    .eq('friend_id', friendId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (!history || history.length === 0) return { messages: [], lastOutgoing: '' };

  const toText = (m) => {
    if (m.content?.text) return m.content.text;
    if (Array.isArray(m.content?.messages)) {
      return m.content.messages.filter((x) => x.type === 'text' && x.text).map((x) => x.text).join('\n');
    }
    return '';
  };
  const messages = history.slice().reverse().map((m) => {
    const content = toText(m);
    if (!content) return null;
    const role = m.direction === 'inbound' || m.direction === 'incoming' ? 'user' : 'assistant';
    return { role, content };
  }).filter(Boolean);
  const lastOut = history.find((m) => m.direction === 'outgoing' || m.direction === 'outbound');
  return { messages, lastOutgoing: lastOut ? toText(lastOut) : '' };
}

module.exports = {
  generateCreashotReply,
  enqueueCreashotReply,
  processCreashotQueue,
  loadChatHistory,
  getCreashotSettings,
  invalidateCreashotSettingsCache,
  isCreashotFriend,
  CREATINE_STATUS_TAGS,
  PROFILE_FIELDS,
};
