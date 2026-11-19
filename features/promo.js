// /promo -> Staff can create, remove, list, and give promo discount codes to customers
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLOR, CURRENCY, CATEGORY_ID } = require('../config');
const { data, saveData, formatPeso } = require('../core/data');
const { EPHEMERAL, isStaff, getCustomerId } = require('../core/helpers');

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
    )
    .addSubcommand((sub) =>
      sub
        .setName('give')
        .setDescription('Send a promo code to the customer in this ticket for their next order')
        .addStringOption((o) =>
          o.setName('code').setDescription('The promo code to give (must exist)').setRequired(true)
        )
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

  if (sub === 'give') {
    const code = interaction.options.getString('code').trim().toUpperCase();
    const promo = (data.promos || []).find((p) => p.code === code);
    if (!promo) {
      await interaction.reply({
        content: `⚠️ Promo code **${code}** does not exist. Create it first with \`/promo create\`.`,
        flags: EPHEMERAL,
      });
      return true;
    }

    // Check if used inside a ticket channel
    const parentId = interaction.channel.parentId;
    if (parentId !== CATEGORY_ID) {
      await interaction.reply({
        content: '⚠️ Use this inside a ticket channel to give the promo code to that customer.',
        flags: EPHEMERAL,
      });
      return true;
    }

    const customerId = getCustomerId(interaction.channel);
    if (!customerId) {
      await interaction.reply({
        content: '⚠️ Could not find the customer of this ticket.',
        flags: EPHEMERAL,
      });
      return true;
    }

    const desc = promo.type === 'fixed' ? `${formatPeso(promo.value)} off` : `${promo.value}% off`;

    // Post in the ticket so the customer sees it
    const promoEmbed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle('🎁  You Got a Promo Code!')
      .setDescription(
        `Thank you for your order! Here is a promo code for your **next purchase**:\n\n` +
        `\`\`\`${code}\`\`\`\n` +
        `**Discount:** ${desc}\n` +
        `Enter this code in the **Promo Code** field when you place your next order on the Buy panel.`
      )
      .setFooter({ text: 'Reveux Shop • Use it before it expires!' })
      .setTimestamp();

    await interaction.channel.send({
      content: `<@${customerId}>`,
      embeds: [promoEmbed],
      allowedMentions: { users: [customerId] },
    });

    // Also try to DM the customer so they don't lose the code
    try {
      const member = await interaction.guild.members.fetch(customerId);
      await member.send({ embeds: [promoEmbed] });
    } catch {
      // DMs might be closed, the in-channel message is enough
    }

    await interaction.reply({
      content: `✅ Promo code **${code}** (${desc}) sent to <@${customerId}> in this ticket and via DM.`,
      flags: EPHEMERAL,
    });
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
