// Small helpers used everywhere
const fs = require('fs');
const path = require('path');
const {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const {
  STAFF_ROLE_ID,
  COLOR,
  CURRENCY,
  STICKERS,
  ROOT,
  MAX_TICKETS_PER_PRODUCT,
} = require('../config');
const { data } = require('./data');

const EPHEMERAL = MessageFlags.Ephemeral;

function isStaff(member) {
  return (
    member.roles.cache.has(STAFF_ROLE_ID) ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

// Replaces {words} in a text from messages.js. Unknown {words} are left as they are.
function fill(template, vars = {}) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (match, key) =>
    vars[key] !== undefined ? String(vars[key]) : match
  );
}

// Turns a { title, text, footer } entry from messages.js into ready-to-use text
function fromTemplate(tpl, vars = {}) {
  return {
    title: fill(tpl.title, vars),
    text: fill(tpl.text, vars),
    footer: tpl.footer ? fill(tpl.footer, vars) : undefined,
  };
}

// Builds a ticket message where the text is INSIDE the embed (with the sticker image under it).
// A mention inside an embed does not ping, so the customer ping stays as a tiny line above it.
// If the sticker file is missing, the message is sent without the picture.
function ticketMessage(
  stickerKey,
  { userId, title, text, footer, components, extraEmbeds, extraFiles } = {}
) {
  const embed = new EmbedBuilder().setColor(COLOR).setDescription(text).setTimestamp();
  if (title) embed.setTitle(title);
  if (footer) embed.setFooter({ text: footer });

  const files = [...(extraFiles || [])];
  const stickerName = stickerKey && STICKERS[stickerKey];
  if (stickerName) {
    const file = path.join(ROOT, stickerName);
    if (fs.existsSync(file)) {
      embed.setImage(`attachment://${stickerName}`);
      files.push(new AttachmentBuilder(file, { name: stickerName }));
    } else {
      console.warn(`${stickerName} not found, sending without the sticker.`);
    }
  }

  const message = { embeds: [embed, ...(extraEmbeds || [])] };
  if (files.length) message.files = files;
  if (userId) message.content = `<@${userId}>`;
  if (components) message.components = components;
  return message;
}

// Strips "ticket-", "queue-3-", "sent-", "done-" or "hold-" from a channel name
function baseName(channelName) {
  return channelName.replace(/^(ticket|queue-\d+|sent|done|hold)-/, '');
}

// The topic is "ticket:<userId>:<product>" (older tickets: "ticket:<userId>")
function getCustomerId(channel) {
  return (channel.topic || '').replace('ticket:', '').split(':')[0];
}

// Open tickets one customer has for one product ('robux' or a game key like 'ml')
function findOpenTickets(guild, userId, product) {
  const topic = `ticket:${userId}:${product}`;
  return [...guild.channels.cache.filter((ch) => ch.topic === topic).values()];
}

// Returns a message for the customer if they already have the maximum, otherwise null
function ticketLimitMessage(guild, userId, product, productName) {
  // If config.js is missing the setting (old copy), fall back to 2 instead of blocking everyone
  const limit = Number(MAX_TICKETS_PER_PRODUCT) || 2;
  const open = findOpenTickets(guild, userId, product);
  if (open.length < limit) return null;
  return (
    `You already have ${open.length} open ${productName} ticket${open.length === 1 ? '' : 's'} ` +
    `(the limit is ${limit}): ${open.join(', ')}\n` +
    'Please finish or close one before opening another.'
  );
}

// Takes the Robux text and the price text from a form.
// Exactly one must be filled in. Returns { amount } or { error }.
function parseOrderAmount(robuxRaw, priceRaw) {
  const robuxText = (robuxRaw || '').trim().replace(/,/g, '');
  const priceText = (priceRaw || '').trim().replace(/,/g, '');

  if ((robuxText && priceText) || (!robuxText && !priceText)) {
    return {
      error: `Please fill in only one: the Robux amount **or** the price (${CURRENCY}). Try again.`,
    };
  }

  if (robuxText) {
    if (!/^\d+$/.test(robuxText) || Number(robuxText) <= 0) {
      return { error: 'Robux amount must be a whole number greater than 0. Please try again.' };
    }
    return { amount: Number(robuxText) };
  }

  if (!/^\d+(\.\d+)?$/.test(priceText) || Number(priceText) <= 0) {
    return { error: `Price must be a number greater than 0 (in ${CURRENCY}). Please try again.` };
  }
  const amount = Math.floor((Number(priceText) * 100) / data.rate + 1e-9);
  if (amount <= 0) {
    return {
      error: `That price is too low to buy any Robux. The rate is **${CURRENCY}${data.rate}** per 100 Robux.`,
    };
  }
  return { amount };
}

// Short text for a queue entry: "1,000 Robux" or "Mobile Legends - 112 Diamonds"
function orderLabel(entry) {
  if (entry.type === 'game') return `${entry.gameName} - ${entry.label}`;
  return `${entry.amount.toLocaleString()} Robux`;
}

module.exports = {
  fill,
  fromTemplate,
  orderLabel,
  EPHEMERAL,
  isStaff,
  ticketMessage,
  baseName,
  getCustomerId,
  findOpenTickets,
  ticketLimitMessage,
  parseOrderAmount,
};