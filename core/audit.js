// Audit log: posts a short record in a private staff channel every time a customer creates a ticket.
// Set AUDIT_CHANNEL_ID in your .env (make that channel staff-only). If it is not set, nothing is logged.
const path = require('path');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { COLOR, AUDIT_CHANNEL_ID, STICKERS, PAYEES } = require('../config');
const client = require('./client');
const { data, saveData, formatPeso, orderPriceText } = require('./data');
const { getCustomerId } = require('./helpers');
const { getTextEmbedding } = require('./ai');

// Accounts newer than this are marked with a warning (common sign of scammers / alt accounts)
const NEW_ACCOUNT_DAYS = 7;

function relative(timestamp) {
  return `<t:${Math.floor(timestamp / 1000)}:R>`;
}

// Calculate Levenshtein similarity ratio between two strings (0.0 to 1.0)
function similarity(s1, s2) {
  const a = (s1 || '').toLowerCase().trim();
  const b = (s2 || '').toLowerCase().trim();
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const maxLen = Math.max(m, n);
  return (maxLen - dp[m][n]) / maxLen;
}

// Checks order details against known fraud patterns
function checkFraudSignals(user, details = []) {
  const flags = [];

  // 1. Account age < 7 days
  const ageDays = (Date.now() - user.createdTimestamp) / 86400000;
  if (ageDays < NEW_ACCOUNT_DAYS) {
    flags.push(`⚠️ **New Discord account** (created ${Math.floor(ageDays)}d ago)`);
  }

  // 2. Blacklist look-alike check
  const blacklist = data.blacklist || [];
  for (const b of blacklist) {
    if (b.username) {
      const sim = similarity(user.username, b.username);
      if (sim >= 0.75 && user.username.toLowerCase() !== b.username.toLowerCase()) {
        flags.push(`🚨 **Name look-alike** of blacklisted user @${b.username} (${Math.round(sim * 100)}% match)`);
        break;
      }
    }
  }

  // 3. Same Roblox username ordered by multiple different Discord accounts
  const robloxUserField = details.find((d) => d.name === 'Account Username');
  if (robloxUserField && robloxUserField.value) {
    const rName = robloxUserField.value.trim().toLowerCase();
    const otherAccounts = new Set();
    // Check queue
    for (const q of data.queue || []) {
      if (q.username && q.username.trim().toLowerCase() === rName && q.userId !== user.id) {
        otherAccounts.add(q.userId);
      }
    }
    // Check historical orders log
    for (const ord of data.ordersLog || []) {
      if (ord.username && ord.username.trim().toLowerCase() === rName && ord.userId !== user.id) {
        otherAccounts.add(ord.userId);
      }
    }
    if (otherAccounts.size > 0) {
      flags.push(`⚠️ **Shared Game ID**: Roblox user \`${robloxUserField.value}\` was also ordered by ${otherAccounts.size} other Discord account(s)`);
    }
  }

  return flags;
}

// item    e.g. "1,000 Robux" or "112 Diamonds  •  Mobile Legends"
// price   e.g. "₱350"
// details extra fields from the order form: [{ name, value, inline }]
// This never throws, so a logging problem can never stop a customer from getting a ticket.
async function logTicketCreated(interaction, { channel, item, price, details = [] }) {
  if (!AUDIT_CHANNEL_ID) return;
  try {
    const user = interaction.user;
    const joined = interaction.member && interaction.member.joinedTimestamp;
    const fraudSignals = checkFraudSignals(user, details);
    const hasAlert = fraudSignals.length > 0;

    const embed = new EmbedBuilder()
      .setColor(hasAlert ? 0xff0033 : COLOR)
      .setTitle(hasAlert ? '🎫  Ticket Created  ⚠️ Security Warning' : '🎫  Ticket Created')
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: 'Customer', value: `${user}\n@${user.username}`, inline: true },
        { name: 'Discord ID', value: `\`${user.id}\``, inline: true },
        { name: 'Ticket', value: `${channel}`, inline: true },
        { name: 'Account created', value: relative(user.createdTimestamp), inline: true },
        { name: 'Joined server', value: joined ? relative(joined) : 'Unknown', inline: true },
        { name: 'Order', value: `${item}\n${price}`, inline: true },
        ...details.map((d) => ({ name: d.name, value: d.value || '-', inline: true }))
      );

    if (hasAlert) {
      embed.addFields({
        name: '🛡️ Fraud / Risk Detection Flags',
        value: fraudSignals.join('\n'),
        inline: false,
      });
    }

    embed.setTimestamp();

    const auditChannel = await client.channels.fetch(AUDIT_CHANNEL_ID);
    const posted = await auditChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return posted.id;
  } catch (err) {
    console.error('Could not post the audit log:', err);
    return null;
  }
}

// Finds the ticket log message of an order. Uses the saved message id; for tickets that have none
// (opened before it was saved) it looks for the log of that ticket in the last 100 messages.
async function findAuditMessage(entry, auditChannel) {
  if (entry.auditMessageId) {
    try {
      return await auditChannel.messages.fetch({ message: entry.auditMessageId, force: true });
    } catch (err) {
      // fall through and search
    }
  }
  const recent = await auditChannel.messages.fetch({ limit: 100 });
  const found = recent.find((m) =>
    m.embeds[0] && (m.embeds[0].fields || []).some((f) => f.name === 'Ticket' && f.value.includes(entry.channelId))
  );
  if (found) {
    entry.auditMessageId = found.id;
    saveData();
  }
  return found || null;
}

// After Edit Order: show the new amount in the ticket log, with the original amount beside it.
// This never throws, so a logging problem can never stop an order edit.
async function updateTicketLogOrder(entry, newAmount, newPrice) {
  if (!AUDIT_CHANNEL_ID) return;
  try {
    const auditChannel = await client.channels.fetch(AUDIT_CHANNEL_ID);
    const message = await findAuditMessage(entry, auditChannel);
    if (!message) {
      console.warn('Ticket log message not found for', entry.channelId, '(Edit Order not shown in the log)');
      return;
    }
    const embed = EmbedBuilder.from(message.embeds[0]);
    const was = entry.originalAmount ? `\n✏️ edited, originally ${entry.originalAmount.toLocaleString()} Robux` : '';
    const fields = (embed.data.fields || []).map((f) =>
      f.name === 'Order' ? { ...f, value: `${newAmount.toLocaleString()} Robux\n${newPrice}${was}` } : f
    );
    embed.setFields(fields);
    await message.edit({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('Could not update the audit log:', err);
  }
}

// After Edit Order on a game order: show the new package + price in the ticket log,
// with the original package beside it. Never throws.
async function updateTicketLogGameOrder(entry, newItem, newPrice, originalText) {
  if (!AUDIT_CHANNEL_ID) return;
  try {
    const auditChannel = await client.channels.fetch(AUDIT_CHANNEL_ID);
    const message = await findAuditMessage(entry, auditChannel);
    if (!message) {
      console.warn('Ticket log message not found for', entry.channelId, '(Edit Order not shown in the log)');
      return;
    }
    const embed = EmbedBuilder.from(message.embeds[0]);
    const was = originalText ? `\n✏️ edited, originally ${originalText}` : '';
    const fields = (embed.data.fields || []).map((f) =>
      f.name === 'Order' ? { ...f, value: `${newItem}\n${newPrice}${was}` } : f
    );
    embed.setFields(fields);
    await message.edit({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('Could not update the audit log:', err);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatText(content) {
  if (!content) return '';
  let text = escapeHtml(content);
  // Code blocks: ```code```
  text = text.replace(/```(?:[a-z0-9_-]+)?\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // Inline code: `code`
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold: **text**
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic: *text*
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Newlines
  text = text.replace(/\n/g, '<br>');
  return text;
}

// ---------- Pictures in transcripts ----------
// Discord picture links stop working after a while, and the ticket channel is deleted when it is
// closed. So the pictures people sent (payment receipts, delivery proof) are downloaded now and put
// INSIDE the transcript file. Sticker and QR pictures are skipped (same pictures in every ticket).
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // up to 8MB per picture (handles high-res phone screenshots)
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024; // up to 20MB total (well within Discord 25MB bot upload limit)
const DOWNLOAD_TIMEOUT = 12000;
// Only Discord's own servers are downloaded from. A link a customer pasted is never fetched.
const DISCORD_CDN_HOSTS = new Set([
  'cdn.discordapp.com',
  'media.discordapp.net',
  'cdn.discord.com',
  'images-ext-1.discordapp.net',
  'images-ext-2.discordapp.net',
]);
const SKIPPED_FILE_NAMES = new Set([
  ...Object.values(STICKERS).map((n) => n.toLowerCase()),
  ...PAYEES.map((p) => path.basename(p.qrFile).toLowerCase()),
]);

function isDiscordCdn(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && DISCORD_CDN_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function isDecorativeImage(url) {
  try {
    return SKIPPED_FILE_NAMES.has(path.basename(new URL(url).pathname).toLowerCase());
  } catch {
    return false;
  }
}

// Returns Map<picture url, data: URI> for the pictures that fit the size limits.
// Never throws: a picture that can't be downloaded just stays a normal link.
async function inlineImages(messages) {
  const images = new Map();
  const wanted = [];
  for (const m of messages) {
    for (const att of m.attachments ? m.attachments.values() : []) {
      const isImg =
        (att.contentType || '').startsWith('image/') ||
        /\.(png|jpe?g|webp|gif|bmp|tiff)($|\?)/i.test(att.name || '') ||
        /\.(png|jpe?g|webp|gif|bmp|tiff)($|\?)/i.test(att.url || '');
      if (isImg) wanted.push({ url: att.url, size: att.size });
    }
    for (const e of m.embeds || []) {
      if (e.image && e.image.url) wanted.push({ url: e.image.url, size: 0 });
    }
  }

  let total = 0;
  for (const { url, size } of wanted) {
    if (images.has(url) || !isDiscordCdn(url) || isDecorativeImage(url)) continue;
    if (size > MAX_IMAGE_BYTES) continue;
    if (total >= MAX_TOTAL_IMAGE_BYTES) break;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT) });
      if (!res.ok) continue;
      const type = res.headers.get('content-type') || '';
      if (!type.startsWith('image/')) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_IMAGE_BYTES || total + buffer.length > MAX_TOTAL_IMAGE_BYTES) continue;
      total += buffer.length;
      images.set(url, `data:${type};base64,${buffer.toString('base64')}`);
    } catch (err) {
      // could not download this one, keep the link
    }
  }
  return images;
}

// images = Map from inlineImages(). Pictures that are not in it are shown from their Discord link.
function buildHtmlTranscript(channel, sortedMessages, images = new Map()) {
  const channelName = escapeHtml(channel.name);
  const total = sortedMessages.length;
  const closedDate = new Date().toUTCString();

  const messageCards = sortedMessages
    .map((m) => {
      const authorName = escapeHtml(m.author ? m.author.username : 'Unknown');
      const avatarUrl = m.author ? m.author.displayAvatarURL({ size: 64 }) : '';
      const botTag = m.author && m.author.bot ? '<span class="bot-tag">BOT</span>' : '';
      const timeStr = new Date(m.createdTimestamp).toLocaleString('en-US', {
        timeZone: 'UTC',
        dateStyle: 'medium',
        timeStyle: 'short',
      }) + ' UTC';

      const bodyHtml = formatText(m.content);

      // Embeds
      const embedsHtml = (m.embeds || [])
        .map((e) => {
          const title = e.title ? `<div class="embed-title">${escapeHtml(e.title)}</div>` : '';
          const desc = e.description ? `<div class="embed-desc">${formatText(e.description)}</div>` : '';
          const fields = (e.fields || [])
            .map(
              (f) =>
                `<div class="embed-field"><div class="field-name">${escapeHtml(f.name)}</div><div class="field-val">${formatText(f.value)}</div></div>`
            )
            .join('');
          let picture = '';
          if (e.image && e.image.url && !isDecorativeImage(e.image.url)) {
            // Only pictures that are saved in the file or hosted by Discord. A picture from a link
            // the customer pasted is never loaded when staff open the transcript.
            const saved = images.get(e.image.url);
            if (saved || isDiscordCdn(e.image.url)) {
              picture = `<img class="embed-img" src="${saved || e.image.url}" alt="" />`;
            }
          }
          return `<div class="embed">${title}${desc}${fields}${picture}</div>`;
        })
        .join('');

      // Attachments
      const attachmentsHtml = Array.from(m.attachments ? m.attachments.values() : [])
        .map((att) => {
          const isImg =
            (att.contentType || '').startsWith('image/') ||
            /\.(png|jpe?g|webp|gif|bmp|tiff)($|\?)/i.test(att.name || '') ||
            /\.(png|jpe?g|webp|gif|bmp|tiff)($|\?)/i.test(att.url || '');
          const alt = escapeHtml(att.name || 'Image');
          if (isImg) {
            const saved = images.get(att.url);
            if (saved) {
              return `<div class="attachment"><a href="${saved}" target="_blank"><img src="${saved}" alt="${alt}" /></a><div class="att-name">🖼️ ${alt}</div></div>`;
            }
            return `<div class="attachment"><a href="${att.url}" target="_blank"><img src="${att.url}" alt="${alt}" onerror="this.style.display='none'" /></a><div class="att-name">📎 <a href="${att.url}" target="_blank" style="color:#00a8fc;">${alt}</a></div></div>`;
          }
          return `<div class="attachment"><a href="${att.url}" target="_blank" style="color:#00a8fc; text-decoration:none;">📎 ${alt}</a></div>`;
        })
        .join('');

      const hasBody = Boolean(bodyHtml);
      const hasEmbeds = (m.embeds || []).length > 0;
      const hasAtts = (m.attachments ? m.attachments.size : 0) > 0;

      let innerContent = '';
      if (hasBody) innerContent += `<div class="body">${bodyHtml}</div>`;
      if (hasEmbeds) innerContent += embedsHtml;
      if (hasAtts) innerContent += attachmentsHtml;
      if (!hasBody && !hasEmbeds && !hasAtts) {
        innerContent = '<div class="body" style="color:#80848e; font-style:italic;">[Message text or attachment unavailable — ensure Message Content Intent is enabled in Discord Developer Portal]</div>';
      }

      return `
      <div class="message">
        <img class="avatar" src="${avatarUrl}" alt="${authorName}" onerror="this.style.display='none'" />
        <div class="content">
          <div class="author-row">
            <span class="author-name">${authorName}</span>
            ${botTag}
            <span class="timestamp">${timeStr}</span>
          </div>
          ${innerContent}
        </div>
      </div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Transcript - #${channelName}</title>
<style>
  body {
    background-color: #313338;
    color: #dbdee1;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    margin: 0;
    padding: 24px;
    font-size: 14px;
    line-height: 1.5;
  }
  .header {
    background-color: #2b2d31;
    padding: 16px 20px;
    border-radius: 8px;
    margin-bottom: 24px;
    border-left: 4px solid #94030f;
  }
  .header h1 {
    margin: 0 0 6px 0;
    font-size: 20px;
    color: #f2f3f5;
  }
  .header p {
    margin: 0;
    color: #949ba4;
    font-size: 13px;
  }
  .messages {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .message {
    display: flex;
    gap: 14px;
    background: #2b2d31;
    padding: 12px 16px;
    border-radius: 8px;
  }
  .avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .content {
    flex-grow: 1;
    min-width: 0;
  }
  .author-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 4px;
  }
  .author-name {
    font-weight: 600;
    color: #f2f3f5;
  }
  .bot-tag {
    background: #5865f2;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 3px;
    text-transform: uppercase;
  }
  .timestamp {
    color: #949ba4;
    font-size: 12px;
  }
  .body {
    word-break: break-word;
    color: #dbdee1;
  }
  code {
    background: #1e1f22;
    padding: 2px 4px;
    border-radius: 4px;
    font-family: Consolas, monospace;
    font-size: 13px;
  }
  pre {
    background: #1e1f22;
    padding: 8px 12px;
    border-radius: 6px;
    overflow-x: auto;
  }
  pre code {
    padding: 0;
    background: transparent;
  }
  .embed {
    background: #1e1f22;
    border-left: 4px solid #94030f;
    border-radius: 4px;
    padding: 10px 14px;
    margin-top: 8px;
    max-width: 600px;
  }
  .embed-title {
    font-weight: 600;
    color: #f2f3f5;
    margin-bottom: 4px;
  }
  .embed-desc {
    margin-bottom: 8px;
    color: #dbdee1;
  }
  .embed-field {
    margin-top: 6px;
  }
  .field-name {
    font-weight: 600;
    font-size: 12px;
    color: #b5bac1;
  }
  .field-val {
    color: #dbdee1;
  }
  .attachment {
    margin-top: 8px;
  }
  .embed-img {
    max-width: 320px;
    max-height: 240px;
    border-radius: 6px;
    display: block;
    margin-top: 8px;
  }
  .attachment img {
    max-width: 480px;
    max-height: 360px;
    border-radius: 6px;
    display: block;
  }
  .att-name {
    margin-top: 4px;
    font-size: 12px;
    color: #949ba4;
  }
</style>
</head>
<body>
  <div class="header">
    <h1>Ticket Transcript: #${channelName}</h1>
    <p>Archived on ${closedDate} • Total ${total} messages</p>
  </div>
  <div class="messages">
    ${messageCards}
  </div>
</body>
</html>`;
}

// Fetches ALL messages from a channel (pages through the API, 100 at a time)
async function fetchAllMessages(channel) {
  const all = [];
  let lastId;
  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;
    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;
    all.push(...batch.values());
    lastId = batch.last().id;
    if (batch.size < 100) break;
  }
  return all;
}

// Generates an HTML transcript of the ticket and uploads it to AUDIT_CHANNEL_ID.
// Never throws, so close can never be blocked by transcript generation.
async function logTicketTranscript(channel, closedByUser) {
  if (!AUDIT_CHANNEL_ID) return;
  try {
    const auditChannel = await client.channels.fetch(AUDIT_CHANNEL_ID);
    if (!auditChannel) return;

    const messages = await fetchAllMessages(channel);
    const sorted = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const images = await inlineImages(sorted);
    const makeFile = (withImages) =>
      new AttachmentBuilder(
        Buffer.from(buildHtmlTranscript(channel, sorted, withImages ? images : new Map()), 'utf-8'),
        { name: `transcript-${channel.name}.html` }
      );

    const customerId = getCustomerId(channel);
    const entry = data.queue.find((e) => e.channelId === channel.id);
    let orderInfo = 'N/A';
    if (entry && entry.type === 'game') {
      orderInfo = `${entry.label} (${entry.gameName}) • ${formatPeso(entry.price)}`;
    } else if (entry) {
      orderInfo = `${entry.amount.toLocaleString()} Robux • ${orderPriceText(entry)}`;
    }

    const embed = new EmbedBuilder()
      .setTitle(`📁  Ticket Closed & Transcript: #${channel.name}`)
      .setColor(COLOR)
      .addFields(
        {
          name: 'Customer',
          value: customerId ? `<@${customerId}> (\`${customerId}\`)` : 'Unknown',
          inline: true,
        },
        {
          name: 'Closed by',
          value: `${closedByUser} (@${closedByUser.username})`,
          inline: true,
        },
        {
          name: 'Order',
          value: orderInfo,
          inline: true,
        },
        {
          name: 'Messages Archived',
          value: `${sorted.length}`,
          inline: true,
        }
      )
      .setTimestamp();

    let sentAuditMsg = null;
    try {
      sentAuditMsg = await auditChannel.send({ embeds: [embed], files: [makeFile(true)], allowedMentions: { parse: [] } });
    } catch (err) {
      if (images.size === 0) throw err;
      // Most likely the file was too big with the pictures inside: send it with links instead
      console.warn('Transcript with pictures could not be uploaded, sending it without them:', err.message);
      sentAuditMsg = await auditChannel.send({ embeds: [embed], files: [makeFile(false)], allowedMentions: { parse: [] } });
    }

    // Index closed ticket summary + vector embedding for /searchlogs
    try {
      const orderId = (entry && entry.orderId) || 'REV-XXXX';
      const paymentNotes =
        entry && Array.isArray(entry.payments) && entry.payments.length > 0
          ? entry.payments
              .map((p) => `${p.provider || 'Transfer'} ₱${Number(p.amount || 0).toFixed(2)}${p.refNo ? ` (${p.refNo})` : ''}`)
              .join(', ')
          : entry?.lastScannedReceipt?.provider || '';
      const receiptNote = entry?.lastScannedReceipt?.comparison?.message || '';
      const msgSnippets = sorted
        .filter((m) => !m.author.bot && m.content && m.content.trim())
        .slice(-20)
        .map((m) => `${m.author.username}: ${m.content.trim().slice(0, 120)}`)
        .join(' | ');

      const summaryText = [
        `Ticket #${channel.name}`,
        `Order #${orderId}`,
        orderInfo,
        entry?.username ? `Account: ${entry.username}` : '',
        paymentNotes ? `Payments: ${paymentNotes}` : '',
        receiptNote,
        `Closed by @${closedByUser.username}`,
        msgSnippets ? `Chat: ${msgSnippets}` : '',
      ]
        .filter(Boolean)
        .join(' • ')
        .slice(0, 1800);

      const emb = await getTextEmbedding(summaryText);
      if (!Array.isArray(data.transcriptIndex)) data.transcriptIndex = [];
      data.transcriptIndex.push({
        channelId: channel.id,
        channelName: channel.name,
        orderId,
        customerId: customerId || null,
        orderInfo,
        summaryText,
        transcriptUrl: sentAuditMsg ? sentAuditMsg.url : null,
        auditMessageId: sentAuditMsg ? sentAuditMsg.id : null,
        embedding: emb ? emb.vector : null,
        embeddingModel: emb ? emb.model : null,
        closedAt: Date.now(),
      });
      if (data.transcriptIndex.length > 2000) {
        data.transcriptIndex = data.transcriptIndex.slice(-2000);
      }
      saveData();
    } catch (idxErr) {
      console.warn('Could not index ticket transcript for semantic search:', idxErr.message || idxErr);
    }
  } catch (err) {
    console.error('Could not log ticket transcript:', err);
  }
}

module.exports = {
  logTicketCreated,
  updateTicketLogOrder,
  updateTicketLogGameOrder,
  logTicketTranscript,
};