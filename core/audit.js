// Audit log: posts a short record in a private staff channel every time a customer creates a ticket.
// Set AUDIT_CHANNEL_ID in your .env (make that channel staff-only). If it is not set, nothing is logged.
const { EmbedBuilder } = require('discord.js');
const { COLOR, AUDIT_CHANNEL_ID } = require('../config');
const client = require('./client');

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

// After Edit Order: show the new amount in the ticket log, with the original amount beside it.
// This never throws, so a logging problem can never stop an order edit.
async function updateTicketLogOrder(entry, newAmount, newPrice) {
  if (!AUDIT_CHANNEL_ID || !entry.auditMessageId) return;
  try {
    const auditChannel = await client.channels.fetch(AUDIT_CHANNEL_ID);
    const message = await auditChannel.messages.fetch({ message: entry.auditMessageId, force: true });
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

module.exports = { logTicketCreated, updateTicketLogOrder };