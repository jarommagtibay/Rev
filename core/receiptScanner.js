// GCash & Maya Receipt Scanner & Reference Number Extractor
// Extracts Reference Numbers and Amounts from payment screenshots using OCR & smart regex.
// Falls back gracefully if tesseract.js is not installed.

let Tesseract = null;
try {
  Tesseract = require('tesseract.js');
} catch {
  // tesseract.js not yet installed, fallback regex is used on text captions
}

/**
 * Extracts a GCash, Maya, BDO or Bank Reference Number from raw OCR text.
 * @param {string} text
 * @returns {string|null}
 */
function findReferenceNumber(text) {
  if (!text || typeof text !== 'string') return null;

  // Clean OCR noise while preserving numbers and dashes
  const clean = text.replace(/[\r\n]+/g, ' ');

  // 1. Explicit labeled reference with letters/numbers/dashes:
  // e.g. "Reference no. BN-20261120-73005435", "Ref No. 1002 8492 1038", "Reference ID: ABCD-1234-EF56"
  const labeled = clean.match(
    /(?:ref(?:erence)?\.?\s*(?:no\.?|id|number)?[:\s]+)([A-Z0-9]{2,8}[-_\s]?[A-Z0-9]{4,14}(?:[-_\s]?[A-Z0-9]{4,12})?)\b/i
  );
  if (labeled) {
    const raw = labeled[1].trim();
    if (raw.length >= 8 && raw.length <= 32) {
      return raw;
    }
  }

  // 2. Bank prefix reference: BN-YYYYMMDD-XXXXXXXX (BDO), UB-..., BPI-...
  const bankPrefix = clean.match(/\b([A-Z]{2,4}-\d{6,10}-\d{4,10})\b/i);
  if (bankPrefix) {
    return bankPrefix[1].toUpperCase();
  }

  // 3. Spaced digits (GCash): "1002 8492 1038" or "0001 2345 6789"
  const spacedDigits = clean.match(/\b(\d{4}\s\d{4}\s\d{4,5})\b/);
  if (spacedDigits) {
    return spacedDigits[1];
  }

  // 4. Maya 4-4-4: "ABCD-1234-EF56"
  const maya = clean.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})\b/i);
  if (maya) {
    return maya[1].toUpperCase();
  }

  // 5. Continuous 12-14 digits starting with standard GCash prefixes (100x or 000x)
  const continuousDigits = clean.match(/\b(100\d{9,11}|00\d{10,12}|\d{12,13})\b/);
  if (continuousDigits) {
    const raw = continuousDigits[1];
    return raw.replace(/(\d{4})(\d{4})(\d{4,5})/, '$1 $2 $3');
  }

  return null;
}

/**
 * Extracts the transaction amount from raw OCR text.
 * @param {string} text
 * @returns {string|null}
 */
function findAmount(text) {
  if (!text || typeof text !== 'string') return null;

  const clean = text.replace(/[\r\n]+/g, ' ');

  // Look for "Amount PHP 550.00" or "Total ₱550.00"
  const labeled = clean.match(
    /(?:amount|total(?:\s*paid)?|paid|php|₱)\s*[:.]?\s*(?:php|₱)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/i
  );
  if (labeled) {
    const val = labeled[1].replace(/,/g, '');
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      return `₱${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  }

  // Look for currency prefix e.g. "₱550.00" or "PHP 550.00"
  const currencyMatch = clean.match(/(?:₱|PHP)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i);
  if (currencyMatch) {
    const val = currencyMatch[1].replace(/,/g, '');
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      return `₱${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  }

  return null;
}

/**
 * Scans an image buffer using Tesseract OCR if available.
 * @param {Buffer} buffer
 * @returns {Promise<string|null>}
 */
async function scanReceiptImage(buffer) {
  if (!Tesseract || !buffer) return null;
  try {
    const {
      data: { text },
    } = await Tesseract.recognize(buffer, 'eng', {
      errorHandler: () => {},
    });
    return text || null;
  } catch (err) {
    console.warn('Receipt OCR processing notice:', err.message || err);
    return null;
  }
}

const PAYMENT_KEYWORDS = [
  'gcash',
  'express send',
  'send money',
  'sent to',
  'transfer to',
  'successfully sent',
  'payment details',
  'transaction details',
  'transaction no',
  'reference no',
  'ref no',
  'ref. no',
  'reference id',
  'maya',
  'paymaya',
  'money sent',
  'instapay',
  'pesonet',
  'bdo',
  'bpi',
  'unionbank',
  'seabank',
  'gotyme',
  'payment received',
  'amount paid',
  'total amount',
  'payment successful',
];

const FAILED_KEYWORDS = [
  'unable to send money',
  'unable to send',
  'transaction failed',
  'transfer failed',
  'payment failed',
  'unsuccessful',
  'declined',
  'cancelled',
  'failed to send',
  'try again later',
  'experiencing issues',
];

/**
 * Checks if the screenshot is an error or failed/declined transaction.
 * @param {string} text
 * @returns {boolean}
 */
function checkIsFailedTransaction(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return FAILED_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Identifies the payment provider/bank from text.
 * @param {string} text
 * @returns {string}
 */
function detectProvider(text) {
  if (!text) return 'E-Wallet / Bank';
  const lower = text.toLowerCase();
  if (lower.includes('bdo')) return 'BDO Pay / Online';
  if (lower.includes('bpi')) return 'BPI';
  if (lower.includes('unionbank')) return 'UnionBank';
  if (lower.includes('seabank')) return 'SeaBank';
  if (lower.includes('gotyme')) return 'GoTyme Bank';
  if (lower.includes('maya') || lower.includes('paymaya')) return 'Maya';
  if (lower.includes('gcash')) return 'GCash';
  if (lower.includes('instapay')) return 'InstaPay';
  return 'E-Wallet / Bank';
}

/**
 * Validates if the scanned image is actually a payment receipt and not a random screenshot.
 * @param {string} rawText
 * @param {string|null} refNo
 * @param {string|null} amount
 * @param {string} [attachmentName]
 * @param {string} [messageContent]
 * @returns {boolean}
 */
function checkIsReceipt(rawText, refNo, amount, attachmentName = '', messageContent = '') {
  // 1. If an authentic reference number was extracted, it is 100% a receipt
  if (refNo) return true;

  const combined = `${rawText || ''} ${messageContent || ''} ${attachmentName || ''}`.toLowerCase();

  // 2. Check for payment provider or transaction keywords
  const hasKeyword = PAYMENT_KEYWORDS.some((kw) => combined.includes(kw));
  if (hasKeyword && (amount || /\b(paid|sent|transfer|ref|php|₱|unable to send)\b/i.test(combined))) {
    return true;
  }

  // 3. Check if customer's message explicitly says it is a payment receipt
  if (/\b(receipt|bayad|paid|eto receipt|ito receipt|proof|screenshot ng bayad|payment|nagbayad|nasend)\b/i.test(messageContent || '')) {
    return true;
  }

  // 4. Check if the file name itself indicates a receipt
  if (/^(receipt|gcash|maya|pay|payment|transfer)[_-]?/i.test(attachmentName || '')) {
    return true;
  }

  return false;
}

/**
 * Main extractor: parses reference number and amount from image buffer and fallback text.
 * @param {Buffer} [imageBuffer]
 * @param {string} [fallbackText]
 * @param {string} [attachmentName]
 * @returns {Promise<{ refNo: string|null, amount: string|null, rawText: string, ocrAvailable: boolean, isReceipt: boolean, isFailed: boolean, provider: string }>}
 */
async function extractReceiptDetails(imageBuffer, fallbackText = '', attachmentName = '') {
  let rawText = fallbackText || '';
  const ocrAvailable = Boolean(Tesseract);

  if (imageBuffer && ocrAvailable) {
    const ocrText = await scanReceiptImage(imageBuffer);
    if (ocrText) {
      rawText = `${rawText}\n${ocrText}`.trim();
    }
  }

  const refNo = findReferenceNumber(rawText);
  const amount = findAmount(rawText);
  const isReceipt = checkIsReceipt(rawText, refNo, amount, attachmentName, fallbackText);
  const isFailed = checkIsFailedTransaction(rawText);
  const provider = detectProvider(rawText);

  return {
    refNo,
    amount,
    rawText,
    ocrAvailable,
    isReceipt,
    isFailed,
    provider,
  };
}

module.exports = {
  extractReceiptDetails,
  findReferenceNumber,
  findAmount,
  checkIsReceipt,
  checkIsFailedTransaction,
  detectProvider,
};
