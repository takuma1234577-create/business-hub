import { BaseScraper, RawTransaction, LoginResult, TwoFactorResult, FetchOptions } from './base';

const SELECTORS = {
  userInput: 'input[name="userName"], #userName, input[type="text"][autocomplete="username"], input[type="text"]',
  passInput: 'input[name="loginPwdSet"], #loginPwdSet, input[type="password"]',
  loginBtn: 'button[type="submit"], input[type="submit"], a.m-btn-submit, button.m-btn-submit, .m-btn-login',
  twoFaInput: 'input[name="otp"], input[name="authCode"], input[type="tel"], input[name="token"]',
} as const;

export class SbiNetScraper extends BaseScraper {
  readonly bankId = 'sbi_net';
  readonly bankName = '住信SBIネット銀行';
  protected readonly SELECTORS = SELECTORS;

  private _twoFaResolve?: (code: string) => void;

  async login(credentials: { userId: string; password: string }): Promise<LoginResult> {
    await this.initBrowser();

    console.log('[SBI] ログインページに移動中...');
    await this.page.goto('https://www.netbk.co.jp/contents/pages/wpl010101/i010101CT/DI/nb_login', {
      waitUntil: 'domcontentloaded', timeout: 45000,
    });
    await this.randomDelay();

    // ユーザー名入力
    console.log('[SBI] 認証情報を入力中...');
    await this.page.waitForSelector(SELECTORS.userInput, { timeout: 30000 });
    const userEl = await this.page.$(SELECTORS.userInput);
    if (!userEl) return { status: 'error', message: 'ユーザー名フィールドが見つかりません' };
    await userEl.click({ clickCount: 3 });
    await userEl.type(credentials.userId, { delay: 50 });
    await this.randomDelay(500, 1000);

    // パスワード入力
    const passEl = await this.page.$(SELECTORS.passInput);
    if (!passEl) return { status: 'error', message: 'パスワードフィールドが見つかりません' };
    await passEl.click({ clickCount: 3 });
    await passEl.type(credentials.password, { delay: 50 });
    await this.randomDelay(500, 1000);

    // ログインボタン
    console.log('[SBI] ログイン実行中...');
    for (const sel of SELECTORS.loginBtn.split(', ')) {
      const btn = await this.page.$(sel);
      if (btn) { await btn.click(); break; }
    }

    // ページ遷移待ち
    await Promise.race([
      this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }),
      new Promise(r => setTimeout(r, 20000)),
    ]).catch(() => {});
    await this.randomDelay(2000, 3000);

    // 結果判定
    const content = await this.safeContent();
    const url = this.page.url();

    if (/ログインできません|IDまたはパスワード|認証に失敗/.test(content)) {
      return { status: 'error', message: 'ログイン失敗: ユーザー名またはパスワードが正しくありません' };
    }

    if (/スマート認証|認証番号|ワンタイム|二要素|承認/.test(content) || url.includes('auth')) {
      console.log('[SBI] スマート認証を検出');
      return { status: 'waiting_2fa', message: 'スマート認証が必要です。スマホアプリで承認するか、認証コードを入力してください。' };
    }

    if (url.includes('nb_login') || url.includes('wpl010101')) {
      return { status: 'error', message: 'ログインに失敗しました。認証情報を確認してください。' };
    }

    console.log('[SBI] ログイン成功:', url);
    return { status: 'logged_in' };
  }

  async submitTwoFactor(code: string): Promise<TwoFactorResult> {
    console.log('[SBI] 2FAコードを入力中...');

    // コード入力フィールドを探す
    for (const sel of SELECTORS.twoFaInput.split(', ')) {
      const input = await this.page.$(sel);
      if (input) {
        await input.click({ clickCount: 3 });
        await input.type(code, { delay: 80 });
        break;
      }
    }
    await this.randomDelay();

    // 送信ボタン
    for (const sel of ['button[type="submit"]', 'input[type="submit"]', 'button.m-btn-submit']) {
      const btn = await this.page.$(sel);
      if (btn) { await btn.click(); break; }
    }

    await Promise.race([
      this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }),
      new Promise(r => setTimeout(r, 20000)),
    ]).catch(() => {});
    await this.randomDelay(2000, 3000);

    const content = await this.safeContent();
    if (/エラー|失敗|正しくありません/.test(content)) {
      return { status: 'error', message: '2FAコードが正しくありません' };
    }

    console.log('[SBI] 2FA認証成功');
    return { status: 'logged_in' };
  }

  async fetchTransactions(options: FetchOptions): Promise<RawTransaction[]> {
    console.log('[SBI] 入出金明細ページに移動中...');

    // 明細ページへ遷移
    const historyUrls = [
      'https://www.netbk.co.jp/contents/pages/wpl010300/i010300CT/DI/nb_trn_his',
      'https://www.netbk.co.jp/contents/pages/wpl900500/i900500CT/DI/nb_statement_list',
    ];

    let navigated = false;
    for (const url of historyUrls) {
      try {
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await this.randomDelay(2000, 3000);
        const content = await this.safeContent();
        if (/入出金|明細|取引履歴|日付/.test(content)) {
          navigated = true;
          console.log('[SBI] 明細ページに到達');
          break;
        }
      } catch { /* try next */ }
    }

    // メニューリンクからの遷移
    if (!navigated) {
      try {
        const links = await this.page.$$('a');
        for (const link of links) {
          const text = await this.page.evaluate(el => el.textContent, link).catch(() => '');
          if (text && /入出金|明細|取引履歴/.test(text)) {
            await link.click();
            await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            await this.randomDelay(2000, 3000);
            navigated = true;
            break;
          }
        }
      } catch { /* best effort */ }
    }

    // テーブルから取引データ抽出
    console.log('[SBI] 取引データを抽出中...');
    const transactions = await this.page.evaluate(() => {
      const results: { date: string; description: string; amount: number; balance?: number }[] = [];

      document.querySelectorAll('table tr, [role="row"]').forEach(row => {
        const cells = row.querySelectorAll('td, [role="cell"]');
        if (cells.length < 3) return;
        const texts = Array.from(cells).map(c => (c as HTMLElement).textContent?.trim().replace(/\s+/g, ' ') || '');

        let dateStr: string | null = null;
        for (const t of texts) {
          const m = t.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
          if (m) { dateStr = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; break; }
        }
        if (!dateStr) return;

        const amounts: { index: number; value: number }[] = [];
        let description = '';
        texts.forEach((t, i) => {
          const cleaned = t.replace(/[,¥￥\s円]/g, '');
          const num = parseFloat(cleaned);
          if (!isNaN(num) && num !== 0 && /^-?\d+$/.test(cleaned)) {
            amounts.push({ index: i, value: num });
          } else if (i > 0 && t.length > 1 && !/^\d{4}/.test(t) && !description) {
            description = t;
          }
        });
        if (amounts.length === 0) return;

        let amount = 0;
        let balance: number | undefined;
        if (amounts.length >= 3) {
          amount = amounts[1].value > 0 ? amounts[1].value : -amounts[0].value;
          balance = amounts[2].value;
        } else if (amounts.length === 2) {
          amount = -amounts[0].value;
          balance = amounts[1].value;
        } else {
          amount = amounts[0].value;
        }

        results.push({ date: dateStr, description: description || '取引', amount, balance });
      });
      return results;
    });

    console.log(`[SBI] ${transactions.length}件取得`);
    return transactions;
  }

}
