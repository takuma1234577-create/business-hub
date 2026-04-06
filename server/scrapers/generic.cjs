/**
 * 汎用スクレイパー（未対応金融機関用プレースホルダー）
 * 将来的に各金融機関固有のスクレイパーを追加する際のテンプレート
 */
const BaseScraper = require('./base.cjs');

class GenericScraper extends BaseScraper {
  constructor(credentials, institutionCode) {
    super(credentials);
    this._institutionCode = institutionCode;
  }

  get institutionName() { return this._institutionCode; }

  async fetchTransactions() {
    throw new Error(`${this._institutionCode} のスクレイパーは現在未実装です。CSV取り込みをご利用ください。`);
  }

  async testConnection() {
    return { success: false, message: `${this._institutionCode} は自動取り込み未対応です。CSV取り込みをご利用ください。` };
  }
}

module.exports = GenericScraper;
