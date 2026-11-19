// Closing tickets (staff only): /closeticket and the Close Ticket button
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLOR } = require('../config');
const M = require('../messages');
const { EPHEMERAL, isStaff, fromTemplate } = require('../core/helpers');
const { logTicketTranscript } = require('../core/audit');

const commands = [
  new SlashCommandBuilder()
    .setName(M.commandNames.closeticket)
    .setDescription('Staff only: close this ticket'),
];

function closingMessage(user) {
  const t = fromTemplate(M.closing, { user: user.username });
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(t.title)
    .setDescription(t.text)
    .setTimestamp();
  if (t.footer) embed.setFooter({ text: t.footer });
  return { embeds: [embed] };
}

// Executes close: sends closing message, archives transcript to AUDIT_CHANNEL_ID, and deletes channel
async function executeClose(interaction) {
  await interaction.reply(closingMessage(interaction.user));

  // Archive transcript in the background
  try {
    await logTicketTranscript(interaction.channel, interaction.user);
  } catch (err) {
    console.error('Could not archive transcript before deletion:', err);
  }

  setTimeout(() => {
    // The channelDelete event removes it from the queue automatically
    interaction.channel.delete().catch(console.error);
  }, 4000);
}

// /closeticket -> staff only, inside a ticket channel
async function closeTicketCommand(interaction) {
  if (!(interaction.channel.topic || '').startsWith('ticket:')) {
    return interaction.reply({
      content: 'This command only works inside a ticket channel.',
      flags: EPHEMERAL,
    });
  }

  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can close tickets.',
      flags: EPHEMERAL,
    });
  }

  await executeClose(interaction);
}

// Close Ticket button -> staff only
async function closeTicketButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can close tickets.',
      flags: EPHEMERAL,
    });
  }

  await executeClose(interaction);
}

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === M.commandNames.closeticket) {
    await closeTicketCommand(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'close_ticket') {
    await closeTicketButton(interaction);
    return true;
  }

  return false;
}

module.exports = { commands, handle };
