// /queue -> full order list    /next -> who is first in line   (staff only)
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLOR } = require('../config');
const M = require('../messages');
const { data } = require('../core/data');
const { EPHEMERAL, isStaff, orderLabel } = require('../core/helpers');

const commands = [
  new SlashCommandBuilder()
    .setName(M.commandNames.queue)
    .setDescription('Staff only: show the full order queue'),
  new SlashCommandBuilder()
    .setName(M.commandNames.next)
    .setDescription('Staff only: show who is next in line'),
];

async function runQueue(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can use this command.',
      flags: EPHEMERAL,
    });
  }

  if (data.queue.length === 0) {
    return interaction.reply({
      content: 'The queue is empty.',
      flags: EPHEMERAL,
    });
  }

  const lines = data.queue.map(
    (e, i) =>
      `**#${i + 1}** ${e.name}${e.username ? ` (@${e.username})` : ''} - ${orderLabel(e)} - <#${e.channelId}>`
  );

  const embed = new EmbedBuilder()
    .setTitle(`Order Queue (${data.queue.length})`)
    .setDescription(lines.join('\n').slice(0, 4000))
    .setColor(COLOR);

  return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
}

async function runNext(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can use this command.',
      flags: EPHEMERAL,
    });
  }

  const first = data.queue[0];
  if (!first) {
    return interaction.reply({
      content: 'The queue is empty.',
      flags: EPHEMERAL,
    });
  }

  return interaction.reply({
    content: `Next in line: **${first.name}**${first.username ? ` (@${first.username})` : ''} - ${orderLabel(first)} - <#${first.channelId}>`,
    flags: EPHEMERAL,
  });
}

async function handle(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  if (interaction.commandName === M.commandNames.queue) {
    await runQueue(interaction);
    return true;
  }
  if (interaction.commandName === M.commandNames.next) {
    await runNext(interaction);
    return true;
  }
  return false;
}

module.exports = { commands, handle };
