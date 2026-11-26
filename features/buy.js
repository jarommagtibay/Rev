// Roblox buying flow: Roblox button -> choice -> order form -> private ticket + queue
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { CURRENCY, COLOR, STAFF_ROLE_ID, SHOP_CLOSED_TEXT } = require('../config');
const { data, saveData, formatPeso, robuxPrice, isBlacklisted, generateOrderId, getExpressFee } = require('../core/data');
const { EPHEMERAL, parseOrderAmount, ticketLimitMessage } = require('../core/helpers');
const {
  orderHeadline,
  ticketRows,
  makeSafeName,
  createTicketChannel,
  sendPaymentMessage,
} = require('../core/ticket');
const { refreshQueue, availableStock, notEnoughStockMessage } = require('../core/queue');
const { logTicketCreated } = require('../core/audit');
const { applyPromoDiscount } = require('./promo');
const { getRobloxProfile } = require('../core/roblox');
const { areAllStaffOffDuty, getOffDutyNote } = require('./duty');
const { hasUnvouchedBuyer, getUnvouchedBuyer, buildUnvouchedBlockEmbed } = require('../core/unvouched');

const commands = [];

// Returns a message if nobody can order right now, otherwise null.
// Stock that is already taken by orders waiting in the queue does not count.
function stockBlockMessage() {
  if (data.stock <= 0 || data.rate <= 0) {
    return 'Sorry, we are out of Robux stock right now. Please check back later.';
  }
  if (availableStock() <= 0) {
    return 'All of our Robux stock is already reserved by orders in the queue. Please check back later.';
  }
  return null;
}

// Buy button -> ask how they want to order (Robux amount or price)
async function showChoice(interaction) {
  if (hasUnvouchedBuyer(interaction.user.id)) {
    const buyer = getUnvouchedBuyer(interaction.user.id);
    return interaction.reply({
      ...buildUnvouchedBlockEmbed(buyer),
      flags: EPHEMERAL,
    });
  }

  if (isBlacklisted(interaction.user.id)) {
    const entry = (data.blacklist || []).find((b) => b.userId === interaction.user.id);
    const reason = entry && entry.reason ? `\nReason: **${entry.reason}**` : '';
    return interaction.reply({
      content: `🚫 You are blacklisted from opening tickets in this shop.${reason}`,
      flags: EPHEMERAL,
    });
  }

  if (!data.shopOpen) {
    return interaction.reply({ content: SHOP_CLOSED_TEXT, flags: EPHEMERAL });
  }

  const stockMessage = stockBlockMessage();
  if (stockMessage) {
    return interaction.reply({ content: stockMessage, flags: EPHEMERAL });
  }

  const limitMessage = ticketLimitMessage(interaction.guild, interaction.user.id, 'robux', 'Robux');
  if (limitMessage) {
    return interaction.reply({ content: limitMessage, flags: EPHEMERAL });
  }

  const choiceRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('buy_by_robux')
      .setLabel('Order by Robux amount')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('buy_by_price')
      .setLabel(`Order by price (${CURRENCY})`)
      .setStyle(ButtonStyle.Danger)
  );

  return interaction.reply({
    content: 'How do you want to order?',
    components: [choiceRow],
    flags: EPHEMERAL,
  });
}

// Choice button -> show the form for the chosen option
async function showForm(interaction, presetRobuxAmount = null) {
  if (hasUnvouchedBuyer(interaction.user.id)) {
    const buyer = getUnvouchedBuyer(interaction.user.id);
    return interaction.reply({
      ...buildUnvouchedBlockEmbed(buyer),
      flags: EPHEMERAL,
    });
  }

  if (isBlacklisted(interaction.user.id)) {
    const entry = (data.blacklist || []).find((b) => b.userId === interaction.user.id);
    const reason = entry && entry.reason ? `\nReason: **${entry.reason}**` : '';
    return interaction.reply({
      content: `🚫 You are blacklisted from opening tickets in this shop.${reason}`,
      flags: EPHEMERAL,
    });
  }

  if (!data.shopOpen) {
    return interaction.reply({ content: SHOP_CLOSED_TEXT, flags: EPHEMERAL });
  }

  const stockMessage = stockBlockMessage();
  if (stockMessage) {
    return interaction.reply({ content: stockMessage, flags: EPHEMERAL });
  }

  const limitMessage = ticketLimitMessage(interaction.guild, interaction.user.id, 'robux', 'Robux');
  if (limitMessage) {
    return interaction.reply({ content: limitMessage, flags: EPHEMERAL });
  }

  const mode = presetRobuxAmount !== null || interaction.customId === 'buy_by_robux' ? 'robux' : 'price';

  const modal = new ModalBuilder()
    .setCustomId(`robux_form:${mode}`)
    .setTitle(mode === 'robux' ? 'Order by Robux amount' : 'Order by price');

  const nameInput = new TextInputBuilder()
    .setCustomId('account_name')
    .setLabel('Account name (display name)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);

  const usernameInput = new TextInputBuilder()
    .setCustomId('account_username')
    .setLabel('Account username')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);

  const valueInput = new TextInputBuilder()
    .setCustomId('amount_value')
    .setLabel(mode === 'robux' ? 'How much Robux?' : `How much do you want to pay (${CURRENCY})?`)
    .setPlaceholder(mode === 'robux' ? 'e.g. 1000' : 'e.g. 350')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10);
  if (presetRobuxAmount !== null) {
    valueInput.setValue(String(presetRobuxAmount));
  }

  const promoInput = new TextInputBuilder()
    .setCustomId('promo_code')
    .setLabel('Promo Code (Optional)')
    .setPlaceholder('Enter discount code if you have one')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(20);

  const expressFee = getExpressFee();
  const expressInput = new TextInputBuilder()
    .setCustomId('express_delivery')
    .setLabel(`⚡ Express Queue (+${CURRENCY}${expressFee})? Type YES`)
    .setPlaceholder('Type YES to skip the line, or leave blank')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(5);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(usernameInput),
    new ActionRowBuilder().addComponents(valueInput),
    new ActionRowBuilder().addComponents(promoInput),
    new ActionRowBuilder().addComponents(expressInput)
  );

  return interaction.showModal(modal);
}

// Order form submitted -> create the private ticket channel + join the queue
async function createTicket(interaction) {
  if (hasUnvouchedBuyer(interaction.user.id)) {
    const buyer = getUnvouchedBuyer(interaction.user.id);
    return interaction.reply({
      ...buildUnvouchedBlockEmbed(buyer),
      flags: EPHEMERAL,
    });
  }

  // The shop may have been closed while the customer was filling in the form
  if (!data.shopOpen) {
    return interaction.reply({ content: SHOP_CLOSED_TEXT, flags: EPHEMERAL });
  }

  const mode = interaction.customId.split(':')[1];
  const name = interaction.fields.getTextInputValue('account_name').trim();
  const username = interaction.fields.getTextInputValue('account_username').trim();
  const value = interaction.fields.getTextInputValue('amount_value');
  const promoCode = (interaction.fields.getTextInputValue('promo_code') || '').trim();
  const expressVal = (interaction.fields.getTextInputValue('express_delivery') || '').trim().toUpperCase();
  const isExpress = expressVal === 'YES' || expressVal === 'Y';

  const limitMessage = ticketLimitMessage(interaction.guild, interaction.user.id, 'robux', 'Robux');
  if (limitMessage) {
    return interaction.reply({ content: limitMessage, flags: EPHEMERAL });
  }

  const parsed = parseOrderAmount(
    mode === 'robux' ? value : '',
    mode === 'price' ? value : ''
  );
  if (parsed.error) {
    return interaction.reply({ content: parsed.error, flags: EPHEMERAL });
  }
  const amount = parsed.amount;
  // The price is decided ONCE here and saved on the queue entry, so a later rate change never reprices it
  const basePrice = robuxPrice(amount);

  // Apply promo code discount if provided
  let price = basePrice;
  let promoNote = '';
  if (promoCode) {
    const res = applyPromoDiscount(promoCode, basePrice, interaction.user.id);
    if (res.error) {
      return interaction.reply({ content: `⚠️ Promo Code Error: ${res.error}`, flags: EPHEMERAL });
    }
    price = res.price;
    if (res.promo) {
      if (res.promo.allowedUsers && res.promo.allowedUsers[interaction.user.id] > 0) {
        res.promo.allowedUsers[interaction.user.id] -= 1;
      }
      res.promo.usedCount = (res.promo.usedCount || 0) + 1;
      saveData();
      promoNote = ` (Discounted from ${formatPeso(basePrice)} via \`${res.promo.code}\`)`;
    }
  }

  // Add express fee if selected
  let expressNote = '';
  const expressFee = getExpressFee();
  if (isExpress) {
    price += expressFee;
    expressNote = ` (+${CURRENCY}${expressFee} Express)`;
  }

  const available = availableStock();
  if (amount > available) {
    return interaction.reply({ content: notEnoughStockMessage(available), flags: EPHEMERAL });
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  // Lookup and strictly verify Roblox account before opening ticket
  const roblox = await getRobloxProfile(username);
  if (roblox && roblox.notFound) {
    return interaction.editReply({
      content:
        `❌ **Roblox Account Not Found!** No account named \`${username}\` exists on Roblox.\n\n` +
        `Please check your spelling (use your exact Roblox @username, not display name) and try again to prevent wrong deliveries!`,
    });
  }

  const safeName = makeSafeName(interaction.user);
  const orderId = generateOrderId();

  // Position is decided before the channel is created so the name can include it
  const position = data.queue.length + 1;

  const channel = await createTicketChannel(interaction, position, safeName, 'robux');

  const embed = new EmbedBuilder()
    .setAuthor({ name: 'REVÉUX  •  ORDER TICKET' })
    .setTitle('🧾  New Robux Order')
    .setColor(COLOR)
    .setDescription(orderHeadline(`${amount.toLocaleString()} Robux`, formatPeso(price)))
    .setThumbnail(roblox?.avatarUrl || interaction.user.displayAvatarURL())
    .addFields(
      { name: 'Order ID', value: `\`#${orderId}\``, inline: true },
      { name: 'Account Name', value: `\`\`\`\n${name}\n\`\`\``, inline: true },
      { name: 'Account Username', value: `\`\`\`\n${username}\n\`\`\``, inline: true },
      { name: 'Robux Amount', value: amount.toLocaleString(), inline: true },
      { name: 'Price', value: `${formatPeso(price)}${promoNote}${expressNote}`, inline: true },
      { name: 'Queue Position', value: isExpress ? `#1 ⚡ EXPRESS` : `#${position}`, inline: true },
      { name: 'Opened by', value: `${interaction.user}` }
    )
    .setFooter({ text: `Order #${orderId} • Rate: ${CURRENCY}${data.rate} per 100 Robux` })
    .setTimestamp();

  if (isExpress) {
    embed.addFields({
      name: '⚡  Priority Level',
      value: `**VIP EXPRESS QUEUE (+${CURRENCY}${expressFee})** — Prioritized at the front of the line!`,
      inline: false,
    });
  }

  if (roblox && !roblox.notFound) {
    embed.addFields({
      name: '👤  Roblox Profile',
      value: `[**${roblox.displayName}** (@${roblox.name})](${roblox.profileUrl})\n*(Avatar verified above)*`,
      inline: false,
    });
  } else if (roblox && roblox.notFound) {
    embed.addFields({
      name: '⚠️  Roblox Warning',
      value: `No account named \`${username}\` found on Roblox! Please verify spelling before sending.`,
      inline: false,
    });
  }

  const staffAlert = isExpress
    ? `<@&${STAFF_ROLE_ID}> ⚡ **VIP EXPRESS ORDER** (prioritize immediately!)`
    : `<@&${STAFF_ROLE_ID}>`;

  const message = await channel.send({
    content: `${interaction.user} ${staffAlert}`,
    embeds: [embed],
    components: ticketRows('open', false),
    allowedMentions: { parse: ['users', 'roles'] },
  });

  await sendPaymentMessage(channel, formatPeso(price), `${amount.toLocaleString()} Robux`);

  // Check once more right before joining the queue: another customer may have ordered while this
  // ticket was being created. (No waiting happens between this check and the queue push below.)
  const availableNow = availableStock();
  if (amount > availableNow) {
    await channel.delete().catch(() => { });
    return interaction.editReply(notEnoughStockMessage(availableNow));
  }

  const entry = {
    orderId,
    channelId: channel.id,
    messageId: message.id,
    userId: interaction.user.id,
    name,
    username,
    safeName,
    amount,
    price,
    joinedAt: Date.now(),
    notifiedNext: false,
    shownPosition: isExpress ? `#1 ⚡ EXPRESS` : `#${position}`,
    isExpress,
  };

  // Express orders are placed at the front of the active queue
  if (isExpress) {
    const insertIdx = data.queue.findIndex((e) => !e.isExpress);
    if (insertIdx === -1) data.queue.push(entry);
    else data.queue.splice(insertIdx, 0, entry);
  } else {
    data.queue.push(entry);
  }
  saveData();

  // If all staff are currently off-duty, display off-duty notice
  if (areAllStaffOffDuty()) {
    const note = getOffDutyNote();
    const noteLine = note ? `\n\n**Staff Note:**\n${note}` : '';
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2b2d31)
          .setTitle('⏸️  Staff Notice: Staff Is Currently Off-Duty')
          .setDescription(
            'Our staff team is currently taking a break or off-duty.\n\n' +
            '📋 **Order Reserved in Queue:** Your order has been placed and saved in the queue.\n' +
            '💳 **Payment QR Code:** As soon as staff is back on-duty, they will send the payment QR code here in this ticket.\n' +
            `⚡ **Fulfillment:** Your order will be prioritized and fulfilled as soon as staff returns online!${noteLine}`
          )
          .setFooter({ text: 'Reveux Shop • Orders are fulfilled in queue order' })
          .setTimestamp(),
      ],
    });
  }

  // Record who opened the ticket in the audit channel (not awaited, never blocks the customer)
  logTicketCreated(interaction, {
    channel,
    item: `${amount.toLocaleString()} Robux${isExpress ? ' (⚡ Express)' : ''}`,
    price: formatPeso(price),
    details: [
      { name: 'Account Name', value: name },
      { name: 'Account Username', value: username },
    ],
  }).then((id) => {
    // Remember the log message, so Edit Order can update the amount in it
    if (id) {
      entry.auditMessageId = id;
      saveData();
    }
  });

  // Greet them with their position (and ping them if they're first)
  await refreshQueue(interaction.guild);

  const posText = isExpress ? '**#1 ⚡ EXPRESS**' : `**#${position}**`;
  return interaction.editReply(
    `Your ticket has been created: ${channel}\nYour position in the queue: ${posText}`
  );
}

async function handle(interaction) {
  if (interaction.isButton() && interaction.customId === 'buy_robux') {
    await showChoice(interaction);
    return true;
  }

  if (
    interaction.isButton() &&
    (interaction.customId === 'buy_by_robux' || interaction.customId === 'buy_by_price')
  ) {
    await showForm(interaction);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('robux_form:')) {
    await createTicket(interaction);
    return true;
  }

  return false;
}

module.exports = { commands, handle, showForm };