// /note -> Staff only: post an internal staff note inside a ticket that sticks to the bottom
const { SlashCommandBuilder } = require('discord.js');
const { EPHEMERAL, isStaff } = require('../core/helpers');
const { setStickyNote, handleStickyInteraction } = require('../core/sticky');

const commands = [
  new SlashCommandBuilder()
    .setName('note')
    .setDescription('Staff only: leave an internal note inside this ticket channel (pinned to bottom)')
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
  await setStickyNote(interaction.channel, text, interaction.user.username);

  return interaction.reply({
    content: '✅ Staff note posted and pinned to the bottom of the ticket.',
    flags: EPHEMERAL,
  });
}

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'note') {
    await runNote(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith('dismiss_sticky:note')) {
    return handleStickyInteraction(interaction);
  }
  return false;
}

module.exports = { commands, handle };
