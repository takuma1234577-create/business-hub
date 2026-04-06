/**
 * スクレイパーレジストリ
 * institution_code → Scraperクラスのマッピング
 */
const RakutenBankScraper = require('./rakuten-bank.cjs');
const RakutenCardScraper = require('./rakuten-card.cjs');
const SbiNetBankScraper = require('./sbi-net.cjs');
const SmbcCardScraper = require('./smbc-card.cjs');
const GenericScraper = require('./generic.cjs');

// 対応金融機関マッピング
const SCRAPER_MAP = {
  'rakuten_bank': RakutenBankScraper,
  'rakuten_card': RakutenCardScraper,
  'sbi_net': SbiNetBankScraper,
  'smbc_card': SmbcCardScraper,
};

// UIで表示する対応金融機関リスト
const SUPPORTED_INSTITUTIONS = [
  { code: 'rakuten_bank', name: '楽天銀行', type: 'bank', status: 'supported' },
  { code: 'rakuten_card', name: '楽天カード', type: 'credit_card', status: 'supported' },
  { code: 'sbi_net', name: '住信SBIネット銀行', type: 'bank', status: 'supported' },
  { code: 'smbc_card', name: '三井住友カード', type: 'credit_card', status: 'supported' },
  // 未対応（将来実装）
  { code: 'mufg', name: '三菱UFJ銀行', type: 'bank', status: 'planned' },
  { code: 'smbc', name: '三井住友銀行', type: 'bank', status: 'planned' },
  { code: 'mizuho', name: 'みずほ銀行', type: 'bank', status: 'planned' },
  { code: 'yucho', name: 'ゆうちょ銀行', type: 'bank', status: 'planned' },
  { code: 'amazon_card', name: 'Amazon Mastercard', type: 'credit_card', status: 'planned' },
  { code: 'koza_shinkin', name: 'コザ信用金庫', type: 'bank', status: 'planned' },
];

/**
 * スクレイパーインスタンスを取得
 * @param {string} institutionCode
 * @param {object} credentials - { loginId, password, extraAuth }
 * @returns {BaseScraper}
 */
function getScraper(institutionCode, credentials) {
  const ScraperClass = SCRAPER_MAP[institutionCode];
  if (ScraperClass) {
    return new ScraperClass(credentials);
  }
  return new GenericScraper(credentials, institutionCode);
}

module.exports = { getScraper, SUPPORTED_INSTITUTIONS, SCRAPER_MAP };
