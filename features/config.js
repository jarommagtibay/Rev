// /config -> Staff only: view or change rate, express fee, and low-stock threshold dynamically
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLOR, CURRENCY } = require('../config');
const { data, saveData, getExpressFee, getLowStockThreshold } = require('../core/data');
const { EPHEMERAL, isStaff } = require('../core/helpers');
const { postStockBoard } = require('./stock');

const commands = [
  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Staff only: view or change shop rate, express fee, and low-stock threshold')
    .addSubcommand((sub) =>
      sub.setName('view').setDescription('View current live shop configuration')
    )
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Update shop configuration values without restarting')
        .addNumberOption((o) =>
          o
            .setName('rate')
            .setDescription('New Robux rate per 100 R$ (e.g. 55, 60)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(1000)
        )
        .addNumberOption((o) =>
          o
            .setName('express')
            .setDescription(`New express delivery fee in ${CURRENCY} (e.g. 15, 20)`)
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(500)
        )
        .addNumberOption((o) =>
          o
            .setName('lowstock')
            .setDescription('New low-stock alert threshold in R$ (e.g. 500, 1000)')
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(1000000)
        )
    ),
];

async function runConfigView(interaction) {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('⚙️  Shop Live Configuration')
    .setDescription('Current live shop parameters in memory and `data.json`:')
    .addFields(
      {
        name: '💎  Robux Rate',
        value: `**${CURRENCY}${data.rate || 0}** per 100 Robux`,
        inline: true,
      },
      {
        name: '⚡  Express Delivery Fee',
        value: `**${CURRENCY}${getExpressFee()}**`,
        inline: true,
      },
      {
        name: '⚠️  Low Stock Threshold',
        value: `**${getLowStockThreshold().toLocaleString()} R$**`,
        inline: true,
      },
      {
        name: '🏬  Shop Status',
        value: data.shopOpen ? '🟢 **Open**' : '🔴 **Closed**',
        inline: true,
      },
      {
        name: '📦  Current Robux Stock',
        value: `**${(data.stock || 0).toLocaleString()} R$**`,
        inline: true,
      }
    )
    .setFooter({ text: 'Changes applied via /config take effect instantly without restarting.' })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
}

async function runConfigSet(interaction) {
  const newRate = interaction.options.getNumber('rate');
  const newExpress = interaction.options.getNumber('express');
  const newLowStock = interaction.options.getNumber('lowstock');

  if (newRate === null && newExpress === null && newLowStock === null) {
    return interaction.reply({
      content: '⚠️ Please provide at least one parameter to update: `rate`, `express`, or `lowstock`.',
      flags: EPHEMERAL,
    });
  }

  const changes = [];

  if (newRate !== null) {
    const oldRate = data.rate;
    data.rate = newRate;
    changes.push(`• **Robux Rate:** \`${CURRENCY}${oldRate}/100 R$\` ➔ **\`${CURRENCY}${newRate}/100 R$\`**`);
  }

  if (newExpress !== null) {
    const oldExpress = getExpressFee();
    data.expressFee = newExpress;
    changes.push(`• **Express Fee:** \`${CURRENCY}${oldExpress}\` ➔ **\`${CURRENCY}${newExpress}\`**`);
  }

  if (newLowStock !== null) {
    const oldLowStock = getLowStockThreshold();
    data.lowStockThreshold = newLowStock;
    changes.push(
      `• **Low-Stock Alert:** \`${oldLowStock.toLocaleString()} R$\` ➔ **\`${newLowStock.toLocaleString()} R$\`**`
    );
  }

  saveData();

  // If rate was changed, refresh the stock board in the public channel
  if (newRate !== null) {
    try {
      await postStockBoard(interaction.guild);
    } catch (err) {
      console.warn('[config] Could not refresh stock board after rate update:', err);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x00ff88)
    .setTitle('✅  Configuration Updated Successfully')
    .setDescription(
      `The following settings have been updated live in memory and saved to disk:\n\n` +
        changes.join('\n') +
        `\n\n*All active forms, ticket calculations, and alerts will use these new values immediately.*`
    )
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
}

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'config') {
    if (!isStaff(interaction.member)) {
      await interaction.reply({
        content: 'Only staff can view or edit shop configuration.',
        flags: EPHEMERAL,
      });
      return true;
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'view') {
      await runConfigView(interaction);
      return true;
    }
    if (sub === 'set') {
      await runConfigSet(interaction);
      return true;
    }
  }
  return false;
}

module.exports = { commands, handle };
