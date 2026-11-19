// /myorder -> customer or staff checks their current active order status, queue position and ticket link
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLOR } = require('../config');
const { data, orderPriceText, getAverageETA } = require('../core/data');
const { EPHEMERAL } = require('../core/helpers');

const commands = [
  new SlashCommandBuilder()
    .setName('myorder')
    .setDescription('Check your current order status, queue position and ticket'),
];

async function handle(interaction) {
  if (interaction.isButton() && interaction.customId === 'check_my_order') {
    return showMyOrder(interaction);
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'myorder') {
    return showMyOrder(interaction);
  }

  return false;
}

async function showMyOrder(interaction) {
  const userId = interaction.user.id;
  const userOrders = (data.queue || []).filter((e) => e.userId === userId);

  if (userOrders.length === 0) {
    await interaction.reply({
      content: 'You don\'t have any active orders right now. Click one of the buttons on the buy panel to start an order!',
      flags: EPHEMERAL,
    });
    return true;
  }

  const activeQueue = (data.queue || []).filter((e) => !e.onHold);

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('📋  Your Active Order Status')
    .setDescription(
      `You currently have **${userOrders.length}** open order ticket${userOrders.length > 1 ? 's' : ''}:`
    )
    .setTimestamp();

  for (const entry of userOrders) {
    const isGame = entry.type === 'game';
    const item = isGame ? `${entry.label} (${entry.gameName})` : `${entry.amount.toLocaleString()} Robux`;
    const price = orderPriceText(entry);
    const channelLink = `<#${entry.channelId}>`;

    let statusText = '🟢 Active in Queue';
    if (entry.onHold) {
      statusText = '⏸️ On Hold (Paused)';
    }

    const pos = activeQueue.findIndex((e) => e.channelId === entry.channelId);
    const posText = entry.onHold ? 'On Hold' : pos >= 0 ? `#${pos + 1}` : 'Processing';

    // Calculate dynamic ETA
    const avgMins = getAverageETA();
    let etaText = 'Calculating...';
    if (entry.onHold) {
      etaText = 'Paused (On Hold)';
    } else if (pos === 0) {
      etaText = '~5 - 10 mins (Next in line!)';
    } else if (pos > 0) {
      const estimatedMins = (pos + 1) * avgMins;
      etaText = `~${estimatedMins} mins (approx. ${avgMins}m / order)`;
    }

    embed.addFields({
      name: `Ticket: ${channelLink}`,
      value:
        `• **Item:** ${item}\n` +
        `• **Price:** ${price}\n` +
        `• **Position in Line:** **${posText}**\n` +
        `• **Estimated Wait Time:** ⏱️ **${etaText}**\n` +
        `• **Status:** ${statusText}`,
      inline: false,
    });
  }

  embed.setFooter({ text: 'Revéux Shop • Keep receipts ready in your ticket!' });

  await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
  return true;
}

module.exports = { commands, handle };
