// AI Vision Receipt Parser: smart fallback when Tesseract OCR struggles with dark mode,
// cropped images, or non-standard banking layouts (GoTyme, SeaBank, BPI, Maya, GCash).
// Supports Gemini Vision (GEMINI_API_KEY) and OpenAI Vision (OPENAI_API_KEY) via native fetch.
const { GEMINI_API_KEY, OPENAI_API_KEY, VISION_MODE } = require('../config');

const VISION_PROMPT = `You are a strict payment receipt parser for a Philippine digital shop (GCash, Maya, GoTyme, SeaBank, BPI, BDO, UnionBank, InstaPay).
Inspect this image carefully and return ONLY a valid JSON object (no markdown, no explanation) with this exact schema:
{
  "isReceipt": boolean,
  "isFailed": boolean,
  "provider": string,
  "amount": number | null,
  "refNo": string | null,
  "recipientName": string | null,
  "dateTime": string | null,
  "visualTamperFlags": string[]
}

Rules:
- "isReceipt": true if this is a payment/transfer receipt, bank transfer confirmation, or failed transfer screen; false for avatars, memes, chat screenshots, or unrelated images.
- "isFailed": true ONLY if the screenshot clearly shows a failed, declined, cancelled, or "Unable to send money" transaction.
- "provider": exact bank/e-wallet name (e.g. "GCash", "Maya", "GoTyme Bank", "SeaBank", "BPI", "BDO Pay / Online", "UnionBank", "InstaPay", or "E-Wallet / Bank").
- "amount": the main transferred/paid amount in PHP as a plain number (e.g. 250.5), excluding transaction fees if shown separately, or null if unreadable.
- "refNo": exact reference / transaction number string, or null if not visible.
- "recipientName": receiver name/account shown on the receipt, or null if not visible.
- "dateTime": date & time shown on the receipt, or null if not visible.
- "visualTamperFlags": array of short strings ONLY if you see clear visual signs of editing (e.g. "mismatched font on amount", "misaligned decimal", "blurry patch behind reference number"). Leave [] if it looks like a normal screenshot.`;

function isVisionAvailable() {
  if (VISION_MODE === 'off') return false;
  return Boolean(GEMINI_API_KEY || OPENAI_API_KEY);
}

function parseVisionJson(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function callGeminiVision(base64, mimeType) {
  let lastErr = null;
  for (const model of ['gemini-2.0-flash', 'gemini-1.5-flash']) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
        GEMINI_API_KEY
      )}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: VISION_PROMPT },
                { inline_data: { mime_type: mimeType, data: base64 } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
      });
      if (!res.ok) {
        lastErr = new Error(`Gemini Vision (${model}) HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = parseVisionJson(text);
      if (parsed) return parsed;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

async function callOpenAIVision(base64, mimeType) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI Vision HTTP ${res.status}`);
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content || '';
  return parseVisionJson(text);
}

/**
 * Parses a receipt image using an AI Vision model.
 * @param {Buffer} imageBuffer
 * @param {string} [mimeType='image/png']
 * @returns {Promise<{
 *   isReceipt: boolean,
 *   isFailed: boolean,
 *   provider: string,
 *   amountValue: number|null,
 *   amountFormatted: string|null,
 *   refNo: string|null,
 *   recipientName: string|null,
 *   dateTime: string|null,
 *   visualTamperFlags: string[]
 * }|null>}
 */
async function analyzeReceiptWithVision(imageBuffer, mimeType = 'image/png') {
  if (!isVisionAvailable() || !imageBuffer) return null;

  const base64 = imageBuffer.toString('base64');
  const safeMime = mimeType && mimeType.startsWith('image/') ? mimeType : 'image/png';

  try {
    const parsed = GEMINI_API_KEY
      ? await callGeminiVision(base64, safeMime)
      : await callOpenAIVision(base64, safeMime);

    if (!parsed || typeof parsed !== 'object') return null;

    const num = parsed.amount != null ? Number(parsed.amount) : null;
    const validAmount = num != null && !isNaN(num) && num > 0 ? num : null;

    return {
      isReceipt: Boolean(parsed.isReceipt),
      isFailed: Boolean(parsed.isFailed),
      provider: typeof parsed.provider === 'string' && parsed.provider.trim() ? parsed.provider.trim() : 'E-Wallet / Bank',
      amountValue: validAmount,
      amountFormatted:
        validAmount != null
          ? `₱${validAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : null,
      refNo: typeof parsed.refNo === 'string' && parsed.refNo.trim() ? parsed.refNo.trim() : null,
      recipientName:
        typeof parsed.recipientName === 'string' && parsed.recipientName.trim()
          ? parsed.recipientName.trim()
          : null,
      dateTime:
        typeof parsed.dateTime === 'string' && parsed.dateTime.trim() ? parsed.dateTime.trim() : null,
      visualTamperFlags: Array.isArray(parsed.visualTamperFlags)
        ? parsed.visualTamperFlags.filter((x) => typeof x === 'string' && x.trim())
        : [],
    };
  } catch (err) {
    console.warn('[receiptVision] Vision fallback failed:', err.message || err);
    return null;
  }
}

module.exports = {
  isVisionAvailable,
  analyzeReceiptWithVision,
};
