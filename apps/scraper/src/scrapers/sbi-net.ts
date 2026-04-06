import { BaseScraper, RawTransaction, LoginResult, TwoFactorResult, FetchOptions } from './base';

const SELECTORS = {
  userInput: 'input[type="text"]',
  passInput: 'input[type="password"]',
  loginBtn: 'button[type="submit"], input[type="submit"], button.m-btn-submit',
  twoFaInput: 'input[name="otp"], input[name="authCode"], input[type="tel"], input[name="token"]',
} as const;

export class SbiNetScraper extends BaseScraper {
  readonly bankId = 'sbi_net';
  readonly bankName = '住信SBIネット銀行';
  protected readonly SELECTORS = SELECTORS;

  async login(credentials: { userId: string; password: string }): Promise<LoginResult> {
    await this.initBrowser();

    try {
      console.log('[SBI] ログインページに移動中...');
      await this.page.goto('https://www.netbk.co.jp/contents/pages/wpl010101/i010101CT/DI/nb_login', {
        waitUntil: 'domcontentloaded', timeout: 45000,
      });

      // SPAなのでJSレンダリングを十分に待つ
      console.log('[SBI] ページレンダリング待ち...');
      await this.sleep(8000);

      // スクリーンショットでデバッグ
      console.log('[SBI] 現在のURL:', this.page.url());

      // ユーザー名入力
      console.log('[SBI] 認証情報を入力中...');
      const userEl = await this.page.$('input[type="text"]');
      if (!userEl) {
        await this.captureScreenshot('sbi-no-user-field');
        return { status: 'error', message: 'ユーザー名フィールドが見つかりません' };
      }
      await userEl.click({ clickCount: 3 });
      await this.randomDelay(300, 600);
      await userEl.type(credentials.userId, { delay: 80 });
      await this.randomDelay(500, 1000);

      // パスワード入力
      const passEl = await this.page.$('input[type="password"]');
      if (!passEl) {
        await this.captureScreenshot('sbi-no-pass-field');
        return { status: 'error', message: 'パスワードフィールドが見つかりません' };
      }
      await passEl.click({ clickCount: 3 });
      await this.randomDelay(300, 600);
      await passEl.type(credentials.password, { delay: 80 });
      await this.randomDelay(500, 1000);

      // ログインボタンクリック
      console.log('[SBI] ログイン実行中...');
      const btn = await this.page.$('button[type="submit"]')
        || await this.page.$('input[type="submit"]')
        || await this.page.$('button.m-btn-submit');

      if (btn) {
        await btn.click();
      } else {
        await this.page.keyboard.press('Enter');
      }

      // SPAのためsleepで待つ（waitForFunction/waitForNavigationはコンテキスト破壊の原因）
      console.log('[SBI] ログイン結果を待機中...');
      const loginUrl = this.page.url();
      await this.sleep(10000);

      // 結果判定
      const currentUrl = this.page.url();
      let content = '';
      try { content = await this.page.evaluate(() => document.body?.innerText || ''); } catch { content = ''; }

      console.log('[SBI] ログイン後URL:', currentUrl);
      console.log('[SBI] ページ内容(先頭200):', content.substring(0, 200));

      if (content.includes('ログインできません') || content.includes('IDまたはパスワード') || content.includes('認証に失敗')) {
        return { status: 'error', message: 'ログイン失敗: ユーザー名またはパスワードが正しくありません' };
      }

      if (content.includes('スマート認証') || content.includes('認証番号') || content.includes('ワンタイム') || content.includes('承認') || currentUrl.includes('auth')) {
        console.log('[SBI] スマート認証を検出');
        return { status: 'waiting_2fa', message: 'スマート認証が必要です。スマホアプリで承認するか、認証コードを入力してください。' };
      }

      // URLが変わっていればログイン成功
      if (currentUrl !== loginUrl && !currentUrl.includes('nb_login')) {
        console.log('[SBI] ログイン成功');
        return { status: 'logged_in' };
      }

      // URLが変わっていないが、ログインページの内容も変わっている場合
      if (content.length > 100 && !content.includes('ログイン')) {
        console.log('[SBI] ログイン成功（URL未変更だがページ内容変化）');
        return { status: 'logged_in' };
      }

      await this.captureScreenshot('sbi-login-unknown');
      return { status: 'error', message: 'ログイン結果を判定できませんでした。スクリーンショットを確認してください。' };

    } catch (err: any) {
      console.error('[SBI] login error:', err.message);
      try { await this.captureScreenshot('sbi-login-error'); } catch {}
      return { status: 'error', message: `ログインエラー: ${err.message}` };
    }
  }

  async submitTwoFactor(code: string): Promise<TwoFactorResult> {
    try {
      console.log('[SBI] 2FAコードを入力中...');
      await this.sleep(1000);

      // コード入力フィールドを探す
      const inputSelectors = ['input[type="tel"]', 'input[type="text"]', 'input[name="otp"]', 'input[name="authCode"]'];
      let found = false;
      for (const sel of inputSelectors) {
        const input = await this.page.$(sel);
        if (input) {
          await input.click({ clickCount: 3 });
          await input.type(code, { delay: 80 });
          found = true;
          break;
        }
      }

      if (!found) {
        return { status: 'error', message: '2FA入力フィールドが見つかりません' };
      }

      await this.randomDelay();

      // 送信
      const btn = await this.page.$('button[type="submit"]') || await this.page.$('input[type="submit"]');
      if (btn) await btn.click();
      else await this.page.keyboard.press('Enter');

      // 結果待ち
      await this.sleep(5000);

      let content = '';
      try { content = await this.page.evaluate(() => document.body?.innerText || ''); } catch { content = ''; }

      if (content.includes('エラー') || content.includes('失敗') || content.includes('正しくありません')) {
        return { status: 'error', message: '2FAコードが正しくありません' };
      }

      console.log('[SBI] 2FA認証成功');
      return { status: 'logged_in' };

    } catch (err: any) {
      return { status: 'error', message: `2FAエラー: ${err.message}` };
    }
  }

  async fetchTransactions(options: FetchOptions): Promise<RawTransaction[]> {
    try {
      console.log('[SBI] 入出金明細ページに移動中...');

      const historyUrls = [
        'https://www.netbk.co.jp/contents/pages/wpl010300/i010300CT/DI/nb_trn_his',
        'https://www.netbk.co.jp/contents/pages/wpl900500/i900500CT/DI/nb_statement_list',
      ];

      let navigated = false;
      for (const url of historyUrls) {
        try {
          await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await this.sleep(5000);
          let content = '';
          try { content = await this.page.evaluate(() => document.body?.innerText || ''); } catch {}
          if (/入出金|明細|取引履歴|日付/.test(content)) {
            navigated = true;
            console.log('[SBI] 明細ページに到達');
            break;
          }
        } catch { /* try next */ }
      }

      if (!navigated) {
        // メニューリンクから
        try {
          const links = await this.page.$$('a');
          for (const link of links) {
            let text = '';
            try { text = await this.page.evaluate(el => el.textContent || '', link); } catch { continue; }
            if (/入出金|明細|取引履歴/.test(text)) {
              await link.click();
              await this.sleep(5000);
              navigated = true;
              break;
            }
          }
        } catch {}
      }

      // 取引データ抽出
      console.log('[SBI] 取引データを抽出中...');
      await this.sleep(3000);

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
      }).catch(() => [] as { date: string; description: string; amount: number; balance?: number }[]);

      console.log(`[SBI] ${transactions.length}件取得`);
      return transactions;

    } catch (err: any) {
      console.error('[SBI] fetchTransactions error:', err.message);
      try { await this.captureScreenshot('sbi-fetch-error'); } catch {}
      return [];
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
