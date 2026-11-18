// /prices -> Price list for Robux and all games in the shop.
// Everyone can use it (private by default, staff can post publicly with public: true).
const {
  ActionRowBuilder,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { CURRENCY, COLOR } = require('../config');
const M = require('../messages');
const { GAMES } = require('../catalog');
const { data, formatPrice, formatPeso } = require('../core/data');
const { EPHEMERAL, isStaff } = require('../core/helpers');

const COMMAND_NAME = (M.commandNames && M.commandNames.prices) || 'prices';

const commands = [
  new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription('View the price list for Robux and all games in the shop')
    .addStringOption((o) =>
      o
        .setName('game')
        .setDescription('Filter by a specific game or product')
        .setRequired(false)
        .addChoices(
          { name: 'All Products', value: 'all' },
          { name: 'Roblox (Robux)', value: 'robux' },
          { name: 'Mobile Legends', value: 'ml' },
          { name: 'Honor of Kings', value: 'hok' },
          { name: 'Call of Duty Mobile', value: 'codm' }
        )
    )
    .addBooleanOption((o) =>
      o
        .setName('public')
        .setDescription('Staff only: post the price list publicly in the channel')
        .setRequired(false)
    ),
];

function buildPriceMenu(selected = 'all') {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('view_pricelist_game')
    .setPlaceholder('Select a game or category to view...')
    .addOptions(
      { label: 'All Products', value: 'all', emoji: '🏷️', default: selected === 'all' },
      { label: 'Roblox (Robux)', value: 'robux', emoji: '💎', default: selected === 'robux' },
      { label: 'Mobile Legends', value: 'ml', emoji: '🎮', default: selected === 'ml' },
      { label: 'Honor of Kings', value: 'hok', emoji: '👑', default: selected === 'hok' },
      { label: 'Call of Duty Mobile', value: 'codm', emoji: '🎯', default: selected === 'codm' }
    );

  return new ActionRowBuilder().addComponents(menu);
}

function buildPriceEmbed(category = 'all') {
  const embed = new EmbedBuilder().setColor(COLOR).setTimestamp();

  if (category === 'robux') {
    embed.setTitle('💎  Roblox (Robux) Price List');
    embed.setDescription(
      `Current Rate: **${CURRENCY}${data.rate}** per 100 Robux\n` +
      `Current Stock: **${data.stock.toLocaleString()}** Robux\n` +
      `Status: **${data.shopOpen ? '🟢 Shop Open' : '🔴 Shop Closed'}**\n\n` +
      '💡 *Use `/calc` to calculate any custom Robux amount!*'
    );

    const sampleAmounts = [100, 250, 500, 1000, 1500, 2000, 3000, 5000, 10000];
    const lines = sampleAmounts.map(
      (amt) => `\`${amt.toLocaleString().padStart(6)} Robux\`  →  **${formatPrice(amt)}**`
    );

    embed.addFields({
      name: 'Common Packages',
      value: lines.join('\n'),
    });

    embed.setFooter({ text: 'Prices depend on the current rate • Reveux' });
    return embed;
  }

  if (GAMES[category]) {
    const game = GAMES[category];
    const emojiMap = { ml: '🎮', hok: '👑', codm: '🎯' };
    const emoji = emojiMap[category] || '🎮';

    embed.setTitle(`${emoji}  ${game.name} Price List`);

    let desc = `Currency: **${game.currency}**`;
    if (game.note) desc += `\n⚠️ **${game.note}**`;
    embed.setDescription(desc);

    const lines = game.packages.map(
      (pkg) => `\`${pkg.label.padEnd(22)}\`  →  **${formatPeso(pkg.price)}**`
    );

    embed.addFields({
      name: 'Available Packages',
      value: lines.join('\n'),
    });

    embed.setFooter({ text: `Open a ticket in the buy channel to order • ${game.name}` });
    return embed;
  }

  // category === 'all'
  embed.setTitle('🏷️  Revéux Shop — Complete Price List');
  embed.setDescription(
    'Browse our full price catalog below, or pick a specific game from the dropdown menu!'
  );

  // 1. Robux section
  const sampleRobux = [500, 1000, 2000, 5000].map(
    (amt) => `\`${amt.toLocaleString()} R$\` → **${formatPrice(amt)}**`
  ).join('  •  ');
  embed.addFields({
    name: `💎  Robux (Rate: ${CURRENCY}${data.rate} / 100 R$)`,
    value: `${sampleRobux}\n*Use \`/calc\` for any amount!*`,
  });

  // 2. Games sections
  for (const [key, game] of Object.entries(GAMES)) {
    const emojiMap = { ml: '🎮', hok: '👑', codm: '🎯' };
    const emoji = emojiMap[key] || '🎮';

    const lines = game.packages.map(
      (pkg) => `\`${pkg.label}\` → **${formatPeso(pkg.price)}**`
    );

    // If there are many packages, format them cleanly
    const noteText = game.note ? `\n⚠️ *${game.note}*` : '';
    embed.addFields({
      name: `${emoji}  ${game.name}`,
      value: lines.join('\n') + noteText,
    });
  }

  embed.setFooter({ text: 'Reveux  •  Prices may change, check before ordering' });
  return embed;
}

async function runPrices(interaction) {
  const game = interaction.options.getString('game') || 'all';
  const wantPublic = interaction.options.getBoolean('public') || false;

  const isPublic = wantPublic && isStaff(interaction.member);

  const embed = buildPriceEmbed(game);
  const row = buildPriceMenu(game);

  return interaction.reply({
    embeds: [embed],
    components: [row],
    flags: isPublic ? undefined : EPHEMERAL,
  });
}

async function handle(interaction) {
  // Slash command /prices
  if (interaction.isChatInputCommand() && interaction.commandName === COMMAND_NAME) {
    await runPrices(interaction);
    return true;
  }

  // Dropdown menu change
  if (interaction.isStringSelectMenu() && interaction.customId === 'view_pricelist_game') {
    const selected = interaction.values[0] || 'all';
    const embed = buildPriceEmbed(selected);
    const row = buildPriceMenu(selected);
    await interaction.update({ embeds: [embed], components: [row] });
    return true;
  }

  return false;
}

module.exports = { commands, handle };
