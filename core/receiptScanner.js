// GCash & Maya Receipt Scanner & Reference Number Extractor
// Extracts Reference Numbers and Amounts from payment screenshots using OCR & smart regex,
// with AI Vision fallback (Gemini / OpenAI) when OCR confidence is low.
const { VISION_MODE } = require('../config');
const { isVisionAvailable, analyzeReceiptWithVision } = require('./receiptVision');

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

  // 1. Explicit labeled numeric reference:
  // e.g. "Ref No. 1047 553 476926", "Ref. No: 1002 8492 1038", "Reference No. 1047 553 476926"
  const labeledNumeric = clean.match(
    /(?:ref(?:erence)?\.?\s*(?:no\.?|id|number)?[:.\s]+)((?:\d[\s-]?){9,15}\d)\b/i
  );
  if (labeledNumeric) {
    const raw = labeledNumeric[1].trim();
    const digits = raw.replace(/[\s-]/g, '');
    if (digits.length >= 10 && digits.length <= 16) {
      return raw.replace(/\s+/g, ' ');
    }
  }

  // 2. Bank prefix reference: BN-YYYYMMDD-XXXXXXXX (BDO), UB-..., BPI-...
  const bankPrefix = clean.match(/\b([A-Z]{2,4}-\d{6,10}-\d{4,10})\b/i);
  if (bankPrefix) {
    return bankPrefix[1].toUpperCase();
  }

  // 3. Explicit labeled alphanumeric reference (e.g. BDO, Maya, Bank)
  const labeledAlpha = clean.match(
    /(?:ref(?:erence)?\.?\s*(?:no\.?|id|number)?[:.\s]+)([A-Z0-9_-]{8,32})\b/i
  );
  if (labeledAlpha) {
    return labeledAlpha[1].trim();
  }

  // 4. Maya 4-4-4: "ABCD-1234-EF56"
  const maya = clean.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})\b/i);
  if (maya) {
    return maya[1].toUpperCase();
  }

  // 5. Standalone spaced digits (GCash 12-14 digits):
  // 13 digits (4-3-6): "1047 553 476926"
  // 12 digits (4-4-4): "1002 8492 1038"
  // 13 digits (4-3-3-3): "1002 849 210 381"
  const spacedMatch = clean.match(/\b(\d{4}(?:\s+\d{2,7}){2,3})\b/);
  if (spacedMatch) {
    const raw = spacedMatch[1].trim();
    const digits = raw.replace(/\s+/g, '');
    // Ignore 11-digit mobile numbers starting with 09
    if (digits.length >= 10 && digits.length <= 16 && !(digits.length === 11 && digits.startsWith('09'))) {
      return raw.replace(/\s+/g, ' ');
    }
  }

  // 6. Continuous 12-14 digits starting with standard GCash prefixes (10x or 00x)
  const continuousDigits = clean.match(/\b(10\d{10,12}|00\d{10,12}|\d{12,14})\b/);
  if (continuousDigits) {
    const raw = continuousDigits[1];
    if (raw.length === 13) {
      return `${raw.slice(0, 4)} ${raw.slice(4, 7)} ${raw.slice(7)}`;
    } else if (raw.length === 12) {
      return `${raw.slice(0, 4)} ${raw.slice(4, 8)} ${raw.slice(8)}`;
    }
    return raw;
  }

  return null;
}

/**
 * Extracts detailed transaction amount (both formatted string and numeric value) from raw OCR text.
 * @param {string} text
 * @returns {{ formatted: string|null, value: number|null }}
 */
function parseAmountDetails(text) {
  if (!text || typeof text !== 'string') return { formatted: null, value: null };

  const clean = text.replace(/[\r\n]+/g, ' ');

  // 1. Explicit labeled totals: "Total Amount Sent ₱ 114.00", "Total Amount: ₱114.00", "Total Paid: 114.00"
  const totalMatch = clean.match(
    /(?:total\s*amount(?:\s*sent)?(?:\s*paid)?|total(?:\s*paid)?|amount\s*sent)\s*[:.]?\s*(?:php|₱|p\.?)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/i
  );
  if (totalMatch) {
    const num = parseFloat(totalMatch[1].replace(/,/g, ''));
    if (!isNaN(num) && num > 0) {
      return {
        formatted: `₱${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        value: num,
      };
    }
  }

  // 2. Generic labeled "Amount 114.00", "Amount: PHP 114.00"
  const amountMatch = clean.match(
    /(?:amount|paid)\s*[:.]?\s*(?:php|₱|p\.?)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/i
  );
  if (amountMatch) {
    const num = parseFloat(amountMatch[1].replace(/,/g, ''));
    if (!isNaN(num) && num > 0) {
      return {
        formatted: `₱${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        value: num,
      };
    }
  }

  // 3. Currency symbol prefix: "₱ 114.00", "PHP 114.00", "₱114.00"
  const currencyMatch = clean.match(/(?:₱|PHP)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i);
  if (currencyMatch) {
    const num = parseFloat(currencyMatch[1].replace(/,/g, ''));
    if (!isNaN(num) && num > 0) {
      return {
        formatted: `₱${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        value: num,
      };
    }
  }

  return { formatted: null, value: null };
}

/**
 * Extracts the transaction amount from raw OCR text (returns formatted string).
 * @param {string} text
 * @returns {string|null}
 */
function findAmount(text) {
  return parseAmountDetails(text).formatted;
}

/**
 * Compares the scanned receipt amount with the expected order price.
 * @param {number|null} scannedAmount
 * @param {number|null} expectedPrice
 * @returns {{ status: 'match'|'underpaid'|'overpaid'|'unknown', diff: number, shortage: number, excess: number, badge: string, message: string }}
 */
function comparePaymentPrice(scannedAmount, expectedPrice) {
  if (scannedAmount == null || isNaN(scannedAmount) || expectedPrice == null || isNaN(expectedPrice)) {
    return {
      status: 'unknown',
      diff: 0,
      shortage: 0,
      excess: 0,
      badge: '🔍 Manual Verification Required',
      message: 'Could not automatically detect amount from receipt (please verify manually)',
    };
  }

  const sVal = Math.round(Number(scannedAmount) * 100) / 100;
  const eVal = Math.round(Number(expectedPrice) * 100) / 100;
  const diff = Math.round((sVal - eVal) * 100) / 100;

  if (Math.abs(diff) < 0.01) {
    return {
      status: 'match',
      diff: 0,
      shortage: 0,
      excess: 0,
      badge: '✅ Exact Match',
      message: `Receipt amount matches order total (₱${eVal.toFixed(2)})`,
    };
  }

  if (diff < 0) {
    const shortage = Math.abs(diff);
    return {
      status: 'underpaid',
      diff,
      shortage,
      excess: 0,
      badge: `⚠️ Underpayment (Short ₱${shortage.toFixed(2)})`,
      message: `Receipt shows ₱${sVal.toFixed(2)}, which is ₱${shortage.toFixed(2)} less than order total (₱${eVal.toFixed(2)})!`,
    };
  }

  const excess = diff;
  return {
    status: 'overpaid',
    diff,
    shortage: 0,
    excess,
    badge: `ℹ️ Overpayment (+₱${excess.toFixed(2)})`,
    message: `Receipt shows ₱${sVal.toFixed(2)}, which is ₱${excess.toFixed(2)} more than order total (₱${eVal.toFixed(2)})`,
  };
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
 * Runs Tesseract OCR first, then falls back to AI Vision if OCR confidence is low (or VISION_MODE=always).
 * @param {Buffer} [imageBuffer]
 * @param {string} [fallbackText]
 * @param {string} [attachmentName]
 * @param {string} [mimeType]
 * @returns {Promise<{
 *   refNo: string|null,
 *   amount: string|null,
 *   amountValue: number|null,
 *   rawText: string,
 *   ocrAvailable: boolean,
 *   isReceipt: boolean,
 *   isFailed: boolean,
 *   provider: string,
 *   recipientName: string|null,
 *   dateTime: string|null,
 *   visualTamperFlags: string[],
 *   parsedBy: string
 * }>}
 */
async function extractReceiptDetails(imageBuffer, fallbackText = '', attachmentName = '', mimeType = 'image/png') {
  let rawText = fallbackText || '';
  const ocrAvailable = Boolean(Tesseract);

  if (imageBuffer && ocrAvailable) {
    const ocrText = await scanReceiptImage(imageBuffer);
    if (ocrText) {
      rawText = `${rawText}\n${ocrText}`.trim();
    }
  }

  let refNo = findReferenceNumber(rawText);
  const amountDetails = parseAmountDetails(rawText);
  let amount = amountDetails.formatted;
  let amountValue = amountDetails.value;
  let isReceipt = checkIsReceipt(rawText, refNo, amount, attachmentName, fallbackText);
  let isFailed = checkIsFailedTransaction(rawText);
  let provider = detectProvider(rawText);
  let recipientName = null;
  let dateTime = null;
  let visualTamperFlags = [];
  let parsedBy = ocrAvailable ? 'OCR' : 'Regex';

  // Smart Vision fallback: run when OCR missed key fields, text is sparse/unreadable, or VISION_MODE=always
  const lowConfidence = !amountValue || !refNo || !isReceipt || rawText.trim().length < 35;
  if (imageBuffer && isVisionAvailable() && (VISION_MODE === 'always' || lowConfidence)) {
    const vision = await analyzeReceiptWithVision(imageBuffer, mimeType);
    if (vision) {
      parsedBy = ocrAvailable ? 'OCR + AI Vision' : 'AI Vision';
      if (vision.isReceipt) isReceipt = true;
      if (vision.isFailed) isFailed = true;
      if (!refNo && vision.refNo) refNo = vision.refNo;
      if (!amountValue && vision.amountValue) {
        amountValue = vision.amountValue;
        amount = vision.amountFormatted;
      }
      if (provider === 'E-Wallet / Bank' && vision.provider) {
        provider = vision.provider;
      }
      if (vision.recipientName) recipientName = vision.recipientName;
      if (vision.dateTime) dateTime = vision.dateTime;
      if (vision.visualTamperFlags && vision.visualTamperFlags.length > 0) {
        visualTamperFlags = vision.visualTamperFlags;
      }
    }
  }

  return {
    refNo,
    amount,
    amountValue,
    rawText,
    ocrAvailable,
    isReceipt,
    isFailed,
    provider,
    recipientName,
    dateTime,
    visualTamperFlags,
    parsedBy,
  };
}

module.exports = {
  extractReceiptDetails,
  findReferenceNumber,
  findAmount,
  parseAmountDetails,
  comparePaymentPrice,
  checkIsReceipt,
  checkIsFailedTransaction,
  detectProvider,
};
