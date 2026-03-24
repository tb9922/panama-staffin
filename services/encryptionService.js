import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const HEX_KEY_LENGTH = KEY_BYTES * 2; // 64 hex chars

let _key = null;

/**
 * Lazy-load the encryption key from ENCRYPTION_KEY env var.
 * Throws on first use if missing or invalid — does NOT crash on startup.
 */
function getKey() {
  if (_key) return _key;

  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY env var is required for webhook secret encryption. ' +
      `Set a ${HEX_KEY_LENGTH}-char hex string (${KEY_BYTES} bytes). ` +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  if (raw.length !== HEX_KEY_LENGTH || !/^[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(
      `ENCRYPTION_KEY must be exactly ${HEX_KEY_LENGTH} hex characters (${KEY_BYTES} bytes). Got ${raw.length} chars.`
    );
  }

  _key = Buffer.from(raw, 'hex');
  return _key;
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * @param {string} plaintext
 * @returns {{ encrypted: Buffer, iv: Buffer, tag: Buffer }}
 */
export function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { encrypted, iv, tag };
}

/**
 * Decrypt ciphertext using AES-256-GCM.
 * @param {Buffer} encrypted
 * @param {Buffer} iv
 * @param {Buffer} tag
 * @returns {string} plaintext
 */
export function decrypt(encrypted, iv, tag) {
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}

/** Reset cached key — only for testing. */
export function _resetKeyCache() {
  _key = null;
}
