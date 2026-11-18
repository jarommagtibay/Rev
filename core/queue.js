// Queue helpers
const { EmbedBuilder } = require('discord.js');
const { COLOR } = require('../config');
const { data, saveData } = require('./data');
const M = require('../messages');
const { baseName, fill } = require('./helpers');
const { setPositionField } = require('./ticket');

// Updates the position shown in every open ticket (embed + channel name)
async function refreshQueue(guild) {
  const activeQueue = data.queue.filter((e) => !e.onHold);

  // Active queue: calculate #1, #2, #3...
  for (let i = 0; i < activeQueue.length; i++) {
    const entry = activeQueue[i];
    try {
      const channel = await guild.channels.fetch(entry.channelId);
      const message = await channel.messages.fetch({ message: entry.messageId, force: true });
      const embed = EmbedBuilder.from(message.embeds[0]);
      setPositionField(embed, `#${i + 1}`);
      await message.edit({ embeds: [embed] });

      // Rename the channel to show the queue number
      // (not awaited: Discord limits renames to about 2 per 10 minutes per channel)
      const wanted = `queue-${i + 1}-${entry.safeName || baseName(channel.name)}`;
      if (channel.name !== wanted) {
        channel.setName(wanted).catch(() => { });
      }

      // Tell the customer when they reach the front
      if (i === 0 && !entry.notifiedNext) {
        entry.notifiedNext = true;
        saveData();
        await channel.send({
          content: `<@${entry.userId}>`,
          embeds: [
            new EmbedBuilder()
              .setColor(COLOR)
              .setTitle(fill(M.nextInLine.title))
              .setDescription(fill(M.nextInLine.text))
              .setTimestamp(),
          ],
        });
      }
    } catch (err) {
      // channel or message is gone, ignore
    }
  }

  // Held tickets: ⏸️ On Hold
  const heldQueue = data.queue.filter((e) => e.onHold);
  for (const entry of heldQueue) {
    try {
      const channel = await guild.channels.fetch(entry.channelId);
      const message = await channel.messages.fetch({ message: entry.messageId, force: true });
      const embed = EmbedBuilder.from(message.embeds[0]);
      setPositionField(embed, '⏸️ On Hold');
      await message.edit({ embeds: [embed] });

      const wanted = `hold-${entry.safeName || baseName(channel.name)}`;
      if (channel.name !== wanted) {
        channel.setName(wanted).catch(() => { });
      }
    } catch (err) {
      // ignore
    }
  }
}

function removeFromQueue(channelId) {
  const before = data.queue.length;
  data.queue = data.queue.filter((e) => e.channelId !== channelId);
  if (data.queue.length !== before) saveData();
  return data.queue.length !== before;
}

// Stock that is still free to order: the real stock minus every Robux order waiting in the queue.
// (Game orders do not use Robux stock.) excludeChannelId = ignore one order, used when editing it.
function availableStock(excludeChannelId = null) {
  const reserved = data.queue
    .filter((e) => e.type !== 'game' && e.channelId !== excludeChannelId)
    .reduce((sum, e) => sum + (e.amount || 0), 0);
  return Math.max(0, data.stock - reserved);
}

function notEnoughStockMessage(available) {
  const note = data.stock > available ? ' right now (the rest is reserved for orders already in the queue)' : '';
  return `Not enough stock. We only have **${available.toLocaleString()}** Robux available${note}.`;
}

module.exports = { refreshQueue, removeFromQueue, availableStock, notEnoughStockMessage };