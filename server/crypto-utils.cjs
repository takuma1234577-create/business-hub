/**
 * AES-256-GCM 暗号化ユーティリティ
 * 環境変数 BANK_CREDENTIAL_ENCRYPTION_KEY を使用
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getKey() {
  const secret = process.env.BANK_CREDENTIAL_ENCRYPTION_KEY;
  if (!secret) throw new Error('BANK_CREDENTIAL_ENCRYPTION_KEY が未設定です');
  return crypto.scryptSync(secret, 'business-hub-salt', KEY_LENGTH);
}

function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({ iv: iv.toString('hex'), data: encrypted, tag });
}

function decrypt(ciphertext) {
  const key = getKey();
  const { iv, data, tag } = JSON.parse(ciphertext);
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };
