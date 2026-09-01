/**
 * Phone & Username Normalization Helper
 * Provides canonical normalization and validation across all branch databases.
 */

/**
 * Normalizes username: trim and lowercase
 * @param {string} username
 * @returns {string}
 */
function normalizeUsername(username) {
  if (!username) return '';
  return String(username).trim().toLowerCase();
}

/**
 * Normalizes a phone number to standard canonical format.
 * For Pakistani mobile numbers: converts (+92, 0092, 92, 03xx-xxxxxxx, 03xx xxxxxxx) to 11-digit 03xxxxxxxxx.
 * For international numbers: converts to +<country_code><digits>.
 * Returns null if input is empty or invalid.
 * 
 * @param {string|null|undefined} rawPhone
 * @returns {string|null}
 */
function normalizePhone(rawPhone) {
  if (!rawPhone) return null;
  
  let p = String(rawPhone).trim();
  if (!p) return null;

  // Remove common separator characters (spaces, dashes, parentheses, dots)
  p = p.replace(/[\s\-\(\)\.]+/g, '');

  if (!p) return null;

  // Convert international prefixes for Pakistan (+92, 0092, 92)
  if (p.startsWith('+92')) {
    p = '0' + p.slice(3);
  } else if (p.startsWith('0092')) {
    p = '0' + p.slice(4);
  } else if (p.startsWith('92') && p.length === 12 && p.startsWith('923')) {
    p = '0' + p.slice(2);
  }

  // If Pakistani mobile format (11 digits starting with 03)
  if (/^03\d{9}$/.test(p)) {
    return p;
  }

  // If local Pakistani landline format (e.g. 021-xxxxxxx or 10-11 digits starting with 0)
  if (/^0\d{9,10}$/.test(p)) {
    return p;
  }

  // If standard international format with leading +
  if (/^\+\d{7,15}$/.test(p)) {
    return p;
  }

  // For digits-only standard numbers
  if (/^\d{7,15}$/.test(p)) {
    // If 10 digits without leading 0 (e.g. 3001234567), add leading 0
    if (p.length === 10 && p.startsWith('3')) {
      return '0' + p;
    }
    return p;
  }

  // Clean fallback: remove any non-digit/non-+ characters
  const cleanDigits = p.replace(/[^\d+]/g, '');
  return cleanDigits.length >= 7 ? cleanDigits : null;
}

/**
 * Checks if a phone number is valid
 * @param {string} phone
 * @returns {boolean}
 */
function isValidPhone(phone) {
  if (!phone) return false;
  const normalized = normalizePhone(phone);
  return normalized !== null && normalized.length >= 7 && normalized.length <= 16;
}

module.exports = {
  normalizeUsername,
  normalizePhone,
  isValidPhone
};
