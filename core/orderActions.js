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
const { data, saveData, formatPrice } = require('./data');
const M = require('../messages');
const {
  EPHEMERAL,
  isStaff,
  ticketMessage,
  fromTemplate,
  getCustomerId,
  baseName,
} = require('./helpers');
const {
  orderHeadline,
  setPositionField,
  setStatusField,
  stageFromEmbed,
  isPaid,
  setPaymentField,
  getAmount,
  isRobuxOrder,
  ticketRows,
  vouchRow,
} = require('./ticket');
const { refreshQueue, removeFromQueue } = require('./queue');

// message = the main ticket message (the order embed)
async function markPaymentReceived(message, channel, user) {
  const embed = EmbedBuilder.from(message.embeds[0]);
  const stage = stageFromEmbed(embed);
  if (stage === 'completed') {
    return { error: 'This order is already completed.' };
  }
  if (isPaid(embed)) {
    return { error: 'The payment was already marked as received.' };
  }

  setPaymentField(embed, `Received by ${user}`);
  await message.edit({ embeds: [embed], components: ticketRows(stage, true, isRobuxOrder(embed)) });

  await channel.send(
    ticketMessage('paymentReceived', {
      userId: getCustomerId(channel),
      ...fromTemplate(M.paymentReceived, { staff: user.username }),
    })
  );
  return {};
}

async function markProcessing(message, channel, user) {
  const embed = EmbedBuilder.from(message.embeds[0]);
  const stage = stageFromEmbed(embed);
  if (stage === 'sent' || stage === 'completed') {
    return { error: 'This order was already sent.' };
  }

  setStatusField(embed, `Processing by ${user}`);
  await message.edit({ embeds: [embed], components: ticketRows('processing', isPaid(embed), isRobuxOrder(embed)) });

  await channel.send(
    ticketMessage('processing', {
      userId: getCustomerId(channel),
      ...fromTemplate(M.processing, { staff: user.username }),
    })
  );
  return {};
}

// The queue entry holds the real amount (Edit Order saves it there). If the order message still
// shows an older amount, fix it, so the stock, the ticket and the receipt all use the same number.
function syncOrderAmount(embed, amount) {
  const fields = (embed.data.fields || []).map((f) => {
    if (f.name === 'Robux Amount') return { ...f, value: amount.toLocaleString() };
    if (f.name === 'Price') return { ...f, value: formatPrice(amount) };
    return f;
  });
  embed.setFields(fields);
  embed.setDescription(orderHeadline(`${amount.toLocaleString()} Robux`, formatPrice(amount)));
}

// Deducts the stock, takes the order out of the queue and posts the Vouch button
async function markSent(message, channel, guild, user, proof) {
  const embed = EmbedBuilder.from(message.embeds[0]);
  const stage = stageFromEmbed(embed);
  if (stage === 'sent' || stage === 'completed') {
    return { error: 'This order was already marked as sent.' };
  }

  // Only Robux orders use the Robux stock. Game orders (ML / HOK / CODM) skip it.
  const robux = isRobuxOrder(embed);
  let amount = getAmount(embed);
  const entry = data.queue.find((e) => e.channelId === channel.id);
  if (robux && entry && entry.amount > 0 && entry.amount !== amount) {
    amount = entry.amount;
    syncOrderAmount(embed, amount);
  }
  if (robux && amount > data.stock) {
    return {
      error: `Not enough stock to send this order. Stock is **${data.stock.toLocaleString()}**, order needs **${amount.toLocaleString()}**. Update it with \`/${M.commandNames.setup}\`.`,
    };
  }

  if (robux) data.stock -= amount;
  removeFromQueue(channel.id);
  saveData();

  setPositionField(embed, 'Sent');
  setStatusField(embed, `Sent by ${user}`);
  await message.edit({ embeds: [embed], components: ticketRows('sent') });

  // Rename the ticket to sent-username
  channel.setName(`sent-${baseName(channel.name)}`).catch(() => { });

  // Order sent message (text inside the embed, proof picture under it),
  // then a new message at the bottom with the Vouch button
  const sentOptions = {
    userId: getCustomerId(channel),
    ...fromTemplate(M.sent, { staff: user.username, item: robux ? 'Robux' : 'order' }),
  };

  if (proof) {
    const ext = (path.extname(proof.name || '') || '.png').toLowerCase();
    const proofName = `proof${ext}`;
    sentOptions.extraEmbeds = [
      new EmbedBuilder()
        .setTitle(M.sent.proofTitle)
        .setColor(COLOR)
        .setImage(`attachment://${proofName}`),
    ];
    sentOptions.extraFiles = [new AttachmentBuilder(proof.url, { name: proofName })];
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
        extraEmbeds: proof
          ? [new EmbedBuilder().setTitle(M.sent.proofTitle).setColor(COLOR).setImage(proof.url)]
          : [],
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

// Popup where staff attach the proof picture when marking an order as sent
function buildSentModal() {
  const upload = new FileUploadBuilder().setCustomId('proof').setRequired(true);

  const label = new LabelBuilder()
    .setLabel('Proof of delivery')
    .setDescription('Attach a picture showing the order was sent to the account')
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
  syncOrderAmount,
  markPaymentReceived,
  markProcessing,
  markSent,
  showSentModal,
  runOrderCommand,
};