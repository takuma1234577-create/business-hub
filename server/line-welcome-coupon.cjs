/**
 * 公式LINE登録 → My FITPEAK への自動連携と、登録特典クーポンの自動登録（2026-09-29）
 *
 * - 公式LINEを友だち追加した人は全員、LINEのID（members.line_user_id）で My FITPEAK の会員（FITPEAK ID）を自動で用意する。
 *   後からその人が「LINEでログイン」すると、同じ会員につながる。
 * - 公式サイト経由（流入経路コード j8drobax / zufpwj02 / ldwmkwyi）の人には、登録特典クーポン FPLINE1000（1,000円OFF・3,000円以上・1人1回）を coupons に登録する。
 *   実際の値引きはShopify側のコードが行い、使用回数（1人1回）もShopifyが管理する。ここは「My FITPEAKに表示する」ための記録。
 */
const { getSupabase } = require('./shared.cjs');

const SITE_CODES = ['j8drobax', 'zufpwj02', 'ldwmkwyi'];
const COUPON_CODE = 'FPLINE1000';

async function ensureWelcomeCoupon(memberId) {
  const supabase = getSupabase();
  const { data: exist } = await supabase
    .from('coupons')
    .select('id')
    .eq('member_id', memberId)
    .eq('source', 'line_signup')
    .limit(1)
    .maybeSingle();
  if (exist) return false;
  const { error } = await supabase.from('coupons').insert({
    member_id: memberId,
    code: COUPON_CODE,
    coupon_code: COUPON_CODE,
    discount_type: 'fixed',
    discount_value: 1000,
    discount_amount: 1000,
    source: 'line_signup',
    is_active: true,
  });
  if (error) { console.error('[welcome-coupon] insert failed:', error.message); return false; }
  return true;
}

// LINEのIDから会員を用意（無ければ作る）。ログイン用アカウントは、本人が「LINEでログイン」したときに作られる
async function ensureMemberForLine({ lineUserId, displayName }) {
  const supabase = getSupabase();
  const find = async () => (await supabase.from('members').select('id').eq('line_user_id', lineUserId).maybeSingle()).data;
  let member = await find();
  if (!member) {
    const { data, error } = await supabase
      .from('members')
      .insert({ line_user_id: lineUserId, nickname: displayName || null, source: 'line_follow' })
      .select('id')
      .single();
    member = data || (error ? await find() : null);
  }
  return member;
}

// follow webhook から呼ぶ：友だち追加した人は全員 My FITPEAK の会員（FITPEAK ID）を自動で用意する。
// 特典クーポンは公式サイト経由（流入経路コードが SITE_CODES）の人にだけ登録する。
async function onSiteFollow({ lineUserId, displayName, trafficSourceId }) {
  try {
    if (!lineUserId) return;
    const member = await ensureMemberForLine({ lineUserId, displayName });
    if (!member || !trafficSourceId) return;
    const { data: src } = await getSupabase().from('traffic_sources').select('code').eq('id', trafficSourceId).maybeSingle();
    if (src && SITE_CODES.includes(src.code)) await ensureWelcomeCoupon(member.id);
  } catch (e) {
    console.error('[welcome-coupon] onSiteFollow error:', e.message);
  }
}

// 「LINEでログイン」した会員が公式LINEの友だちなら、特典クーポンを登録する（登録前から友だちだった人も含む）
async function onLineLogin({ lineUserId, memberId }) {
  try {
    const { data: friend } = await getSupabase().from('friends').select('id').eq('line_user_id', lineUserId).maybeSingle();
    if (friend) await ensureWelcomeCoupon(memberId);
  } catch (e) {
    console.error('[welcome-coupon] onLineLogin error:', e.message);
  }
}

// メールで登録した会員がLINE連携したとき、LINE側で先に作られていた会員（クーポン付き）を、メール側の会員に寄せる
async function mergeLineMemberIntoEmailMember({ lineUserId, email }) {
  try {
    const supabase = getSupabase();
    const { data: byEmail } = await supabase.from('members').select('id, line_user_id').eq('email', email).limit(1).maybeSingle();
    if (!byEmail) return;
    if (byEmail.line_user_id && byEmail.line_user_id !== lineUserId) return; // 別のLINEと連携済みなら触らない
    const { data: byLine } = await supabase.from('members').select('id, auth_user_id').eq('line_user_id', lineUserId).maybeSingle();
    if (byLine && byLine.id !== byEmail.id) {
      if (byLine.auth_user_id) return; // すでにLINEログインのアカウントを持つ場合は統合しない（別アカウントとして残す）
      await supabase.from('coupons').update({ member_id: byEmail.id }).eq('member_id', byLine.id);
      await supabase.from('members').update({ line_user_id: null, merged_into: byEmail.id }).eq('id', byLine.id);
    }
    await supabase.from('members').update({ line_user_id: lineUserId }).eq('id', byEmail.id);
    await ensureWelcomeCoupon(byEmail.id);
  } catch (e) {
    console.error('[welcome-coupon] merge error:', e.message);
  }
}

module.exports = { onSiteFollow, onLineLogin, mergeLineMemberIntoEmailMember, COUPON_CODE };
