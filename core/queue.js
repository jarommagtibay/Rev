// Queue helpers
const { EmbedBuilder } = require('discord.js');
const { COLOR } = require('../config');
const { data, saveData } = require('./data');
const M = require('../messages');
const { baseName, fill } = require('./helpers');
const { setPositionField } = require('./ticket');

// Discord allows about 2 channel renames per 10 minutes per channel. Renaming a ticket more often
// than this only fills Discord's queue with waiting requests, so position renames are spaced out.
// (Hold <-> active changes are always renamed at once. The embed always shows the real position.)
const RENAME_COOLDOWN = 5 * 60 * 1000;

async function getTicketChannel(guild, channelId) {
  return guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId));
}

// Brings one ticket up to date: the position in its embed (only if it changed) and the channel name.
// Returns true if something was changed that needs saving.
async function syncTicket(guild, entry, positionText, nameFor) {
  const channel = await getTicketChannel(guild, entry.channelId);
  const wantedName = nameFor(channel);
  let changed = false;

  if (entry.shownPosition !== positionText) {
    const message = await channel.messages.fetch({ message: entry.messageId, force: true });
    const embed = EmbedBuilder.from(message.embeds[0]);
    setPositionField(embed, positionText);
    await message.edit({ embeds: [embed] });
    entry.shownPosition = positionText;
    changed = true;
  }

  if (channel.name !== wantedName) {
    const stateChange = channel.name.startsWith('hold-') !== wantedName.startsWith('hold-');
    if (stateChange || Date.now() - (entry.renamedAt || 0) >= RENAME_COOLDOWN) {
      entry.renamedAt = Date.now();
      changed = true;
      // not awaited: a rename that Discord delays must not slow the queue down
      channel.setName(wantedName).catch(() => { });
    }
  }

  return { channel, changed };
}

async function refreshQueueNow(guild) {
  let needsSave = false;

  // Sort queue: Express orders first, then regular orders
  data.queue.sort((a, b) => {
    if (a.isExpress && !b.isExpress) return -1;
    if (!a.isExpress && b.isExpress) return 1;
    return 0;
  });

  const activeQueue = data.queue.filter((e) => !e.onHold);

  // Active queue: calculate #1, #2, #3... (express orders marked with ⚡ EXPRESS)
  for (let i = 0; i < activeQueue.length; i++) {
    const entry = activeQueue[i];
    const isExp = Boolean(entry.isExpress);
    const posText = isExp ? `#${i + 1} ⚡ EXPRESS` : `#${i + 1}`;
    const namePrefix = isExp ? `express-${i + 1}` : `queue-${i + 1}`;
    try {
      const { channel, changed } = await syncTicket(
        guild,
        entry,
        posText,
        (ch) => `${namePrefix}-${entry.safeName || baseName(ch.name)}`
      );
      if (changed) needsSave = true;

      // Tell the customer when they reach the front
      if (i === 0 && !entry.notifiedNext) {
        entry.notifiedNext = true;
        needsSave = true;
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
  for (const entry of data.queue.filter((e) => e.onHold)) {
    try {
      const { changed } = await syncTicket(
        guild,
        entry,
        '⏸️ On Hold',
        (ch) => `hold-${entry.safeName || baseName(ch.name)}`
      );
      if (changed) needsSave = true;
    } catch (err) {
      // ignore
    }
  }

  if (needsSave) saveData();
}

// Only one refresh runs at a time. If more changes arrive while it runs, ONE more pass is made
// afterwards (instead of several refreshes editing the same tickets at once).
let running = null;
let rerun = false;

function refreshQueue(guild) {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        rerun = false;
        await refreshQueueNow(guild);
      } while (rerun);
    } finally {
      running = null;
    }
  })();
  return running;
}

function removeFromQueue(channelId) {
  const before = data.queue.length;
  data.queue = data.queue.filter((e) => e.channelId !== channelId);
  if (data.queue.length !== before) saveData();
  return data.queue.length !== before;
}

// Stock that is still free to order: the real stock minus every Robux order waiting in the queue.
// Held tickets do not reserve stock so active buyers are not blocked by idle/unpaid orders.
// (Game orders do not use Robux stock.) excludeChannelId = ignore one order, used when editing it.
function availableStock(excludeChannelId = null) {
  const reserved = data.queue
    .filter((e) => e.type !== 'game' && !e.onHold && e.channelId !== excludeChannelId)
    .reduce((sum, e) => sum + (e.amount || 0), 0);
  return Math.max(0, data.stock - reserved);
}

function notEnoughStockMessage(available) {
  const note = data.stock > available ? ' right now (the rest is reserved for orders already in the queue)' : '';
  return `Not enough stock. We only have **${available.toLocaleString()}** Robux available${note}.`;
}

module.exports = { refreshQueue, removeFromQueue, availableStock, notEnoughStockMessage };