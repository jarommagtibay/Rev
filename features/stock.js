// /setup -> staff sets stock and rate
// /stock -> private reply, everyone can use it
// /publicstock -> good-looking public stock board, staff only
// (all wording of the public board is in messages.js)
const fs = require('fs');
const path = require('path');
const {
  AttachmentBuilder,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');
const {
  CURRENCY,
  COLOR,
  ROOT,
  SHOP_IMAGES,
  SHOP_PING_ROLE_ID,
  STOCK_CHANNEL_ID,
  AUDIT_CHANNEL_ID,
} = require('../config');
const client = require('../core/client');
const M = require('../messages');
const { data, saveData, formatPrice, getLowStockThreshold } = require('../core/data');
const { EPHEMERAL, isStaff, fill } = require('../core/helpers');
const { availableStock, reservedStock } = require('../core/queue');

const commands = [
  new SlashCommandBuilder()
    .setName(M.commandNames.setup)
    .setDescription('Staff only: set the Robux stock and price per 100 Robux')
    .addIntegerOption((o) =>
      o.setName('stock').setDescription('Robux currently in stock').setMinValue(0)
    )
    .addNumberOption((o) =>
      o.setName('rate').setDescription('Price per 100 Robux').setMinValue(0)
    ),
  new SlashCommandBuilder()
    .setName(M.commandNames.stock)
    .setDescription('Check the current Robux stock and price (only you can see it)'),
  new SlashCommandBuilder()
    .setName(M.commandNames.publicstock)
    .setDescription('Staff only: post the Robux stock board publicly in this channel'),
];

async function runSetup(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can use this command.',
      flags: EPHEMERAL,
    });
  }

  const stock = interaction.options.getInteger('stock');
  const rate = interaction.options.getNumber('rate');

  if (stock === null && rate === null) {
    return interaction.reply({
      content: `Give at least one value, e.g. \`/${M.commandNames.setup} stock:5000 rate:35\`.\nCurrent: **${data.stock.toLocaleString()}** Robux in stock, **${CURRENCY}${data.rate}** per 100 Robux.`,
      flags: EPHEMERAL,
    });
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  if (stock !== null) data.stock = stock;
  if (rate !== null) data.rate = rate;
  saveData();

  // Stock alerts: auto-close at 0 or warn if below threshold
  checkStockAlerts(data.stock).catch(() => {});

  // New stock or rate -> update the stock board in the stock channel right away
  let note = '';
  if (STOCK_CHANNEL_ID) {
    const posted = await postStockBoard();
    note = posted
      ? '\n📢 The stock board in the stock channel was updated.'
      : '\n⚠️ I could not post in the stock channel. Check STOCK_CHANNEL_ID and my permissions there.';
  }

  return interaction.editReply(
    `Updated.\nStock: **${data.stock.toLocaleString()}** Robux\nRate: **${CURRENCY}${data.rate}** per 100 Robux${note}`
  );
}

// Simple stock embed for the private /stock
function buildStockEmbed() {
  const totalOrders = data.totalOrders || 0;
  const totalVouches = data.totalVouches || 0;
  const totalRobux = data.totalRobuxDelivered || 0;
  const avail = availableStock();
  const reserved = reservedStock();

  let stockText;
  if (reserved > 0 && avail === 0 && data.stock > 0) {
    stockText = `0 available\n*(${reserved.toLocaleString()} R$ reserved for customers in line)*`;
  } else if (reserved > 0) {
    stockText = `${avail.toLocaleString()} Robux available\n*(${reserved.toLocaleString()} R$ reserved in line • ${data.stock.toLocaleString()} total)*`;
  } else {
    stockText = `${data.stock.toLocaleString()} Robux`;
  }

  return new EmbedBuilder()
    .setTitle('Robux Stock')
    .setColor(COLOR)
    .addFields(
      {
        name: 'Shop',
        value: data.shopOpen ? 'Open' : 'Closed',
        inline: true,
      },
      {
        name: 'In stock',
        value: stockText,
        inline: true,
      },
      {
        name: 'Rate',
        value: `${CURRENCY}${data.rate} per 100 Robux`,
        inline: true,
      },
      {
        name: 'Orders in queue',
        value: `${data.queue.length}`,
        inline: true,
      },
      {
        name: '⭐ Shop Record',
        value: `${totalOrders.toLocaleString()} Orders  •  ${totalVouches.toLocaleString()} Vouches  •  ${totalRobux.toLocaleString()} R$ delivered`,
        inline: false,
      }
    );
}

// Good-looking stock board for /publicstock
// ping = false for the automatic reminders, so the shop role is not pinged every hour
function buildPublicStock(ping = true) {
  const T = M.publicStock;
  const open = data.shopOpen;
  const avail = availableStock();
  const reserved = reservedStock();
  const outOfStock = data.stock <= 0 || data.rate <= 0;

  let description;
  if (!open) description = T.descClosed;
  else if (outOfStock) description = T.descOutOfStock;
  else if (avail === 0 && reserved > 0) {
    description = `${T.descOpen}\n\n⏳ **All ${data.stock.toLocaleString()} Robux in stock is currently reserved for customers in line.**`;
  } else {
    description = T.descOpen;
  }

  let stockBoardText;
  if (reserved > 0 && avail === 0 && data.stock > 0) {
    stockBoardText = `0 available\n(${reserved.toLocaleString()} reserved in line)`;
  } else if (reserved > 0) {
    stockBoardText = `${avail.toLocaleString()} Robux\n(${reserved.toLocaleString()} reserved in line)`;
  } else {
    stockBoardText = `${data.stock.toLocaleString()} Robux`;
  }

  const queueCount = data.queue.length;
  const queueText = queueCount === 0 ? T.queueEmpty : fill(T.queueCount, { count: queueCount });

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: T.author })
    .setTitle(open ? T.titleOpen : T.titleClosed)
    .setDescription(description)
    .addFields(
      {
        name: T.inStockLabel,
        value: `\`\`\`${stockBoardText}\`\`\``,
        inline: true,
      },
      {
        name: T.rateLabel,
        value: `\`\`\`${CURRENCY}${data.rate} / 100 Robux\`\`\``,
        inline: true,
      },
      {
        name: T.queueLabel,
        value: `\`\`\`${queueText}\`\`\``,
        inline: true,
      }
    )
    .setTimestamp();
  if (T.footer) embed.setFooter({ text: T.footer });

  // Price list, only for amounts that are still free to order
  if (!outOfStock && avail > 0) {
    const lines = T.priceListAmounts
      .filter((a) => a <= avail)
      .map((a) => `${a.toLocaleString().padStart(6)} Robux  →  ${formatPrice(a)}`);
    if (lines.length > 0) {
      embed.addFields({
        name: T.priceListLabel,
        value: `\`\`\`${lines.join('\n')}\`\`\``,
      });
    }
  }

  const totalOrders = data.totalOrders || 0;
  const totalVouches = data.totalVouches || 0;
  const totalRobux = data.totalRobuxDelivered || 0;
  embed.addFields({
    name: '⭐ Shop Statistics & Trust',
    value: `\`\`\`${totalOrders.toLocaleString()} Orders Completed  •  ${totalVouches.toLocaleString()} Vouches  •  ${totalRobux.toLocaleString()} R$ Delivered\`\`\``,
  });

  // Shop open / closed picture as a small thumbnail (skipped if the file is missing)
  const files = [];
  const fileName = SHOP_IMAGES[open ? 'open' : 'closed'];
  const file = path.join(ROOT, fileName);
  if (fs.existsSync(file)) {
    embed.setThumbnail(`attachment://${fileName}`);
    files.push(new AttachmentBuilder(file, { name: fileName }));
  }

  const message = { embeds: [embed], files };

  // Ping the shop role (SHOP_PING_ROLE_ID in .env), same role as the /shop announcements
  if (ping && SHOP_PING_ROLE_ID) {
    message.content = `<@&${SHOP_PING_ROLE_ID}>`;
    message.allowedMentions = { roles: [SHOP_PING_ROLE_ID] };
  }

  return message;
}

// ---------- Stock channel: the bot posts the stock board by itself every 1 hour ----------
// It shows if there is stock or not (same board as /publicstock). Only the latest board stays.
// The automatic posting only runs while the shop is OPEN. When staff close the shop with /shop,
// it pauses. When the shop is opened again, it resumes (and posts right away if 1 hour has passed).
// The shop open / closed status itself is NOT touched: staff open and close the shop with /shop.
const STOCK_INTERVAL = 60 * 60 * 1000; // 1 hour
let posting = false;

// Returns true if the board was posted
async function postStockBoard() {
  if (!STOCK_CHANNEL_ID || posting) return false;
  posting = true;
  try {
    const channel = await client.channels.fetch(STOCK_CHANNEL_ID);

    // Delete the previous board so the channel does not fill up
    if (data.stockMessageId) {
      try {
        const old = await channel.messages.fetch(data.stockMessageId);
        await old.delete();
      } catch {
        // already deleted, ignore
      }
    }

    const sent = await channel.send(buildPublicStock(false));
    data.stockMessageId = sent.id;
    data.stockPostedAt = Date.now();
    saveData();
    return true;
  } catch (err) {
    console.error('Could not post the stock board:', err);
    // try again in 10 minutes instead of every minute
    data.stockPostedAt = Date.now() - STOCK_INTERVAL + 10 * 60 * 1000;
    saveData();
    return false;
  } finally {
    posting = false;
  }
}

// Checks every minute. Because the time of the last post is saved, a restart does not
// reset the 1 hour (and a missed reminder is posted as soon as the bot is back).
// If the shop is closed, nothing is posted.
if (STOCK_CHANNEL_ID) {
  setInterval(() => {
    if (!client.isReady()) return;
    if (!data.shopOpen) return; // shop closed -> automatic stock posting is disabled
    if (Date.now() - (data.stockPostedAt || 0) >= STOCK_INTERVAL) postStockBoard();
  }, 60 * 1000);
} else {
  console.warn('STOCK_CHANNEL_ID is not set in your .env, so no stock reminders will be posted.');
}

// /stock -> private reply, everyone can use it
async function runStock(interaction) {
  return interaction.reply({ embeds: [buildStockEmbed()], flags: EPHEMERAL });
}

// /publicstock -> public reply, staff only
async function runPublicStock(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can use this command.',
      flags: EPHEMERAL,
    });
  }

  return interaction.reply(buildPublicStock());
}

async function handle(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  if (interaction.commandName === M.commandNames.setup) {
    await runSetup(interaction);
    return true;
  }
  if (interaction.commandName === M.commandNames.stock) {
    await runStock(interaction);
    return true;
  }
  if (interaction.commandName === M.commandNames.publicstock) {
    await runPublicStock(interaction);
    return true;
  }
  return false;
}

// Checks stock levels and alerts staff (warning only — does NOT auto-close the shop,
// because the shop also sells game credits that are unrelated to Robux stock).
async function checkStockAlerts(currentStock) {
  if (!AUDIT_CHANNEL_ID) return;
  try {
    const auditChan = await client.channels.fetch(AUDIT_CHANNEL_ID).catch(() => null);
    if (!auditChan) return;

    const lowThreshold = getLowStockThreshold();
    if (currentStock <= 0 && !data._zeroStockAlerted) {
      data._zeroStockAlerted = true;
      saveData();
      await auditChan.send({
        content: `🚨 **ROBUX OUT OF STOCK**: Robux stock reached **0**! Game credits are unaffected. Use \`/setup stock:<amount>\` to restock.`,
      });
    } else if (currentStock > 0 && currentStock <= lowThreshold && !data._lowStockAlerted) {
      data._lowStockAlerted = true;
      data._zeroStockAlerted = false;
      saveData();
      await auditChan.send({
        content: `⚠️ **LOW STOCK ALERT**: Current Robux stock is **${currentStock.toLocaleString()} R$** (below threshold of ${lowThreshold.toLocaleString()} R$). Please restock soon!`,
      });
    } else if (currentStock > lowThreshold) {
      data._lowStockAlerted = false;
      data._zeroStockAlerted = false;
      saveData();
    }
  } catch (err) {
    console.error('Error checking stock alerts:', err);
  }
}

// postStockBoard is also used by shop.js to refresh the board when the shop opens or closes
module.exports = { commands, handle, postStockBoard, checkStockAlerts };