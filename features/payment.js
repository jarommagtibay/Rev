// Payment: Payment Received button, /paymentreceived, and the Pay to ... QR buttons
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLOR, QR_FILES, QR_NAMES, QR_DETAILS } = require('../config');
const M = require('../messages');
const { data, formatPeso, orderPriceText } = require('../core/data');
const { EPHEMERAL, isStaff } = require('../core/helpers');
const { markPaymentReceived, runOrderCommand } = require('../core/orderActions');

const commands = [
  new SlashCommandBuilder()
    .setName(M.commandNames.paymentreceived)
    .setDescription('Staff only: mark the payment of this ticket as received'),
];

// Payment Received button -> staff only
async function paymentReceivedButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can use this button.',
      flags: EPHEMERAL,
    });
  }

  await interaction.deferUpdate();
  const result = await markPaymentReceived(
    interaction.message,
    interaction.channel,
    interaction.user
  );
  await interaction.followUp({
    content: result.error || '✅ Payment marked as received.',
    flags: EPHEMERAL,
  });
}

// Pay buttons -> staff only, posts the QR of the chosen payee in the ticket
async function payButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can send the payment QR.',
      flags: EPHEMERAL,
    });
  }

  const key = interaction.customId.replace('pay_', '');
  const file = QR_FILES[key];

  if (!file) {
    return interaction.reply({ content: 'That payee is not set up anymore.', flags: EPHEMERAL });
  }
  if (!fs.existsSync(file)) {
    console.warn(`${path.basename(file)} not found.`);
    return interaction.reply({
      content: `The QR for ${QR_NAMES[key]} is not available right now. Please tell staff.`,
      flags: EPHEMERAL,
    });
  }

  const entry = data.queue.find((e) => e.channelId === interaction.channel.id);
  let amountLine = '';
  if (entry && entry.type === 'game') {
    amountLine = `Pay\n## ${formatPeso(entry.price)}\nfor **${entry.label}** (${entry.gameName})\n\n`;
  } else if (entry) {
    amountLine = `Pay\n## ${orderPriceText(entry)}\nfor **${entry.amount.toLocaleString()} Robux**\n\n`;
  }

  const qrName = path.basename(file); // keeps the real file name, so .jpg QR files work too
  const details = QR_DETAILS && QR_DETAILS[key];
  const copyLine = details
    ? `\n\n📱 **Account / GCash (tap to copy on mobile):**\n\`\`\`\n${details}\n\`\`\``
    : '';

  const qrEmbed = new EmbedBuilder()
    .setTitle(`💳  Pay to ${QR_NAMES[key]}`)
    .setColor(COLOR)
    .setDescription(`${amountLine}Send your receipt in this ticket.\n> 🧾  **No receipt = no process!**${copyLine}`)
    .setImage(`attachment://${qrName}`);

  return interaction.reply({
    embeds: [qrEmbed],
    files: [new AttachmentBuilder(file, { name: qrName })],
  });
}

async function handle(interaction) {
  if (interaction.isButton() && interaction.customId === 'payment_received') {
    await paymentReceivedButton(interaction);
    return true;
  }

  // pay_<key> buttons: one per payee in config.js (PAYEES)
  if (
    interaction.isButton() &&
    interaction.customId.startsWith('pay_') &&
    Object.prototype.hasOwnProperty.call(QR_FILES, interaction.customId.slice(4))
  ) {
    await payButton(interaction);
    return true;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === M.commandNames.paymentreceived) {
    await runOrderCommand(interaction);
    return true;
  }

  return false;
}

module.exports = { commands, handle };
