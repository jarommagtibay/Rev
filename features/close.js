// Closing tickets (staff only): /closeticket and the Close Ticket button
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLOR } = require('../config');
const client = require('../core/client');
const M = require('../messages');
const { data, formatPeso, orderPriceText } = require('../core/data');
const { EPHEMERAL, isStaff, fromTemplate, getCustomerId } = require('../core/helpers');
const { logTicketTranscript } = require('../core/audit');
const { generateReceiptCard } = require('../core/receiptCard');

const commands = [
  new SlashCommandBuilder()
    .setName(M.commandNames.closeticket)
    .setDescription('Staff only: close this ticket'),
];

function closingMessage(user) {
  const t = fromTemplate(M.closing, { user: user.username });
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(t.title)
    .setDescription(t.text)
    .setTimestamp();
  if (t.footer) embed.setFooter({ text: t.footer });
  return { embeds: [embed] };
}

async function sendCustomerDmReceipt(channel, closedByUser) {
  try {
    const customerId = getCustomerId(channel);
    if (!customerId) return;

    const customer = await client.users.fetch(customerId).catch(() => null);
    if (!customer) return;

    const entry = data.queue.find((e) => e.channelId === channel.id);
    let orderLine = 'Thank you for shopping with Revéux!';
    if (entry && entry.type === 'game') {
      orderLine = `**Product:** ${entry.label} (${entry.gameName})\n**Price:** ${formatPeso(entry.price)}`;
    } else if (entry) {
      orderLine = `**Product:** ${entry.amount.toLocaleString()} Robux\n**Price:** ${orderPriceText(entry)}`;
    }

    // If staff gave a promo code in this ticket, remind the customer
    let promoLine = '';
    if (entry && entry.givenPromo) {
      promoLine = `\n\n🎁 **Your Promo Code for Next Order:**\n\`\`\`${entry.givenPromo.code}\`\`\`**Discount:** ${entry.givenPromo.desc}\nEnter this code in the **Promo Code** field when you place your next order!`;
    }

    const orderId = (entry && entry.orderId) || 'REV-XXXX';

    const dmEmbed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(`🛍️  Revéux Shop — Order #${orderId} Completed`)
      .setDescription(
        `Hello ${customer}! Your ticket **#${channel.name}** has been closed.\n\n` +
        `**Order ID:** \`#${orderId}\`\n` +
        `${orderLine}\n\n` +
        '⭐ If you enjoyed our service, don\'t forget to leave a vouch in the server. Thank you for your support!' +
        promoLine
      )
      .setFooter({ text: `Order #${orderId} • Handled by @${closedByUser.username} • Reveux Shop` })
      .setTimestamp();

    let files = [];
    try {
      const receiptResult = await generateReceiptCard({
        orderId,
        customerName: customer.username,
        customerId: customer.id,
        customerAvatar: customer.displayAvatarURL({ extension: 'png', size: 128 }),
        productName: entry ? (entry.type === 'game' ? `${entry.label} (${entry.gameName})` : `${entry.amount.toLocaleString()} Robux`) : 'Gaming Top-Up',
        priceText: entry ? (entry.type === 'game' ? formatPeso(entry.price) : orderPriceText(entry)) : '₱0.00',
        accountInfo: entry ? (entry.name || entry.username || '-') : '-',
        gameName: entry ? (entry.gameName || 'Roblox') : 'Roblox',
        staffName: closedByUser.username,
        timestamp: Date.now(),
      });
      if (receiptResult && receiptResult.attachment) {
        files = [receiptResult.attachment];
        dmEmbed.setImage(`attachment://${receiptResult.attachment.name}`);
      }
    } catch (cardErr) {
      console.warn('Could not generate receipt image for customer DM:', cardErr);
    }

    await customer.send({ embeds: [dmEmbed], files }).catch(() => {
      // DMs closed or blocked, ignore safely
    });
  } catch (err) {
    console.error('Could not send DM receipt:', err);
  }
}

// Executes close: sends closing message, archives transcript to AUDIT_CHANNEL_ID, sends DM receipt, and deletes channel
async function executeClose(interaction) {
  await interaction.reply(closingMessage(interaction.user));

  // Send DM receipt to customer & archive transcript in the background
  sendCustomerDmReceipt(interaction.channel, interaction.user);

  try {
    await logTicketTranscript(interaction.channel, interaction.user);
  } catch (err) {
    console.error('Could not archive transcript before deletion:', err);
  }

  setTimeout(() => {
    // The channelDelete event removes it from the queue automatically
    interaction.channel.delete().catch(console.error);
  }, 4000);
}

// /closeticket -> staff only, inside a ticket channel
async function closeTicketCommand(interaction) {
  if (!(interaction.channel.topic || '').startsWith('ticket:')) {
    return interaction.reply({
      content: 'This command only works inside a ticket channel.',
      flags: EPHEMERAL,
    });
  }

  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can close tickets.',
      flags: EPHEMERAL,
    });
  }

  await executeClose(interaction);
}

// Close Ticket button -> staff only
async function closeTicketButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can close tickets.',
      flags: EPHEMERAL,
    });
  }

  await executeClose(interaction);
}

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === M.commandNames.closeticket) {
    await closeTicketCommand(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'close_ticket') {
    await closeTicketButton(interaction);
    return true;
  }

  return false;
}

module.exports = { commands, handle, executeClose };
