// Audit log: posts a short record in a private staff channel every time a customer creates a ticket.
// Set AUDIT_CHANNEL_ID in your .env (make that channel staff-only). If it is not set, nothing is logged.
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { COLOR, AUDIT_CHANNEL_ID } = require('../config');
const client = require('./client');
const { data, saveData, formatPrice, formatPeso } = require('./data');
const { getCustomerId } = require('./helpers');

// Accounts newer than this are marked with a warning (common sign of scammers / alt accounts)
const NEW_ACCOUNT_DAYS = 7;

function relative(timestamp) {
  return `<t:${Math.floor(timestamp / 1000)}:R>`;
}

// item    e.g. "1,000 Robux" or "112 Diamonds  •  Mobile Legends"
// price   e.g. "₱350"
// details extra fields from the order form: [{ name, value, inline }]
// This never throws, so a logging problem can never stop a customer from getting a ticket.
async function logTicketCreated(interaction, { channel, item, price, details = [] }) {
  if (!AUDIT_CHANNEL_ID) return;
  try {
    const user = interaction.user;
    const ageDays = (Date.now() - user.createdTimestamp) / 86400000;
    const isNew = ageDays < NEW_ACCOUNT_DAYS;
    const joined = interaction.member && interaction.member.joinedTimestamp;

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(isNew ? '🎫  Ticket Created  ⚠️ New account' : '🎫  Ticket Created')
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: 'Customer', value: `${user}\n@${user.username}`, inline: true },
        { name: 'Discord ID', value: `\`${user.id}\``, inline: true },
        { name: 'Ticket', value: `${channel}`, inline: true },
        { name: 'Account created', value: relative(user.createdTimestamp), inline: true },
        { name: 'Joined server', value: joined ? relative(joined) : 'Unknown', inline: true },
        { name: 'Order', value: `${item}\n${price}`, inline: true },
        ...details.map((d) => ({ name: d.name, value: d.value || '-', inline: true }))
      )
      .setTimestamp();

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

function buildHtmlTranscript(channel, sortedMessages) {
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
          return `<div class="embed">${title}${desc}${fields}</div>`;
        })
        .join('');

      // Attachments
      const attachmentsHtml = Array.from(m.attachments ? m.attachments.values() : [])
        .map((att) => {
          const isImg = (att.contentType || '').startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(att.name || '');
          if (isImg) {
            return `<div class="attachment"><a href="${att.url}" target="_blank"><img src="${att.url}" alt="${escapeHtml(att.name || 'Image')}" /></a></div>`;
          }
          return `<div class="attachment"><a href="${att.url}" target="_blank" style="color:#00a8fc; text-decoration:none;">📎 ${escapeHtml(att.name || 'Attachment')}</a></div>`;
        })
        .join('');

      return `
      <div class="message">
        <img class="avatar" src="${avatarUrl}" alt="${authorName}" onerror="this.style.display='none'" />
        <div class="content">
          <div class="author-row">
            <span class="author-name">${authorName}</span>
            ${botTag}
            <span class="timestamp">${timeStr}</span>
          </div>
          ${bodyHtml ? `<div class="body">${bodyHtml}</div>` : ''}
          ${embedsHtml}
          ${attachmentsHtml}
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
  .attachment img {
    max-width: 320px;
    max-height: 240px;
    border-radius: 6px;
    display: block;
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

// Generates an HTML transcript of the ticket and uploads it to AUDIT_CHANNEL_ID.
// Never throws, so close can never be blocked by transcript generation.
async function logTicketTranscript(channel, closedByUser) {
  if (!AUDIT_CHANNEL_ID) return;
  try {
    const auditChannel = await client.channels.fetch(AUDIT_CHANNEL_ID);
    if (!auditChannel) return;

    const messages = await channel.messages.fetch({ limit: 100 });
    const sorted = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const html = buildHtmlTranscript(channel, sorted);
    const file = new AttachmentBuilder(Buffer.from(html, 'utf-8'), {
      name: `transcript-${channel.name}.html`,
    });

    const customerId = getCustomerId(channel);
    const entry = data.queue.find((e) => e.channelId === channel.id);
    let orderInfo = 'N/A';
    if (entry && entry.type === 'game') {
      orderInfo = `${entry.label} (${entry.gameName}) • ${formatPeso(entry.price)}`;
    } else if (entry) {
      orderInfo = `${entry.amount.toLocaleString()} Robux • ${formatPrice(entry.amount)}`;
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

    await auditChannel.send({ embeds: [embed], files: [file], allowedMentions: { parse: [] } });
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