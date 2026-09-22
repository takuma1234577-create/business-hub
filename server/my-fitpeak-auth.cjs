/**
 * My FITPEAK（顧客向け）APIの認証
 *
 * - LINEログインやサインアップなど、ログイン前に呼ぶものは素通し
 * - それ以外は「顧客自身のSupabaseセッション」で通す。req.fitpeakEmail に本人のメールを入れる
 * - 顧客セッションが無い場合は、従来どおり社内の管理トークン（authMiddleware）で判定する
 */

const { createClient } = require('@supabase/supabase-js');
const { authMiddleware } = require('./auth.cjs');

// ログイン前に呼ばれるためトークン不要
const PUBLIC_PATHS = new Set([
  '/auth/signup',
  '/auth/reset-password',
  '/auth/auto-login',
  '/line-link',
  '/line-link/verify',
]);

module.exports = async function myFitpeakCustomerAuth(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) return next();

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (token) {
    try {
      const supabase = createClient(
        (process.env.SUPABASE_URL || '').trim(),
        (process.env.SUPABASE_ANON_KEY || '').trim()
      );
      const { data } = await supabase.auth.getUser(token);
      if (data?.user?.email) {
        req.fitpeakUser = data.user;
        // 他人のメールを指定されても、本人のデータしか返さない
        req.fitpeakEmail = data.user.email;
        return next();
      }
    } catch { /* 顧客セッションでなければ管理トークンとして判定する */ }
  }

  return authMiddleware(req, res, next);
};
