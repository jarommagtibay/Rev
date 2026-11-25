// Shared AI utilities: LLM ticket handoff summarization + text embeddings + local semantic similarity
const { GEMINI_API_KEY, OPENAI_API_KEY, CURRENCY } = require('../config');

function isLLMAvailable() {
  return Boolean(GEMINI_API_KEY || OPENAI_API_KEY);
}

async function generateTextWithLLM(prompt) {
  if (!isLLMAvailable()) return null;

  if (GEMINI_API_KEY) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(
        GEMINI_API_KEY
      )}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 350 },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim()) return { text: text.trim(), engine: 'Gemini AI' };
      }
    } catch (err) {
      console.warn('[ai] Gemini text generation failed:', err.message || err);
    }
  }

  if (OPENAI_API_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          max_tokens: 350,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const text = json?.choices?.[0]?.message?.content;
        if (text && text.trim()) return { text: text.trim(), engine: 'OpenAI' };
      }
    } catch (err) {
      console.warn('[ai] OpenAI text generation failed:', err.message || err);
    }
  }

  return null;
}

/**
 * Summarizes a ticket for staff handoff into a crisp 4-line brief:
 * Order, Paid vs Remaining, Current Blocker, Next Action.
 */
async function summarizeTicketHandoff(ctx) {
  const {
    orderId,
    productText,
    price,
    amountPaid,
    paymentCount,
    stage,
    isPaidFlag,
    onHold,
    stickyNote,
    stickyRemind,
    lastReceipt,
    transcriptSnippet,
  } = ctx;

  const total = Number(price) || 0;
  const paid = Number(amountPaid) || 0;
  const remaining = Math.max(0, total - paid);

  if (isLLMAvailable()) {
    const prompt =
      `You are assisting a Discord shop staff member taking over an active order ticket mid-shift.\n` +
      `Produce ONLY a concise 4-line handoff brief using EXACTLY these 4 bold labels:\n` +
      `• **Order:** <order id, product, account>\n` +
      `• **Paid vs Remaining:** <exact amounts paid so far vs remaining or Paid in Full>\n` +
      `• **Current Blocker:** <any hold, underpayment, tamper warning, missing info, or "None">\n` +
      `• **Next Action:** <clear next step for staff>\n\n` +
      `Structured State:\n` +
      `- Order ID: #${orderId}\n` +
      `- Product: ${productText}\n` +
      `- Order Total: ${CURRENCY}${total.toFixed(2)}\n` +
      `- Tracked Paid So Far: ${CURRENCY}${paid.toFixed(2)} (${paymentCount} transfer(s)), Remaining: ${CURRENCY}${remaining.toFixed(2)}\n` +
      `- Ticket Stage: ${stage} | Payment Marked Received: ${isPaidFlag ? 'Yes' : 'No'} | On Hold: ${onHold ? 'Yes' : 'No'}\n` +
      (stickyNote ? `- Staff Sticky Note: ${stickyNote}\n` : '') +
      (stickyRemind ? `- Active Customer Reminder: ${stickyRemind}\n` : '') +
      (lastReceipt
        ? `- Last Receipt Scan: ${lastReceipt.amount || 'Unknown'} (${lastReceipt.provider || 'Unknown'}), Ref: ${
            lastReceipt.refNo || 'None'
          }, Tamper: ${lastReceipt.forensics?.badge || 'Clean'}\n`
        : '') +
      `\nRecent Ticket Messages (oldest to newest):\n${transcriptSnippet || '(No messages)'}`;

    const llm = await generateTextWithLLM(prompt);
    if (llm) return llm;
  }

  // Deterministic fallback when no LLM key is configured
  let paidLine;
  if (isPaidFlag) {
    paidLine = `**${CURRENCY}${total.toFixed(2)}** — Marked Received ✅`;
  } else if (paid > 0 && remaining > 0.01) {
    paidLine = `Paid **${CURRENCY}${paid.toFixed(2)}** / **${CURRENCY}${total.toFixed(2)}** (${paymentCount} transfer${
      paymentCount === 1 ? '' : 's'
    }) — Remaining **${CURRENCY}${remaining.toFixed(2)}** ⏳`;
  } else if (paid > 0) {
    paidLine = `Paid **${CURRENCY}${paid.toFixed(2)}** / **${CURRENCY}${total.toFixed(2)}** (${paymentCount} transfer${
      paymentCount === 1 ? '' : 's'
    }) — Covers total, awaiting staff click`;
  } else {
    paidLine = `**${CURRENCY}0.00** / **${CURRENCY}${total.toFixed(2)}** (Unpaid)`;
  }

  const blockers = [];
  if (onHold) blockers.push('Ticket is ON HOLD');
  if (lastReceipt?.forensics?.riskLevel === 'high') blockers.push('High tampering risk flagged on receipt');
  if (lastReceipt?.isDuplicate) blockers.push('Duplicate receipt warning');
  if (!isPaidFlag && paid > 0 && remaining > 0.01) blockers.push(`Underpaid by ${CURRENCY}${remaining.toFixed(2)}`);
  if (stickyNote) blockers.push(`Note: "${stickyNote}"`);
  if (stickyRemind) blockers.push('Waiting on customer reminder');
  const blockerLine = blockers.length > 0 ? blockers.join(' • ') : 'None';

  let nextAction = 'Review ticket and proceed';
  if (stage === 'completed') nextAction = 'Order completed — close ticket when ready';
  else if (stage === 'sent') nextAction = 'Waiting for customer to vouch/rate (or click Complete Order)';
  else if (!isPaidFlag && paid >= total && total > 0) nextAction = 'Verify receipt in GCash/Maya and click Payment Received';
  else if (!isPaidFlag && paid > 0 && remaining > 0.01) nextAction = `Wait for customer to pay remaining ${CURRENCY}${remaining.toFixed(2)}`;
  else if (!isPaidFlag) nextAction = 'Send payment QR or wait for customer receipt';
  else if (stage === 'open') nextAction = 'Click Processing and prepare delivery';
  else if (stage === 'processing') nextAction = 'Deliver order and click Sent with proof';

  return {
    text:
      `• **Order:** \`#${orderId}\` — ${productText}\n` +
      `• **Paid vs Remaining:** ${paidLine}\n` +
      `• **Current Blocker:** ${blockerLine}\n` +
      `• **Next Action:** ${nextAction}`,
    engine: 'Smart Summary',
  };
}

/**
 * Generates a vector embedding for semantic search (Gemini text-embedding-004 or OpenAI text-embedding-3-small).
 * Returns null if no API key is set (callers gracefully fall back to localSemanticScore).
 */
async function getTextEmbedding(text) {
  const input = String(text || '').slice(0, 6000).trim();
  if (!input) return null;

  if (GEMINI_API_KEY) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${encodeURIComponent(
        GEMINI_API_KEY
      )}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: { parts: [{ text: input }] },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const values = json?.embedding?.values;
        if (Array.isArray(values) && values.length > 0) {
          return { vector: values, model: 'gemini' };
        }
      }
    } catch (err) {
      console.warn('[ai] Gemini embedding failed:', err.message || err);
    }
  }

  if (OPENAI_API_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const values = json?.data?.[0]?.embedding;
        if (Array.isArray(values) && values.length > 0) {
          return { vector: values, model: 'openai' };
        }
      }
    } catch (err) {
      console.warn('[ai] OpenAI embedding failed:', err.message || err);
    }
  }

  return null;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// Local token + character-trigram semantic similarity fallback (works offline with zero API keys)
function localSemanticScore(query, docText) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9₱.\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const q = norm(query);
  const d = norm(docText);
  if (!q || !d) return 0;

  const stop = new Set(['the', 'and', 'for', 'with', 'who', 'that', 'this', 'was', 'via', 'guy', 'order', 'ticket']);
  const qTokens = q.split(' ').filter((w) => w.length >= 2 && !stop.has(w));
  const dTokens = new Set(d.split(' ').filter((w) => w.length >= 2));

  if (qTokens.length === 0) return d.includes(q) ? 0.8 : 0;

  let tokenHits = 0;
  for (const qt of qTokens) {
    if (dTokens.has(qt)) tokenHits += 1;
    else if (d.includes(qt)) tokenHits += 0.7;
  }
  const tokenScore = tokenHits / qTokens.length;

  const trigrams = (str) => {
    const set = new Set();
    for (let i = 0; i <= str.length - 3; i++) set.add(str.slice(i, i + 3));
    return set;
  };
  const qTri = trigrams(q);
  const dTri = trigrams(d);
  let inter = 0;
  for (const t of qTri) if (dTri.has(t)) inter++;
  const triScore = qTri.size > 0 ? inter / qTri.size : 0;

  return Math.min(0.99, tokenScore * 0.65 + triScore * 0.35);
}

module.exports = {
  isLLMAvailable,
  summarizeTicketHandoff,
  getTextEmbedding,
  cosineSimilarity,
  localSemanticScore,
};
