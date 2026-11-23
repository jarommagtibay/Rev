// Game credits flow (Mobile Legends, Honor of Kings, CODM):
// game button -> package dropdown -> ID form -> private ticket + queue
// Packages, prices and the ID fields are edited in catalog.js
const {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { COLOR, STAFF_ROLE_ID, SHOP_CLOSED_TEXT, CURRENCY, EXPRESS_FEE } = require('../config');
const { GAMES } = require('../catalog');
const { data, saveData, formatPeso, isBlacklisted, generateOrderId } = require('../core/data');
const { EPHEMERAL, ticketLimitMessage } = require('../core/helpers');
const {
  orderHeadline,
  ticketRows,
  makeSafeName,
  createTicketChannel,
  sendPaymentMessage,
} = require('../core/ticket');
const { refreshQueue } = require('../core/queue');
const { logTicketCreated } = require('../core/audit');
const { applyPromoDiscount } = require('./promo');
const { areAllStaffOffDuty, getOffDutyNote } = require('./duty');
const { hasUnvouchedBuyer, getUnvouchedBuyer, buildUnvouchedBlockEmbed } = require('../core/unvouched');

const commands = [];

// Checks shared by every step. Returns a reply message if the customer can't continue.
// The ticket limit is counted per game (key = the game key from catalog.js, e.g. 'ml').
function blockReason(interaction, game, key) {
  if (isBlacklisted(interaction.user.id)) {
    const entry = (data.blacklist || []).find((b) => b.userId === interaction.user.id);
    const reason = entry && entry.reason ? `\nReason: **${entry.reason}**` : '';
    return `🚫 You are blacklisted from opening tickets in this shop.${reason}`;
  }
  if (!data.shopOpen) return SHOP_CLOSED_TEXT;
  return ticketLimitMessage(interaction.guild, interaction.user.id, key, game.name);
}

// Game button -> dropdown with the packages
async function showPackages(interaction) {
  if (hasUnvouchedBuyer(interaction.user.id)) {
    const buyer = getUnvouchedBuyer(interaction.user.id);
    return interaction.reply({
      ...buildUnvouchedBlockEmbed(buyer),
      flags: EPHEMERAL,
    });
  }

  const key = interaction.customId.split(':')[1];
  const game = GAMES[key];
  if (!game) {
    return interaction.reply({ content: 'That game is not available.', flags: EPHEMERAL });
  }

  const blocked = blockReason(interaction, game, key);
  if (blocked) return interaction.reply({ content: blocked, flags: EPHEMERAL });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`game_pkg:${key}`)
    .setPlaceholder(`Choose your ${game.currency} package`)
    .addOptions(
      game.packages.slice(0, 25).map((p, i) => ({
        label: p.label,
        description: formatPeso(p.price),
        value: String(i),
      }))
    );

  const note = game.note ? `\n**${game.note}**` : '';
  return interaction.reply({
    content: `**${game.name}**\nChoose how many ${game.currency} you want to buy.${note}`,
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: EPHEMERAL,
  });
}

// Package picked -> ID form
async function showForm(interaction) {
  if (hasUnvouchedBuyer(interaction.user.id)) {
    const buyer = getUnvouchedBuyer(interaction.user.id);
    return interaction.reply({
      ...buildUnvouchedBlockEmbed(buyer),
      flags: EPHEMERAL,
    });
  }

  const key = interaction.customId.split(':')[1];
  const game = GAMES[key];
  const index = Number(interaction.values[0]);
  const pkg = game && game.packages[index];
  if (!pkg) {
    return interaction.reply({
      content: 'That package is not available anymore. Please press the game button again.',
      flags: EPHEMERAL,
    });
  }

  const blocked = blockReason(interaction, game, key);
  if (blocked) return interaction.reply({ content: blocked, flags: EPHEMERAL });

  const modal = new ModalBuilder()
    .setCustomId(`game_form:${key}:${index}`)
    .setTitle(`${game.name} Order`.slice(0, 45));

  for (const f of game.fields) {
    const input = new TextInputBuilder()
      .setCustomId(f.id)
      .setLabel(f.label)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(50);
    if (f.placeholder) input.setPlaceholder(f.placeholder);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }

  const promoInput = new TextInputBuilder()
    .setCustomId('game_promo')
    .setLabel('Promo Code (optional)')
    .setPlaceholder('Enter discount code if you have one')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(20);
  modal.addComponents(new ActionRowBuilder().addComponents(promoInput));

  const expressInput = new TextInputBuilder()
    .setCustomId('game_express')
    .setLabel(`⚡ Express Queue (+${CURRENCY}${EXPRESS_FEE})? Type YES`)
    .setPlaceholder('Type YES to skip the line, or leave blank')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(5);
  modal.addComponents(new ActionRowBuilder().addComponents(expressInput));

  return interaction.showModal(modal);
}

// Form submitted -> create the private ticket + join the queue
async function createTicket(interaction) {
  if (hasUnvouchedBuyer(interaction.user.id)) {
    const buyer = getUnvouchedBuyer(interaction.user.id);
    return interaction.reply({
      ...buildUnvouchedBlockEmbed(buyer),
      flags: EPHEMERAL,
    });
  }

  const [, key, indexText] = interaction.customId.split(':');
  const game = GAMES[key];
  const pkg = game && game.packages[Number(indexText)];
  if (!pkg) {
    return interaction.reply({
      content: 'That package is not available anymore. Please press the game button again.',
      flags: EPHEMERAL,
    });
  }

  const blocked = blockReason(interaction, game, key);
  if (blocked) return interaction.reply({ content: blocked, flags: EPHEMERAL });

  // Read and check every field
  const values = {};
  for (const f of game.fields) {
    const v = interaction.fields.getTextInputValue(f.id).trim();
    if (f.digits && !/^\d+$/.test(v)) {
      return interaction.reply({
        content: `**${f.label}** must be numbers only. Please try again.`,
        flags: EPHEMERAL,
      });
    }
    values[f.id] = v;
  }

  const nameField = game.fields.find((f) => f.isName);
  const name = nameField ? values[nameField.id] : interaction.user.username;

  // Optional promo discount
  let promoCode = '';
  try {
    promoCode = interaction.fields.getTextInputValue('game_promo').trim();
  } catch {
    promoCode = '';
  }

  // Optional express delivery
  let expressVal = '';
  try {
    expressVal = (interaction.fields.getTextInputValue('game_express') || '').trim().toUpperCase();
  } catch {
    expressVal = '';
  }
  const isExpress = expressVal === 'YES' || expressVal === 'Y';

  let price = pkg.price;
  let promoNote = '';
  if (promoCode) {
    const res = applyPromoDiscount(promoCode, pkg.price, interaction.user.id);
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
      promoNote = ` (Discounted from ${formatPeso(pkg.price)} via \`${res.promo.code}\`)`;
    }
  }

  let expressNote = '';
  if (isExpress) {
    price += EXPRESS_FEE;
    expressNote = ` (+${CURRENCY}${EXPRESS_FEE} Express)`;
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  const safeName = makeSafeName(interaction.user);
  const orderId = generateOrderId();

  // Position is decided before the channel is created so the name can include it
  const position = data.queue.length + 1;

  const channel = await createTicketChannel(interaction, position, safeName, key);

  const embed = new EmbedBuilder()
    .setAuthor({ name: 'REVÉUX  •  ORDER TICKET' })
    .setTitle(`🧾  New ${game.name} Order`)
    .setColor(COLOR)
    .setDescription(orderHeadline(`${pkg.label}  •  ${game.name}`, formatPeso(price) + promoNote + expressNote, '🎮'))
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      { name: 'Order ID', value: `\`#${orderId}\``, inline: true },
      { name: 'Game', value: game.name, inline: true },
      { name: 'Package', value: pkg.label, inline: true },
      { name: 'Price', value: formatPeso(price) + promoNote + expressNote, inline: true },
      { name: 'Queue Position', value: isExpress ? `#1 ⚡ EXPRESS` : `#${position}`, inline: true },
      ...game.fields.map((f) => ({ name: f.label, value: `\`\`\`\n${values[f.id]}\n\`\`\``, inline: true })),
      { name: 'Opened by', value: `${interaction.user}` }
    )
    .setFooter({ text: `Order #${orderId}${game.note ? ` • ${game.note}` : ''}` })
    .setTimestamp();

  if (isExpress) {
    embed.addFields({
      name: '⚡  Priority Level',
      value: `**VIP EXPRESS QUEUE (+${CURRENCY}${EXPRESS_FEE})** — Prioritized at the front of the line!`,
      inline: false,
    });
  }

  if (game.note) embed.setFooter({ text: game.note });

  const staffAlert = isExpress
    ? `<@&${STAFF_ROLE_ID}> ⚡ **VIP EXPRESS ORDER** (prioritize immediately!)`
    : `<@&${STAFF_ROLE_ID}>`;

  const message = await channel.send({
    content: `${interaction.user} ${staffAlert}`,
    embeds: [embed],
    components: ticketRows('open', false),
    allowedMentions: { parse: ['users', 'roles'] },
  });

  await sendPaymentMessage(channel, formatPeso(price), `${pkg.label} (${game.name})`);

  const entry = {
    orderId,
    channelId: channel.id,
    messageId: message.id,
    userId: interaction.user.id,
    name,
    username: '',
    safeName,
    type: 'game',
    game: key,
    gameName: game.name,
    label: pkg.label,
    price,
    amount: 0,
    joinedAt: Date.now(),
    notifiedNext: false,
    shownPosition: isExpress ? `#1 ⚡ EXPRESS` : `#${position}`,
    isExpress,
  };

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
    item: `${pkg.label}  •  ${game.name}${isExpress ? ' (⚡ Express)' : ''}`,
    price: formatPeso(price),
    details: game.fields.map((f) => ({ name: f.label, value: values[f.id] })),
  }).then((id) => {
    // Remember the log message, so Edit Order can update the package in it
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
  if (interaction.isButton() && interaction.customId.startsWith('buy_game:')) {
    await showPackages(interaction);
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('game_pkg:')) {
    await showForm(interaction);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('game_form:')) {
    await createTicket(interaction);
    return true;
  }

  return false;
}

module.exports = { commands, handle };