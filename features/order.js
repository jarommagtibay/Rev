// Order progress: Processing, Sent (with proof), Edit Order (button + /edit command), Complete Order
const {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { CURRENCY, COLOR } = require('../config');
const M = require('../messages');
const { GAMES } = require('../catalog');
const { data, saveData, formatPrice, formatPeso } = require('../core/data');
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
const { updateTicketLogOrder, updateTicketLogGameOrder } = require('../core/audit');
const {
  syncOrderAmount,
  markProcessing,
  markSent,
  showSentModal,
  runOrderCommand,
} = require('../core/orderActions');

// Command name. You can change it in messages.js by adding  editorder: 'edit',  to commandNames.
const EDIT_COMMAND = M.commandNames.editorder || 'edit';

const commands = [
  new SlashCommandBuilder()
    .setName(M.commandNames.processing)
    .setDescription('Staff only: mark this ticket\'s order as processing'),
  new SlashCommandBuilder()
    .setName(M.commandNames.sent)
    .setDescription('Staff only: mark this ticket\'s order as sent (attach proof picture)'),
  new SlashCommandBuilder()
    .setName(EDIT_COMMAND)
    .setDescription('Staff only: edit this ticket\'s order (Robux or game credits)'),
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
  const validFiles = files ? files.filter((f) => (f.contentType || '').startsWith('image/')) : null;
  if (!validFiles || validFiles.size === 0) {
    return interaction.editReply(
      'Please attach at least one picture (PNG or JPG). Press **Sent** again and try once more.'
    );
  }

  const proofs = validFiles.map((attachment) => ({
    url: attachment.url,
    name: attachment.name,
  }));

  const message = await interaction.channel.messages.fetch({ message: entry.messageId, force: true });
  const result = await markSent(
    message,
    interaction.channel,
    interaction.guild,
    interaction.user,
    proofs
  );

  return interaction.editReply(
    result.error || `📦 Order marked as sent with ${proofs.length} proof picture${proofs.length === 1 ? '' : 's'}.`
  );
}

// Builds the Edit popup for a ticket (Robux popup or game popup).
// Used by the Edit Order button and the /edit command (staff check is done before calling this).
async function showEditModal(interaction) {
  const entry = data.queue.find((e) => e.channelId === interaction.channel.id);
  if (!entry) {
    return interaction.reply({
      content: 'This order is no longer in the queue, so it can\'t be edited.',
      flags: EPHEMERAL,
    });
  }

  // ----- Game credits order: package, price and the ID fields -----
  if (entry.type === 'game') {
    const game = GAMES[entry.game];
    if (!game) {
      return interaction.reply({
        content: 'This game is not in catalog.js anymore, so the order can\'t be edited.',
        flags: EPHEMERAL,
      });
    }

    // Same dropdown as the buy part: pick the new package, the price comes from catalog.js
    const menu = new StringSelectMenuBuilder()
      .setCustomId('edit_game_pkg')
      .setPlaceholder(`Current: ${entry.label}. Choose the new package`)
      .addOptions(
        game.packages.slice(0, 25).map((p, i) => ({
          label: p.label,
          description: formatPeso(p.price),
          value: String(i),
        }))
      );

    return interaction.reply({
      content: `**Edit ${game.name} order**\nCurrent: **${entry.label}** for **${formatPeso(entry.price)}**\nChoose the new package.`,
      components: [new ActionRowBuilder().addComponents(menu)],
      flags: EPHEMERAL,
    });
  }

  // ----- Robux order: amount or price -----
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

// Edit Order button -> staff only
async function editOrderButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can edit orders.',
      flags: EPHEMERAL,
    });
  }

  return showEditModal(interaction);
}

// New package picked in the Edit dropdown -> update the order, the ticket log and tell the customer
async function editGameSelect(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can edit orders.',
      flags: EPHEMERAL,
    });
  }

  const entry = data.queue.find((e) => e.channelId === interaction.channel.id);
  if (!entry || entry.type !== 'game') {
    return interaction.update({
      content: 'This order is no longer in the queue, so it can\'t be edited.',
      components: [],
    });
  }
  const game = GAMES[entry.game];
  const pkg = game && game.packages[Number(interaction.values[0])];
  if (!pkg) {
    return interaction.update({
      content: 'That package is not available anymore. Press Edit Order again.',
      components: [],
    });
  }

  if (pkg.label === entry.label && pkg.price === entry.price) {
    return interaction.update({ content: 'Nothing was changed (same package).', components: [] });
  }

  await interaction.deferUpdate();

  const message = await interaction.channel.messages.fetch({ message: entry.messageId, force: true });
  const embed = EmbedBuilder.from(message.embeds[0]);
  const fields = (embed.data.fields || []).map((f) => {
    if (f.name === 'Package') return { ...f, value: pkg.label };
    if (f.name === 'Price') return { ...f, value: formatPeso(pkg.price) };
    return f;
  });
  embed.setFields(fields);
  embed.setDescription(orderHeadline(`${pkg.label}  •  ${game.name}`, formatPeso(pkg.price), '🎮'));
  await message.edit({ embeds: [embed] });

  // Keep the first package so the ticket log can show "originally ..."
  if (!entry.originalLabel) {
    entry.originalLabel = entry.label;
    entry.originalPrice = entry.price;
  }
  entry.label = pkg.label;
  entry.price = pkg.price;
  saveData();

  // Update the ticket log (audit channel), not awaited, never blocks
  updateTicketLogGameOrder(
    entry,
    `${pkg.label}  •  ${game.name}`,
    formatPeso(pkg.price),
    `${entry.originalLabel} (${formatPeso(entry.originalPrice)})`
  );

  await interaction.channel.send({
    content: `<@${entry.userId}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(fill(M.orderUpdated.title))
        .setDescription(
          fill(M.orderUpdated.text, { staff: `${interaction.user}` }) +
          '\n\n' +
          orderHeadline(`${pkg.label}  •  ${game.name}`, formatPeso(pkg.price), '🎮')
        )
        .setTimestamp(),
    ],
  });

  return interaction.editReply({ content: '✏️ Order updated.', components: [] });
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
      content: 'Use the Edit Order button for game orders.',
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
  }

  // Track shop stats
  data.totalOrders = (data.totalOrders || 0) + 1;
  if (isRobuxOrder(embed) && amount > 0) {
    data.totalRobuxDelivered = (data.totalRobuxDelivered || 0) + amount;
  }
  saveData();

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

// Copy Info button -> staff only. Opens a modal popup with prefilled fields so iPhone and mobile users can easily tap and copy.
async function copyInfoButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can use this button.',
      flags: EPHEMERAL,
    });
  }

  const embed = interaction.message.embeds[0];
  const fields = embed ? embed.fields || [] : [];
  const clean = (val) => (val || '').replace(/```\n?/g, '').trim();

  const isRobux = isRobuxOrder(embed);
  const modal = new ModalBuilder()
    .setCustomId('copy_info_modal')
    .setTitle(isRobux ? 'Robux Order Details' : 'Game Order Details');

  if (isRobux) {
    const nameField = fields.find((f) => f.name === 'Account Name');
    const userField = fields.find((f) => f.name === 'Account Username');
    const name = nameField ? clean(nameField.value) : '-';
    const username = userField ? clean(userField.value) : '-';

    const nameInput = new TextInputBuilder()
      .setCustomId('copy_name')
      .setLabel('Account Name (tap to copy)')
      .setStyle(TextInputStyle.Short)
      .setValue(name)
      .setRequired(false);

    const userInput = new TextInputBuilder()
      .setCustomId('copy_username')
      .setLabel('Account Username (tap to copy)')
      .setStyle(TextInputStyle.Short)
      .setValue(username)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(userInput)
    );
  } else {
    const skip = new Set([
      'Game',
      'Package',
      'Price',
      'Queue Position',
      'Opened by',
      'Payment',
      'Status',
      'Vouch',
      'Done',
    ]);
    const detailFields = fields.filter((f) => !skip.has(f.name)).slice(0, 5); // Discord allows up to 5 inputs

    for (const f of detailFields) {
      const input = new TextInputBuilder()
        .setCustomId(`copy_${f.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`)
        .setLabel(`${f.name} (tap to copy)`.slice(0, 45))
        .setStyle(TextInputStyle.Short)
        .setValue(clean(f.value))
        .setRequired(false);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
    }
  }

  return interaction.showModal(modal);
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
      case 'copy_info':
        await copyInfoButton(interaction);
        return true;
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'copy_info_modal') {
      await interaction.reply({ content: '✅ Copied / closed.', flags: EPHEMERAL });
      return true;
    }
    if (interaction.customId === 'sent_form') {
      await sentForm(interaction);
      return true;
    }
    if (interaction.customId === 'edit_order_form') {
      await editOrderForm(interaction);
      return true;
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'edit_game_pkg') {
    await editGameSelect(interaction);
    return true;
  }

  // /edit -> same popup as the Edit Order button (staff only, inside a ticket)
  if (interaction.isChatInputCommand() && interaction.commandName === EDIT_COMMAND) {
    if (!isStaff(interaction.member)) {
      await interaction.reply({ content: 'Only staff can use this command.', flags: EPHEMERAL });
      return true;
    }
    if (!(interaction.channel.topic || '').startsWith('ticket:')) {
      await interaction.reply({
        content: 'This command only works inside a ticket channel.',
        flags: EPHEMERAL,
      });
      return true;
    }
    await showEditModal(interaction);
    return true;
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