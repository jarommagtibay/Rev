// /find -> Quick-search command for orders by Order ID, Discord user, or Roblox username
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLOR, RECEIPT_CHANNEL_ID, AUDIT_CHANNEL_ID } = require('../config');
const { data, formatPeso } = require('../core/data');
const { EPHEMERAL, isStaff } = require('../core/helpers');

const commands = [
  new SlashCommandBuilder()
    .setName('find')
    .setDescription('Quick-search orders by Order ID, Discord customer, or Roblox username')
    .addStringOption((o) =>
      o.setName('order').setDescription('Order ID to find (e.g. 1012, REV-1012)').setRequired(false)
    )
    .addUserOption((o) =>
      o.setName('user').setDescription('Discord customer to find orders for').setRequired(false)
    )
    .addStringOption((o) =>
      o.setName('robloxname').setDescription('Roblox or in-game username').setRequired(false)
    ),
];

async function runFind(interaction) {
  const staff = isStaff(interaction.member);
  const orderQuery = (interaction.options.getString('order') || '').trim();
  const targetUser = interaction.options.getUser('user');
  const robloxQuery = (interaction.options.getString('robloxname') || '').trim().toLowerCase();

  if (!orderQuery && !targetUser && !robloxQuery) {
    return interaction.reply({
      content: '⚠️ Please provide at least one search filter: `order`, `user`, or `robloxname`.',
      flags: EPHEMERAL,
    });
  }

  const cleanOrderNum = orderQuery.replace(/[^0-9]/g, '');
  const cleanOrderText = orderQuery.replace(/[`#]/g, '').toLowerCase();

  // Aggregate orders from data.queue (active) and data.ordersLog (completed)
  const activeOrders = (data.queue || []).map((e) => ({
    ...e,
    orderId: e.orderId || 'REV-XXXX',
    status: 'Active (Open / In Queue)',
    isActive: true,
  }));

  const completedOrders = (data.ordersLog || []).map((e) => ({
    ...e,
    orderId: e.orderId || 'REV-XXXX',
    status: e.status || 'Completed ✅',
    isActive: false,
  }));

  const allRecords = [...activeOrders, ...completedOrders];

  // Filter matches
  let matches = allRecords.filter((ord) => {
    // Non-staff can only search their own orders
    if (!staff && ord.userId !== interaction.user.id) return false;

    if (orderQuery) {
      const curId = String(ord.orderId || '').toLowerCase();
      const curNum = curId.replace(/[^0-9]/g, '');
      const matchExact = curId.includes(cleanOrderText);
      const matchNum = cleanOrderNum && curNum && curNum.includes(cleanOrderNum);
      if (!matchExact && !matchNum) return false;
    }

    if (targetUser && ord.userId !== targetUser.id) {
      return false;
    }

    if (robloxQuery) {
      const acc = String(ord.username || ord.name || ord.accountInfo || '').toLowerCase();
      if (!acc.includes(robloxQuery)) return false;
    }

    return true;
  });

  // Deduplicate by orderId if duplicated across queue and log
  const seen = new Set();
  matches = matches.filter((o) => {
    const key = `${o.orderId}_${o.channelId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort newest first
  matches.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (matches.length === 0) {
    return interaction.reply({
      content: `❌ **No orders found** matching your search criteria.${
        !staff ? ' *(Note: You can only search your own orders)*' : ''
      }`,
      flags: EPHEMERAL,
    });
  }

  const embeds = [];
  const topMatches = matches.slice(0, 5);

  const mainEmbed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`🔍  Order Search Results (${matches.length} found)`)
    .setDescription(
      `Found **${matches.length}** matching order${matches.length === 1 ? '' : 's'}.${
        matches.length > 5 ? ' Showing the 5 most recent:' : ''
      }`
    )
    .setTimestamp();

  for (const ord of topMatches) {
    const isRobux = ord.type === 'robux' || (!ord.type && ord.amount);
    const productStr = isRobux
      ? `${Number(ord.amount || 0).toLocaleString()} Robux`
      : ord.label || ord.productName || 'Gaming Item';

    const accountStr = ord.username
      ? `\`${ord.username}\`${ord.name && ord.name !== ord.username ? ` (${ord.name})` : ''}`
      : ord.accountInfo || '-';

    const channelStr = ord.channelId
      ? `<#${ord.channelId}>`
      : ord.channelName
      ? `#${ord.channelName}`
      : 'Closed';

    const dateStr = ord.timestamp
      ? `<t:${Math.floor(ord.timestamp / 1000)}:f> (<t:${Math.floor(ord.timestamp / 1000)}:R>)`
      : 'N/A';

    const ratingStr = ord.rating ? `${'⭐'.repeat(ord.rating)} (${ord.rating}/5)` : 'Not rated yet';

    let extraLinks = [];
    if (RECEIPT_CHANNEL_ID) extraLinks.push(`Receipts: <#${RECEIPT_CHANNEL_ID}>`);
    if (staff && AUDIT_CHANNEL_ID) extraLinks.push(`Transcripts: <#${AUDIT_CHANNEL_ID}>`);
    const linkLine = extraLinks.length > 0 ? `\n• **Channels:** ${extraLinks.join(' • ')}` : '';

    mainEmbed.addFields({
      name: `📦 Order #${ord.orderId} • ${ord.status}`,
      value:
        `• **Customer:** <@${ord.userId}>\n` +
        `• **Product:** **${productStr}**\n` +
        `• **Price / Total:** **${formatPeso(ord.price || 0)}**\n` +
        `• **In-Game Account:** ${accountStr}\n` +
        `• **Ticket:** ${channelStr}\n` +
        `• **Fulfilled by:** @${ord.staff || 'Staff'}\n` +
        `• **Customer Rating:** ${ratingStr}\n` +
        `• **Date:** ${dateStr}` +
        linkLine,
      inline: false,
    });
  }

  embeds.push(mainEmbed);

  return interaction.reply({
    embeds,
    flags: EPHEMERAL,
  });
}

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'find') {
    await runFind(interaction);
    return true;
  }
  return false;
}

module.exports = { commands, handle };
