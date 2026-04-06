/**
 * スクレイパーベースクラス
 * 各金融機関のスクレイパーはこれを継承する
 */
class BaseScraper {
  constructor(credentials) {
    this.loginId = credentials.loginId;
    this.password = credentials.password;
    this.extraAuth = credentials.extraAuth || {};

    // 遅延読み込み（Vercel環境でのバンドル問題を回避）
    const axios = require('axios');
    let client;
    try {
      const { CookieJar } = require('tough-cookie');
      const { wrapper } = require('axios-cookiejar-support');
      this.jar = new CookieJar();
      client = wrapper(axios.create({
        jar: this.jar,
        withCredentials: true,
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        },
        maxRedirects: 10,
        validateStatus: (status) => status < 400,
      }));
    } catch {
      // tough-cookie が利用できない場合、基本的なaxiosクライアントを使用
      client = axios.create({
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        maxRedirects: 10,
        validateStatus: (status) => status < 400,
      });
    }
    this.client = client;
  }

  /**
   * 取引データを取得する（サブクラスでオーバーライド）
   * @param {string} fromDate - YYYY-MM-DD
   * @param {string} toDate - YYYY-MM-DD
   * @returns {Promise<Array<{date: string, description: string, amount: number, balanceAfter: number|null, rawData: object}>>}
   */
  async fetchTransactions(fromDate, toDate) {
    throw new Error('fetchTransactions() must be implemented by subclass');
  }

  /**
   * 接続テスト（ログインできるか確認）
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async testConnection() {
    throw new Error('testConnection() must be implemented by subclass');
  }

  /** 金融機関名（表示用） */
  get institutionName() {
    return 'Unknown';
  }

  /** HTMLからCSRFトークンなどを抽出するヘルパー */
  extractFormFields(html, formSelector) {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    const fields = {};
    const form = formSelector ? $(formSelector) : $('form').first();
    form.find('input[type="hidden"]').each((_, el) => {
      const name = $(el).attr('name');
      const value = $(el).attr('value') || '';
      if (name) fields[name] = value;
    });
    return fields;
  }

  /** 日付パース */
  parseDate(str) {
    if (!str) return null;
    const cleaned = str.replace(/年|月/g, '-').replace(/日/g, '').replace(/\//g, '-').trim();
    const m = cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }

  /** 金額パース */
  parseAmount(str) {
    if (!str || str.trim() === '' || str.trim() === '-') return 0;
    return parseFloat(str.replace(/[,¥￥\s円]/g, '')) || 0;
  }
}

module.exports = BaseScraper;
