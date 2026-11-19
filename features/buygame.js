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
const { COLOR, STAFF_ROLE_ID, SHOP_CLOSED_TEXT } = require('../config');
const { GAMES } = require('../catalog');
const { data, saveData, formatPeso, isBlacklisted } = require('../core/data');
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

  return interaction.showModal(modal);
}

// Form submitted -> create the private ticket + join the queue
async function createTicket(interaction) {
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

  await interaction.deferReply({ flags: EPHEMERAL });

  const safeName = makeSafeName(interaction.user);

  // Position is decided before the channel is created so the name can include it
  const position = data.queue.length + 1;

  const channel = await createTicketChannel(interaction, position, safeName, key);

  const embed = new EmbedBuilder()
    .setAuthor({ name: 'REVÉUX  •  ORDER TICKET' })
    .setTitle(`🧾  New ${game.name} Order`)
    .setColor(COLOR)
    .setDescription(orderHeadline(`${pkg.label}  •  ${game.name}`, formatPeso(pkg.price), '🎮'))
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      { name: 'Game', value: game.name, inline: true },
      { name: 'Package', value: pkg.label, inline: true },
      { name: 'Price', value: formatPeso(pkg.price), inline: true },
      { name: 'Queue Position', value: `#${position}`, inline: true },
      ...game.fields.map((f) => ({ name: f.label, value: `\`\`\`\n${values[f.id]}\n\`\`\``, inline: true })),
      { name: 'Opened by', value: `${interaction.user}` }
    )
    .setTimestamp();
  if (game.note) embed.setFooter({ text: game.note });

  const message = await channel.send({
    content: `${interaction.user} <@&${STAFF_ROLE_ID}>`,
    embeds: [embed],
    components: ticketRows('open', false),
    allowedMentions: { parse: ['users', 'roles'] },
  });

  await sendPaymentMessage(channel, formatPeso(pkg.price), `${pkg.label} (${game.name})`);

  const entry = {
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
    price: pkg.price,
    amount: 0,
    joinedAt: Date.now(),
    notifiedNext: false,
  };
  data.queue.push(entry);
  saveData();

  // Record who opened the ticket in the audit channel (not awaited, never blocks the customer)
  logTicketCreated(interaction, {
    channel,
    item: `${pkg.label}  •  ${game.name}`,
    price: formatPeso(pkg.price),
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

  return interaction.editReply(
    `Your ticket has been created: ${channel}\nYour position in the queue: **#${position}**`
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