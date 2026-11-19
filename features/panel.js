// /buy -> posts the main Buy panel: Mobile Legends, Honor of Kings, CODM and Roblox
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { COLOR, BUY_CHANNEL_ID } = require('../config');
const { GAMES } = require('../catalog');
const client = require('../core/client');
const M = require('../messages');
const { EPHEMERAL, fill } = require('../core/helpers');

const commands = [
  new SlashCommandBuilder()
    .setName(M.commandNames.buy)
    .setDescription('Post the Buy panel (game credits + Roblox) in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

async function postPanel(interaction) {
  const embed = new EmbedBuilder()
    .setTitle(fill(M.buyPanel.title))
    .setDescription(fill(M.buyPanel.text))
    .setColor(COLOR);

  // One button per game in catalog.js, then Roblox
  const buttons = Object.entries(GAMES).map(([key, game]) =>
    new ButtonBuilder()
      .setCustomId(`buy_game:${key}`)
      .setLabel(game.name)
      .setStyle(ButtonStyle.Danger)
  );
  buttons.push(
    new ButtonBuilder()
      .setCustomId('buy_robux') // same id as before, so the Roblox flow is unchanged
      .setLabel(M.buyPanel.robloxButton)
      .setStyle(ButtonStyle.Danger)
  );

  // Discord limits action rows to at most 5 buttons each (and at most 5 rows)
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }

  // Post in BUY_CHANNEL_ID if set, otherwise in the current channel
  const buyChannel = BUY_CHANNEL_ID
    ? await client.channels.fetch(BUY_CHANNEL_ID)
    : interaction.channel;
  await buyChannel.send({ embeds: [embed], components: rows });
  await interaction.reply({ content: 'Panel posted.', flags: EPHEMERAL });
}

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === M.commandNames.buy) {
    await postPanel(interaction);
    return true;
  }
  return false;
}

module.exports = { commands, handle };
