/**
 * 楽天銀行スクレイパー
 * https://fes.rakuten-bank.co.jp/MS/main/RbS?
 */
const BaseScraper = require('./base.cjs');
const cheerio = require('cheerio');

class RakutenBankScraper extends BaseScraper {
  get institutionName() { return '楽天銀行'; }

  async fetchTransactions(fromDate, toDate) {
    // 1. ログインページ取得
    const loginPageUrl = 'https://fes.rakuten-bank.co.jp/MS/main/RbS?CurrentPageID=START&&COMMAND=LOGIN';
    const loginPage = await this.client.get(loginPageUrl);
    const hiddenFields = this.extractFormFields(loginPage.data);

    // 2. ログイン実行
    const loginData = new URLSearchParams({
      ...hiddenFields,
      LOGIN: 'LOGIN',
      'JS_FLG': '1',
      'USRID': this.loginId,
      'LOGIN_PASSWORD': this.password,
    });

    const loginRes = await this.client.post(
      'https://fes.rakuten-bank.co.jp/MS/main/RbS',
      loginData.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    if (loginRes.data.includes('ログインできませんでした') || loginRes.data.includes('エラー')) {
      throw new Error('ログインに失敗しました。IDまたはパスワードを確認してください。');
    }

    // 3. 入出金明細ページに遷移
    const from = new Date(fromDate);
    const to = new Date(toDate);

    const statementData = new URLSearchParams({
      'COMMAND': 'STATEMENT',
      'CurrentPageID': 'CONTENTS_MENU',
      'FROM_YEAR': String(from.getFullYear()),
      'FROM_MONTH': String(from.getMonth() + 1).padStart(2, '0'),
      'FROM_DAY': String(from.getDate()).padStart(2, '0'),
      'TO_YEAR': String(to.getFullYear()),
      'TO_MONTH': String(to.getMonth() + 1).padStart(2, '0'),
      'TO_DAY': String(to.getDate()).padStart(2, '0'),
    });

    const statementRes = await this.client.post(
      'https://fes.rakuten-bank.co.jp/MS/main/RbS',
      statementData.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    // 4. 明細テーブルをパース
    return this.parseStatementPage(statementRes.data);
  }

  parseStatementPage(html) {
    const $ = cheerio.load(html);
    const transactions = [];

    // 楽天銀行の入出金明細テーブルをパース
    $('table.tbl-data tr, table.statement tr, .table01 tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 4) return;

      const dateStr = $(cells[0]).text().trim();
      const description = $(cells[1]).text().trim();
      const withdrawStr = $(cells[2]).text().trim();
      const depositStr = $(cells[3]).text().trim();
      const balanceStr = cells.length >= 5 ? $(cells[4]).text().trim() : '';

      const date = this.parseDate(dateStr);
      if (!date || !description) return;

      const withdraw = this.parseAmount(withdrawStr);
      const deposit = this.parseAmount(depositStr);
      const amount = deposit > 0 ? deposit : -withdraw;

      if (amount === 0) return;

      transactions.push({
        date,
        description,
        amount,
        balanceAfter: balanceStr ? this.parseAmount(balanceStr) : null,
        rawData: { withdrawStr, depositStr, balanceStr },
      });
    });

    return transactions;
  }

  async testConnection() {
    try {
      const loginPageUrl = 'https://fes.rakuten-bank.co.jp/MS/main/RbS?CurrentPageID=START&&COMMAND=LOGIN';
      const loginPage = await this.client.get(loginPageUrl);
      const hiddenFields = this.extractFormFields(loginPage.data);

      const loginData = new URLSearchParams({
        ...hiddenFields,
        LOGIN: 'LOGIN',
        'JS_FLG': '1',
        'USRID': this.loginId,
        'LOGIN_PASSWORD': this.password,
      });

      const loginRes = await this.client.post(
        'https://fes.rakuten-bank.co.jp/MS/main/RbS',
        loginData.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      if (loginRes.data.includes('ログインできませんでした') || loginRes.data.includes('エラー')) {
        return { success: false, message: 'ログイン失敗: IDまたはパスワードが正しくありません' };
      }
      return { success: true, message: 'ログイン成功' };
    } catch (err) {
      return { success: false, message: `接続エラー: ${err.message}` };
    }
  }
}

module.exports = RakutenBankScraper;
