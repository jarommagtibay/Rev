// /remind -> Staff only: send a polite reminder ping to the customer inside their ticket that sticks to the bottom
const { SlashCommandBuilder } = require('discord.js');
const { COLOR } = require('../config');
const { EPHEMERAL, isStaff, getCustomerId } = require('../core/helpers');
const { setStickyRemind, handleStickyInteraction } = require('../core/sticky');

const REMINDER_TEXTS = {
  receipt:
    'Friendly reminder: Please send your **payment receipt screenshot** here in the ticket so staff can verify and process your order! 🧾\n\n> *No receipt = no process!*',
  vouch:
    'Friendly reminder: If you have received your order, please click the **Vouch** button above to complete your transaction and leave a rating! ⭐\n\n> *Your feedback helps our shop grow!*',
  details:
    'Friendly reminder: Please provide or double-check your account / game details so staff can proceed with your order. 📋',
};

const commands = [
  new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Staff only: send a reminder ping to the customer in this ticket (pinned to bottom)')
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription('What to remind the customer about')
        .setRequired(true)
        .addChoices(
          { name: '🧾 Payment Receipt Reminder', value: 'receipt' },
          { name: '⭐ Vouch / Rating Reminder', value: 'vouch' },
          { name: '📋 Account Details Reminder', value: 'details' }
        )
    )
    .addStringOption((o) =>
      o
        .setName('note')
        .setDescription('Optional extra custom note to include')
        .setRequired(false)
    ),
];

async function runRemind(interaction) {
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

  const type = interaction.options.getString('type');
  const customNote = interaction.options.getString('note');
  const customerId = getCustomerId(interaction.channel);

  let desc = REMINDER_TEXTS[type] || REMINDER_TEXTS.receipt;
  if (customNote) {
    desc += `\n\n💬 **Staff note:** ${customNote}`;
  }

  await setStickyRemind(interaction.channel, type, desc, interaction.user.username, customerId);

  return interaction.reply({
    content: '✅ Reminder sent and pinned to the bottom of the ticket.',
    flags: EPHEMERAL,
  });
}

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'remind') {
    await runRemind(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith('dismiss_sticky:remind')) {
    return handleStickyInteraction(interaction);
  }
  return false;
}

module.exports = { commands, handle };
