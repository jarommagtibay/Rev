// Staff AFK / Step Away Auto-Responder
// Allows staff to set /afk and auto-replies to customers inside tickets while staff is away.
// Automatically turns OFF when staff sends any message in the server.
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLOR } = require('../config');
const { data, saveData } = require('../core/data');
const { EPHEMERAL, isStaff } = require('../core/helpers');

const commands = [
  new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Staff only: mark yourself as temporarily AFK with an auto-reply in tickets')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set yourself as AFK with a reason')
        .addStringOption((opt) =>
          opt
            .setName('reason')
            .setDescription('Reason for stepping away (e.g. Back in 10 mins, eating)')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('off')
        .setDescription('Remove your AFK status')
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('View which staff members are currently AFK')
    ),
];

function setStaffAfk(userId, username, reason = 'Stepped away, back soon') {
  if (!data.staffAfk || typeof data.staffAfk !== 'object') data.staffAfk = {};
  data.staffAfk[userId] = {
    userId,
    username,
    reason: reason || 'Stepped away, back soon',
    setAt: Date.now(),
  };
  saveData();
}

function clearStaffAfk(userId) {
  if (!data.staffAfk || typeof data.staffAfk !== 'object') return false;
  if (data.staffAfk[userId]) {
    delete data.staffAfk[userId];
    saveData();
    return true;
  }
  return false;
}

function getActiveAfkStaff() {
  if (!data.staffAfk || typeof data.staffAfk !== 'object') return [];
  return Object.values(data.staffAfk);
}

async function handle(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'afk') return false;

  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can use this command.',
      flags: EPHEMERAL,
    });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'set') {
    const reason = interaction.options.getString('reason') || 'Back in 10-15 mins';
    setStaffAfk(interaction.user.id, interaction.user.username, reason);

    await interaction.reply({
      content:
        `⏸️ <@${interaction.user.id}> is now **AFK**.\n` +
        `> **Reason:** "${reason}"\n\n` +
        `Customers who message in tickets will receive an auto-reply. Sending any message in the server will automatically turn off your AFK status!`,
      flags: EPHEMERAL,
    });
    return true;
  }

  if (sub === 'off') {
    const wasAfk = clearStaffAfk(interaction.user.id);
    await interaction.reply({
      content: wasAfk
        ? `🟢 Welcome back <@${interaction.user.id}>! Your AFK status has been removed.`
        : 'You were not marked as AFK.',
      flags: EPHEMERAL,
    });
    return true;
  }

  if (sub === 'status') {
    const afkList = getActiveAfkStaff();
    if (afkList.length === 0) {
      return interaction.reply({
        content: '🟢 No staff members are currently AFK. All on-duty staff are active!',
        flags: EPHEMERAL,
      });
    }

    const lines = afkList.map((a) => {
      const timeStr = `<t:${Math.floor(a.setAt / 1000)}:R>`;
      return `• <@${a.userId}> (@${a.username}) — *"${a.reason}"* (${timeStr})`;
    });

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle('⏸️  Staff AFK Status')
      .setDescription(lines.join('\n\n'))
      .setFooter({ text: 'AFK turns off automatically when staff speaks' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
  }

  return false;
}

module.exports = {
  commands,
  handle,
  setStaffAfk,
  clearStaffAfk,
  getActiveAfkStaff,
};
