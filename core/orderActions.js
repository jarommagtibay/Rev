// Order actions shared by the buttons and the slash commands:
// payment received, processing, sent (with proof picture)
const path = require('path');
const {
  AttachmentBuilder,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
} = require('discord.js');
const { COLOR } = require('../config');
const { data, saveData, formatPrice, formatPeso, recordStaffAction, recordCompletionDuration, recordCompletedOrder } = require('./data');
const M = require('../messages');
const {
  EPHEMERAL,
  isStaff,
  ticketMessage,
  fromTemplate,
  getCustomerId,
  baseName,
  tryLock,
  safeRenameChannel,
} = require('./helpers');
const {
  orderHeadline,
  setPositionField,
  setStatusField,
  stageFromEmbed,
  isPaid,
  setPaymentField,
  setPaymentProgressField,
  getAmount,
  isRobuxOrder,
  ticketRows,
  vouchRow,
} = require('./ticket');
const { addUnvouchedBuyer } = require('./unvouched');
const { refreshQueue, removeFromQueue } = require('./queue');
const { checkStockAlerts } = require('../features/stock');

const PAYMENT_REQUIRED_MESSAGE =
  '⚠️ Payment has not been marked as received yet! Please verify the payment and click **Payment Received** first.';
const BUSY_MESSAGE = 'Another staff member is updating this order right now. Please try again in a moment.';

// Runs one order action while holding the ticket's lock. The ticket message is read again inside the
// lock, because the copy that came with a button click can be a few seconds old.
async function withOrderLock(channel, message, action) {
  const release = tryLock(`order:${channel.id}`);
  if (!release) return { error: BUSY_MESSAGE };
  try {
    let fresh = message;
    try {
      fresh = await channel.messages.fetch({ message: message.id, force: true });
    } catch {
      // keep the copy we have
    }
    return await action(fresh);
  } finally {
    release();
  }
}

// message = the main ticket message (the order embed)
async function markPaymentReceivedUnlocked(message, channel, user) {
  const embed = EmbedBuilder.from(message.embeds[0]);
  const stage = stageFromEmbed(embed);
  if (stage === 'completed') {
    return { error: 'This order is already completed.' };
  }
  if (isPaid(embed)) {
    return { error: 'The payment was already marked as received.' };
  }

  setPaymentField(embed, `Received by ${user}`);
  const entry = data.queue.find((e) => e.channelId === channel.id);
  if (entry) {
    entry.paidAt = Date.now();
    if (entry.price > 0 && entry.amountPaid > 0 && entry.amountPaid < entry.price) {
      entry.amountPaid = entry.price;
      setPaymentProgressField(embed, entry.amountPaid, entry.price, (entry.payments && entry.payments.length) || 1);
    }
    saveData();
  }
  await message.edit({
    embeds: [embed],
    components: ticketRows(stage, true, isRobuxOrder(embed), Boolean(entry && entry.onHold)),
  });

  await channel.send(
    ticketMessage('paymentReceived', {
      userId: getCustomerId(channel),
      ...fromTemplate(M.paymentReceived, { staff: user.username }),
    })
  );
  return {};
}

async function markProcessingUnlocked(message, channel, user) {
  const embed = EmbedBuilder.from(message.embeds[0]);
  const stage = stageFromEmbed(embed);
  if (stage === 'sent' || stage === 'completed') {
    return { error: 'This order was already sent.' };
  }

  setStatusField(embed, `Processing by ${user}`);
  recordStaffAction(user.id, user.username, 'processed');
  const entry = data.queue.find((e) => e.channelId === channel.id);
  if (entry) {
    entry.processingAt = Date.now();
    saveData();
  }
  await message.edit({
    embeds: [embed],
    components: ticketRows('processing', isPaid(embed), isRobuxOrder(embed), Boolean(entry && entry.onHold)),
  });

  await channel.send(
    ticketMessage('processing', {
      userId: getCustomerId(channel),
      ...fromTemplate(M.processing, { staff: user.username }),
    })
  );
  return {};
}

// The queue entry holds the real amount and price (Edit Order saves it there). If the order message still
// shows an older amount, fix it, so the stock, the ticket and the receipt all use the same number.
function syncOrderAmount(embed, amount, price) {
  const priceText = price !== undefined ? formatPeso(price) : formatPrice(amount);
  const fields = (embed.data.fields || []).map((f) => {
    if (f.name === 'Robux Amount') return { ...f, value: amount.toLocaleString() };
    if (f.name === 'Price') return { ...f, value: priceText };
    return f;
  });
  embed.setFields(fields);
  embed.setDescription(orderHeadline(`${amount.toLocaleString()} Robux`, priceText));
}

// Deducts the stock, takes the order out of the queue and posts the Vouch button
async function markSentUnlocked(message, channel, guild, user, proof) {
  const embed = EmbedBuilder.from(message.embeds[0]);
  const stage = stageFromEmbed(embed);
  if (stage === 'sent' || stage === 'completed') {
    return { error: 'This order was already marked as sent.' };
  }

  // Ensure payment has been confirmed before allowing staff to mark as sent
  if (!isPaid(embed)) {
    return { error: PAYMENT_REQUIRED_MESSAGE };
  }

  // Only Robux orders use the Robux stock. Game orders (ML / HOK / CODM) skip it.
  const robux = isRobuxOrder(embed);
  let amount = getAmount(embed);
  const entry = data.queue.find((e) => e.channelId === channel.id);
  if (robux && entry && entry.amount > 0 && entry.amount !== amount) {
    amount = entry.amount;
    syncOrderAmount(embed, amount, entry.price);
  }
  if (robux && amount > data.stock) {
    return {
      error: `Not enough stock to send this order. Stock is **${data.stock.toLocaleString()}**, order needs **${amount.toLocaleString()}**. Update it with \`/${M.commandNames.setup}\`.`,
    };
  }

  if (robux) data.stock -= amount;
  if (entry) {
    entry.sentAt = Date.now();
    if (entry.paidAt) {
      const durationMins = (entry.sentAt - entry.paidAt) / (1000 * 60);
      recordCompletionDuration(durationMins);
    }
    const loggedOrderId = recordCompletedOrder({
      orderId: entry.orderId,
      channelId: channel.id,
      userId: entry.userId,
      type: entry.type || 'robux',
      amount: entry.amount || 0,
      price: entry.price || 0,
      gameName: entry.gameName || 'Roblox',
      label: entry.label || `${entry.amount} Robux`,
      username: entry.username || '',
      staff: user.username,
      staffId: user.id,
      sentAt: entry.sentAt,
      paidAt: entry.paidAt,
    });
    addUnvouchedBuyer(entry.userId, entry.username, entry.orderId || loggedOrderId, channel.id);
  }
  removeFromQueue(channel.id);
  recordStaffAction(user.id, user.username, 'sent');
  recordStaffAction(user.id, user.username, 'completed');
  saveData();

  if (robux) {
    checkStockAlerts(data.stock).catch(() => {});
  }

  setPositionField(embed, 'Sent');
  setStatusField(embed, `Sent by ${user}`);
  await message.edit({ embeds: [embed], components: ticketRows('sent') });

  // Rename the ticket to sent-username
  safeRenameChannel(channel, `sent-${baseName(channel.name)}`);

  // Order sent message (text inside the embed, proof picture under it),
  // then a new message at the bottom with the Vouch button
  const sentOptions = {
    userId: getCustomerId(channel),
    ...fromTemplate(M.sent, { staff: user.username, item: robux ? 'Robux' : 'order' }),
  };

  const proofs = Array.isArray(proof) ? proof : proof ? [proof] : [];

  if (proofs.length) {
    const proofName = (idx, ext) => (proofs.length === 1 ? `proof${ext}` : `proof-${idx + 1}${ext}`);
    sentOptions.extraFiles = proofs.map((p, idx) => {
      const ext = (path.extname(p.name || '') || '.png').toLowerCase();
      return new AttachmentBuilder(p.url, { name: proofName(idx, ext) });
    });
    sentOptions.extraEmbeds = proofs.map((p, idx) => {
      const ext = (path.extname(p.name || '') || '.png').toLowerCase();
      const b = new EmbedBuilder().setColor(COLOR).setImage(`attachment://${proofName(idx, ext)}`);
      if (idx === 0) b.setTitle(M.sent.proofTitle);
      return b;
    });
  }

  try {
    await channel.send(ticketMessage('sent', sentOptions));
  } catch (err) {
    // If the proof picture could not be re-uploaded, link it directly instead (no uploads)
    console.error('Could not upload the proof picture:', err);
    await channel.send(
      ticketMessage(null, {
        userId: sentOptions.userId,
        title: sentOptions.title,
        text: sentOptions.text,
        footer: sentOptions.footer,
        extraEmbeds: proofs.map((p, idx) => {
          const b = new EmbedBuilder().setColor(COLOR).setImage(p.url);
          if (idx === 0) b.setTitle(M.sent.proofTitle);
          return b;
        }),
      })
    );
  }
  await channel.send(
    ticketMessage('vouch', {
      ...fromTemplate(M.vouchPrompt),
      components: [vouchRow(message.id)],
    })
  );

  // Move everyone else up
  await refreshQueue(guild);
  return {};
}

// The three actions staff can take on an order. Each one holds the ticket's lock (see withOrderLock).
function markPaymentReceived(message, channel, user) {
  return withOrderLock(channel, message, (m) => markPaymentReceivedUnlocked(m, channel, user));
}
function markProcessing(message, channel, user) {
  return withOrderLock(channel, message, (m) => markProcessingUnlocked(m, channel, user));
}
function markSent(message, channel, guild, user, proof) {
  return withOrderLock(channel, message, (m) => markSentUnlocked(m, channel, guild, user, proof));
}

// Popup where staff attach the proof picture(s) when marking an order as sent
function buildSentModal() {
  const upload = new FileUploadBuilder().setCustomId('proof').setRequired(true);
  if (typeof upload.setMinValues === 'function') upload.setMinValues(1);
  if (typeof upload.setMaxValues === 'function') upload.setMaxValues(10);

  const label = new LabelBuilder()
    .setLabel('Proof of delivery')
    .setDescription('Attach picture(s) showing the order was sent to the account')
    .setFileUploadComponent(upload);

  return new ModalBuilder()
    .setCustomId('sent_form')
    .setTitle('Mark Order as Sent')
    .addLabelComponents(label);
}

// Used by the Sent button and the /sent command (staff check is done before calling this)
async function showSentModal(interaction) {
  const entry = data.queue.find((e) => e.channelId === interaction.channel.id);
  if (!entry) {
    return interaction.reply({
      content: 'This order is not in the queue anymore (it may already be sent or completed).',
      flags: EPHEMERAL,
    });
  }

  if (entry.type !== 'game' && entry.amount > data.stock) {
    return interaction.reply({
      content: `Not enough stock to send this order. Stock is **${data.stock.toLocaleString()}**, order needs **${entry.amount.toLocaleString()}**. Update it with \`/${M.commandNames.setup}\`.`,
      flags: EPHEMERAL,
    });
  }

  // Check the payment BEFORE the popup opens, so staff don't attach proof pictures just to be rejected.
  // (markSent checks again when the popup is submitted.)
  try {
    const mainMessage =
      interaction.isButton() && interaction.message.id === entry.messageId
        ? interaction.message
        : await interaction.channel.messages.fetch({ message: entry.messageId });
    if (!isPaid(EmbedBuilder.from(mainMessage.embeds[0]))) {
      return interaction.reply({ content: PAYMENT_REQUIRED_MESSAGE, flags: EPHEMERAL });
    }
  } catch (err) {
    // could not read the ticket message: let markSent do the check
  }

  // Older discord.js versions can't show a file upload popup: mark as sent without proof
  if (!FileUploadBuilder || !LabelBuilder) {
    console.warn('This discord.js version has no file upload popup. Run: npm install discord.js@latest');
    await interaction.deferReply({ flags: EPHEMERAL });
    const message = await interaction.channel.messages.fetch({ message: entry.messageId, force: true });
    const result = await markSent(message, interaction.channel, interaction.guild, interaction.user, null);
    return interaction.editReply(
      result.error || 'Order marked as sent. (No proof popup: discord.js needs updating.)'
    );
  }

  return interaction.showModal(buildSentModal());
}

// Handles /paymentreceived, /processing and /sent (staff only, inside a ticket channel)
async function runOrderCommand(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can use this command.',
      flags: EPHEMERAL,
    });
  }

  if (!(interaction.channel.topic || '').startsWith('ticket:')) {
    return interaction.reply({
      content: 'This command only works inside a ticket channel.',
      flags: EPHEMERAL,
    });
  }

  // /sent opens the proof popup (a popup must be the first response)
  if (interaction.commandName === M.commandNames.sent) {
    return showSentModal(interaction);
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  const entry = data.queue.find((e) => e.channelId === interaction.channel.id);
  if (!entry) {
    return interaction.editReply(
      'This order is not in the queue anymore (it may already be sent or completed).'
    );
  }

  const message = await interaction.channel.messages.fetch({ message: entry.messageId, force: true });
  const cmd = interaction.commandName;

  let result;
  let doneText;
  if (cmd === M.commandNames.paymentreceived) {
    result = await markPaymentReceived(message, interaction.channel, interaction.user);
    doneText = '✅ Payment marked as received.';
  } else {
    result = await markProcessing(message, interaction.channel, interaction.user);
    doneText = '⏳ Order marked as processing.';
  }

  return interaction.editReply(result.error || doneText);
}

module.exports = {
  PAYMENT_REQUIRED_MESSAGE,
  BUSY_MESSAGE,
  syncOrderAmount,
  markPaymentReceived,
  markProcessing,
  markSent,
  showSentModal,
  runOrderCommand,
};