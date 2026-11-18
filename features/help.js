// /help -> How to use the bot and place an order (only the user can see it).
// All text and sections are in messages.js (help section).
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLOR, BUY_CHANNEL_ID } = require('../config');
const M = require('../messages');
const { EPHEMERAL, fill } = require('../core/helpers');

const commands = [
  new SlashCommandBuilder()
    .setName(M.commandNames.help)
    .setDescription('How to use Reveux and how to order (only you can see it)'),
];

async function runHelp(interaction) {
  const T = M.help;
  const buyChannel = BUY_CHANNEL_ID ? `<#${BUY_CHANNEL_ID}>` : 'the buy channel';

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(T.title)
    .setDescription(fill(T.intro, { buyChannel }))
    .addFields(
      T.sections.map((s) => ({
        name: s.name,
        value: fill(s.text, { buyChannel }),
      }))
    );
  if (T.footer) embed.setFooter({ text: T.footer });

  return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
}

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === M.commandNames.help) {
    await runHelp(interaction);
    return true;
  }
  return false;
}

module.exports = { commands, handle };
