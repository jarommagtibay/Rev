// Shared AI utilities: LLM ticket handoff summarization + text embeddings + local semantic similarity
const { GEMINI_API_KEY, OPENAI_API_KEY, CURRENCY } = require('../config');

function isLLMAvailable() {
  return Boolean(GEMINI_API_KEY || OPENAI_API_KEY);
}

async function generateTextWithLLM(prompt) {
  if (!isLLMAvailable()) return null;

  if (GEMINI_API_KEY) {
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
        console.warn(`[ai] Gemini (${model}) text generation failed:`, err.message || err);
      }
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
    for (const embModel of ['text-embedding-004', 'gemini-embedding-001']) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${embModel}:embedContent?key=${encodeURIComponent(
          GEMINI_API_KEY
        )}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(12000),
          body: JSON.stringify({
            model: `models/${embModel}`,
            content: { parts: [{ text: input }] },
          }),
        });
        if (res.ok) {
          const json = await res.json();
          const values = json?.embedding?.values;
          if (Array.isArray(values) && values.length > 0) {
            return { vector: values, model: `gemini:${embModel}` };
          }
        }
      } catch (err) {
        console.warn(`[ai] Gemini embedding (${embModel}) failed:`, err.message || err);
      }
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

const ALLOWED_COPILOT_ACTIONS = new Set([
  'send_reply',
  'edit_reply',
  'send_balance_reminder',
  'ask_clear_receipt',
  'mark_paid',
  'mark_processing',
  'pin_vouch_reminder',
]);

/**
 * Analyzes an active ticket for /copilot and returns:
 * { situation, suggestedReply, actions: string[], engine: string }
 */
async function analyzeTicketForCopilot(ctx) {
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
    focus,
  } = ctx;

  const total = Number(price) || 0;
  const paid = Number(amountPaid) || 0;
  const remaining = Math.max(0, total - paid);

  if (isLLMAvailable()) {
    const prompt =
      `You are an AI Copilot for staff running a Discord Robux & game credit shop (Revéux).\n` +
      `Analyze the ticket state and recent messages, then respond with ONLY valid JSON (no markdown fences, no extra text):\n` +
      `{\n` +
      `  "situation": "1-2 concise sentences diagnosing what is happening or blocking the order right now.",\n` +
      `  "suggestedReply": "A short, friendly, natural English/Taglish reply staff can send to the customer right now (under 240 chars).",\n` +
      `  "actions": ["action_id_1", "action_id_2"]\n` +
      `}\n\n` +
      `Allowed action IDs (pick 2 to 4 most relevant):\n` +
      `- "send_reply": Post the suggestedReply directly to the ticket\n` +
      `- "edit_reply": Open a popup to edit suggestedReply before sending\n` +
      `- "send_balance_reminder": Pin a customer reminder for the remaining ${CURRENCY}${remaining.toFixed(2)} balance\n` +
      `- "ask_clear_receipt": Pin a reminder asking for a clearer, uncropped receipt with Ref No. & amount\n` +
      `- "mark_paid": Mark Payment Received on the ticket\n` +
      `- "mark_processing": Mark order as Processing\n` +
      `- "pin_vouch_reminder": Pin a reminder asking the customer to vouch/rate\n\n` +
      `Structured Ticket State:\n` +
      `- Order ID: #${orderId}\n` +
      `- Product: ${productText}\n` +
      `- Order Total: ${CURRENCY}${total.toFixed(2)}\n` +
      `- Tracked Paid So Far: ${CURRENCY}${paid.toFixed(2)} (${paymentCount} transfer(s)), Remaining: ${CURRENCY}${remaining.toFixed(2)}\n` +
      `- Stage: ${stage} | Payment Marked Received: ${isPaidFlag ? 'Yes' : 'No'} | On Hold: ${onHold ? 'Yes' : 'No'}\n` +
      (stickyNote ? `- Staff Sticky Note: ${stickyNote}\n` : '') +
      (stickyRemind ? `- Active Customer Reminder: ${stickyRemind}\n` : '') +
      (lastReceipt
        ? `- Last Receipt Scan: ${lastReceipt.amount || 'Unknown'} (${lastReceipt.provider || 'Unknown'}), Ref: ${
            lastReceipt.refNo || 'None'
          }, Tamper: ${lastReceipt.forensics?.badge || 'Clean'}, Duplicate: ${lastReceipt.isDuplicate ? 'YES' : 'No'}\n`
        : '- Last Receipt Scan: None yet\n') +
      (focus ? `\nStaff Specific Question/Focus: ${focus}\n` : '') +
      `\nRecent Ticket Messages (oldest to newest):\n${transcriptSnippet || '(No messages)'}`;

    const llm = await generateTextWithLLM(prompt);
    if (llm && llm.text) {
      try {
        const cleaned = llm.text
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
        const parsed = JSON.parse(cleaned);
        if (parsed && typeof parsed.situation === 'string' && parsed.situation.trim()) {
          const validActions = Array.isArray(parsed.actions)
            ? parsed.actions.filter((a) => ALLOWED_COPILOT_ACTIONS.has(a)).slice(0, 4)
            : [];
          if (validActions.length === 0) validActions.push('send_reply', 'edit_reply');
          return {
            situation: parsed.situation.trim().slice(0, 500),
            suggestedReply:
              typeof parsed.suggestedReply === 'string' && parsed.suggestedReply.trim()
                ? parsed.suggestedReply.trim().slice(0, 350)
                : 'Hi! Checking in on your order — please let us know if you need anything.',
            actions: validActions,
            engine: llm.engine,
          };
        }
      } catch (err) {
        console.warn('[ai] Copilot JSON parse failed, using fallback:', err.message || err);
      }
    }
  }

  // Deterministic smart fallback when no LLM key is configured or parse fails
  let situation = `Order #${orderId} (${productText}) is currently in **${stage}** stage.`;
  let suggestedReply = 'Hi! We are reviewing your order now and will update you shortly.';
  let actions = ['send_reply', 'edit_reply'];

  if (lastReceipt?.forensics?.riskLevel === 'high' || lastReceipt?.isDuplicate) {
    situation = lastReceipt?.isDuplicate
      ? `🚨 Receipt flagged as a **duplicate** (Ref: \`${lastReceipt.refNo || 'Unknown'}\`). Verify carefully before marking paid.`
      : `🚨 Receipt flagged for **high tampering risk** (${lastReceipt.forensics?.badge || 'Alert'}). Request a screen recording or clearer uncropped proof.`;
    suggestedReply =
      'Hi! For security verification, could you please send an uncropped screenshot or quick screen recording showing the transaction in your GCash/Maya history?';
    actions = ['ask_clear_receipt', 'send_reply', 'edit_reply'];
  } else if (!isPaidFlag && paid > 0 && remaining > 0.01) {
    situation = `Buyer has paid **${CURRENCY}${paid.toFixed(2)}** out of **${CURRENCY}${total.toFixed(2)}** — still short by **${CURRENCY}${remaining.toFixed(2)}**.`;
    suggestedReply = `Hi! We received ${CURRENCY}${paid.toFixed(2)} so far. Please send the remaining ${CURRENCY}${remaining.toFixed(2)} and upload the receipt so we can proceed!`;
    actions = ['send_balance_reminder', 'send_reply', 'edit_reply'];
  } else if (!isPaidFlag && lastReceipt && (!lastReceipt.amount || !lastReceipt.refNo)) {
    situation = 'A receipt was uploaded, but OCR could not clearly read the amount or reference number.';
    suggestedReply =
      'Hi! Could you please resend a clearer, uncropped receipt screenshot showing the full amount and Reference No.?';
    actions = ['ask_clear_receipt', 'send_reply', 'edit_reply', 'mark_paid'];
  } else if (!isPaidFlag && paid >= total && total > 0) {
    situation = `Tracked payments (**${CURRENCY}${paid.toFixed(2)}**) cover the **${CURRENCY}${total.toFixed(2)}** total. Ready to confirm payment.`;
    suggestedReply = 'Payment confirmed! Moving your order to processing now.';
    actions = ['mark_paid', 'send_reply', 'edit_reply'];
  } else if (!isPaidFlag) {
    situation = `Waiting on customer payment (**${CURRENCY}${total.toFixed(2)}**) or receipt screenshot.`;
    suggestedReply = `Hi! Please send your **${CURRENCY}${total.toFixed(2)}** payment using the QR above and upload the receipt screenshot here when done.`;
    actions = ['ask_clear_receipt', 'send_reply', 'edit_reply'];
  } else if (stage === 'open') {
    situation = 'Payment is already marked received, and the order is ready to move into Processing.';
    suggestedReply = 'Thanks for waiting! We are processing your order now.';
    actions = ['mark_processing', 'send_reply', 'edit_reply'];
  } else if (stage === 'processing') {
    situation = 'Order is currently Processing. Deliver the item and use `/sent` (or the Sent button) with proof.';
    suggestedReply = 'Working on your order right now — will send proof shortly!';
    actions = ['send_reply', 'edit_reply'];
  } else if (stage === 'sent') {
    situation = 'Order has been sent! Waiting for the customer to leave a vouch/rating.';
    suggestedReply = 'Your order has been delivered! Please click a star rating button above to vouch and complete your order ⭐';
    actions = ['pin_vouch_reminder', 'send_reply', 'edit_reply'];
  }

  return {
    situation,
    suggestedReply,
    actions,
    engine: 'Smart Rules',
  };
}

/**
 * Generates a hyped, clean Discord shop announcement for /announce.
 * Returns { title, body, engine }.
 */
async function generateAnnouncement({ topic, rate, stock }) {
  if (isLLMAvailable()) {
    const prompt =
      `You are writing a Discord announcement for a trusted Philippine Robux & Mobile Game credits shop called "Revéux".\n` +
      `Topic / Promo Details: ${topic}\n` +
      `Current Live Shop Context: Rate = ${CURRENCY}${rate} per 100 Robux | Available Stock = ${Number(stock || 0).toLocaleString()} Robux\n\n` +
      `Respond with ONLY valid JSON (no markdown code fences):\n` +
      `{\n` +
      `  "title": "Short punchy headline with 1-2 emojis (max 80 chars)",\n` +
      `  "body": "Clean, hyped Discord announcement with bullet points/emojis, clear call-to-action to open a ticket, max 700 chars."\n` +
      `}`;

    const llm = await generateTextWithLLM(prompt);
    if (llm && llm.text) {
      try {
        const cleaned = llm.text
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
        const parsed = JSON.parse(cleaned);
        if (parsed && typeof parsed.title === 'string' && typeof parsed.body === 'string') {
          return {
            title: parsed.title.trim().slice(0, 120),
            body: parsed.body.trim().slice(0, 1500),
            engine: llm.engine,
          };
        }
      } catch (err) {
        console.warn('[ai] Announcement JSON parse failed, using fallback:', err.message || err);
      }
    }
  }

  return {
    title: `🔥  REVÉUX ANNOUNCEMENT`,
    body:
      `✨ **${topic}**\n\n` +
      `💎 **Current Rate:** ${CURRENCY}${rate} / 100 Robux\n` +
      `📦 **Available Stock:** ${Number(stock || 0).toLocaleString()} Robux\n\n` +
      `🛒 Head to the buy channel and open a ticket now before stock runs out!`,
    engine: 'Smart Template',
  };
}

module.exports = {
  isLLMAvailable,
  summarizeTicketHandoff,
  analyzeTicketForCopilot,
  generateAnnouncement,
  getTextEmbedding,
  cosineSimilarity,
  localSemanticScore,
};
