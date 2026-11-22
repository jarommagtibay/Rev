// /history -> View past completed orders and loyalty reward progress
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLOR, CURRENCY } = require('../config');
const { data, formatPeso } = require('../core/data');
const { EPHEMERAL } = require('../core/helpers');

const LOYALTY_TARGET = 5; // Every 5 orders qualifies for a special discount
const LOYALTY_DISCOUNT_PERCENT = 10;

const commands = [
  new SlashCommandBuilder()
    .setName('history')
    .setDescription('View your past completed orders and loyalty rewards progress'),
];

async function handle(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'history') {
    return false;
  }

  const userId = interaction.user.id;
  const allOrders = data.ordersLog || [];
  const userPast = allOrders.filter((o) => o.userId === userId);

  const completedCount = userPast.length;
  const progressInCycle = completedCount % LOYALTY_TARGET;
  const rewardsEarned = Math.floor(completedCount / LOYALTY_TARGET);
  const remaining = LOYALTY_TARGET - progressInCycle;

  let loyaltyBar = '🟩'.repeat(progressInCycle) + '⬜'.repeat(remaining);

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`📜  Order History & Loyalty — ${interaction.user.username}`)
    .setDescription(
      `⭐ **Lifetime Completed Orders:** \`${completedCount}\`\n` +
      `🎁 **Loyalty Milestones Achieved:** \`${rewardsEarned}\`\n\n` +
      `**Progress to Next Loyalty Reward (${remaining} more order${remaining > 1 ? 's' : ''}):**\n` +
      `> [${loyaltyBar}] **${progressInCycle}/${LOYALTY_TARGET}**\n` +
      `*Complete ${LOYALTY_TARGET} orders to unlock special promo discounts and perks!*`
    )
    .setTimestamp();

  if (completedCount === 0) {
    embed.addFields({
      name: 'Recent Orders',
      value: 'No completed orders found for your account yet. Once your orders are delivered, they will appear here!',
    });
  } else {
    // Show last 5 completed orders
    const recent = userPast.slice(-5).reverse();
    const orderLines = recent.map((o, idx) => {
      const dateStr = o.completedAt ? `<t:${Math.floor(o.completedAt / 1000)}:R>` : 'Recently';
      const orderIdBadge = o.orderId ? `\`#${o.orderId}\` • ` : '';
      return `**${idx + 1}.** ${orderIdBadge}${o.label || `${o.amount} Robux`} — **${formatPeso(o.price)}** (${dateStr})`;
    });

    embed.addFields({
      name: `Recent Completed Orders (Last ${recent.length})`,
      value: orderLines.join('\n'),
    });
  }

  embed.setFooter({ text: 'Revéux Shop Loyalty Club' });

  await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
  return true;
}

module.exports = { commands, handle };
