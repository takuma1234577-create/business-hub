/**
 * 三井住友カード（Vpass）スクレイパー
 * https://www.smbc-card.com/mem/index.jsp
 */
const BaseScraper = require('./base.cjs');
const cheerio = require('cheerio');

class SmbcCardScraper extends BaseScraper {
  get institutionName() { return '三井住友カード'; }

  async fetchTransactions(fromDate, toDate) {
    await this.login();

    const from = new Date(fromDate);
    const to = new Date(toDate);
    const allTransactions = [];

    // 月ごとに明細取得
    let current = new Date(from.getFullYear(), from.getMonth(), 1);
    while (current <= to) {
      const year = current.getFullYear();
      const month = current.getMonth() + 1;

      try {
        const stmtRes = await this.client.get(
          'https://www.smbc-card.com/mem/cardinfo/cardinfo4010.jsp', {
            params: { addSend: `${year}${String(month).padStart(2, '0')}` },
          }
        );
        const txns = this.parseStatementPage(stmtRes.data, fromDate, toDate);
        allTransactions.push(...txns);
      } catch (err) {
        console.error(`三井住友カード ${year}/${month} エラー:`, err.message);
      }

      current.setMonth(current.getMonth() + 1);
    }

    return allTransactions;
  }

  async login() {
    const loginPageRes = await this.client.get('https://www.smbc-card.com/mem/index.jsp');
    const hiddenFields = this.extractFormFields(loginPageRes.data);

    const loginData = new URLSearchParams({
      ...hiddenFields,
      'inputId': this.loginId,
      'inputPass': this.password,
    });

    const loginRes = await this.client.post(
      'https://www.smbc-card.com/mem/index.jsp',
      loginData.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    if (loginRes.data.includes('ログインできません') || loginRes.data.includes('ID・パスワードが正しくありません')) {
      throw new Error('ログインに失敗しました');
    }
  }

  parseStatementPage(html, fromDate, toDate) {
    const $ = cheerio.load(html);
    const transactions = [];

    $('table tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 3) return;

      const dateStr = $(cells[0]).text().trim();
      const description = $(cells[1]).text().trim();
      const amountStr = $(cells[cells.length - 1]).text().trim();

      const date = this.parseDate(dateStr);
      if (!date || !description) return;
      if (date < fromDate || date > toDate) return;

      const amount = -Math.abs(this.parseAmount(amountStr));
      if (amount === 0) return;

      transactions.push({ date, description, amount, balanceAfter: null, rawData: { amountStr } });
    });

    return transactions;
  }

  async testConnection() {
    try {
      await this.login();
      return { success: true, message: 'ログイン成功' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

module.exports = SmbcCardScraper;
