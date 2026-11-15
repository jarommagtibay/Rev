// Ticket embed fields, buttons, receipt, and shared ticket creation helpers
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { COLOR, CURRENCY, RECEIPT_CHANNEL_ID, STAFF_ROLE_ID, CATEGORY_ID } = require('../config');
const client = require('./client');
const M = require('../messages');
const { baseName, fill } = require('./helpers');

// Big headline at the top of the order card: what was bought + the price, large and easy to see.
// Only decoration: nothing in the bot reads the description, the fields below stay the real data.
// itemText e.g. "1,000 Robux" or "Mobile Legends  •  112 Diamonds", priceText e.g. "₱117"
function orderHeadline(itemText, priceText, icon = '💎') {
  return `### ${icon}  ${itemText}\n## ${priceText}\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
}

function setPositionField(embed, value) {
  const fields = (embed.data.fields || []).filter((f) => f.name !== 'Queue Position');
  // Put it right after the Price field
  const priceIndex = fields.findIndex((f) => f.name === 'Price');
  const field = { name: 'Queue Position', value, inline: true };
  if (priceIndex === -1) fields.push(field);
  else fields.splice(priceIndex + 1, 0, field);
  embed.setFields(fields);
}

function setStatusField(embed, value) {
  const fields = (embed.data.fields || []).filter((f) => f.name !== 'Status');
  const field = { name: 'Status', value };
  const vouchIndex = fields.findIndex((f) => f.name === 'Vouch');
  if (vouchIndex === -1) fields.push(field);
  else fields.splice(vouchIndex, 0, field);
  embed.setFields(fields);
}

function stageFromEmbed(embed) {
  const status = ((embed.data.fields || []).find((f) => f.name === 'Status') || {}).value || '';
  if (status.startsWith('Completed')) return 'completed';
  if (status.startsWith('Sent')) return 'sent';
  if (status.startsWith('Processing')) return 'processing';
  return 'open';
}

function isVouched(embed) {
  return (embed.data.fields || []).some((f) => f.name === 'Vouch');
}

function isPaid(embed) {
  return (embed.data.fields || []).some((f) => f.name === 'Payment');
}

// true for Robux orders, false for game credit orders (ML / HOK / CODM)
function isRobuxOrder(embed) {
  return (embed.data.fields || []).some((f) => f.name === 'Robux Amount');
}

// Adds the Payment field (kept before Status and Vouch)
function setPaymentField(embed, value) {
  const fields = (embed.data.fields || []).filter((f) => f.name !== 'Payment');
  const field = { name: 'Payment', value };
  let index = fields.findIndex((f) => f.name === 'Status');
  if (index === -1) index = fields.findIndex((f) => f.name === 'Vouch');
  if (index === -1) fields.push(field);
  else fields.splice(index, 0, field);
  embed.setFields(fields);
}

function getAmount(embed) {
  const field = (embed.data.fields || []).find((f) => f.name === 'Robux Amount');
  return field ? Number(field.value.replace(/,/g, '')) : 0;
}

// Buttons shown in the ticket depending on the order stage
// paid = true once staff marked the payment as received (hides that button)
// canEdit = false for game orders (no Edit Order button)
function ticketRows(stage, paid, canEdit = true) {
  const btn = (id, label, style) =>
    new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

  // After the order is completed only Close remains
  if (stage === 'completed') {
    return [new ActionRowBuilder().addComponents(btn('close_ticket', 'Close Ticket', ButtonStyle.Danger))];
  }

  // After the order is sent: Complete (staff) or Close
  if (stage === 'sent') {
    return [
      new ActionRowBuilder().addComponents(
        btn('complete_order', 'Complete Order (Staff)', ButtonStyle.Danger),
        btn('close_ticket', 'Close Ticket', ButtonStyle.Danger)
      ),
    ];
  }

  const staffButtons = [];
  if (!paid) staffButtons.push(btn('payment_received', 'Payment Received', ButtonStyle.Danger));
  staffButtons.push(
    btn('order_processing', 'Processing', ButtonStyle.Danger),
    btn('order_sent', 'Sent', ButtonStyle.Danger)
  );
  if (canEdit) staffButtons.push(btn('edit_order', 'Edit Order', ButtonStyle.Danger));
  staffButtons.push(btn('complete_order', 'Complete Order (Staff)', ButtonStyle.Danger));

  return [
    new ActionRowBuilder().addComponents(staffButtons),
    new ActionRowBuilder().addComponents(btn('close_ticket', 'Close Ticket', ButtonStyle.Danger)),
  ];
}

// The Vouch button is sent as a NEW message at the bottom of the ticket.
// mainMessageId is the id of the main ticket message (the order embed).
function vouchRow(mainMessageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vouch:${mainMessageId}`)
      .setLabel('Vouch')
      .setStyle(ButtonStyle.Danger)
  );
}

// Posts a receipt of a completed order in the receipt channel (if RECEIPT_CHANNEL_ID is set)
async function postReceipt(embed, ticketChannel) {
  if (!RECEIPT_CHANNEL_ID) return;
  try {
    const get = (name) =>
      ((embed.data.fields || []).find((f) => f.name === name) || {}).value || '-';

    let fields;
    if (isRobuxOrder(embed)) {
      fields = [
        { name: 'Customer', value: get('Opened by'), inline: true },
        { name: 'Account Name', value: get('Account Name'), inline: true },
        { name: 'Account Username', value: get('Account Username'), inline: true },
        { name: 'Robux Amount', value: get('Robux Amount'), inline: true },
        { name: 'Price', value: get('Price'), inline: true },
        { name: 'Ticket', value: baseName(ticketChannel.name), inline: true },
        { name: 'Payment', value: get('Payment') },
        { name: 'Status', value: get('Status') },
      ];
    } else {
      // Game order: Game, Package, Price and the ID fields are copied as they are
      const skip = new Set(['Opened by', 'Queue Position', 'Payment', 'Status', 'Vouch']);
      const details = (embed.data.fields || [])
        .filter((f) => !skip.has(f.name))
        .map((f) => ({ name: f.name, value: f.value, inline: true }));
      fields = [
        { name: 'Customer', value: get('Opened by'), inline: true },
        ...details,
        { name: 'Ticket', value: baseName(ticketChannel.name), inline: true },
        { name: 'Payment', value: get('Payment') },
        { name: 'Status', value: get('Status') },
      ];
    }

    const receipt = new EmbedBuilder()
      .setTitle('Order Receipt')
      .setColor(COLOR)
      .addFields(fields)
      .setTimestamp();

    const receiptChannel = await client.channels.fetch(RECEIPT_CHANNEL_ID);
    await receiptChannel.send({ embeds: [receipt] });
  } catch (err) {
    console.error('Could not post receipt:', err);
  }
}

// ---------- Shared by every buying flow (Roblox and games) ----------
function makeSafeName(user) {
  return (
    user.username
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 20) || 'user'
  );
}

// Creates the private ticket channel (customer + staff + bot only)
async function createTicketChannel(interaction, position, safeName) {
  return interaction.guild.channels.create({
    name: `queue-${position}-${safeName}`,
    type: ChannelType.GuildText,
    parent: CATEGORY_ID || null,
    topic: `ticket:${interaction.user.id}`,
    permissionOverwrites: [
      {
        id: interaction.guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
      },
      {
        id: STAFF_ROLE_ID,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ManageChannels,
        ],
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
    ],
  });
}

// Payment message with one button per payee (each button shows that QR)
// priceText e.g. "₱117", itemText e.g. "112 Diamonds (Mobile Legends)"
async function sendPaymentMessage(channel, priceText, itemText) {
  try {
    const payEmbed = new EmbedBuilder()
      .setTitle('💳  ' + fill(M.payment.title))
      .setColor(COLOR)
      .setDescription(
        `You need to pay\n## ${priceText}\nfor **${itemText}**\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
          'Staff will send you the QR code here. Once you have paid, send your receipt in this ticket.\n\n' +
          '> 🧾  **No receipt = no process!**\n' +
          '> ⚠️  **For force refund, 30% of the total will be deducted.**'
      )
      .setFooter({ text: 'Tap a button below to see the payment QR' });

    const payRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('pay_hixsly')
        .setLabel('Pay to Hixsly')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('pay_ysha')
        .setLabel('Pay to Ysha')
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({ embeds: [payEmbed], components: [payRow] });
  } catch (err) {
    console.error('Could not send payment message:', err);
  }
}

module.exports = {
  orderHeadline,
  setPositionField,
  setStatusField,
  stageFromEmbed,
  isVouched,
  isPaid,
  isRobuxOrder,
  setPaymentField,
  getAmount,
  ticketRows,
  vouchRow,
  postReceipt,
  makeSafeName,
  createTicketChannel,
  sendPaymentMessage,
};
