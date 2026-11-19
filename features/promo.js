// /promo -> Staff can create, remove, and list promo discount codes
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLOR, CURRENCY } = require('../config');
const { data, saveData, formatPeso } = require('../core/data');
const { EPHEMERAL, isStaff } = require('../core/helpers');

const commands = [
  new SlashCommandBuilder()
    .setName('promo')
    .setDescription('Staff only: manage promotional discount codes')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a promo code')
        .addStringOption((o) =>
          o.setName('code').setDescription('Promo code text (e.g. REV50)').setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Discount type (peso off or percent off)')
            .setRequired(true)
            .addChoices(
              { name: `Fixed Pesos Off (${CURRENCY})`, value: 'fixed' },
              { name: 'Percentage Off (%)', value: 'percent' }
            )
        )
        .addNumberOption((o) =>
          o.setName('value').setDescription('Discount amount (e.g. 50 for ₱50, 10 for 10%)').setRequired(true).setMinValue(1)
        )
        .addIntegerOption((o) =>
          o.setName('uses').setDescription('Maximum number of uses (optional, default unlimited)').setRequired(false).setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete an existing promo code')
        .addStringOption((o) =>
          o.setName('code').setDescription('The code to delete').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List all active promo codes')
    ),
];

async function handle(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'promo') {
    return false;
  }

  if (!isStaff(interaction.member)) {
    await interaction.reply({
      content: 'Only staff can manage promo codes.',
      flags: EPHEMERAL,
    });
    return true;
  }

  const sub = interaction.options.getSubcommand();
  if (!Array.isArray(data.promos)) data.promos = [];

  if (sub === 'create') {
    const code = interaction.options.getString('code').trim().toUpperCase();
    const type = interaction.options.getString('type');
    const value = interaction.options.getNumber('value');
    const maxUses = interaction.options.getInteger('uses') || 0; // 0 = unlimited

    const existingIdx = data.promos.findIndex((p) => p.code === code);
    const promoObj = {
      code,
      type,
      value,
      maxUses,
      usedCount: 0,
      createdBy: interaction.user.username,
      createdAt: Date.now(),
    };

    if (existingIdx >= 0) {
      data.promos[existingIdx] = promoObj;
    } else {
      data.promos.push(promoObj);
    }
    saveData();

    const desc = type === 'fixed' ? `${formatPeso(value)} off` : `${value}% off`;
    const useText = maxUses > 0 ? `${maxUses} total uses` : 'Unlimited uses';

    await interaction.reply({
      content: `✅ Promo code **${code}** created! Value: **${desc}** (${useText}).`,
      flags: EPHEMERAL,
    });
    return true;
  }

  if (sub === 'delete') {
    const code = interaction.options.getString('code').trim().toUpperCase();
    const initialLen = data.promos.length;
    data.promos = data.promos.filter((p) => p.code !== code);

    if (data.promos.length === initialLen) {
      await interaction.reply({
        content: `⚠️ Promo code **${code}** was not found.`,
        flags: EPHEMERAL,
      });
      return true;
    }

    saveData();
    await interaction.reply({
      content: `🗑️ Promo code **${code}** deleted.`,
      flags: EPHEMERAL,
    });
    return true;
  }

  if (sub === 'list') {
    if (data.promos.length === 0) {
      await interaction.reply({
        content: '🏷️ No active promo codes currently configured.',
        flags: EPHEMERAL,
      });
      return true;
    }

    const lines = data.promos.map((p, idx) => {
      const discount = p.type === 'fixed' ? `${formatPeso(p.value)} off` : `${p.value}% off`;
      const uses = p.maxUses > 0 ? `${p.usedCount}/${p.maxUses} uses` : `${p.usedCount} used (unlimited)`;
      return `**${idx + 1}.** \`${p.code}\` — **${discount}** • ${uses} (by @${p.createdBy})`;
    });

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(`🏷️  Active Promo Codes (${data.promos.length})`)
      .setDescription(lines.join('\n\n'))
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
    return true;
  }

  return false;
}

// Helper to validate and calculate discount on an amount
function applyPromoDiscount(codeStr, originalPrice) {
  if (!codeStr || !Array.isArray(data.promos)) return { price: originalPrice, discount: 0, promo: null };
  const cleanCode = codeStr.trim().toUpperCase();
  const promo = data.promos.find((p) => p.code === cleanCode);
  if (!promo) return { price: originalPrice, discount: 0, promo: null, error: 'Invalid promo code.' };

  if (promo.maxUses > 0 && promo.usedCount >= promo.maxUses) {
    return { price: originalPrice, discount: 0, promo: null, error: 'This promo code has reached its maximum uses.' };
  }

  let discount = 0;
  if (promo.type === 'fixed') {
    discount = Math.min(originalPrice, promo.value);
  } else if (promo.type === 'percent') {
    discount = Math.round((originalPrice * promo.value) / 100);
  }

  const finalPrice = Math.max(0, originalPrice - discount);
  return { price: finalPrice, discount, promo };
}

module.exports = { commands, handle, applyPromoDiscount };
