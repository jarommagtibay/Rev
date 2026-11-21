// /duty -> Staff on-duty / off-duty shift toggle and status
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLOR } = require('../config');
const { data, saveData } = require('../core/data');
const { EPHEMERAL, isStaff } = require('../core/helpers');

const commands = [
  new SlashCommandBuilder()
    .setName('duty')
    .setDescription('Staff only: toggle or check staff on-duty and shift status')
    .addSubcommand((sub) =>
      sub
        .setName('on')
        .setDescription('Clock in: mark yourself as ON DUTY (ready to fulfill orders)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('off')
        .setDescription('Clock out: mark yourself as OFF DUTY / resting')
        .addStringOption((o) =>
          o.setName('note').setDescription('Optional note (e.g. Sleeping, back at 8 AM)').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('View current shift status of all staff members')
    ),
];

function areAllStaffOffDuty() {
  if (!data.staffDuty) return false;
  const entries = Object.values(data.staffDuty);
  if (entries.length === 0) return false; // no duty records = normal
  return !entries.some((s) => s.onDuty === true);
}

function getOffDutyNote() {
  if (!data.staffDuty) return '';
  const offStaff = Object.values(data.staffDuty).filter((s) => !s.onDuty && s.note);
  if (offStaff.length > 0) {
    return offStaff.map((s) => `• @${s.username}: "${s.note}"`).join('\n');
  }
  return '';
}

async function handle(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'duty') {
    return false;
  }

  if (!isStaff(interaction.member)) {
    await interaction.reply({
      content: 'Only staff can manage shift duty.',
      flags: EPHEMERAL,
    });
    return true;
  }

  const sub = interaction.options.getSubcommand();
  if (!data.staffDuty) data.staffDuty = {};

  if (sub === 'on') {
    data.staffDuty[interaction.user.id] = {
      onDuty: true,
      username: interaction.user.username,
      updatedAt: Date.now(),
    };
    saveData();

    await interaction.reply({
      content: `🟢 <@${interaction.user.id}> is now **ON DUTY**. Ready to take orders!`,
      flags: EPHEMERAL,
    });
    return true;
  }

  if (sub === 'off') {
    const note = interaction.options.getString('note') || '';
    data.staffDuty[interaction.user.id] = {
      onDuty: false,
      username: interaction.user.username,
      note,
      updatedAt: Date.now(),
    };
    saveData();

    const allOff = areAllStaffOffDuty();
    const notice = allOff
      ? '\n💤 **Notice:** All staff members are currently off-duty. Off-duty notices will automatically be shown in new tickets.'
      : '';

    await interaction.reply({
      content: `🌙 <@${interaction.user.id}> is now **OFF DUTY**. ${note ? `\n> Note: "${note}"` : ''}${notice}`,
      flags: EPHEMERAL,
    });
    return true;
  }

  if (sub === 'status') {
    const entries = Object.entries(data.staffDuty || {});
    if (entries.length === 0) {
      await interaction.reply({
        content: '📋 No staff shift records logged yet. Use `/duty on` or `/duty off` to clock in/out.',
        flags: EPHEMERAL,
      });
      return true;
    }

    const lines = entries.map(([id, s]) => {
      const statusIcon = s.onDuty ? '🟢 **ON DUTY**' : '🌙 **OFF DUTY**';
      const timeStr = s.updatedAt ? `<t:${Math.floor(s.updatedAt / 1000)}:R>` : 'Recently';
      const noteStr = s.note ? `\n> *Note: "${s.note}"*` : '';
      return `• <@${id}> (@${s.username}) — ${statusIcon} (${timeStr})${noteStr}`;
    });

    const allOff = areAllStaffOffDuty();
    const footerText = allOff ? 'All staff are off-duty • Off-duty notices active in tickets' : 'Staff is active and taking orders';

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle('🛡️  Staff Shift & Duty Status')
      .setDescription(lines.join('\n\n'))
      .setFooter({ text: footerText })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
    return true;
  }

  return false;
}

module.exports = { commands, handle, areAllStaffOffDuty, getOffDutyNote };
