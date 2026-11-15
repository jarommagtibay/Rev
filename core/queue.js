// Queue helpers
const { EmbedBuilder } = require('discord.js');
const { COLOR } = require('../config');
const { data, saveData } = require('./data');
const M = require('../messages');
const { baseName, fill } = require('./helpers');
const { setPositionField } = require('./ticket');

// Updates the position shown in every open ticket (embed + channel name)
async function refreshQueue(guild) {
  for (let i = 0; i < data.queue.length; i++) {
    const entry = data.queue[i];
    try {
      const channel = await guild.channels.fetch(entry.channelId);
      const message = await channel.messages.fetch(entry.messageId);
      const embed = EmbedBuilder.from(message.embeds[0]);
      setPositionField(embed, `#${i + 1}`);
      await message.edit({ embeds: [embed] });

      // Rename the channel to show the queue number
      // (not awaited: Discord limits renames to about 2 per 10 minutes per channel)
      const wanted = `queue-${i + 1}-${entry.safeName || baseName(channel.name)}`;
      if (channel.name !== wanted) {
        channel.setName(wanted).catch(() => {});
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
}

function removeFromQueue(channelId) {
  const before = data.queue.length;
  data.queue = data.queue.filter((e) => e.channelId !== channelId);
  if (data.queue.length !== before) saveData();
  return data.queue.length !== before;
}

module.exports = { refreshQueue, removeFromQueue };
