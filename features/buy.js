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
const { data, saveData, formatPrice } = require('../core/data');
const { EPHEMERAL, parseOrderAmount, ticketLimitMessage } = require('../core/helpers');
const {
  orderHeadline,
  ticketRows,
  makeSafeName,
  createTicketChannel,
  sendPaymentMessage,
} = require('../core/ticket');
const { refreshQueue } = require('../core/queue');
const { logTicketCreated } = require('../core/audit');

const commands = [];

// Buy button -> ask how they want to order (Robux amount or price)
async function showChoice(interaction) {
  if (!data.shopOpen) {
    return interaction.reply({ content: SHOP_CLOSED_TEXT, flags: EPHEMERAL });
  }

  if (data.stock <= 0 || data.rate <= 0) {
    return interaction.reply({
      content: 'Sorry, we are out of Robux stock right now. Please check back later.',
      flags: EPHEMERAL,
    });
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

  if (data.stock <= 0 || data.rate <= 0) {
    return interaction.reply({
      content: 'Sorry, we are out of Robux stock right now. Please check back later.',
      flags: EPHEMERAL,
    });
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

  if (amount > data.stock) {
    return interaction.reply({
      content: `Not enough stock. We only have **${data.stock.toLocaleString()}** Robux available.`,
      flags: EPHEMERAL,
    });
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
    .setDescription(orderHeadline(`${amount.toLocaleString()} Robux`, formatPrice(amount)))
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      { name: 'Account Name', value: name, inline: true },
      { name: 'Account Username', value: username, inline: true },
      { name: 'Robux Amount', value: amount.toLocaleString(), inline: true },
      { name: 'Price', value: formatPrice(amount), inline: true },
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

  await sendPaymentMessage(channel, formatPrice(amount), `${amount.toLocaleString()} Robux`);

  const entry = {
    channelId: channel.id,
    messageId: message.id,
    userId: interaction.user.id,
    name,
    username,
    safeName,
    amount,
    joinedAt: Date.now(),
    notifiedNext: false,
  };
  data.queue.push(entry);
  saveData();

  // Record who opened the ticket in the audit channel (not awaited, never blocks the customer)
  logTicketCreated(interaction, {
    channel,
    item: `${amount.toLocaleString()} Robux`,
    price: formatPrice(amount),
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