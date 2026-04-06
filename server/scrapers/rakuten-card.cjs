/**
 * 楽天カードスクレイパー
 * https://www.rakuten-card.co.jp/e-navi/
 */
const BaseScraper = require('./base.cjs');
const cheerio = require('cheerio');

class RakutenCardScraper extends BaseScraper {
  get institutionName() { return '楽天カード'; }

  async fetchTransactions(fromDate, toDate) {
    // 1. e-NAVI ログイン
    const loginPageRes = await this.client.get('https://www.rakuten-card.co.jp/e-navi/index.xhtml');
    const hiddenFields = this.extractFormFields(loginPageRes.data);

    const loginData = new URLSearchParams({
      ...hiddenFields,
      'u': this.loginId,
      'p': this.password,
    });

    const loginRes = await this.client.post(
      'https://www.rakuten-card.co.jp/e-navi/index.xhtml',
      loginData.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        maxRedirects: 5,
      }
    );

    if (loginRes.data.includes('ログインできません') || loginRes.data.includes('エラー')) {
      throw new Error('ログインに失敗しました');
    }

    // 2. 利用明細ページ（月ごと）
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const allTransactions = [];

    // 月ごとにループ
    let current = new Date(from.getFullYear(), from.getMonth(), 1);
    while (current <= to) {
      const year = current.getFullYear();
      const month = current.getMonth() + 1;

      try {
        const stmtRes = await this.client.get(
          `https://www.rakuten-card.co.jp/e-navi/members/statement/index.xhtml?tab=use498&usedYm=${year}${String(month).padStart(2, '0')}`,
        );

        const txns = this.parseStatementPage(stmtRes.data, fromDate, toDate);
        allTransactions.push(...txns);
      } catch (err) {
        console.error(`楽天カード ${year}/${month} 取得エラー:`, err.message);
      }

      current.setMonth(current.getMonth() + 1);
    }

    return allTransactions;
  }

  parseStatementPage(html, fromDate, toDate) {
    const $ = cheerio.load(html);
    const transactions = [];

    // 利用明細テーブルのパース
    $('table.stmt-table tr, .stmt-list tr, table.tbl-stmt tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 3) return;

      const dateStr = $(cells[0]).text().trim();
      const description = $(cells[1]).text().trim();
      const amountStr = $(cells[cells.length - 1]).text().trim();

      const date = this.parseDate(dateStr);
      if (!date || !description) return;

      // 日付範囲チェック
      if (date < fromDate || date > toDate) return;

      const amount = -Math.abs(this.parseAmount(amountStr)); // カード利用はマイナス

      if (amount === 0) return;

      transactions.push({
        date,
        description,
        amount,
        balanceAfter: null,
        rawData: { amountStr },
      });
    });

    return transactions;
  }

  async testConnection() {
    try {
      const loginPageRes = await this.client.get('https://www.rakuten-card.co.jp/e-navi/index.xhtml');
      const hiddenFields = this.extractFormFields(loginPageRes.data);

      const loginData = new URLSearchParams({
        ...hiddenFields,
        'u': this.loginId,
        'p': this.password,
      });

      const loginRes = await this.client.post(
        'https://www.rakuten-card.co.jp/e-navi/index.xhtml',
        loginData.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      if (loginRes.data.includes('ログインできません') || loginRes.data.includes('エラー')) {
        return { success: false, message: 'ログイン失敗' };
      }
      return { success: true, message: 'ログイン成功' };
    } catch (err) {
      return { success: false, message: `接続エラー: ${err.message}` };
    }
  }
}

module.exports = RakutenCardScraper;
