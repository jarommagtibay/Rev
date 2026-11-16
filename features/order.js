// Order progress: Processing, Sent (with proof), Edit Order, Complete Order
const {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { CURRENCY, COLOR } = require('../config');
const M = require('../messages');
const { data, saveData, formatPrice } = require('../core/data');
const {
  EPHEMERAL,
  isStaff,
  ticketMessage,
  fromTemplate,
  fill,
  baseName,
  getCustomerId,
  parseOrderAmount,
} = require('../core/helpers');
const {
  orderHeadline,
  setPositionField,
  setStatusField,
  stageFromEmbed,
  getAmount,
  isRobuxOrder,
  ticketRows,
  vouchRow,
  postReceipt,
} = require('../core/ticket');
const { refreshQueue, removeFromQueue, availableStock, notEnoughStockMessage } = require('../core/queue');
const { updateTicketLogOrder } = require('../core/audit');
const {
  syncOrderAmount,
  markProcessing,
  markSent,
  showSentModal,
  runOrderCommand,
} = require('../core/orderActions');

const commands = [
  new SlashCommandBuilder()
    .setName(M.commandNames.processing)
    .setDescription('Staff only: mark this ticket\'s order as processing'),
  new SlashCommandBuilder()
    .setName(M.commandNames.sent)
    .setDescription('Staff only: mark this ticket\'s order as sent (attach proof picture)'),
];

// Processing button -> staff only
async function processingButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can use this button.',
      flags: EPHEMERAL,
    });
  }

  await interaction.deferUpdate();
  const result = await markProcessing(interaction.message, interaction.channel, interaction.user);
  await interaction.followUp({
    content: result.error || '⏳ Order marked as processing.',
    flags: EPHEMERAL,
  });
}

// Sent button -> staff only. Opens a popup to attach the proof picture.
async function sentButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can use this button.',
      flags: EPHEMERAL,
    });
  }

  return showSentModal(interaction);
}

// Proof popup submitted -> mark as sent (deducts stock, leaves the queue)
async function sentForm(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can mark orders as sent.',
      flags: EPHEMERAL,
    });
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  const entry = data.queue.find((e) => e.channelId === interaction.channel.id);
  if (!entry) {
    return interaction.editReply(
      'This order is not in the queue anymore (it may already be sent or completed).'
    );
  }

  const files = interaction.fields.getUploadedFiles('proof');
  const attachment = files && files.first();
  if (!attachment || !(attachment.contentType || '').startsWith('image/')) {
    return interaction.editReply(
      'Please attach a picture (PNG or JPG). Press **Sent** again and try once more.'
    );
  }

  const message = await interaction.channel.messages.fetch({ message: entry.messageId, force: true });
  const result = await markSent(
    message,
    interaction.channel,
    interaction.guild,
    interaction.user,
    { url: attachment.url, name: attachment.name }
  );

  return interaction.editReply(result.error || '📦 Order marked as sent with proof.');
}

// Edit Order button -> staff changes the Robux amount or the price
async function editOrderButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can edit orders.',
      flags: EPHEMERAL,
    });
  }

  const entry = data.queue.find((e) => e.channelId === interaction.channel.id);
  if (!entry) {
    return interaction.reply({
      content: 'This order is no longer in the queue, so it can\'t be edited.',
      flags: EPHEMERAL,
    });
  }

  if (entry.type === 'game') {
    return interaction.reply({
      content: 'Game orders can\'t be edited. Close this ticket and ask the customer to order again.',
      flags: EPHEMERAL,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('edit_order_form')
    .setTitle('Edit Order');

  const amountInput = new TextInputBuilder()
    .setCustomId('robux_amount')
    .setLabel('New Robux amount (or leave blank)')
    .setPlaceholder(`Current: ${entry.amount}`)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10);

  const priceInput = new TextInputBuilder()
    .setCustomId('price_amount')
    .setLabel(`New price in ${CURRENCY} (or leave blank)`)
    .setPlaceholder(`Current: ${formatPrice(entry.amount)}`)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10);

  modal.addComponents(
    new ActionRowBuilder().addComponents(amountInput),
    new ActionRowBuilder().addComponents(priceInput)
  );

  return interaction.showModal(modal);
}

// Edit form submitted -> update the order amount and price
async function editOrderForm(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can edit orders.',
      flags: EPHEMERAL,
    });
  }

  const entry = data.queue.find((e) => e.channelId === interaction.channel.id);
  if (!entry) {
    return interaction.reply({
      content: 'This order is no longer in the queue, so it can\'t be edited.',
      flags: EPHEMERAL,
    });
  }

  if (entry.type === 'game') {
    return interaction.reply({
      content: 'Game orders can\'t be edited. Close this ticket and ask the customer to order again.',
      flags: EPHEMERAL,
    });
  }

  const parsed = parseOrderAmount(
    interaction.fields.getTextInputValue('robux_amount'),
    interaction.fields.getTextInputValue('price_amount')
  );
  if (parsed.error) {
    return interaction.reply({ content: parsed.error, flags: EPHEMERAL });
  }
  const amount = parsed.amount;

  // Stock left after every OTHER waiting order (this order's own old amount does not count)
  const available = availableStock(interaction.channel.id);
  if (amount > available) {
    return interaction.reply({ content: notEnoughStockMessage(available), flags: EPHEMERAL });
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  const message = await interaction.channel.messages.fetch({ message: entry.messageId, force: true });
  const embed = EmbedBuilder.from(message.embeds[0]);
  const fields = (embed.data.fields || []).map((f) => {
    if (f.name === 'Robux Amount') return { ...f, value: amount.toLocaleString() };
    if (f.name === 'Price') return { ...f, value: formatPrice(amount) };
    return f;
  });
  embed.setFields(fields);
  embed.setDescription(orderHeadline(`${amount.toLocaleString()} Robux`, formatPrice(amount)));
  embed.setFooter({ text: `Rate: ${CURRENCY}${data.rate} per 100 Robux` });
  await message.edit({ embeds: [embed] });

  // Keep the first amount so the ticket log can show "originally ..."
  if (!entry.originalAmount) entry.originalAmount = entry.amount;
  entry.amount = amount;
  saveData();

  // Update the ticket log (audit channel) with the new amount (not awaited, never blocks)
  updateTicketLogOrder(entry, amount, formatPrice(amount));

  await interaction.channel.send({
    content: `<@${entry.userId}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(fill(M.orderUpdated.title))
        .setDescription(
          fill(M.orderUpdated.text, { staff: `${interaction.user}` }) +
          '\n\n' +
          orderHeadline(`${amount.toLocaleString()} Robux`, formatPrice(amount))
        )
        .setTimestamp(),
    ],
  });

  return interaction.editReply('✏️ Order updated.');
}

// Complete Order -> staff only. Deducts stock only if "Sent" was not pressed yet.
async function completeOrderButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can complete orders.',
      flags: EPHEMERAL,
    });
  }

  const embed = EmbedBuilder.from(interaction.message.embeds[0]);
  const stage = stageFromEmbed(embed);
  if (stage === 'completed') {
    return interaction.reply({
      content: 'This order is already completed.',
      flags: EPHEMERAL,
    });
  }

  let amount = getAmount(embed);
  const entry = data.queue.find((e) => e.channelId === interaction.channel.id);
  if (isRobuxOrder(embed) && entry && entry.amount > 0 && entry.amount !== amount) {
    amount = entry.amount;
    syncOrderAmount(embed, amount);
  }

  // Stock was already deducted when the order was marked as Sent
  // (only Robux orders use stock, game orders skip it)
  if (stage !== 'sent') {
    if (isRobuxOrder(embed)) {
      if (amount > data.stock) {
        return interaction.reply({
          content: `Not enough stock to complete this order. Stock is **${data.stock.toLocaleString()}**, order needs **${amount.toLocaleString()}**. Update it with \`/${M.commandNames.setup}\`.`,
          flags: EPHEMERAL,
        });
      }
      data.stock -= amount;
    }
    removeFromQueue(interaction.channel.id);
    saveData();
  }

  embed.setColor(COLOR);
  setPositionField(embed, 'Done');
  setStatusField(embed, `Completed by ${interaction.user}`);

  await interaction.update({
    embeds: [embed],
    components: ticketRows('completed'),
  });
  await interaction.followUp({
    content: '✅ Order completed.',
    flags: EPHEMERAL,
  });

  // Post the receipt in the receipt channel
  await postReceipt(embed, interaction.channel);

  // Rename the finished ticket to done-username
  interaction.channel
    .setName(`done-${baseName(interaction.channel.name)}`)
    .catch(() => { });

  const customerId = getCustomerId(interaction.channel);
  await interaction.channel.send(
    ticketMessage('thanks', {
      userId: customerId,
      ...fromTemplate(M.complete, { staff: interaction.user.username }),
    })
  );
  if (stage !== 'sent') {
    // The customer did not get the Vouch button from a Sent message yet
    await interaction.channel.send(
      ticketMessage('vouch', {
        ...fromTemplate(M.vouchReminder),
        components: [vouchRow(interaction.message.id)],
      })
    );
  }

  // Move everyone else up
  await refreshQueue(interaction.guild);
}

async function handle(interaction) {
  if (interaction.isButton()) {
    switch (interaction.customId) {
      case 'order_processing':
        await processingButton(interaction);
        return true;
      case 'order_sent':
        await sentButton(interaction);
        return true;
      case 'edit_order':
        await editOrderButton(interaction);
        return true;
      case 'complete_order':
        await completeOrderButton(interaction);
        return true;
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'sent_form') {
      await sentForm(interaction);
      return true;
    }
    if (interaction.customId === 'edit_order_form') {
      await editOrderForm(interaction);
      return true;
    }
  }

  if (
    interaction.isChatInputCommand() &&
    (interaction.commandName === M.commandNames.processing ||
      interaction.commandName === M.commandNames.sent)
  ) {
    await runOrderCommand(interaction);
    return true;
  }

  return false;
}

module.exports = { commands, handle };