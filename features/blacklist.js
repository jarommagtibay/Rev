// /blacklist -> Staff only: block malicious users from opening tickets
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLOR } = require('../config');
const { data, saveData } = require('../core/data');
const { EPHEMERAL, isStaff } = require('../core/helpers');

const commands = [
  new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Staff only: manage the shop blacklist')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Block a user from opening tickets')
        .addUserOption((o) =>
          o.setName('user').setDescription('The user to blacklist').setRequired(true)
        )
        .addStringOption((o) =>
          o.setName('reason').setDescription('Reason for blacklist').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Unblock a user from the blacklist')
        .addUserOption((o) =>
          o.setName('user').setDescription('The user to unblacklist').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List all currently blacklisted users')
    ),
];

async function handleAdd(interaction) {
  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'No reason specified';

  data.blacklist = Array.isArray(data.blacklist) ? data.blacklist : [];
  const existing = data.blacklist.find((b) => b.userId === target.id);
  if (existing) {
    existing.reason = reason;
    existing.by = interaction.user.username;
    existing.at = Date.now();
  } else {
    data.blacklist.push({
      userId: target.id,
      username: target.username,
      reason,
      by: interaction.user.username,
      at: Date.now(),
    });
  }
  saveData();

  return interaction.reply({
    content: `🚫 **${target.username}** (\`${target.id}\`) has been added to the blacklist.\nReason: **${reason}**`,
    flags: EPHEMERAL,
  });
}

async function handleRemove(interaction) {
  const target = interaction.options.getUser('user');
  data.blacklist = Array.isArray(data.blacklist) ? data.blacklist : [];
  const initialLen = data.blacklist.length;
  data.blacklist = data.blacklist.filter((b) => b.userId !== target.id);

  if (data.blacklist.length === initialLen) {
    return interaction.reply({
      content: `⚠️ **${target.username}** is not in the blacklist.`,
      flags: EPHEMERAL,
    });
  }

  saveData();
  return interaction.reply({
    content: `✅ **${target.username}** (\`${target.id}\`) has been removed from the blacklist.`,
    flags: EPHEMERAL,
  });
}

async function handleList(interaction) {
  data.blacklist = Array.isArray(data.blacklist) ? data.blacklist : [];
  if (data.blacklist.length === 0) {
    return interaction.reply({
      content: '✅ The blacklist is currently empty. No users are blocked.',
      flags: EPHEMERAL,
    });
  }

  const lines = data.blacklist.map(
    (b, idx) =>
      `**${idx + 1}.** <@${b.userId}> (\`${b.userId}\`)\n> 📌 **Reason:** ${b.reason}\n> 🛡️ **By:** @${b.by || 'staff'}`
  );

  const embed = new EmbedBuilder()
    .setTitle(`🚫 Blacklisted Users (${data.blacklist.length})`)
    .setColor(COLOR)
    .setDescription(lines.join('\n\n'))
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
}

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'blacklist') {
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: 'Only staff can manage the blacklist.',
        flags: EPHEMERAL,
      });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'add') await handleAdd(interaction);
    else if (sub === 'remove') await handleRemove(interaction);
    else if (sub === 'list') await handleList(interaction);
    return true;
  }
  return false;
}

module.exports = { commands, handle };
