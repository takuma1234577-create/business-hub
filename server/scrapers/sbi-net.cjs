/**
 * 住信SBIネット銀行スクレイパー（Puppeteer版 - 完全自動化）
 *
 * フロー:
 * 1. Puppeteerでログインページを開く
 * 2. ユーザー名・パスワードを入力してログイン
 * 3. スマート認証が要求された場合、最大45秒間ポーリングで承認を待つ
 * 4. 認証完了後、入出金明細ページに遷移してデータ取得
 */
const BaseScraper = require('./base.cjs');

class SbiNetBankScraper extends BaseScraper {
  get institutionName() { return '住信SBIネット銀行'; }

  async getBrowser() {
    const puppeteer = require('puppeteer-core');
    let execPath;
    let args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'];
    let headless = 'new';

    try {
      const chromium = require('@sparticuz/chromium');
      chromium.setHeadlessMode = true;
      chromium.setGraphicsMode = false;
      execPath = await chromium.executablePath();
      args = chromium.args;
      headless = chromium.headless;
    } catch {
      // ローカル: システムのChrome
      if (process.platform === 'darwin') execPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      else if (process.platform === 'win32') execPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
      else execPath = '/usr/bin/google-chrome';
    }

    return puppeteer.launch({ executablePath: execPath, headless, args, defaultViewport: { width: 1280, height: 800 } });
  }

  async fetchTransactions(fromDate, toDate, onStatus) {
    const log = (msg) => { console.log(`[SBI] ${msg}`); if (onStatus) onStatus(msg); };
    let browser;

    try {
      log('ブラウザ起動中...');
      browser = await this.getBrowser();
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

      // === ログイン ===
      log('ログインページに移動中...');
      await page.goto('https://www.netbk.co.jp/contents/pages/wpl010101/i010101CT/DI/nb_login', {
        waitUntil: 'networkidle2', timeout: 20000,
      });
      await this.sleep(2000);

      // ユーザー名入力
      log('認証情報を入力中...');
      const userSelector = 'input[name="userName"], #userName, input[type="text"][autocomplete="username"]';
      await page.waitForSelector(userSelector, { timeout: 10000 }).catch(() => null);
      let userInput = await page.$(userSelector);
      if (!userInput) {
        // fallback: すべてのtext inputから探す
        const textInputs = await page.$$('input[type="text"]');
        if (textInputs.length > 0) userInput = textInputs[0];
      }
      if (!userInput) throw new Error('ユーザー名フィールドが見つかりません。SBIのサイトが変更された可能性があります。');

      await userInput.click({ clickCount: 3 });
      await userInput.type(this.loginId, { delay: 30 });

      // パスワード入力
      const passSelector = 'input[name="loginPwdSet"], #loginPwdSet, input[type="password"]';
      let passInput = await page.$(passSelector);
      if (!passInput) {
        const passInputs = await page.$$('input[type="password"]');
        if (passInputs.length > 0) passInput = passInputs[0];
      }
      if (!passInput) throw new Error('パスワードフィールドが見つかりません');

      await passInput.click({ clickCount: 3 });
      await passInput.type(this.password, { delay: 30 });

      // ログインボタン
      log('ログイン実行中...');
      const btnSelectors = ['button[type="submit"]', 'input[type="submit"]', 'a.m-btn-submit', 'button.m-btn-submit', '.m-btn-login'];
      for (const sel of btnSelectors) {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); break; }
      }

      // ページ遷移待ち（ナビゲーション中のコンテキスト破壊を回避）
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }),
        this.sleep(15000),
      ]).catch(() => {});
      await this.sleep(3000);

      // === 認証結果確認 ===
      let content = '';
      try { content = await page.content(); } catch { content = ''; }
      const url = page.url();

      // ログイン失敗チェック
      if (/ログインできません|IDまたはパスワード|認証に失敗|ログインIDまたは/.test(content)) {
        throw new Error('ログイン失敗: ユーザー名またはパスワードが正しくありません');
      }

      // === 2FA（スマート認証）対応 ===
      if (/スマート認証|認証番号|ワンタイム|二要素|承認/.test(content) || url.includes('auth')) {
        log('スマート認証を検出 - スマホアプリで承認してください（最大45秒待機）');

        // 最大45秒間、3秒ごとにページをチェック
        let authenticated = false;
        for (let i = 0; i < 15; i++) {
          await this.sleep(3000);
          try { content = await page.content(); } catch { content = ''; }
          const currentUrl = page.url();

          // 認証完了の判定: ログインページでもなく、認証ページでもない
          if (!(/スマート認証|認証番号|ワンタイム|二要素|承認待ち/.test(content)) &&
              !currentUrl.includes('wpl010101') && !currentUrl.includes('auth')) {
            authenticated = true;
            log('スマート認証が承認されました');
            break;
          }

          // ページ遷移チェック
          try {
            await page.waitForNavigation({ timeout: 100 }).catch(() => {});
          } catch { /* ignore */ }

          log(`承認待ち中... (${(i + 1) * 3}秒/${45}秒)`);
        }

        if (!authenticated) {
          throw new Error('スマート認証がタイムアウトしました。スマホアプリで承認してから再試行してください。');
        }
      }

      // === ログイン成功確認 ===
      log('ログイン成功。入出金明細に移動中...');
      await this.sleep(1000);

      // === 入出金明細ページへ遷移 ===
      // 方法1: 直接URLで遷移
      const historyUrls = [
        'https://www.netbk.co.jp/contents/pages/wpl010300/i010300CT/DI/nb_trn_his',
        'https://www.netbk.co.jp/contents/pages/wpl900500/i900500CT/DI/nb_statement_list',
      ];

      let navigated = false;
      for (const histUrl of historyUrls) {
        try {
          await page.goto(histUrl, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
          await this.sleep(3000);
          let histContent = '';
          try { histContent = await page.content(); } catch { histContent = ''; }
          if (/入出金|明細|取引履歴|日付/.test(histContent)) {
            navigated = true;
            log('入出金明細ページに到達');
            break;
          }
        } catch { /* try next */ }
      }

      // 方法2: メニューリンクから遷移
      if (!navigated) {
        const menuLinks = await page.$$('a').catch(() => []) || [];
        for (const link of menuLinks) {
          let text = '';
          try { text = await page.evaluate(el => el.textContent, link); } catch { continue; }
          if (text && /入出金|明細|取引履歴/.test(text)) {
            try {
              await link.click();
              await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
              await this.sleep(3000);
            } catch { continue; }
            navigated = true;
            log('メニューから入出金明細に遷移');
            break;
          }
        }
      }

      if (!navigated) {
        log('入出金明細ページへの直接遷移に失敗。現在のページからデータ取得を試行...');
      }

      // === 取引データ抽出 ===
      log('取引データを抽出中...');
      const transactions = await this.extractFromPage(page);
      log(`${transactions.length}件の取引を取得しました`);

      return transactions;
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  async extractFromPage(page) {
    await this.sleep(2000);

    const transactions = await page.evaluate(() => {
      const results = [];

      // 全テーブルの行を検査
      document.querySelectorAll('table tr, [role="row"], .m-tbl-data tr, .tbl-data tr').forEach(row => {
        const cells = row.querySelectorAll('td, [role="cell"]');
        if (cells.length < 3) return;

        const texts = Array.from(cells).map(c => c.textContent.trim().replace(/\s+/g, ' '));

        // 日付パターンを検索
        let dateStr = null;
        for (const t of texts) {
          const m = t.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
          if (m) { dateStr = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; break; }
        }
        if (!dateStr) return;

        // 金額とテキストを分離
        const amounts = [];
        let description = '';
        for (let i = 0; i < texts.length; i++) {
          const cleaned = texts[i].replace(/[,¥￥\s円]/g, '');
          const num = parseFloat(cleaned);
          if (!isNaN(num) && num !== 0 && cleaned.match(/^-?\d+$/)) {
            amounts.push({ index: i, value: num });
          } else if (i > 0 && texts[i] && !texts[i].match(/^\d{4}/) && texts[i].length > 1) {
            if (!description) description = texts[i];
          }
        }

        if (amounts.length === 0) return;

        let amount = 0;
        let balanceAfter = null;

        if (amounts.length >= 3) {
          // 出金、入金、残高
          amount = amounts[1].value > 0 ? amounts[1].value : -amounts[0].value;
          balanceAfter = amounts[2].value;
        } else if (amounts.length === 2) {
          amount = amounts[0].value > 0 ? -amounts[0].value : amounts[0].value;
          balanceAfter = amounts[1].value;
        } else {
          amount = amounts[0].value;
        }

        results.push({ date: dateStr, description: description || '取引', amount, balanceAfter });
      });

      // テーブルがない場合: リスト形式のデータを探す
      if (results.length === 0) {
        document.querySelectorAll('[class*="transaction"], [class*="history"], [class*="list-item"]').forEach(item => {
          const text = item.textContent || '';
          const dateMatch = text.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
          const amountMatch = text.match(/([0-9,]+)\s*円/);
          if (dateMatch && amountMatch) {
            const date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
            const amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
            const isWithdraw = /出金|引落|振込出|デビット|支払/.test(text);
            results.push({
              date,
              description: text.substring(0, 50).trim(),
              amount: isWithdraw ? -amount : amount,
              balanceAfter: null,
            });
          }
        });
      }

      return results;
    });

    return transactions.map(tx => ({
      ...tx,
      rawData: { source: 'puppeteer' },
    }));
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async testConnection() {
    let browser;
    try {
      browser = await this.getBrowser();
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

      await page.goto('https://www.netbk.co.jp/contents/pages/wpl010101/i010101CT/DI/nb_login', {
        waitUntil: 'networkidle2', timeout: 15000,
      });

      const userInput = await page.$('input[type="text"]');
      const passInput = await page.$('input[type="password"]');

      if (userInput && passInput) {
        return { success: true, message: 'SBIネット銀行のログインページに接続できました。同期実行時に自動ログインします。' };
      }
      return { success: false, message: 'ログインフォームが検出できません' };
    } catch (err) {
      return { success: false, message: `接続エラー: ${err.message}` };
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }
}

module.exports = SbiNetBankScraper;
