import { getSupabase } from '../supabase';
import type { BankScraper, RawTransaction } from '../scrapers/base';
import { SbiNetScraper } from '../scrapers/sbi-net';
import crypto from 'crypto';

// スクレイパーレジストリ
const SCRAPER_REGISTRY: Record<string, () => BankScraper> = {
  sbi_net: () => new SbiNetScraper(),
  // TODO: 追加
  // rakuten_bank: () => new RakutenBankScraper(),
  // rakuten_card: () => new RakutenCardScraper(),
  // smbc_card: () => new SmbcCardScraper(),
};

// アクティブなスクレイパー（2FAコード待ち中に保持）
const activeSessions = new Map<string, BankScraper>();

function decrypt(ciphertext: string): string {
  const secret = process.env.BANK_CREDENTIAL_ENCRYPTION_KEY;
  if (!secret) throw new Error('BANK_CREDENTIAL_ENCRYPTION_KEY が未設定');
  const key = crypto.scryptSync(secret, 'business-hub-salt', 32);
  const { iv, data, tag } = JSON.parse(ciphertext);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * POST /scrape から呼ばれる。ジョブIDを受け取りスクレイピングを実行する。
 */
export async function processScrapeJob(jobId: string): Promise<void> {
  const supabase = getSupabase();

  // 1. ジョブ取得
  const { data: job, error: jobErr } = await supabase
    .from('scraping_jobs').select('*').eq('id', jobId).single();
  if (jobErr || !job) throw new Error('ジョブが見つかりません');

  console.log(`[Processor] ジョブ ${jobId} 開始`);

  // 2. status → running
  await supabase.from('scraping_jobs').update({
    status: 'running', started_at: new Date().toISOString(),
  }).eq('id', jobId);

  await supabase.from('bank_credentials').update({
    sync_status: 'running', sync_error: null,
  }).eq('id', job.credential_id);

  try {
    // 3. 認証情報取得・復号
    const { data: cred } = await supabase
      .from('bank_credentials').select('*').eq('id', job.credential_id).single();
    if (!cred) throw new Error('認証情報が見つかりません');

    const loginId = decrypt(cred.login_id_encrypted);
    const password = decrypt(cred.password_encrypted);

    // 4. スクレイパー選択
    const factory = SCRAPER_REGISTRY[cred.institution_code];
    if (!factory) throw new Error(`${cred.institution_code} のスクレイパーは未対応です`);

    const scraper = factory();
    activeSessions.set(jobId, scraper);

    // 5. ログイン
    console.log(`[Processor] ${cred.institution_code}: ログイン中...`);
    const loginResult = await scraper.login({ userId: loginId, password });

    if (loginResult.status === 'error') {
      throw new Error(loginResult.message || 'ログイン失敗');
    }

    if (loginResult.status === 'waiting_2fa') {
      console.log(`[Processor] ジョブ ${jobId}: 2FA待ち`);
      await supabase.from('scraping_jobs').update({
        status: 'waiting_2fa',
        error_message: loginResult.message || '2FA認証が必要です。SMSコードを入力してください。',
      }).eq('id', jobId);

      await supabase.from('bank_credentials').update({
        sync_status: 'waiting_2fa',
        sync_error: loginResult.message,
      }).eq('id', cred.id);

      // ブラウザはアクティブなまま保持 → 2FAコード待ち
      return;
    }

    // 6. ログイン成功 → 明細取得
    await fetchAndSave(job, scraper);

  } catch (err: any) {
    console.error(`[Processor] ジョブ ${jobId} 失敗:`, err.message);

    // エラー時スクリーンショット
    const scraper = activeSessions.get(jobId);
    if (scraper && 'captureScreenshot' in scraper) {
      await (scraper as any).captureScreenshot(jobId).catch(() => {});
    }

    await supabase.from('scraping_jobs').update({
      status: 'error', completed_at: new Date().toISOString(), error_message: err.message,
    }).eq('id', jobId);

    await supabase.from('bank_credentials').update({
      sync_status: 'error', sync_error: err.message,
    }).eq('id', job.credential_id);

    // クリーンアップ
    const s = activeSessions.get(jobId);
    if (s) { await s.close(); activeSessions.delete(jobId); }
  }
}

/**
 * POST /scrape/:jobId/2fa から呼ばれる。
 */
export async function submit2faCode(jobId: string, code: string): Promise<void> {
  const supabase = getSupabase();
  const scraper = activeSessions.get(jobId);
  if (!scraper) throw new Error('アクティブなセッションが見つかりません。再度同期を実行してください。');

  console.log(`[Processor] ジョブ ${jobId}: 2FAコード受信`);

  await supabase.from('scraping_jobs').update({ status: 'running' }).eq('id', jobId);

  try {
    const result = await scraper.submitTwoFactor(code);

    if (result.status === 'error') {
      await supabase.from('scraping_jobs').update({
        status: 'waiting_2fa',
        error_message: result.message || '2FAコードが正しくありません。再入力してください。',
      }).eq('id', jobId);
      return;
    }

    // 2FA成功 → ジョブデータを再取得して明細取得
    const { data: job } = await supabase.from('scraping_jobs').select('*').eq('id', jobId).single();
    if (!job) throw new Error('ジョブが見つかりません');

    await fetchAndSave(job, scraper);

  } catch (err: any) {
    await supabase.from('scraping_jobs').update({
      status: 'error', completed_at: new Date().toISOString(), error_message: err.message,
    }).eq('id', jobId);

    await scraper.close();
    activeSessions.delete(jobId);
  }
}

/**
 * 明細取得 → DB保存
 */
async function fetchAndSave(job: any, scraper: BankScraper): Promise<void> {
  const supabase = getSupabase();
  const sessionData = (job.session_data || {}) as Record<string, unknown>;
  const daysBack = (sessionData.daysBack as number) || 30;

  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - daysBack);

  try {
    console.log(`[Processor] ジョブ ${job.id}: 明細取得中...`);
    const transactions = await scraper.fetchTransactions({ fromDate, toDate });
    console.log(`[Processor] ${transactions.length}件取得`);

    // 重複チェック & INSERT
    let imported = 0, skipped = 0;
    for (const tx of transactions) {
      const { data: existing } = await supabase.from('financial_transactions')
        .select('id')
        .eq('account_id', job.account_id)
        .eq('transaction_date', tx.date)
        .eq('amount', tx.amount)
        .eq('description', tx.description)
        .limit(1);

      if (existing && existing.length > 0) { skipped++; continue; }

      const { error } = await supabase.from('financial_transactions').insert({
        account_id: job.account_id,
        transaction_date: tx.date,
        amount: tx.amount,
        description: tx.description,
        balance_after: tx.balance ?? null,
        source: 'scraping',
        raw_data: JSON.stringify(tx),
        category: null,
      });

      if (error) { skipped++; } else { imported++; }
    }

    // 口座残高更新
    if (imported > 0) {
      const { data: latest } = await supabase.from('financial_transactions')
        .select('balance_after')
        .eq('account_id', job.account_id)
        .not('balance_after', 'is', null)
        .order('transaction_date', { ascending: false })
        .limit(1);

      if (latest?.[0]?.balance_after != null) {
        await supabase.from('financial_accounts')
          .update({ balance: latest[0].balance_after })
          .eq('id', job.account_id);
      }
    }

    // 完了
    await supabase.from('scraping_jobs').update({
      status: 'done',
      completed_at: new Date().toISOString(),
      transactions_found: transactions.length,
      transactions_imported: imported,
      transactions_skipped: skipped,
    }).eq('id', job.id);

    await supabase.from('bank_credentials').update({
      sync_status: 'success', sync_error: null, last_sync_at: new Date().toISOString(),
    }).eq('id', job.credential_id);

    console.log(`[Processor] ジョブ ${job.id} 完了: ${imported}件登録 / ${skipped}件スキップ`);

  } finally {
    await scraper.close();
    activeSessions.delete(job.id);
  }
}
