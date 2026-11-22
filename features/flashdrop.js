// /flashdrop -> Launch or manage limited-time flash sales in #daily-sale
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  COLOR,
  CURRENCY,
  DAILY_SALE_CHANNEL_ID,
  STAFF_ROLE_ID,
  EXPRESS_FEE,
  MAX_TICKETS_PER_PRODUCT,
  GUILD_ID,
} = require('../config');
const client = require('../core/client');
const {
  data,
  saveData,
  formatPeso,
  isBlacklisted,
  generateOrderId,
} = require('../core/data');
const {
  EPHEMERAL,
  isStaff,
  parseOrderAmount,
  makeSafeName,
  ticketLimitMessage,
} = require('../core/helpers');
const {
  orderHeadline,
  ticketRows,
  createTicketChannel,
  sendPaymentMessage,
} = require('../core/ticket');
const { availableStock, notEnoughStockMessage } = require('../core/queue');
const { logTicketCreated } = require('../core/audit');
const { getRobloxProfile } = require('../core/roblox');
const { areAllStaffOffDuty, getOffDutyNote } = require('./duty');

const commands = [
  new SlashCommandBuilder()
    .setName('flashdrop')
    .setDescription('Staff only: launch or manage a limited-time flash sale in #daily-sale')
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Start a new flash sale countdown event')
        .addIntegerOption((opt) =>
          opt
            .setName('stock')
            .setDescription('Total Robux allocated for this flash sale (e.g. 5000)')
            .setRequired(true)
            .setMinValue(100)
        )
        .addNumberOption((opt) =>
          opt
            .setName('rate')
            .setDescription('Special flash rate per 100 R$ (e.g. 50)')
            .setRequired(true)
            .setMinValue(1)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('duration')
            .setDescription('Duration in minutes (default: 30 minutes)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(1440)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel to post the flash sale in (default: #daily-sale)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('force')
            .setDescription('Force start and override any existing active flash sale (default: false)')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('stop')
        .setDescription('Stop and close the currently active flash sale')
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('View the current status of the active flash sale')
    ),
];

// Resolves the channel for posting the flash sale (daily-sale preferred)
async function resolveSaleChannel(guild, specifiedChannel) {
  if (specifiedChannel) return specifiedChannel;
  if (DAILY_SALE_CHANNEL_ID) {
    const ch = await guild.channels.fetch(DAILY_SALE_CHANNEL_ID).catch(() => null);
    if (ch) return ch;
  }
  const channels = await guild.channels.fetch().catch(() => null);
  if (channels) {
    const found = channels.find(
      (c) =>
        c &&
        c.type === ChannelType.GuildText &&
        (c.name === 'daily-sale' ||
          c.name === 'daily_sale' ||
          c.name === 'dailysale' ||
          c.name === 'announcements')
    );
    if (found) return found;
  }
  return null;
}

// Builds the announcement embed and claim button for #daily-sale
function buildFlashDropMessage(fd) {
  const endsAtSec = Math.floor(fd.endsAt / 1000);
  const remainingStock = Math.max(0, fd.stock);

  const embed = new EmbedBuilder()
    .setColor(0xff9900)
    .setTitle('⚡  REVÉUX FLASH SALE EVENT  ⚡')
    .setDescription(
      `🔥 **LIMITED-TIME FLASH STOCK DROP!**\n` +
      `Grab discounted Robux before the countdown ends or flash stock sells out!\n\n` +
      `💎 **Flash Robux Rate:** **${CURRENCY}${fd.rate}** per 100 R$ *(Regular: ${CURRENCY}${fd.regularRate})*\n` +
      `⏳ **Time Remaining:** Ends <t:${endsAtSec}:R> (<t:${endsAtSec}:t>)\n` +
      `📦 **Flash Stock Remaining:** **${remainingStock.toLocaleString()}** / **${fd.initialStock.toLocaleString()}** Robux\n\n` +
      `👉 *Click the button below to claim this deal and open your private ticket!*`
    )
    .setFooter({ text: `Hosted by @${fd.startedBy} • Reveux Flash Deals` })
    .setTimestamp(fd.startedAt);

  const button = new ButtonBuilder()
    .setCustomId('flashdrop_claim')
    .setLabel('⚡ Claim Deal Now (Open Ticket)')
    .setStyle(ButtonStyle.Success)
    .setEmoji('⚡');

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

// Ends the flash drop and updates the announcement message
async function endFlashDrop(reason = 'ended') {
  if (!data.flashDrop || !data.flashDrop.active) return;
  const fd = data.flashDrop;
  fd.active = false;
  fd.endedAt = Date.now();
  fd.concludeReason = reason;
  saveData();

  try {
    const guild = GUILD_ID ? await client.guilds.fetch(GUILD_ID).catch(() => null) : client.guilds.cache.first();
    if (!guild) return;
    const channel = await guild.channels.fetch(fd.channelId).catch(() => null);
    if (!channel) return;
    const message = await channel.messages.fetch(fd.messageId).catch(() => null);
    if (!message) return;

    let reasonText = 'This flash sale has ended. Stay tuned for the next drop!';
    if (reason === 'sold_out') {
      reasonText = '🔥 **SOLD OUT!** All flash sale stock has been claimed!';
    } else if (reason === 'expired') {
      reasonText = '⏰ **TIME IS UP!** This flash sale has expired.';
    } else if (reason === 'stopped') {
      reasonText = '🛑 This flash sale was concluded by staff.';
    }

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle('🔴  FLASH SALE CONCLUDED')
      .setDescription(
        `${reasonText}\n\n` +
        `💎 **Flash Rate:** ${CURRENCY}${fd.rate}/100 R$\n` +
        `📦 **Stock Claimed:** ${(fd.initialStock - Math.max(0, fd.stock)).toLocaleString()} Robux\n` +
        `Check <#${channel.id}> regularly for upcoming spontaneous drops!`
      )
      .setFooter({ text: 'Reveux Shop Flash Drops' })
      .setTimestamp();

    const disabledBtn = new ButtonBuilder()
      .setCustomId('flashdrop_closed')
      .setLabel('🔒 Sale Ended / Sold Out')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    await message.edit({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(disabledBtn)],
    });
  } catch (err) {
    console.error('Could not update ended flash drop message:', err);
  }
}

// Periodically updates or auto-ends active flash drop
setInterval(async () => {
  if (!data.flashDrop || !data.flashDrop.active) return;
  const now = Date.now();
  if (now >= data.flashDrop.endsAt) {
    await endFlashDrop('expired');
  } else if (data.flashDrop.stock <= 0) {
    await endFlashDrop('sold_out');
  }
}, 25000);

// Slash command handlers
async function handleStart(interaction) {
  // Sync state first: auto-expire if past endsAt or stock <= 0
  if (data.flashDrop && data.flashDrop.active) {
    if (Date.now() >= data.flashDrop.endsAt) {
      await endFlashDrop('expired');
    } else if (data.flashDrop.stock <= 0) {
      await endFlashDrop('sold_out');
    }
  }

  const force = interaction.options.getBoolean('force') || false;

  if (data.flashDrop && data.flashDrop.active && Date.now() < data.flashDrop.endsAt && data.flashDrop.stock > 0) {
    if (!force) {
      const endsAtSec = Math.floor(data.flashDrop.endsAt / 1000);
      return interaction.reply({
        content:
          `⚠️ A flash sale is currently running with **${data.flashDrop.stock.toLocaleString()} R$** remaining (ends <t:${endsAtSec}:R>)!\n\n` +
          `• Run \`/flashdrop stop\` to cancel it first, **OR**\n` +
          `• Re-run with \`force: True\` to immediately override and start the new flash drop.`,
        flags: EPHEMERAL,
      });
    }
    // Force override: conclude current sale cleanly first
    await endFlashDrop('stopped');
  }

  const stock = interaction.options.getInteger('stock');
  const rate = interaction.options.getNumber('rate');
  const duration = interaction.options.getInteger('duration') || 30;
  const targetChannelOpt = interaction.options.getChannel('channel');

  const channel = await resolveSaleChannel(interaction.guild, targetChannelOpt || interaction.channel);
  if (!channel) {
    return interaction.reply({
      content:
        'Could not find a channel named `#daily-sale`. Please specify a channel option or create `#daily-sale`.',
      flags: EPHEMERAL,
    });
  }

  const endsAt = Date.now() + duration * 60 * 1000;
  const flashData = {
    active: true,
    stock,
    initialStock: stock,
    rate,
    regularRate: data.rate || rate,
    endsAt,
    startedAt: Date.now(),
    startedBy: interaction.user.username,
    channelId: channel.id,
    messageId: null,
  };

  const payload = buildFlashDropMessage(flashData);
  const msg = await channel.send(payload);
  flashData.messageId = msg.id;
  data.flashDrop = flashData;
  saveData();

  return interaction.reply({
    content: `⚡ **Flash Sale started!** Posted in <#${channel.id}> for **${stock.toLocaleString()} Robux** at **${CURRENCY}${rate}/100 R$** for **${duration} minutes**!`,
    flags: EPHEMERAL,
  });
}

async function handleStop(interaction) {
  // Sync state first: auto-expire if past endsAt or stock <= 0
  if (data.flashDrop && data.flashDrop.active) {
    if (Date.now() >= data.flashDrop.endsAt) {
      await endFlashDrop('expired');
      return interaction.reply({
        content: '⏰ The flash sale already reached its time limit and was marked as expired.',
        flags: EPHEMERAL,
      });
    } else if (data.flashDrop.stock <= 0) {
      await endFlashDrop('sold_out');
      return interaction.reply({
        content: '🔥 The flash sale was already sold out and marked as concluded.',
        flags: EPHEMERAL,
      });
    }
  }

  if (!data.flashDrop || !data.flashDrop.active) {
    return interaction.reply({
      content:
        'ℹ️ There is no active flash sale currently running.\n' +
        (data.flashDrop ? `The previous flash drop has already concluded. You can start a new one anytime using \`/flashdrop start\`.` : ''),
      flags: EPHEMERAL,
    });
  }

  await endFlashDrop('stopped');
  return interaction.reply({
    content: '🛑 Active flash sale has been stopped and marked as concluded.',
    flags: EPHEMERAL,
  });
}

async function handleStatus(interaction) {
  if (!data.flashDrop) {
    return interaction.reply({
      content: 'No flash sale history recorded.',
      flags: EPHEMERAL,
    });
  }

  // Sync state first: auto-expire if past endsAt or stock <= 0
  if (data.flashDrop.active) {
    if (Date.now() >= data.flashDrop.endsAt) {
      await endFlashDrop('expired');
    } else if (data.flashDrop.stock <= 0) {
      await endFlashDrop('sold_out');
    }
  }

  const fd = data.flashDrop;
  const isRunning = fd.active && Date.now() < fd.endsAt && fd.stock > 0;
  const endsAtSec = Math.floor(fd.endsAt / 1000);
  const endedSec = Math.floor((fd.endedAt || Date.now()) / 1000);

  let statusText = '🟢 **ACTIVE**';
  let timeText = `Ends <t:${endsAtSec}:R> (<t:${endsAtSec}:t>)`;

  if (!isRunning) {
    const reasonLabel =
      fd.concludeReason === 'stopped'
        ? 'Stopped by Staff'
        : fd.concludeReason === 'sold_out'
        ? 'Sold Out'
        : fd.concludeReason === 'expired'
        ? 'Expired'
        : 'Concluded';

    statusText = `🔴 **CONCLUDED** *(${reasonLabel})*`;
    if (fd.endedAt) {
      timeText = `Concluded <t:${endedSec}:R>`;
    } else if (Date.now() >= fd.endsAt) {
      timeText = `Expired <t:${endsAtSec}:R>`;
    } else {
      timeText = 'Concluded by staff';
    }
  }

  const embed = new EmbedBuilder()
    .setColor(isRunning ? 0xff9900 : COLOR)
    .setTitle(isRunning ? '⚡ Active Flash Sale Status' : '📋 Recent Flash Sale Status')
    .addFields(
      { name: 'Status', value: statusText, inline: true },
      { name: 'Flash Rate', value: `${CURRENCY}${fd.rate} / 100 R$`, inline: true },
      { name: 'Regular Rate', value: `${CURRENCY}${fd.regularRate} / 100 R$`, inline: true },
      { name: 'Remaining Stock', value: `${Math.max(0, fd.stock).toLocaleString()} / ${fd.initialStock.toLocaleString()} R$`, inline: true },
      { name: 'Time', value: timeText, inline: true },
      { name: 'Channel', value: `<#${fd.channelId}>`, inline: true }
    )
    .setFooter({ text: `Started by @${fd.startedBy}` });

  return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
}

// Claim button handler
async function handleClaimButton(interaction) {
  if (isBlacklisted(interaction.user.id)) {
    return interaction.reply({
      content: 'You are blocked from opening tickets.',
      flags: EPHEMERAL,
    });
  }

  const fd = data.flashDrop;
  if (!fd || !fd.active || Date.now() >= fd.endsAt || fd.stock <= 0) {
    return interaction.reply({
      content: '⚠️ This flash sale has concluded or is sold out! Please stay tuned for the next drop.',
      flags: EPHEMERAL,
    });
  }

  // Check customer open ticket limits
  const customerTickets = data.queue.filter((e) => e.userId === interaction.user.id);
  if (customerTickets.length >= MAX_TICKETS_PER_PRODUCT) {
    return interaction.reply({
      content: ticketLimitMessage(MAX_TICKETS_PER_PRODUCT),
      flags: EPHEMERAL,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('flashdrop_modal')
    .setTitle('⚡ Claim Flash Sale Robux')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('account_name')
          .setLabel('Roblox Display Name')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('account_username')
          .setLabel('Roblox Username (@handle)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('amount_value')
          .setLabel(`Robux Amount (Available: ${fd.stock.toLocaleString()})`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(`e.g. 1000 (Rate: ${CURRENCY}${fd.rate}/100 R$)`)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('express_delivery')
          .setLabel(`⚡ Express Delivery (+${CURRENCY}${EXPRESS_FEE})`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Type "yes" to jump to #1 in queue (optional)')
          .setRequired(false)
      )
    );

  await interaction.showModal(modal);
}

// Modal submission handler
async function handleModalSubmit(interaction) {
  const fd = data.flashDrop;
  if (!fd || !fd.active || Date.now() >= fd.endsAt || fd.stock <= 0) {
    return interaction.reply({
      content: '⚠️ Sorry! The flash sale ended or ran out of stock while you were filling the form.',
      flags: EPHEMERAL,
    });
  }

  const name = interaction.fields.getTextInputValue('account_name').trim();
  const username = interaction.fields.getTextInputValue('account_username').trim();
  const amountStr = interaction.fields.getTextInputValue('amount_value').trim();
  const expressVal = (interaction.fields.getTextInputValue('express_delivery') || '').trim().toLowerCase();
  const isExpress = expressVal === 'yes' || expressVal === 'y' || expressVal === 'true';

  const amount = parseOrderAmount(amountStr);
  if (!amount || isNaN(amount) || amount <= 0) {
    return interaction.reply({
      content: 'Please enter a valid positive Robux amount (e.g. 500, 1000).',
      flags: EPHEMERAL,
    });
  }

  if (amount > fd.stock) {
    return interaction.reply({
      content: `⚠️ Not enough flash stock left! Only **${fd.stock.toLocaleString()} Robux** remains in this flash drop.`,
      flags: EPHEMERAL,
    });
  }

  // Calculate discounted flash sale price
  let price = Math.round((amount / 100) * fd.rate);
  let expressNote = '';
  if (isExpress) {
    price += EXPRESS_FEE;
    expressNote = ` (+${CURRENCY}${EXPRESS_FEE} Express)`;
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  // Lookup Roblox avatar in background
  const roblox = await getRobloxProfile(username);
  const safeName = makeSafeName(interaction.user);
  const orderId = generateOrderId();
  const position = data.queue.length + 1;

  const channel = await createTicketChannel(interaction, position, safeName, 'robux');

  const embed = new EmbedBuilder()
    .setAuthor({ name: 'REVÉUX  •  FLASH SALE TICKET' })
    .setTitle('⚡  New Flash Sale Order')
    .setColor(0xff9900)
    .setDescription(orderHeadline(`${amount.toLocaleString()} Robux`, formatPeso(price), '⚡'))
    .setThumbnail(roblox?.avatarUrl || interaction.user.displayAvatarURL())
    .addFields(
      { name: 'Order ID', value: `\`#${orderId}\``, inline: true },
      { name: 'Account Name', value: `\`\`\`\n${name}\n\`\`\``, inline: true },
      { name: 'Account Username', value: `\`\`\`\n${username}\n\`\`\``, inline: true },
      { name: 'Robux Amount', value: amount.toLocaleString(), inline: true },
      { name: 'Flash Price', value: `${formatPeso(price)}${expressNote}`, inline: true },
      { name: 'Queue Position', value: isExpress ? `#1 ⚡ EXPRESS` : `#${position}`, inline: true },
      {
        name: '⚡  Deal Rate',
        value: `**${CURRENCY}${fd.rate}** / 100 R$ *(Regular: ${CURRENCY}${fd.regularRate})*`,
        inline: true,
      },
      { name: 'Opened by', value: `${interaction.user}` }
    )
    .setFooter({ text: `Order #${orderId} • Flash Sale Deal` })
    .setTimestamp();

  if (isExpress) {
    embed.addFields({
      name: '⚡  Priority Level',
      value: `**VIP EXPRESS QUEUE (+${CURRENCY}${EXPRESS_FEE})** — Prioritized at the front of the line!`,
      inline: false,
    });
  }

  if (roblox && !roblox.notFound) {
    embed.addFields({
      name: '👤  Roblox Profile',
      value: `[**${roblox.displayName}** (@${roblox.name})](${roblox.profileUrl})\n*(Avatar verified above)*`,
      inline: false,
    });
  }

  const staffAlert = isExpress
    ? `<@&${STAFF_ROLE_ID}> ⚡ **VIP EXPRESS FLASH ORDER** (handle immediately!)`
    : `<@&${STAFF_ROLE_ID}>`;

  const message = await channel.send({
    content: `${interaction.user} ${staffAlert}`,
    embeds: [embed],
    components: ticketRows('open', false),
    allowedMentions: { parse: ['users', 'roles'] },
  });

  await sendPaymentMessage(channel, formatPeso(price), `${amount.toLocaleString()} Robux (⚡ Flash Deal)`);

  // Deduct from flash stock pool
  fd.stock -= amount;
  saveData();

  // Update announcement message in #daily-sale
  try {
    const saleChannel = await interaction.guild.channels.fetch(fd.channelId).catch(() => null);
    if (saleChannel && fd.messageId) {
      const saleMsg = await saleChannel.messages.fetch(fd.messageId).catch(() => null);
      if (saleMsg) {
        if (fd.stock <= 0) {
          await endFlashDrop('sold_out');
        } else {
          await saleMsg.edit(buildFlashDropMessage(fd));
        }
      }
    }
  } catch (err) {
    console.error('Could not update flash drop post:', err);
  }

  const entry = {
    orderId,
    channelId: channel.id,
    messageId: message.id,
    userId: interaction.user.id,
    name,
    username,
    safeName,
    amount,
    price,
    joinedAt: Date.now(),
    notifiedNext: false,
    shownPosition: isExpress ? `#1 ⚡ EXPRESS` : `#${position}`,
    isExpress,
    isFlashDrop: true,
    flashRate: fd.rate,
  };

  if (isExpress) {
    const insertIdx = data.queue.findIndex((e) => !e.isExpress);
    if (insertIdx === -1) data.queue.push(entry);
    else data.queue.splice(insertIdx, 0, entry);
  } else {
    data.queue.push(entry);
  }
  saveData();

  // If staff is off-duty, show notice
  if (areAllStaffOffDuty()) {
    const note = getOffDutyNote();
    const noteLine = note ? `\n\n**Staff Note:**\n${note}` : '';
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2b2d31)
          .setTitle('⏸️  Staff Notice: Staff Is Currently Off-Duty')
          .setDescription(
            'Our staff team is currently taking a break or off-duty.\n\n' +
            '📋 **Order Reserved in Queue:** Your order has been placed and saved in the queue.\n' +
            '💳 **Payment QR Code:** As soon as staff is back on-duty, they will send the payment QR code here in this ticket.\n' +
            `⚡ **Fulfillment:** Your order will be prioritized and fulfilled as soon as staff returns online!${noteLine}`
          )
          .setFooter({ text: 'Reveux Shop • Orders are fulfilled in queue order' })
          .setTimestamp(),
      ],
    });
  }

  logTicketCreated(interaction, {
    channel,
    item: `${amount.toLocaleString()} Robux (⚡ Flash Deal)`,
    price: formatPeso(price),
    details: [
      { name: 'Order ID', value: `#${orderId}` },
      { name: 'Account Name', value: name },
      { name: 'Account Username', value: username },
      { name: 'Flash Rate', value: `${CURRENCY}${fd.rate}/100 R$` },
    ],
  });

  return interaction.editReply({
    content: `⚡ **Flash Deal Claimed!** Your ticket has been opened: <#${channel.id}>. Please proceed there to pay!`,
  });
}

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'flashdrop') {
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: 'Only staff can manage flash drops.',
        flags: EPHEMERAL,
      });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'start') return handleStart(interaction);
    if (sub === 'stop') return handleStop(interaction);
    if (sub === 'status') return handleStatus(interaction);
  }

  if (interaction.isButton() && interaction.customId === 'flashdrop_claim') {
    await handleClaimButton(interaction);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'flashdrop_modal') {
    await handleModalSubmit(interaction);
    return true;
  }

  return false;
}

module.exports = {
  commands,
  handle,
  endFlashDrop,
};
