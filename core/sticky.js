// Core sticky note & reminder manager: keeps staff notes and customer reminders pinned to the bottom of tickets
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { COLOR } = require('../config');
const { data, saveData } = require('./data');
const { isStaff, getCustomerId, EPHEMERAL } = require('./helpers');

// In-memory debounce/lock to avoid loop triggers when re-sticking messages
const channelLocks = new Set();

function buildNoteMessage(noteData) {
  const embed = new EmbedBuilder()
    .setColor(0xffd700) // Gold
    .setTitle('📌  Internal Staff Note')
    .setDescription(noteData.text)
    .setFooter({ text: `Note by @${noteData.author} • Pinned to bottom` })
    .setTimestamp(noteData.timestamp || Date.now());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('dismiss_sticky:note')
      .setLabel('✕ Dismiss Note')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

function buildRemindMessage(remindData) {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('🔔  Customer Reminder')
    .setDescription(remindData.desc)
    .setFooter({ text: `Reminder by @${remindData.author} • Pinned to bottom` })
    .setTimestamp(remindData.timestamp || Date.now());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('dismiss_sticky:remind')
      .setLabel('✕ Dismiss Reminder')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    content: remindData.customerId ? `<@${remindData.customerId}>` : undefined,
    embeds: [embed],
    components: [row],
  };
}

async function setStickyNote(channel, text, authorUsername) {
  data.sticky = data.sticky || {};
  data.sticky[channel.id] = data.sticky[channel.id] || {};

  // Delete previous note if present
  if (data.sticky[channel.id].note && data.sticky[channel.id].note.messageId) {
    try {
      const old = await channel.messages.fetch(data.sticky[channel.id].note.messageId).catch(() => null);
      if (old) await old.delete().catch(() => {});
    } catch {}
  }

  const noteData = {
    text,
    author: authorUsername,
    timestamp: Date.now(),
  };

  const payload = buildNoteMessage(noteData);
  const msg = await channel.send(payload);

  noteData.messageId = msg.id;
  data.sticky[channel.id].note = noteData;
  saveData();
  return msg;
}

async function setStickyRemind(channel, type, desc, authorUsername, customerId) {
  data.sticky = data.sticky || {};
  data.sticky[channel.id] = data.sticky[channel.id] || {};

  // Delete previous reminder if present
  if (data.sticky[channel.id].remind && data.sticky[channel.id].remind.messageId) {
    try {
      const old = await channel.messages.fetch(data.sticky[channel.id].remind.messageId).catch(() => null);
      if (old) await old.delete().catch(() => {});
    } catch {}
  }

  const remindData = {
    type,
    desc,
    author: authorUsername,
    customerId,
    timestamp: Date.now(),
  };

  const payload = buildRemindMessage(remindData);
  const msg = await channel.send(payload);

  remindData.messageId = msg.id;
  data.sticky[channel.id].remind = remindData;
  saveData();
  return msg;
}

function clearSticky(channelId, type = 'all') {
  if (!data.sticky || !data.sticky[channelId]) return;
  if (type === 'note') {
    delete data.sticky[channelId].note;
  } else if (type === 'remind') {
    delete data.sticky[channelId].remind;
  } else {
    delete data.sticky[channelId];
  }
  saveData();
}

// Automatically called whenever a message is sent in a ticket channel:
// Deletes previous sticky messages and resends them at the bottom.
async function repositionSticky(message) {
  if (!message.guild || message.author.bot) return;
  const channelId = message.channel.id;
  if (!data.sticky || !data.sticky[channelId]) return;

  const currentSticky = data.sticky[channelId];
  const hasNote = Boolean(currentSticky.note && currentSticky.note.text);
  const hasRemind = Boolean(currentSticky.remind && currentSticky.remind.desc);

  if (!hasNote && !hasRemind) return;
  if (channelLocks.has(channelId)) return;

  channelLocks.add(channelId);
  try {
    // 1. Resend Note if present
    if (hasNote) {
      const oldNoteId = currentSticky.note.messageId;
      if (oldNoteId) {
        try {
          const oldMsg = await message.channel.messages.fetch(oldNoteId).catch(() => null);
          if (oldMsg) await oldMsg.delete().catch(() => {});
        } catch {}
      }

      const notePayload = buildNoteMessage(currentSticky.note);
      const newMsg = await message.channel.send(notePayload);
      currentSticky.note.messageId = newMsg.id;
    }

    // 2. Resend Reminder if present
    if (hasRemind) {
      const oldRemindId = currentSticky.remind.messageId;
      if (oldRemindId) {
        try {
          const oldMsg = await message.channel.messages.fetch(oldRemindId).catch(() => null);
          if (oldMsg) await oldMsg.delete().catch(() => {});
        } catch {}
      }

      const remindPayload = buildRemindMessage(currentSticky.remind);
      const newMsg = await message.channel.send(remindPayload);
      currentSticky.remind.messageId = newMsg.id;
    }

    saveData();
  } catch (err) {
    console.error(`[sticky] Error repositioning sticky messages in #${message.channel.name}:`, err);
  } finally {
    // Delay releasing lock slightly to absorb any rapid multi-message bursts
    setTimeout(() => {
      channelLocks.delete(channelId);
    }, 1500);
  }
}

async function handleStickyInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('dismiss_sticky:')) return false;

  const [, type] = interaction.customId.split(':');
  const channel = interaction.channel;
  const channelId = channel.id;

  if (type === 'note') {
    if (!isStaff(interaction.member)) {
      await interaction.reply({
        content: 'Only staff can dismiss internal notes.',
        flags: EPHEMERAL,
      });
      return true;
    }

    clearSticky(channelId, 'note');
    try {
      await interaction.message.delete().catch(() => {});
    } catch {}

    await interaction.reply({
      content: '✅ Internal staff note dismissed and unpinned.',
      flags: EPHEMERAL,
    });
    return true;
  }

  if (type === 'remind') {
    const custId = getCustomerId(channel);
    const allowed = isStaff(interaction.member) || interaction.user.id === custId;
    if (!allowed) {
      await interaction.reply({
        content: 'Only the customer or staff can dismiss this reminder.',
        flags: EPHEMERAL,
      });
      return true;
    }

    clearSticky(channelId, 'remind');
    try {
      await interaction.message.delete().catch(() => {});
    } catch {}

    await interaction.reply({
      content: '✅ Reminder dismissed and unpinned.',
      flags: EPHEMERAL,
    });
    return true;
  }

  return false;
}

module.exports = {
  setStickyNote,
  setStickyRemind,
  clearSticky,
  repositionSticky,
  handleStickyInteraction,
};
