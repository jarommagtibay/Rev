// /staffstats -> staff only: show how many orders each staff member processed, sent and completed
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLOR } = require('../config');
const { data } = require('../core/data');
const { EPHEMERAL, isStaff } = require('../core/helpers');

const commands = [
  new SlashCommandBuilder()
    .setName('staffstats')
    .setDescription('Staff only: show performance statistics for all staff members'),
];

async function handle(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'staffstats') {
    return false;
  }

  if (!isStaff(interaction.member)) {
    await interaction.reply({
      content: 'Only staff can view staff performance statistics.',
      flags: EPHEMERAL,
    });
    return true;
  }

  const stats = data.staffStats || {};
  const entries = Object.entries(stats);

  if (entries.length === 0) {
    await interaction.reply({
      content: '📊 No staff actions recorded yet. Stats will appear as orders are processed, sent, and completed.',
      flags: EPHEMERAL,
    });
    return true;
  }

  // Sort by completed + sent count descending
  entries.sort((a, b) => {
    const totalA = (a[1].sent || 0) + (a[1].completed || 0);
    const totalB = (b[1].sent || 0) + (b[1].completed || 0);
    return totalB - totalA;
  });

  const lines = entries.map(([userId, s], index) => {
    return (
      `**#${index + 1} <@${userId}>** (@${s.username})\n` +
      `> ⏳ Processing: \`${s.processed || 0}\`  •  📤 Sent: \`${s.sent || 0}\`  •  ✅ Completed: \`${s.completed || 0}\``
    );
  });

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('🏆  Staff Performance Leaderboard')
    .setDescription(lines.join('\n\n'))
    .setFooter({ text: 'Revéux Shop Staff Team • Tracked automatically' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
  return true;
}

module.exports = { commands, handle };
