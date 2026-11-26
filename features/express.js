// In-ticket "Upgrade to Express" button handler
const { EmbedBuilder } = require('discord.js');
const { COLOR, CURRENCY, STAFF_ROLE_ID } = require('../config');
const { data, saveData, formatPeso, getExpressFee } = require('../core/data');
const { EPHEMERAL, isStaff, getCustomerId, tryLock } = require('../core/helpers');
const {
  orderHeadline,
  stageFromEmbed,
  isPaid,
  isRobuxOrder,
  ticketRows,
  setPaymentProgressField,
} = require('../core/ticket');
const { refreshQueue } = require('../core/queue');

const commands = [];

async function handleUpgradeExpress(interaction) {
  const channel = interaction.channel;
  const customerId = getCustomerId(channel);

  if (customerId !== interaction.user.id && !isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only the ticket buyer or staff can upgrade this order to Express.',
      flags: EPHEMERAL,
    });
  }

  const release = tryLock(`order:${channel.id}`);
  if (!release) {
    return interaction.reply({
      content: 'This ticket is being updated right now. Please try again in a moment.',
      flags: EPHEMERAL,
    });
  }

  try {
    const entry = data.queue.find((e) => e.channelId === channel.id);
    if (!entry) {
      return interaction.reply({
        content: 'This order is no longer active in the queue.',
        flags: EPHEMERAL,
      });
    }
    if (entry.isExpress) {
      return interaction.reply({
        content: '⚡ This order is already on the Express queue!',
        flags: EPHEMERAL,
      });
    }

    const mainMsg = await channel.messages.fetch({ message: entry.messageId, force: true }).catch(() => null);
    if (!mainMsg || mainMsg.embeds.length === 0) {
      return interaction.reply({
        content: 'Could not find the main order card to update.',
        flags: EPHEMERAL,
      });
    }

    const embed = EmbedBuilder.from(mainMsg.embeds[0]);
    const stage = stageFromEmbed(embed);
    if (stage === 'sent' || stage === 'completed') {
      return interaction.reply({
        content: 'This order has already been sent or completed and cannot be upgraded.',
        flags: EPHEMERAL,
      });
    }

    await interaction.deferReply({ flags: EPHEMERAL });

    const fee = getExpressFee();
    const oldPrice = Number(entry.price) || 0;
    const newPrice = Number((oldPrice + fee).toFixed(2));
    entry.isExpress = true;
    entry.price = newPrice;
    saveData();

    const itemLabel =
      entry.type === 'game'
        ? `${entry.gameName}  •  ${entry.label}`
        : `${(entry.amount || 0).toLocaleString()} Robux`;
    const icon = entry.type === 'game' ? '🎮' : '💎';
    embed.setDescription(orderHeadline(itemLabel, formatPeso(newPrice), icon));

    const fields = [...(embed.data.fields || [])];
    const priceIdx = fields.findIndex((f) => f.name === 'Price');
    if (priceIdx !== -1) {
      const existing = fields[priceIdx].value || '';
      const suffixMatch = existing.match(/(\s*\([^)]+\).*)$/);
      const existingNotes = suffixMatch ? suffixMatch[1] : '';
      fields[priceIdx] = {
        ...fields[priceIdx],
        value: `${formatPeso(newPrice)}${existingNotes} (+${CURRENCY}${fee} Express)`,
      };
    }

    if (!fields.some((f) => f.name === '⚡  Priority Level')) {
      fields.push({
        name: '⚡  Priority Level',
        value: `**VIP EXPRESS QUEUE (+${CURRENCY}${fee})** — Upgraded in-ticket!`,
        inline: false,
      });
    }
    embed.setFields(fields);

    if (entry.amountPaid > 0) {
      setPaymentProgressField(
        embed,
        entry.amountPaid,
        newPrice,
        (entry.payments && entry.payments.length) || 1
      );
    }

    const paid = isPaid(embed);
    await mainMsg.edit({
      embeds: [embed],
      components: ticketRows(stage, paid, isRobuxOrder(embed), Boolean(entry.onHold), true),
    });

    await refreshQueue(interaction.guild);

    const remaining = Math.max(0, newPrice - (Number(entry.amountPaid) || 0));
    const payNote =
      paid || remaining <= 0.01
        ? `Please make sure the **+${CURRENCY}${fee}** Express fee is settled with staff.`
        : `New Total: **${formatPeso(newPrice)}** *(Remaining: **${CURRENCY}${remaining.toFixed(2)}**)* — please include the **+${CURRENCY}${fee}** Express fee in your payment.`;

    const staffPing = STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}> ` : '';
    await channel.send({
      content: `${customerId ? `<@${customerId}> ` : ''}${staffPing}`,
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('⚡  Upgraded to VIP Express Queue!')
          .setDescription(
            `${interaction.user} upgraded this order to **Express Priority (+${CURRENCY}${fee})**.\n` +
              `Your ticket has been moved up to the Express queue!\n\n${payNote}`
          )
          .setTimestamp(),
      ],
      allowedMentions: { parse: ['users', 'roles'] },
    });

    return interaction.editReply(`⚡ Upgraded to Express! New total: **${formatPeso(newPrice)}**.`);
  } finally {
    release();
  }
}

async function handle(interaction) {
  if (interaction.isButton() && interaction.customId === 'upgrade_express') {
    await handleUpgradeExpress(interaction);
    return true;
  }
  return false;
}

module.exports = { commands, handle };
