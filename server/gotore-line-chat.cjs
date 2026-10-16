/**
 * 合トレナビ：公式LINEのトークだけで募集を作る・近くの募集を見る・自分の募集を管理する（2026-10-17 オーナー指示）
 *
 *   「合トレ募集」（表記ゆれ可）       → ジム → 時間帯 → 部位 → 目的 → 同性のみか → ひとこと → 確認カード → 投稿
 *   「募集を見る」「近くの合トレ」     → 本人の通っているジム・市区町村・都道府県の公開中の募集を Flex カルーセルで最大10件
 *   「自分の募集」                     → 本人の募集の一覧（締め切る・削除する）
 *
 * 安全の決まり
 *   - 本人は Webhook の source.userId だけで決める。postback の data に入った ID・LINE ID は信用しない
 *     （下書きは LINE のユーザーIDがキー。data の k は「今の質問のボタンか」を確かめる合言葉で、他人の下書きには届かない）。
 *   - 募集の作成・締め切り・文のチェックは既存の gt_post_create / gt_post_close / gt_check_text をそのまま呼ぶ（検証を重複させない）。
 *   - 返信に出すのは公開項目だけ。他人の表示名・性別・年代、本人の非公開項目（お名前・メール・住所）は出さない。
 *   - 合トレの会話中でなければ null を返す（line-crm.cjs は従来どおりの自動返信・AIへ流す）。
 */
const { parseAreaHandle, notifyAll, newPostText, SLOT_LABEL } = require('./gotore.cjs');

const PART_LABEL = { chest: '胸', back: '背中', legs: '脚', shoulders: '肩', arms: '腕', full: '全身', cardio: '有酸素' };
const GOAL_LABEL = { spot: '補助してほしい', form: 'フォームを見てほしい', motivation: 'モチベーション維持', learn: '教わりたい', teach: '教えられます' };
const LEVEL_LABEL = { beginner: '初心者', intermediate: '中級者', advanced: '上級者', competitor: '大会出場' };
const MISSING_LABEL = {
  display_name: '表示名（ニックネーム）', pref: '都道府県', city: '市区町村', gyms: '通っているジム', age_band: '年代', gender: '性別',
  name: 'お名前', kana: 'フリガナ', email: 'メールアドレス',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 送られた文の判定（全角→半角・空白と記号を除く）
const norm = (t) => String(t || '').normalize('NFKC').toLowerCase().replace(/[\s。、．，！!？?・〜~ー\-「」『』]/g, '');
const START = /^(line|ライン)?で?(合トレ|あわトレ|ごうトレ|合トレ仲間)?(を|の)?募集(する|したい|します|を作る|作成)?$/;
const LIST = /^(合トレの?)?募集(を|が)?(見る|見たい|一覧|探す)$|^近くの(合トレ|募集)$|^合トレ(を|の募集を)?(見る|探す)$/;
const MINE = /^(自分|わたし|私|僕|俺)の募集$/;
const CANCEL = /^(やめる|やめます|やめたい|キャンセル|中止|終了)$/;
const SKIP = /^(スキップ|なし|無し|特になし)$/;

const ellip = (s, n) => { const a = Array.from(String(s || '')); return a.length > n ? `${a.slice(0, n - 1).join('')}…` : a.join(''); };
const labels = (keys, map) => (keys || []).map((k) => map[k]).filter(Boolean).join('・');
const jstDate = (iso) => { const d = new Date(new Date(iso).getTime() + 9 * 3600000); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
const isJa = (msg) => /[ぁ-んァ-ヶ一-龠]/.test(msg);

function createGotoreChat(deps) {
  const liff = (path) => `https://liff.line.me/${deps.liffId}?${new URLSearchParams({ mode: 'myfp', redirect: path })}`;
  const pb = (params) => `action=gotore&${new URLSearchParams(params)}`;

  // ── メッセージ部品 ──────────────────────────────────────────────
  const qrPost = (label, params, displayText) => ({ type: 'action', action: { type: 'postback', label: ellip(label, 20), data: pb(params), displayText: displayText || ellip(label, 40) } });
  const textQ = (text, items) => ({ type: 'text', text, ...(items && items.length ? { quickReply: { items: items.slice(0, 13) } } : {}) });
  const button = (action, style = 'secondary') => ({ type: 'button', style, height: 'sm', action });
  const uriBtn = (label, path, style) => button({ type: 'uri', label, uri: liff(path) }, style);
  const postBtn = (label, params, style, displayText) => button({ type: 'postback', label, data: pb(params), displayText: displayText || label }, style);
  const bubble = (title, lines, buttons) => ({
    type: 'bubble', size: 'kilo',
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      { type: 'text', text: title, weight: 'bold', size: 'md', wrap: true },
      ...lines.filter(Boolean).map((l) => ({ type: 'text', text: l, size: 'sm', color: '#444444', wrap: true })),
    ] },
    ...(buttons && buttons.length ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons } } : {}),
  });
  const flex = (altText, contents) => ({ type: 'flex', altText: ellip(altText, 300), contents });
  const out = (messages, log) => ({ messages: Array.isArray(messages) ? messages : [messages], log });
  const cancelItem = (k) => qrPost('やめる', { s: 'cancel', k }, 'やめる');

  // ── 本人の確認（会員・アカウントのプロフィール・合トレのプロフィール）─────
  async function gate(lineUserId, { needGotore }) {
    const member = await deps.rpc('gt_line_member', { p_line: lineUserId });
    if (!member) {
      return { stop: out(flex('My FITPEAKへの登録が必要です', bubble('合トレナビ', [
        '合トレナビは My FITPEAK の機能です。はじめに My FITPEAK に登録（LINEでログイン）して、プロフィールを入力してください。',
      ], [uriBtn('My FITPEAKに登録', '/my-fitpeak/account', 'primary')])), '[合トレ] My FITPEAK未登録のため登録を案内') };
    }
    const acc = await deps.rpc('mf_public_get', { p_member: member });
    const missing = (acc && acc.missing) || [];
    if (missing.length) {
      const names = missing.map((k) => MISSING_LABEL[k]).filter(Boolean);
      return { stop: out(flex('プロフィールの入力が必要です', bubble('プロフィールの入力が必要です', [
        `My FITPEAK のプロフィールに、まだ入力されていない項目があります：${names.join('・')}`,
        'お名前・メールアドレスはほかの会員には表示されません。',
      ], [uriBtn('プロフィールを登録', '/my-fitpeak/account', 'primary')])), `[合トレ] プロフィール不足を案内（${names.join('・')}）`) };
    }
    if (needGotore) {
      const me = await deps.rpc('gt_me', { p_member: member });
      if (!me || !me.profile) {
        return { stop: out(flex('合トレのプロフィール登録が必要です', bubble('合トレのプロフィール登録', [
          '募集を出すには、合トレのプロフィール（レベル）の登録と、ルール（18歳以上・合トレ目的のみ）への同意が必要です。1分で終わります。',
        ], [uriBtn('合トレのプロフィールを登録', '/my-fitpeak/gotore/profile', 'primary')])), '[合トレ] 合トレのプロフィール登録を案内') };
      }
      if (me.profile.suspended) return { stop: out(textQ('このアカウントは合トレナビの利用停止中です。'), '[合トレ] 利用停止中') };
    }
    return { member, pub: acc.public };
  }

  // ── 下書き ────────────────────────────────────────────────────────
  const save = (lineUserId, step, data) => deps.rpc('gt_line_draft_put', { p_line: lineUserId, p_step: step, p_data: data });
  const clear = (lineUserId) => deps.rpc('gt_line_draft_clear', { p_line: lineUserId });

  function ask(d, prefix) {
    const { step, data, token: k } = d;
    const head = prefix ? `${prefix}\n\n` : '';
    if (step === 'gym') {
      return textQ(`${head}【合トレ募集】どのジムで募集しますか？\n（My FITPEAK のプロフィールに登録した、通っているジムから選べます）`,
        [...data.opts.map((o, i) => qrPost(o.n, { s: 'gym', v: String(i), k }, o.n)), cancelItem(k)]);
    }
    if (step === 'slots' || step === 'parts' || step === 'goals') {
      const map = step === 'slots' ? SLOT_LABEL : step === 'parts' ? PART_LABEL : GOAL_LABEL;
      const chosen = data[step] || [];
      const q = step === 'slots' ? '行ける時間帯を選んでください（複数可）。選び終わったら「決定」。'
        : step === 'parts' ? '一緒にやりたい部位は？（任意・複数可）' : '合トレの目的は？（任意・複数可）';
      const now = chosen.length ? `\n選択中：${labels(chosen, map)}` : '';
      const items = Object.entries(map).map(([key, label]) => qrPost(`${chosen.includes(key) ? '●' : ''}${label}`, { s: step, v: key, k }, label));
      if (step !== 'slots' || chosen.length) items.push(qrPost(chosen.length ? '決定' : '指定なしで次へ', { s: step, v: 'done', k }));
      items.push(cancelItem(k));
      return textQ(`${head}${data.gname}\n${q}${now}`, items);
    }
    if (step === 'gender') {
      return textQ(`${head}募集を見せる相手は？\n「同性のみ」にすると、同じ性別の人にだけ表示されます。`,
        [qrPost('誰でも', { s: 'gender', v: 'any', k }), qrPost('同性のみ', { s: 'gender', v: 'same', k }), cancelItem(k)]);
    }
    if (step === 'note') {
      return textQ(`${head}ひとことがあれば、このトークに送ってください（200文字まで）。\n例：ベンチの補助をお願いできる方を探しています\n\n電話番号・LINE ID・SNSなどの連絡先は書けません。なければ「スキップ」。`,
        [qrPost('スキップ', { s: 'note', v: 'skip', k }), cancelItem(k)]);
    }
    // confirm
    return flex('この内容で募集しますか？', bubble('この内容で募集しますか？', [
      `ジム：${data.gname}`,
      `時間帯：${labels(data.slots, SLOT_LABEL)}`,
      `部位：${labels(data.parts, PART_LABEL) || '指定なし'}`,
      `目的：${labels(data.goals, GOAL_LABEL) || '指定なし'}`,
      `表示する相手：${data.same ? '同性のみ' : '誰でも'}`,
      `ひとこと：${data.note || 'なし'}`,
      '募集は30日で自動的に締め切られます。',
    ], [
      postBtn('投稿する', { s: 'post', k }, 'primary'),
      postBtn('やり直す', { s: 'restart', k }),
      postBtn('やめる', { s: 'cancel', k }),
    ]));
  }
  const askOut = (d, prefix) => out(ask(d, prefix), `[合トレ] 質問（${d.step}）`);

  async function start(lineUserId) {
    const g = await gate(lineUserId, { needGotore: true });
    if (g.stop) { await clear(lineUserId); return g.stop; }
    const pub = g.pub || {};
    const opts = (pub.gyms || []).filter((x) => x && x.kind === 'review' && x.key).slice(0, 5).map((x) => ({ h: String(x.key), n: String(x.name) }));
    if (pub.pref && pub.city && parseAreaHandle(`area:${pub.pref}:${pub.city}`)) opts.push({ h: `area:${pub.pref}:${pub.city}`, n: `${pub.city}のエリア掲示板` });
    if (pub.pref) opts.push({ h: `area:${pub.pref}:`, n: `${pub.pref}全体の掲示板` });
    const d = await save(lineUserId, 'gym', { opts, ask_gender: pub.gender === 'male' || pub.gender === 'female' });
    return askOut(d);
  }

  // ジムの掲示板を用意する（記事のジムは記事の実在を確かめてから。公開APIと同じ手順）
  async function board(handle) {
    let r = await deps.rpc('gt_gym_public', { p_handle: handle });
    if (r && r.gym) return r.gym;
    const a = handle.startsWith('area:') ? parseAreaHandle(handle) : await deps.lookupArticle(handle).catch(() => null);
    if (!a) return null;
    await deps.rpc('gt_gym_upsert', { p_handle: handle, p_name: a.name, p_pref: a.pref, p_city: a.city });
    r = await deps.rpc('gt_gym_public', { p_handle: handle });
    return r && r.gym;
  }

  async function step(lineUserId, d, s, v) {
    const data = { ...d.data };
    if (s === 'gym' && d.step === 'gym') {
      const o = /^\d{1,2}$/.test(v || '') ? data.opts[Number(v)] : null;
      if (!o) return askOut(d, '下のボタンから選んでください。');
      const gym = await board(o.h);
      if (!gym) return askOut(d, `「${o.n}」の掲示板を用意できませんでした。ほかのジムかエリア掲示板を選んでください。`);
      return askOut(await save(lineUserId, 'slots', { ...data, h: o.h, gid: gym.id, gname: gym.name, slots: [], parts: [], goals: [] }));
    }
    if ((s === 'slots' || s === 'parts' || s === 'goals') && d.step === s) {
      const map = s === 'slots' ? SLOT_LABEL : s === 'parts' ? PART_LABEL : GOAL_LABEL;
      const chosen = Array.isArray(data[s]) ? data[s] : [];
      if (v === 'done') {
        if (s === 'slots' && !chosen.length) return askOut(d, '時間帯を1つ以上選んでください。');
        const next = s === 'slots' ? 'parts' : s === 'parts' ? 'goals' : data.ask_gender ? 'gender' : 'note';
        return askOut(await save(lineUserId, next, { ...data, ...(next === 'note' ? { same: false } : {}) }));
      }
      if (!Object.prototype.hasOwnProperty.call(map, v)) return askOut(d, '下のボタンから選んでください。');
      const nextChosen = chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v];
      return askOut(await save(lineUserId, s, { ...data, [s]: Object.keys(map).filter((x) => nextChosen.includes(x)) }));
    }
    if (s === 'gender' && d.step === 'gender' && (v === 'any' || v === 'same')) {
      return askOut(await save(lineUserId, 'note', { ...data, same: v === 'same' }));
    }
    if (s === 'note' && d.step === 'note' && v === 'skip') {
      return askOut(await save(lineUserId, 'confirm', { ...data, note: '' }));
    }
    if (s === 'post' && d.step === 'confirm') return post(lineUserId, data);
    return askOut(d, '前のボタンです。いちばん新しい質問のボタンから選んでください。');
  }

  async function noteText(lineUserId, d, text) {
    let note;
    try {
      note = await deps.rpc('gt_check_text', { p_text: text, p_label: '募集文', p_max: 200 });
    } catch (e) {
      const msg = String(e && e.message || '');
      if (!isJa(msg)) throw e;
      return askOut(d, `${msg}\nもう一度送ってください。`);
    }
    return askOut(await save(lineUserId, 'confirm', { ...d.data, note }));
  }

  async function post(lineUserId, data) {
    const g = await gate(lineUserId, { needGotore: true });
    if (g.stop) { await clear(lineUserId); return g.stop; }
    let r;
    try {
      r = await deps.rpc('gt_post_create', {
        p_member: g.member, p_handle: data.h, p_slots: data.slots || [], p_parts: data.parts || [], p_goals: data.goals || [],
        p_gender_pref: data.same ? 'same' : 'any', p_note: data.note || '',
      });
    } catch (e) {
      const msg = String(e && e.message || '');
      if (!isJa(msg)) throw e;
      if (/すでに/.test(msg)) {
        await clear(lineUserId);
        return out(textQ(`${msg}`, [qrPost('自分の募集', { s: 'mine' })]), '[合トレ] 投稿できず（同じジムに募集あり）');
      }
      const d = await deps.rpc('gt_line_draft_get', { p_line: lineUserId });
      return out([textQ(msg), ...(d ? [ask(d)] : [])], '[合トレ] 投稿できず');
    }
    await clear(lineUserId);
    await notifyAll({ pushLine: deps.pushLine }, r.notify, newPostText(deps.baseUrl, r, data.slots));
    return out(flex('募集を出しました', bubble('募集を出しました', [
      `${r.gym_name}（${labels(data.slots, SLOT_LABEL)}）`,
      '「合トレしたい」が届いたら、このLINEでお知らせします。',
    ], [uriBtn('掲示板で見る', `/my-fitpeak/gotore/b/${data.gid}`, 'primary'), postBtn('自分の募集', { s: 'mine' })])), `[合トレ] 募集を投稿（${r.gym_name}）`);
  }

  // ── 近くの募集 ────────────────────────────────────────────────────
  async function nearby(lineUserId) {
    const g = await gate(lineUserId, { needGotore: false });
    if (g.stop) return g.stop;
    const pub = g.pub || {};
    const handles = (pub.gyms || []).filter((x) => x && x.kind === 'review' && x.key).map((x) => String(x.key));
    if (pub.pref && pub.city) handles.push(`area:${pub.pref}:${pub.city}`);
    const posts = await deps.rpc('gt_line_nearby', { p_member: g.member, p_handles: handles, p_pref: pub.pref || null, p_city: pub.city || null, p_limit: 10 });
    if (!posts || !posts.length) {
      return out(textQ('近くの公開中の合トレ募集はまだありません。あなたが最初の募集を出してみませんか？', [qrPost('LINEで募集する', { s: 'start' })]), '[合トレ] 近くの募集 0件');
    }
    const cards = posts.slice(0, 10).map((p) => bubble(ellip(p.gym_name, 40), [
      `${p.pref || ''}${p.city || ''}・${jstDate(p.created_at)}の募集`,
      `時間帯：${labels(p.slots, SLOT_LABEL)}`,
      p.parts && p.parts.length ? `部位：${labels(p.parts, PART_LABEL)}` : null,
      p.goals && p.goals.length ? `目的：${labels(p.goals, GOAL_LABEL)}` : null,
      LEVEL_LABEL[p.level] ? `レベル：${LEVEL_LABEL[p.level]}` : null,
      p.note ? ellip(p.note, 120) : null,
    ], [uriBtn('詳しく見る・応募する', `/my-fitpeak/gotore/b/${p.gym_id}`, 'primary')]));
    return out([flex('近くの合トレ募集', { type: 'carousel', contents: cards }), textQ('気になる募集は「詳しく見る・応募する」から。自分も募集できます。', [qrPost('LINEで募集する', { s: 'start' }), qrPost('自分の募集', { s: 'mine' })])],
      `[合トレ] 近くの募集 ${cards.length}件を表示`);
  }

  // ── 自分の募集 ────────────────────────────────────────────────────
  const STATUS = { open: '募集中', closed: '締め切り済み', expired: '期限切れ' };
  async function mine(lineUserId) {
    const member = await deps.rpc('gt_line_member', { p_line: lineUserId });
    if (!member) return (await gate(lineUserId, { needGotore: false })).stop;
    const posts = await deps.rpc('gt_line_my_posts', { p_member: member });
    if (!posts || !posts.length) {
      return out(textQ('まだ合トレの募集はありません。', [qrPost('LINEで募集する', { s: 'start' }), qrPost('近くの募集を見る', { s: 'list' })]), '[合トレ] 自分の募集 0件');
    }
    const cards = posts.slice(0, 10).map((p) => bubble(ellip(p.gym_name, 40), [
      `${STATUS[p.status] || ''}・${jstDate(p.created_at)}に作成`,
      `時間帯：${labels(p.slots, SLOT_LABEL)}`,
      `申請 ${p.requests}件${p.pending ? `（未対応 ${p.pending}件）` : ''}`,
    ], [
      uriBtn('申請を見る', '/my-fitpeak/gotore', 'primary'),
      ...(p.status === 'open' ? [postBtn('締め切る', { s: 'close', p: p.id })] : []),
      postBtn('削除する', { s: 'del', p: p.id }),
    ]));
    return out(flex('自分の合トレ募集', { type: 'carousel', contents: cards }), `[合トレ] 自分の募集 ${cards.length}件を表示`);
  }

  async function manage(lineUserId, s, postId) {
    if (!UUID.test(postId || '')) return out(textQ('募集が見つかりません。'), '[合トレ] 不正なボタン');
    const member = await deps.rpc('gt_line_member', { p_line: lineUserId });
    if (!member) return out(textQ('募集が見つかりません。'), '[合トレ] 会員なし');
    if (s === 'del') {
      const own = ((await deps.rpc('gt_line_my_posts', { p_member: member })) || []).find((p) => p.id === postId);
      if (!own) return out(textQ('募集が見つかりません。'), '[合トレ] 削除対象なし');
      return out(textQ(`${own.gym_name}の募集を削除しますか？\n届いた申請も消えます（元に戻せません）。`,
        [qrPost('削除する（確定）', { s: 'del2', p: postId }), qrPost('やめておく', { s: 'mine' })]), '[合トレ] 削除の確認');
    }
    try {
      if (s === 'close') {
        await deps.rpc('gt_post_close', { p_member: member, p_post: postId });
        return out(textQ('募集を締め切りました。', [qrPost('自分の募集', { s: 'mine' })]), '[合トレ] 募集を締め切り');
      }
      await deps.rpc('gt_post_delete', { p_member: member, p_post: postId });
      return out(textQ('募集を削除しました。', [qrPost('自分の募集', { s: 'mine' })]), '[合トレ] 募集を削除');
    } catch (e) {
      const msg = String(e && e.message || '');
      if (!isJa(msg)) throw e;
      return out(textQ(msg, [qrPost('自分の募集', { s: 'mine' })]), '[合トレ] 操作できず');
    }
  }

  const expired = () => out(textQ('時間が経ったため（30分）、募集の作成を終了しました。もう一度「合トレ募集」と送るか、下のボタンから始めてください。',
    [qrPost('LINEで募集する', { s: 'start' })]), '[合トレ] 下書きの期限切れ');
  const cancelled = () => out(textQ('募集の作成をやめました。', [qrPost('LINEで募集する', { s: 'start' }), qrPost('近くの募集を見る', { s: 'list' })]), '[合トレ] 募集の作成をやめた');

  return {
    // 文字のメッセージ。合トレで扱わないときは null
    async onText({ lineUserId, text }) {
      if (!lineUserId) return null;
      const n = norm(text);
      if (START.test(n)) return start(lineUserId);
      if (LIST.test(n)) return nearby(lineUserId);
      if (MINE.test(n)) return mine(lineUserId);
      const d = await deps.rpc('gt_line_draft_get', { p_line: lineUserId });
      if (!d) return null;
      if (CANCEL.test(n)) { await clear(lineUserId); return cancelled(); }
      if (d.step === 'note') {
        if (SKIP.test(n)) return askOut(await save(lineUserId, 'confirm', { ...d.data, note: '' }));
        return noteText(lineUserId, d, String(text || ''));
      }
      return askOut(d, '下のボタンから選んでください（やめるときは「やめる」と送ってください）。');
    },

    // ボタン（postback）。action=gotore 以外は null
    async onPostback({ lineUserId, data }) {
      let q;
      try { q = new URLSearchParams(String(data || '')); } catch { return null; }
      if (q.get('action') !== 'gotore' || !lineUserId) return null;
      const s = q.get('s') || '';
      if (s === 'start') return start(lineUserId);
      if (s === 'list') return nearby(lineUserId);
      if (s === 'mine') return mine(lineUserId);
      if (s === 'close' || s === 'del' || s === 'del2') return manage(lineUserId, s, q.get('p'));
      if (!['gym', 'slots', 'parts', 'goals', 'gender', 'note', 'post', 'restart', 'cancel'].includes(s)) {
        return out(textQ('このボタンは使えません。「合トレ募集」と送ると募集を作れます。'), '[合トレ] 不明なボタン');
      }
      const d = await deps.rpc('gt_line_draft_get', { p_line: lineUserId });
      if (!d) return s === 'cancel' ? cancelled() : expired();
      if (q.get('k') !== d.token) return askOut(d, '前のボタンです。いちばん新しい質問のボタンから選んでください。');
      if (s === 'cancel') { await clear(lineUserId); return cancelled(); }
      if (s === 'restart') return start(lineUserId);
      return step(lineUserId, d, s, q.get('v'));
    },
  };
}

function productionDeps() {
  const gotore = require('./gotore.cjs').productionDeps();
  return {
    rpc: gotore.rpc,
    baseUrl: gotore.baseUrl,
    liffId: (process.env.MY_FITPEAK_LIFF_ID || '2006537445-rcvSBpCP').trim(),
    lookupArticle: gotore.lookupArticle,
    pushLine: gotore.pushLine,
  };
}

let prod;
const production = () => (prod ||= createGotoreChat(productionDeps()));

// Webhook のイベントを合トレの会話へ。扱わない・失敗したときは null（line-crm.cjs は従来の処理を続ける）
async function routeLineEvent(chat, event) {
  const lineUserId = event && event.source && event.source.userId;
  if (!lineUserId) return null;
  try {
    if (event.type === 'message' && event.message && event.message.type === 'text') {
      return (await chat.onText({ lineUserId, text: event.message.text })) || null;
    }
    if (event.type === 'postback' && event.postback) {
      return (await chat.onPostback({ lineUserId, data: event.postback.data })) || null;
    }
  } catch (e) {
    console.error('[gotore-chat]', e && e.message);
  }
  return null;
}

module.exports = { createGotoreChat, production, routeLineEvent };
