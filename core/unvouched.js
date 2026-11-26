// core/unvouched.js
// Manages the unvouched buyer penalty system:
// 1. Tracks delivered orders awaiting vouching
// 2. 24h timer: auto-assigns @Unvouched Buyer role and renames channel to unvouched-username
// 3. Ticket creation blocker: blocks non-vouchers from /buy, games, and flash sales
// 4. Instant Unlock: provides a 1-tap vouch modal on block to instantly clear the penalty
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const {
  COLOR,
  CURRENCY,
  GUILD_ID,
  UNVOUCHED_ROLE_ID,
  UNVOUCHED_CATEGORY_ID,
} = require('../config');
const { data, saveData } = require('./data');
const { baseName, safeRenameChannel } = require('./helpers');

/**
 * Registers an unvouched buyer upon order delivery.
 */
function addUnvouchedBuyer(userId, username, orderId, channelId) {
  if (!userId) return;
  if (!data.unvouchedBuyers || typeof data.unvouchedBuyers !== 'object') {
    data.unvouchedBuyers = {};
  }
  data.unvouchedBuyers[userId] = {
    userId,
    username: username || 'Customer',
    orderId: (orderId || 'REV-XXXX').replace(/[`#]/g, ''),
    channelId: channelId || null,
    sentAt: Date.now(),
    roleAssigned: false,
    channelMoved: false,
  };
  saveData();
}

/**
 * Checks if a user has an active unvouched order block (24h has passed without vouching).
 */
function hasUnvouchedBuyer(userId) {
  if (!userId || !data.unvouchedBuyers) return false;
  const buyer = data.unvouchedBuyers[userId];
  if (!buyer) return false;
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  const elapsed = Date.now() - (buyer.sentAt || 0);
  return Boolean(buyer.roleAssigned || elapsed >= TWENTY_FOUR_HOURS);
}

/**
 * Gets the unvouched buyer data for a user.
 */
function getUnvouchedBuyer(userId) {
  if (!userId || !data.unvouchedBuyers) return null;
  return data.unvouchedBuyers[userId] || null;
}

/**
 * Finds or retrieves the @Unvouched Buyer role.
 */
async function getUnvouchedRole(guild) {
  if (!guild) return null;
  // 1. Try explicit ID from config/.env
  if (UNVOUCHED_ROLE_ID) {
    const role = guild.roles.cache.get(UNVOUCHED_ROLE_ID) || (await guild.roles.fetch(UNVOUCHED_ROLE_ID).catch(() => null));
    if (role) return role;
  }
  // 2. Try finding by name in guild
  const found = guild.roles.cache.find(
    (r) => r.name.toLowerCase() === 'unvouched buyer' || r.name.toLowerCase() === 'unvouched'
  );
  if (found) return found;

  // 3. Auto-create role if bot has permission
  try {
    const created = await guild.roles.create({
      name: 'Unvouched Buyer',
      color: 0x72767d,
      reason: 'Auto-created by Reveux for unvouched buyer penalty system',
    });
    return created;
  } catch (err) {
    return null;
  }
}

/**
 * Clears the unvouched buyer penalty when they vouch.
 * Removes role, updates state, and removes block.
 */
async function clearUnvouchedBuyer(guild, userId) {
  if (!userId) return;

  // Remove role from guild member
  if (guild) {
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) {
        const role = await getUnvouchedRole(guild);
        if (role && member.roles.cache.has(role.id)) {
          await member.roles.remove(role).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('Could not remove @Unvouched Buyer role:', err.message);
    }
  }

  // Remove from unvouched tracking
  if (data.unvouchedBuyers && data.unvouchedBuyers[userId]) {
    delete data.unvouchedBuyers[userId];
  }

  // Mark in ordersLog
  if (Array.isArray(data.ordersLog)) {
    for (const ord of data.ordersLog) {
      if (ord.userId === userId && !ord.vouched) {
        ord.vouched = true;
        ord.vouchedAt = Date.now();
      }
    }
  }

  saveData();
}

/**
 * Periodic check:
 * If 24 hours have passed since delivery without a vouch:
 * - Auto-assign @Unvouched Buyer role
 * - Rename ticket to unvouched-username (and move to UNVOUCHED_CATEGORY_ID if set)
 * - Post penalty ping in the ticket
 */
async function checkUnvouchedInterval(client) {
  if (!data.unvouchedBuyers || typeof data.unvouchedBuyers !== 'object') return;
  const now = Date.now();
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  const guild = GUILD_ID ? await client.guilds.fetch(GUILD_ID).catch(() => null) : client.guilds.cache.first();
  if (!guild) return;

  const role = await getUnvouchedRole(guild);

  for (const [userId, buyer] of Object.entries(data.unvouchedBuyers)) {
    if (!buyer || !buyer.sentAt) continue;
    const elapsed = now - buyer.sentAt;

    if (elapsed >= TWENTY_FOUR_HOURS) {
      // 1. Assign @Unvouched Buyer role
      if (!buyer.roleAssigned && role) {
        try {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member && !member.roles.cache.has(role.id)) {
            await member.roles.add(role).catch(() => {});
          }
          buyer.roleAssigned = true;
          saveData();
        } catch (err) {
          console.warn(`Could not assign unvouched role to ${userId}:`, err.message);
        }
      }

      // 2. Rename & update ticket channel if still open
      if (buyer.channelId && !buyer.channelMoved) {
        try {
          const channel = await guild.channels.fetch(buyer.channelId).catch(() => null);
          if (channel) {
            // Rename to unvouched-username
            const curName = baseName(channel.name);
            await safeRenameChannel(channel, `unvouched-${curName}`);

            // Move category if configured
            if (UNVOUCHED_CATEGORY_ID) {
              await channel.setParent(UNVOUCHED_CATEGORY_ID).catch(() => {});
            }

            // Send notice inside the ticket with instant vouch button
            const vBtn = new ButtonBuilder()
              .setCustomId(`vouch_unlock:${userId}:${buyer.orderId}`)
              .setLabel('Vouch Now to Remove Penalty')
              .setStyle(ButtonStyle.Success)
              .setEmoji('⭐');

            await channel.send({
              content: `<@${userId}>`,
              embeds: [
                new EmbedBuilder()
                  .setColor(0xff3333)
                  .setTitle('⚠️  Action Required: 24 Hours Unvouched Penalty')
                  .setDescription(
                    `Hello <@${userId}>! It has been **24 hours** since your order (**#${buyer.orderId}**) was delivered, and a vouch has not been confirmed.\n\n` +
                    `• You have been assigned the **@Unvouched Buyer** role.\n` +
                    `• New ticket creation and ordering privileges have been **temporarily locked**.\n\n` +
                    `👉 **To remove this penalty and unlock ordering:** Click the **[ ⭐ Vouch Now to Remove Penalty ]** button below!`
                  )
                  .setFooter({ text: `Order #${buyer.orderId} • Revéux Vouch Verification` })
                  .setTimestamp(),
              ],
              components: [new ActionRowBuilder().addComponents(vBtn)],
            }).catch(() => {});

            buyer.channelMoved = true;
            saveData();
          } else {
            buyer.channelMoved = true;
            saveData();
          }
        } catch (err) {
          console.warn(`Error updating channel for unvouched buyer ${userId}:`, err.message);
        }
      }
    }
  }
}

/**
 * Builds the warning embed and Vouch button when a blocked user attempts to buy.
 */
function buildUnvouchedBlockEmbed(buyer) {
  const orderId = buyer?.orderId || 'REV-XXXX';
  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('🚫  Ordering Locked: Pending Vouch Required')
    .setDescription(
      `You currently have an **unvouched delivered order** (**#${orderId}**) from a previous purchase!\n\n` +
      `Under our shop policy, customers must confirm item delivery with a quick review before placing new orders.\n\n` +
      `⭐ **Takes only 5 seconds:** Click the button below to submit a rating. It will immediately **remove the @Unvouched Buyer role** and unlock your ordering access!`
    )
    .setFooter({ text: `Order #${orderId} • Revéux Feedback Policy` });

  const button = new ButtonBuilder()
    .setCustomId(`vouch_unlock:${buyer.userId}:${orderId}`)
    .setLabel('Vouch Now to Unlock')
    .setStyle(ButtonStyle.Success)
    .setEmoji('⭐');

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
  };
}

module.exports = {
  addUnvouchedBuyer,
  hasUnvouchedBuyer,
  getUnvouchedBuyer,
  getUnvouchedRole,
  clearUnvouchedBuyer,
  checkUnvouchedInterval,
  buildUnvouchedBlockEmbed,
};
