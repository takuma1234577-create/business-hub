/** SP-APIの資格情報(LWAクライアントシークレット、約180日で失効)の期限と、APIの403を見張り、オーナーの公式LINEへ知らせる。 */
const DAY = 86400000;
const REPEAT_MS = 24 * 3600000;

function recent(last, key, now) {
  return last && last.key === key && now - new Date(last.at) < REPEAT_MS;
}

/** 送るべき通知を1件返す。なければnull。403/401は期限より優先。通信エラーや5xxは資格情報の問題ではないので送らない。 */
function decideNotice({ now, expiresAt, probeStatus, last }) {
  if (probeStatus === 401 || probeStatus === 403) {
    if (recent(last, 'api403', now)) return null;
    return { key: 'api403', text: `【SP-API】Amazonから ${probeStatus} (権限なし)が返っています。在庫同期・注文取得・レビュー依頼が止まっています。デベロッパーセントラルでLWAクライアントシークレットの期限と、アプリの認可(リフレッシュトークン)を確認してください。` };
  }
  if (!expiresAt) return null;
  const days = Math.floor((new Date(expiresAt) - now) / DAY);
  const when = new Date(expiresAt).toISOString().slice(0, 10);
  if (days < 0) {
    if (recent(last, 'expired', now)) return null;
    return { key: 'expired', text: `【SP-API】LWAクライアントシークレットが期限切れです(期限 ${when})。ローテーションし、business-hubのAPI設定のclient_secretとrefresh_tokenを更新してください。` };
  }
  if (days <= 7 && !(last && (last.key === 'expiry7'))) {
    return { key: 'expiry7', text: `【SP-API】LWAクライアントシークレットの期限まで あと${days}日です(期限 ${when})。デベロッパーセントラルでローテーションし、client_secretとrefresh_tokenを更新してください。` };
  }
  if (days <= 30 && days > 7 && !(last && (last.key === 'expiry30' || last.key === 'expiry7'))) {
    return { key: 'expiry30', text: `【SP-API】LWAクライアントシークレットの期限まで 約30日です(期限 ${when})。余裕のあるうちにローテーションし、client_secretとrefresh_tokenを更新してください。` };
  }
  return null;
}

/** 1回分の見張り。通知に失敗したら記録しない(次回また試す)。 */
async function runSpApiWatch({ now = new Date(), getState, probe, notify, saveLast }) {
  const { expiresAt, last } = await getState();
  const probeStatus = await probe();
  const notice = decideNotice({ now, expiresAt, probeStatus, last });
  if (!notice) return { sent: false, probeStatus, reason: 'nothing_to_send' };
  const r = await notify({ kind: 'info', text: notice.text });
  if (!r || !r.ok) return { sent: false, probeStatus, key: notice.key, error: r && r.error };
  await saveLast({ key: notice.key, at: now.toISOString() });
  return { sent: true, probeStatus, key: notice.key };
}

module.exports = { decideNotice, runSpApiWatch };
