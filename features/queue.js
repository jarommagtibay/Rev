// /queue -> full order list
// /next -> who is first in line
// /hold -> put a ticket on hold (adjusts queue automatically)
// /unhold -> resume a held ticket
// /move -> move a ticket to a specific position in the queue
const {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { COLOR } = require('../config');
const M = require('../messages');
const { data, saveData } = require('../core/data');
const { EPHEMERAL, isStaff, orderLabel, baseName } = require('../core/helpers');
const {
  setPositionField,
  stageFromEmbed,
  isPaid,
  ticketRows,
} = require('../core/ticket');
const { refreshQueue } = require('../core/queue');

const HOLD_COMMAND = M.commandNames.hold || 'hold';
const UNHOLD_COMMAND = M.commandNames.unhold || 'unhold';
const MOVE_COMMAND = M.commandNames.move || 'move';

const commands = [
  new SlashCommandBuilder()
    .setName(M.commandNames.queue)
    .setDescription('Staff only: show the full order queue (active and on hold)'),
  new SlashCommandBuilder()
    .setName(M.commandNames.next)
    .setDescription('Staff only: show who is next in line'),
  new SlashCommandBuilder()
    .setName(HOLD_COMMAND)
    .setDescription('Staff only: put this ticket on hold and adjust the queue')
    .addStringOption((o) =>
      o
        .setName('reason')
        .setDescription('Reason for putting on hold (e.g. Waiting for payment)')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName(UNHOLD_COMMAND)
    .setDescription('Staff only: resume a held ticket and return it to the queue')
    .addStringOption((o) =>
      o
        .setName('position')
        .setDescription('Where in line to return? (front or back)')
        .setRequired(false)
        .addChoices(
          { name: 'Front of line (first)', value: 'front' },
          { name: 'Back of line (last)', value: 'back' }
        )
    ),
  new SlashCommandBuilder()
    .setName(MOVE_COMMAND)
    .setDescription('Staff only: move this ticket to a specific position in the queue')
    .addIntegerOption((o) =>
      o
        .setName('position')
        .setDescription('Target position number (e.g. 1 for first)')
        .setRequired(true)
        .setMinValue(1)
    ),
];

// Helper: put a ticket on hold
async function holdTicket(channel, staffMember, reason = '') {
  const entry = data.queue.find((e) => e.channelId === channel.id);
  if (!entry) return { error: 'This ticket is not in the queue.' };
  if (entry.onHold) return { error: 'This ticket is already on hold.' };

  entry.onHold = true;
  entry.holdReason = reason || 'Waiting for customer / response';
  saveData();

  try {
    const message = await channel.messages.fetch({ message: entry.messageId, force: true });
    const embed = EmbedBuilder.from(message.embeds[0]);
    setPositionField(embed, '⏸️ On Hold');
    const stage = stageFromEmbed(embed);
    await message.edit({
      embeds: [embed],
      components: ticketRows(stage, isPaid(embed), true, true),
    });
    entry.shownPosition = '⏸️ On Hold';
    saveData();
  } catch (err) {
    // message not found, ignore
  }

  const wanted = `hold-${entry.safeName || baseName(channel.name)}`;
  channel.setName(wanted).catch(() => { });

  await channel.send({
    content: `<@${entry.userId}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('⏸️  Ticket Placed on Hold')
        .setDescription(
          `This ticket has been placed on hold by ${staffMember}.\n` +
          `**Reason:** ${entry.holdReason}\n\n` +
          'Please reply in this ticket when you are ready to resume your order.'
        )
        .setTimestamp(),
    ],
  });

  await refreshQueue(channel.guild);
  return { success: true };
}

// Helper: unhold / resume a ticket
async function unholdTicket(channel, staffMember, positionOption = 'front') {
  const entry = data.queue.find((e) => e.channelId === channel.id);
  if (!entry) return { error: 'This ticket is not in the queue.' };
  if (!entry.onHold) return { error: 'This ticket is not on hold.' };

  entry.onHold = false;
  delete entry.holdReason;

  if (positionOption === 'back') {
    data.queue = data.queue.filter((e) => e !== entry).concat([entry]);
  } else if (typeof positionOption === 'number' && positionOption >= 1) {
    const targetIdx = Math.min(positionOption - 1, data.queue.length - 1);
    data.queue = data.queue.filter((e) => e !== entry);
    data.queue.splice(targetIdx, 0, entry);
  } else {
    // Default 'front': place at the beginning so customer resumes priority
    data.queue = [entry, ...data.queue.filter((e) => e !== entry)];
  }
  saveData();

  try {
    const message = await channel.messages.fetch({ message: entry.messageId, force: true });
    const embed = EmbedBuilder.from(message.embeds[0]);
    const stage = stageFromEmbed(embed);
    await message.edit({
      embeds: [embed],
      components: ticketRows(stage, isPaid(embed), true, false),
    });
  } catch (err) {
    // message not found, ignore
  }

  await channel.send({
    content: `<@${entry.userId}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('▶️  Ticket Resumed')
        .setDescription(
          `Your ticket has been resumed by ${staffMember} and is back in the active queue!`
        )
        .setTimestamp(),
    ],
  });

  await refreshQueue(channel.guild);
  return { success: true };
}

// Helper: manually move a ticket position
async function moveTicket(channel, staffMember, newPos) {
  const entry = data.queue.find((e) => e.channelId === channel.id);
  if (!entry) return { error: 'This ticket is not in the queue.' };
  if (entry.onHold) return { error: 'This ticket is currently on hold. Unhold it first before moving.' };

  const activeQueue = data.queue.filter((e) => !e.onHold);
  if (newPos < 1 || newPos > activeQueue.length) {
    return { error: `Position must be between 1 and ${activeQueue.length}.` };
  }

  const otherActive = activeQueue.filter((e) => e !== entry);
  otherActive.splice(newPos - 1, 0, entry);

  const held = data.queue.filter((e) => e.onHold);
  data.queue = [...otherActive, ...held];
  saveData();

  await refreshQueue(channel.guild);
  return { success: true, position: newPos };
}

async function runQueue(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can use this command.',
      flags: EPHEMERAL,
    });
  }

  const active = data.queue.filter((e) => !e.onHold);
  const held = data.queue.filter((e) => e.onHold);

  if (active.length === 0 && held.length === 0) {
    return interaction.reply({
      content: 'The queue is empty.',
      flags: EPHEMERAL,
    });
  }

  const activeLines = active.map(
    (e, i) =>
      `**#${i + 1}** ${e.name}${e.username ? ` (@${e.username})` : ''} - ${orderLabel(e)} - <#${e.channelId}>`
  );
  const heldLines = held.map(
    (e) =>
      `⏸️ ${e.name}${e.username ? ` (@${e.username})` : ''} - ${orderLabel(e)} - <#${e.channelId}>${
        e.holdReason ? ` *(Reason: ${e.holdReason})*` : ''
      }`
  );

  const embed = new EmbedBuilder()
    .setTitle(`Order Queue (${active.length} active, ${held.length} on hold)`)
    .setColor(COLOR);

  if (activeLines.length > 0) {
    embed.addFields({
      name: '🟢 Active Queue',
      value: activeLines.join('\n').slice(0, 1024),
    });
  }
  if (heldLines.length > 0) {
    embed.addFields({
      name: '⏸️ On Hold',
      value: heldLines.join('\n').slice(0, 1024),
    });
  }

  return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
}

async function runNext(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can use this command.',
      flags: EPHEMERAL,
    });
  }

  const first = data.queue.find((e) => !e.onHold);
  if (!first) {
    return interaction.reply({
      content: 'There are no active orders in the queue right now.',
      flags: EPHEMERAL,
    });
  }

  return interaction.reply({
    content: `Next in line: **${first.name}**${first.username ? ` (@${first.username})` : ''} - ${orderLabel(first)} - <#${first.channelId}>`,
    flags: EPHEMERAL,
  });
}

function showHoldModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('hold_ticket_modal')
    .setTitle('Hold Ticket');

  const reasonInput = new TextInputBuilder()
    .setCustomId('hold_reason')
    .setLabel('Reason for hold (optional)')
    .setPlaceholder('e.g. Waiting for payment / AFK')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  return interaction.showModal(modal);
}

// Shared checks for /hold, /unhold and /move: staff only, and only inside a ticket channel.
// Replies and returns true when the command must stop.
async function rejectUnlessStaffInTicket(interaction) {
  if (!isStaff(interaction.member)) {
    await interaction.reply({ content: 'Only staff can use this command.', flags: EPHEMERAL });
    return true;
  }
  if (!(interaction.channel.topic || '').startsWith('ticket:')) {
    await interaction.reply({
      content: 'This command only works inside a ticket channel.',
      flags: EPHEMERAL,
    });
    return true;
  }
  return false;
}

async function handle(interaction) {
  // Hold / Resume buttons
  if (interaction.isButton()) {
    if (interaction.customId === 'hold_ticket') {
      if (!isStaff(interaction.member)) {
        await interaction.reply({ content: 'Only staff can hold tickets.', flags: EPHEMERAL });
        return true;
      }
      await showHoldModal(interaction);
      return true;
    }

    if (interaction.customId === 'unhold_ticket') {
      if (!isStaff(interaction.member)) {
        await interaction.reply({ content: 'Only staff can resume tickets.', flags: EPHEMERAL });
        return true;
      }
      await interaction.deferReply({ flags: EPHEMERAL });
      const res = await unholdTicket(interaction.channel, interaction.user, 'front');
      await interaction.editReply(res.error || '▶️ Ticket resumed and returned to queue #1.');
      return true;
    }
  }

  // Hold reason modal submitted
  if (interaction.isModalSubmit() && interaction.customId === 'hold_ticket_modal') {
    if (!isStaff(interaction.member)) {
      await interaction.reply({ content: 'Only staff can hold tickets.', flags: EPHEMERAL });
      return true;
    }
    const reason = interaction.fields.getTextInputValue('hold_reason').trim();
    await interaction.deferReply({ flags: EPHEMERAL });
    const res = await holdTicket(interaction.channel, interaction.user, reason);
    await interaction.editReply(res.error || '⏸️ Ticket placed on hold. Queue updated.');
    return true;
  }

  // Slash commands
  if (interaction.isChatInputCommand()) {
    const name = interaction.commandName;

    if (name === M.commandNames.queue) {
      await runQueue(interaction);
      return true;
    }
    if (name === M.commandNames.next) {
      await runNext(interaction);
      return true;
    }

    // /hold [reason]
    if (name === HOLD_COMMAND) {
      if (await rejectUnlessStaffInTicket(interaction)) return true;
      const reason = interaction.options.getString('reason') || '';
      await interaction.deferReply({ flags: EPHEMERAL });
      const res = await holdTicket(interaction.channel, interaction.user, reason);
      await interaction.editReply(res.error || '⏸️ Ticket placed on hold. Queue updated.');
      return true;
    }

    // /unhold [position]
    if (name === UNHOLD_COMMAND) {
      if (await rejectUnlessStaffInTicket(interaction)) return true;
      const posOpt = interaction.options.getString('position') || 'front';
      await interaction.deferReply({ flags: EPHEMERAL });
      const res = await unholdTicket(interaction.channel, interaction.user, posOpt);
      await interaction.editReply(res.error || `▶️ Ticket resumed at ${posOpt} of queue. Queue updated.`);
      return true;
    }

    // /move <position>
    if (name === MOVE_COMMAND) {
      if (await rejectUnlessStaffInTicket(interaction)) return true;
      const targetPos = interaction.options.getInteger('position');
      await interaction.deferReply({ flags: EPHEMERAL });
      const res = await moveTicket(interaction.channel, interaction.user, targetPos);
      await interaction.editReply(
        res.error || `✅ Moved this ticket to position **#${res.position}**. Queue updated.`
      );
      return true;
    }
  }

  return false;
}

module.exports = { commands, handle, holdTicket, unholdTicket, moveTicket };
