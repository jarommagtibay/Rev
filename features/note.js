// /note -> Staff only: post an internal staff note inside a ticket
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { EPHEMERAL, isStaff } = require('../core/helpers');

const commands = [
  new SlashCommandBuilder()
    .setName('note')
    .setDescription('Staff only: leave an internal note inside this ticket channel')
    .addStringOption((o) =>
      o.setName('text').setDescription('The note content for your team').setRequired(true)
    ),
];

async function runNote(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can use this command.',
      flags: EPHEMERAL,
    });
  }

  if (!(interaction.channel.topic || '').startsWith('ticket:')) {
    return interaction.reply({
      content: 'This command only works inside a ticket channel.',
      flags: EPHEMERAL,
    });
  }

  const text = interaction.options.getString('text');

  const embed = new EmbedBuilder()
    .setColor(0xffd700) // Gold
    .setTitle('📝  Internal Staff Note')
    .setDescription(text)
    .setFooter({ text: `Note by @${interaction.user.username} • Team Reference` })
    .setTimestamp();

  await interaction.channel.send({ embeds: [embed] });
  return interaction.reply({ content: '✅ Staff note posted.', flags: EPHEMERAL });
}

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'note') {
    await runNote(interaction);
    return true;
  }
  return false;
}

module.exports = { commands, handle };
