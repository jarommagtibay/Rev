// /copilot -> Staff-only ephemeral AI Copilot with 1-click suggested actions inside tickets
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { COLOR, CURRENCY } = require('../config');
const { data } = require('../core/data');
const { EPHEMERAL, isStaff, getCustomerId } = require('../core/helpers');
const { stageFromEmbed, isPaid } = require('../core/ticket');
const { markPaymentReceived, markProcessing } = require('../core/orderActions');
const { setStickyRemind } = require('../core/sticky');
const { analyzeTicketForCopilot, fetchFullTicketTranscript } = require('../core/ai');

const commands = [
  new SlashCommandBuilder()
    .setName('copilot')
    .setDescription('Staff only: private AI ticket analysis with 1-click suggested replies & actions')
    .addStringOption((o) =>
      o
        .setName('focus')
        .setDescription('Optional question or context (e.g. "how to handle this underpayment?")')
        .setRequired(false)
        .setMaxLength(200)
    ),
];

// Short-lived cache for copilot suggestions (15 min TTL)
const copilotCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000;

function saveCopilotState(token, state) {
  const now = Date.now();
  for (const [k, v] of copilotCache.entries()) {
    if (now - v.createdAt > CACHE_TTL_MS) copilotCache.delete(k);
  }
  copilotCache.set(token, { ...state, createdAt: now });
}

const ACTION_META = {
  send_reply: { label: 'Send Suggested Reply', emoji: '💬', style: ButtonStyle.Primary },
  edit_reply: { label: 'Edit & Send Reply', emoji: '✏️', style: ButtonStyle.Secondary },
  send_balance_reminder: { label: 'Send Balance Reminder', emoji: '💰', style: ButtonStyle.Secondary },
  ask_clear_receipt: { label: 'Ask Clearer Receipt', emoji: '🧾', style: ButtonStyle.Secondary },
  mark_paid: { label: 'Mark Payment Received', emoji: '✅', style: ButtonStyle.Success },
  mark_processing: { label: 'Mark Processing', emoji: '⏳', style: ButtonStyle.Success },
  pin_vouch_reminder: { label: 'Pin Vouch Reminder', emoji: '⭐', style: ButtonStyle.Secondary },
};

function buildCopilotButtons(actions, token) {
  const unique = [...new Set(actions)].filter((a) => ACTION_META[a]).slice(0, 5);
  if (unique.length === 0) return [];
  const row = new ActionRowBuilder();
  for (const actionId of unique) {
    const meta = ACTION_META[actionId];
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`copilot_act:${actionId}:${token}`)
        .setLabel(meta.label)
        .setEmoji(meta.emoji)
        .setStyle(meta.style)
    );
  }
  return [row];
}

async function runCopilot(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can use `/copilot`.',
      flags: EPHEMERAL,
    });
  }

  if (!(interaction.channel.topic || '').startsWith('ticket:')) {
    return interaction.reply({
      content: 'This command only works inside a ticket channel.',
      flags: EPHEMERAL,
    });
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  const channel = interaction.channel;
  const focus = interaction.options.getString('focus') || '';
  const entry = data.queue.find((e) => e.channelId === channel.id);

  let stage = 'open';
  let isPaidFlag = false;
  let orderId = (entry && entry.orderId) || 'REV-XXXX';
  const productText = entry
    ? entry.type === 'game'
      ? `${entry.label} (${entry.gameName})`
      : `${(entry.amount || 0).toLocaleString()} Robux (${entry.username || '-'})`
    : channel.name;

  if (entry && entry.messageId) {
    const mainMsg = await channel.messages.fetch({ message: entry.messageId, force: true }).catch(() => null);
    if (mainMsg && mainMsg.embeds.length > 0) {
      const embed = mainMsg.embeds[0];
      stage = stageFromEmbed(embed);
      isPaidFlag = isPaid(embed);
      const idField = (embed.data?.fields || embed.fields || []).find((f) => f.name === 'Order ID');
      if (idField) orderId = idField.value.replace(/[`#]/g, '').trim();
    }
  }

  // Fetch the FULL ticket conversation for maximum AI context
  const transcript = await fetchFullTicketTranscript(channel, entry?.messageId);

  const sticky = (data.sticky && data.sticky[channel.id]) || {};
  const result = await analyzeTicketForCopilot({
    orderId,
    productText,
    price: entry?.price || 0,
    amountPaid: entry?.amountPaid || 0,
    paymentCount: (entry?.payments && entry.payments.length) || 0,
    stage,
    isPaidFlag,
    onHold: Boolean(entry?.onHold),
    stickyNote: sticky.note?.text || null,
    stickyRemind: sticky.remind?.type || null,
    lastReceipt: entry?.lastScannedReceipt || null,
    transcriptSnippet: transcript,
    focus,
  });

  const total = Number(entry?.price) || 0;
  const paid = Number(entry?.amountPaid) || 0;
  const remaining = Math.max(0, total - paid);
  const customerId = getCustomerId(channel);

  const token = `${channel.id.slice(-6)}_${Date.now().toString(36)}`;
  saveCopilotState(token, {
    channelId: channel.id,
    orderId,
    customerId,
    remaining,
    suggestedReply: result.suggestedReply,
  });

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`✨  AI Staff Copilot — #${orderId}`)
    .addFields(
      { name: '🔍  Situation', value: result.situation },
      { name: '💬  Suggested Reply', value: `> ${result.suggestedReply}` }
    )
    .setFooter({ text: `Private to you • ${result.engine}` })
    .setTimestamp();

  return interaction.editReply({
    embeds: [embed],
    components: buildCopilotButtons(result.actions, token),
  });
}

async function handleCopilotAction(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can use Copilot actions.', flags: EPHEMERAL });
  }

  const parts = interaction.customId.split(':');
  const actionId = parts[1];
  const token = parts[2];
  const state = copilotCache.get(token);

  if (!state || state.channelId !== interaction.channel.id) {
    return interaction.reply({
      content: '⌛ This Copilot suggestion expired. Run `/copilot` again for a fresh one.',
      flags: EPHEMERAL,
    });
  }

  const channel = interaction.channel;
  const mention = state.customerId ? `<@${state.customerId}> ` : '';

  if (actionId === 'edit_reply') {
    const modal = new ModalBuilder()
      .setCustomId(`copilot_modal:${token}`)
      .setTitle('Edit Copilot Reply');
    const input = new TextInputBuilder()
      .setCustomId('reply_text')
      .setLabel('Message to send in ticket')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000)
      .setValue(state.suggestedReply || '');
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  if (actionId === 'send_reply') {
    await channel.send(`${mention}${state.suggestedReply}`);
    return interaction.editReply('✅ Sent the suggested reply to the ticket.');
  }

  if (actionId === 'send_balance_reminder') {
    const remText =
      state.remaining > 0.01
        ? `Please send the remaining balance of **${CURRENCY}${state.remaining.toFixed(2)}** and upload the receipt here so we can process your order.`
        : 'Please upload your remaining payment receipt here so we can proceed with your order.';
    await setStickyRemind(channel, 'receipt', remText, interaction.user.username, state.customerId);
    return interaction.editReply('✅ Pinned a balance reminder for the customer.');
  }

  if (actionId === 'ask_clear_receipt') {
    const msg =
      'Please send a **clear, uncropped receipt screenshot** showing the full **Amount** and **Reference No.** so we can verify your payment.';
    await setStickyRemind(channel, 'receipt', msg, interaction.user.username, state.customerId);
    return interaction.editReply('✅ Pinned a clearer-receipt reminder for the customer.');
  }

  if (actionId === 'pin_vouch_reminder') {
    const msg =
      'Your order has been delivered! Please click a **star rating button** above to leave a quick vouch and complete your order ⭐';
    await setStickyRemind(channel, 'vouch', msg, interaction.user.username, state.customerId);
    return interaction.editReply('✅ Pinned a vouch reminder for the customer.');
  }

  if (actionId === 'mark_paid' || actionId === 'mark_processing') {
    const entry = data.queue.find((e) => e.channelId === channel.id);
    if (!entry || !entry.messageId) {
      return interaction.editReply('This order is no longer active in the queue.');
    }
    const mainMsg = await channel.messages.fetch({ message: entry.messageId, force: true }).catch(() => null);
    if (!mainMsg) {
      return interaction.editReply('Could not find the main ticket order card.');
    }

    if (actionId === 'mark_paid') {
      const res = await markPaymentReceived(mainMsg, channel, interaction.user);
      return interaction.editReply(res.error || '✅ Payment marked as received.');
    } else {
      const res = await markProcessing(mainMsg, channel, interaction.user);
      return interaction.editReply(res.error || '⏳ Order marked as processing.');
    }
  }

  return interaction.editReply('Unknown Copilot action.');
}

async function handleCopilotModal(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can send Copilot replies.', flags: EPHEMERAL });
  }
  const token = interaction.customId.split(':')[1];
  const state = copilotCache.get(token);
  const text = (interaction.fields.getTextInputValue('reply_text') || '').trim();
  if (!text) {
    return interaction.reply({ content: 'Reply cannot be empty.', flags: EPHEMERAL });
  }
  const customerId = state ? state.customerId : getCustomerId(interaction.channel);
  const mention = customerId ? `<@${customerId}> ` : '';
  await interaction.channel.send(`${mention}${text}`);
  return interaction.reply({ content: '✅ Sent your edited reply to the ticket.', flags: EPHEMERAL });
}

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'copilot') {
    await runCopilot(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith('copilot_act:')) {
    await handleCopilotAction(interaction);
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('copilot_modal:')) {
    await handleCopilotModal(interaction);
    return true;
  }
  return false;
}

module.exports = { commands, handle };
