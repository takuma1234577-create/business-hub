import { BaseScraper, RawTransaction, LoginResult, TwoFactorResult, FetchOptions } from './base';

export class SbiNetScraper extends BaseScraper {
  readonly bankId = 'sbi_net';
  readonly bankName = '住信SBIネット銀行';
  protected readonly SELECTORS = {};

  // 安全なevaluate（コンテキスト破壊時は再試行）
  private async safeEval<T>(fn: () => T | Promise<T>, fallback: T): Promise<T> {
    for (let i = 0; i < 3; i++) {
      try {
        return await this.page.evaluate(fn);
      } catch {
        await this.sleep(2000);
      }
    }
    return fallback;
  }

  // 安全な要素取得
  private async safeQuery(selector: string) {
    try { return await this.page.$(selector); } catch { return null; }
  }

  async login(credentials: { userId: string; password: string }): Promise<LoginResult> {
    await this.initBrowser();

    try {
      console.log('[SBI] ログインページに移動中...');

      // まずトップページでCookieを取得
      try {
        await this.page.goto('https://www.netbk.co.jp/', { waitUntil: 'networkidle0', timeout: 30000 });
      } catch { console.log('[SBI] トップページ読み込み（タイムアウト）'); }
      await this.sleep(3000);

      // ログインページに遷移
      try {
        await this.page.goto('https://www.netbk.co.jp/contents/pages/wpl010101/i010101CT/DI/nb_login', {
          waitUntil: 'networkidle0', timeout: 45000,
        });
      } catch {
        console.log('[SBI] ログインページ読み込み（タイムアウト）');
      }

      // SPAレンダリングを十分に待つ
      await this.sleep(10000);

      // 現在のURLを確認
      const currentUrl = this.page.url();
      console.log('[SBI] 現在のURL:', currentUrl);

      // ページ構造をログ出力
      const pageHtml = await this.safeEval(() => document.documentElement?.outerHTML?.substring(0, 3000) || '', '');
      console.log('[SBI] ページHTML(先頭3000):', pageHtml);

      // input要素を全て列挙
      const allInputs = await this.safeEval(() => {
        return Array.from(document.querySelectorAll('input')).map(el => ({
          type: el.type, name: el.name, id: el.id, placeholder: el.placeholder,
        }));
      }, [] as { type: string; name: string; id: string; placeholder: string }[]);
      console.log('[SBI] 全input要素:', JSON.stringify(allInputs));

      // ユーザー名入力
      console.log('[SBI] 認証情報を入力中...');
      let userEl = await this.safeQuery('input[type="text"]');

      // もし見つからなければ、ページがまだ読み込み中の可能性
      if (!userEl) {
        await this.sleep(5000);
        userEl = await this.safeQuery('input[type="text"]');
      }
      if (!userEl) {
        await this.captureScreenshot('sbi-no-user-field');
        const bodyText = await this.safeEval(() => document.body?.innerText?.substring(0, 300) || '', '');
        return { status: 'error', message: `ユーザー名フィールドが見つかりません。ページ内容: ${bodyText}` };
      }

      await userEl.click({ clickCount: 3 }).catch(() => {});
      await this.sleep(300);
      await userEl.type(credentials.userId, { delay: 80 }).catch(() => {});
      await this.randomDelay(500, 1000);

      // パスワード入力（SPAの再レンダリングを待つ）
      await this.sleep(2000);
      let passEl = await this.safeQuery('input[type="password"]');
      if (!passEl) {
        // SBIが2段階フォームの場合: 次のページを待つ
        console.log('[SBI] パスワードフィールドが見つからない。再レンダリングを待機中...');
        await this.sleep(5000);
        passEl = await this.safeQuery('input[type="password"]');
      }
      if (!passEl) {
        // ページ内容を取得してデバッグ
        const bodyText = await this.safeEval(() => document.body?.innerText?.substring(0, 500) || '', '');
        console.log('[SBI] ページ内容:', bodyText);
        return { status: 'error', message: `パスワードフィールドが見つかりません。ページ内容: ${bodyText.substring(0, 100)}` };
      }
      await passEl.click({ clickCount: 3 }).catch(() => {});
      await this.sleep(300);
      await passEl.type(credentials.password, { delay: 80 }).catch(() => {});
      await this.randomDelay(500, 1000);

      // ログインボタンクリック
      console.log('[SBI] ログイン実行中...');
      const loginUrl = this.page.url();

      const btn = await this.safeQuery('button[type="submit"]')
        || await this.safeQuery('input[type="submit"]')
        || await this.safeQuery('button.m-btn-submit');

      if (btn) {
        await btn.click().catch(() => {});
      } else {
        await this.page.keyboard.press('Enter').catch(() => {});
      }

      // 十分に待つ（SPA遷移 + ネットワーク完了）
      console.log('[SBI] ログイン結果を待機中...');
      await this.sleep(12000);

      // 結果判定（コンテキスト破壊に対応）
      const newUrl = this.page.url();
      const content = await this.safeEval(() => document.body?.innerText || '', '');

      console.log('[SBI] ログイン後URL:', newUrl);
      console.log('[SBI] ページ内容(先頭200):', content.substring(0, 200));

      if (content.includes('ログインできません') || content.includes('IDまたはパスワード')) {
        return { status: 'error', message: 'ログイン失敗: ユーザー名またはパスワードが正しくありません' };
      }

      if (content.includes('スマート認証') || content.includes('認証番号') || content.includes('ワンタイム') || content.includes('承認') || newUrl.includes('auth')) {
        console.log('[SBI] スマート認証を検出');
        return { status: 'waiting_2fa', message: 'スマート認証が必要です。スマホアプリで承認するか、認証コードを入力してください。' };
      }

      if (newUrl !== loginUrl && !newUrl.includes('nb_login')) {
        console.log('[SBI] ログイン成功');
        return { status: 'logged_in' };
      }

      // ログインページのままだが内容が変わっている
      if (content.length > 100 && !content.includes('ユーザネーム') && !content.includes('ログインパスワード')) {
        console.log('[SBI] ログイン成功（ページ内容変化）');
        return { status: 'logged_in' };
      }

      await this.captureScreenshot('sbi-login-unknown');
      return { status: 'error', message: `ログイン結果を判定できませんでした (URL: ${newUrl})` };

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

      const selectors = ['input[type="tel"]', 'input[type="text"]', 'input[name="otp"]'];
      for (const sel of selectors) {
        const input = await this.safeQuery(sel);
        if (input) {
          await input.click({ clickCount: 3 }).catch(() => {});
          await input.type(code, { delay: 80 }).catch(() => {});
          break;
        }
      }

      await this.randomDelay();
      const btn = await this.safeQuery('button[type="submit"]') || await this.safeQuery('input[type="submit"]');
      if (btn) await btn.click().catch(() => {});
      else await this.page.keyboard.press('Enter').catch(() => {});

      await this.sleep(8000);

      const content = await this.safeEval(() => document.body?.innerText || '', '');
      if (content.includes('エラー') || content.includes('正しくありません')) {
        return { status: 'error', message: '2FAコードが正しくありません' };
      }
      return { status: 'logged_in' };
    } catch (err: any) {
      return { status: 'error', message: `2FAエラー: ${err.message}` };
    }
  }

  async fetchTransactions(options: FetchOptions): Promise<RawTransaction[]> {
    try {
      console.log('[SBI] 入出金明細ページに移動中...');

      const urls = [
        'https://www.netbk.co.jp/contents/pages/wpl010300/i010300CT/DI/nb_trn_his',
        'https://www.netbk.co.jp/contents/pages/wpl900500/i900500CT/DI/nb_statement_list',
      ];

      for (const url of urls) {
        try {
          await this.page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
          await this.sleep(8000);
          const content = await this.safeEval(() => document.body?.innerText || '', '');
          if (/入出金|明細|取引履歴|日付/.test(content)) {
            console.log('[SBI] 明細ページに到達');
            break;
          }
        } catch {}
      }

      await this.sleep(3000);

      const transactions = await this.safeEval(() => {
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

          const amounts: number[] = [];
          let desc = '';
          texts.forEach((t, i) => {
            const n = parseFloat(t.replace(/[,¥￥\s円]/g, ''));
            if (!isNaN(n) && n !== 0) amounts.push(n);
            else if (i > 0 && t.length > 1 && !/^\d{4}/.test(t) && !desc) desc = t;
          });
          if (amounts.length === 0) return;

          let amount = 0, balance: number | undefined;
          if (amounts.length >= 3) { amount = amounts[1] > 0 ? amounts[1] : -amounts[0]; balance = amounts[2]; }
          else if (amounts.length === 2) { amount = -amounts[0]; balance = amounts[1]; }
          else { amount = amounts[0]; }

          results.push({ date: dateStr, description: desc || '取引', amount, balance });
        });
        return results;
      }, [] as { date: string; description: string; amount: number; balance?: number }[]);

      console.log(`[SBI] ${transactions.length}件取得`);
      return transactions;
    } catch (err: any) {
      console.error('[SBI] fetchTransactions error:', err.message);
      return [];
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
