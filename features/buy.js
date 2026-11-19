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
const { data, saveData, formatPeso, robuxPrice, isBlacklisted } = require('../core/data');
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
async function showForm(interaction) {
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

  const mode = interaction.customId === 'buy_by_robux' ? 'robux' : 'price';

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

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(usernameInput),
    new ActionRowBuilder().addComponents(valueInput)
  );

  return interaction.showModal(modal);
}

// Order form submitted -> create the private ticket channel + join the queue
async function createTicket(interaction) {
  // The shop may have been closed while the customer was filling in the form
  if (!data.shopOpen) {
    return interaction.reply({ content: SHOP_CLOSED_TEXT, flags: EPHEMERAL });
  }

  const mode = interaction.customId.split(':')[1];
  const name = interaction.fields.getTextInputValue('account_name').trim();
  const username = interaction.fields.getTextInputValue('account_username').trim();
  const value = interaction.fields.getTextInputValue('amount_value');

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
  const price = robuxPrice(amount);

  const available = availableStock();
  if (amount > available) {
    return interaction.reply({ content: notEnoughStockMessage(available), flags: EPHEMERAL });
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  const safeName = makeSafeName(interaction.user);

  // Position is decided before the channel is created so the name can include it
  const position = data.queue.length + 1;

  const channel = await createTicketChannel(interaction, position, safeName, 'robux');

  const embed = new EmbedBuilder()
    .setAuthor({ name: 'REVÉUX  •  ORDER TICKET' })
    .setTitle('🧾  New Robux Order')
    .setColor(COLOR)
    .setDescription(orderHeadline(`${amount.toLocaleString()} Robux`, formatPeso(price)))
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      { name: 'Account Name', value: `\`\`\`\n${name}\n\`\`\``, inline: true },
      { name: 'Account Username', value: `\`\`\`\n${username}\n\`\`\``, inline: true },
      { name: 'Robux Amount', value: amount.toLocaleString(), inline: true },
      { name: 'Price', value: formatPeso(price), inline: true },
      { name: 'Queue Position', value: `#${position}`, inline: true },
      { name: 'Opened by', value: `${interaction.user}` }
    )
    .setFooter({ text: `Rate: ${CURRENCY}${data.rate} per 100 Robux` })
    .setTimestamp();

  const message = await channel.send({
    content: `${interaction.user} <@&${STAFF_ROLE_ID}>`,
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
    shownPosition: `#${position}`,
  };
  data.queue.push(entry);
  saveData();

  // Record who opened the ticket in the audit channel (not awaited, never blocks the customer)
  logTicketCreated(interaction, {
    channel,
    item: `${amount.toLocaleString()} Robux`,
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

  return interaction.editReply(
    `Your ticket has been created: ${channel}\nYour position in the queue: **#${position}**`
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

module.exports = { commands, handle };