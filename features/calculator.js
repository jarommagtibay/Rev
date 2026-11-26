// /c -> Robux calculator for everyone. Only the person who used it can see the answer.
// Give robux = see the price. Give price = see how much Robux you get.
// Wording is in messages.js (calculator section)
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');
const { CURRENCY, COLOR } = require('../config');
const M = require('../messages');
const { data, formatPrice } = require('../core/data');
const { EPHEMERAL, fill, parseOrderAmount } = require('../core/helpers');
const { availableStock } = require('../core/queue');
const { showForm } = require('./buy');

const commands = [
  new SlashCommandBuilder()
    .setName(M.commandNames.calc)
    .setDescription('Robux calculator: Robux to price, or price to Robux (only you can see it)')
    .addIntegerOption((o) =>
      o.setName('robux').setDescription('How much Robux? (shows the price)').setMinValue(1)
    )
    .addNumberOption((o) =>
      o
        .setName('price')
        .setDescription(`How much do you want to pay (${CURRENCY})? (shows the Robux)`)
        .setMinValue(1)
    ),
];

async function runCalc(interaction) {
  const T = M.calculator;

  if (data.rate <= 0) {
    return interaction.reply({ content: fill(T.noRate), flags: EPHEMERAL });
  }

  const robux = interaction.options.getInteger('robux');
  const price = interaction.options.getNumber('price');

  // Exactly one of the two must be given
  if ((robux === null && price === null) || (robux !== null && price !== null)) {
    return interaction.reply({ content: fill(T.usage), flags: EPHEMERAL });
  }

  // Same calculation the order forms use, so the answer matches a real order
  const parsed = parseOrderAmount(
    robux !== null ? String(robux) : '',
    price !== null ? String(price) : ''
  );
  if (parsed.error) {
    return interaction.reply({ content: parsed.error, flags: EPHEMERAL });
  }
  const amount = parsed.amount;

  const avail = availableStock();
  const availability =
    amount > avail
      ? fill(T.overStock, { stock: avail.toLocaleString() })
      : fill(T.inStock);

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(fill(T.title))
    .addFields(
      { name: T.robuxLabel, value: `\`\`\`${amount.toLocaleString()} Robux\`\`\``, inline: true },
      { name: T.priceLabel, value: `\`\`\`${formatPrice(amount)}\`\`\``, inline: true },
      {
        name: T.rateLabel,
        value: `\`\`\`${CURRENCY}${data.rate} / 100 Robux\`\`\``,
        inline: true,
      },
      { name: T.availabilityLabel, value: availability }
    )
    .setTimestamp();
  if (T.footer) embed.setFooter({ text: T.footer });

  const components = [];
  if (data.shopOpen && amount <= avail) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`calc_order:${amount}`)
          .setLabel('Open Ticket for This')
          .setEmoji('🛒')
          .setStyle(ButtonStyle.Success)
      )
    );
  }

  return interaction.reply({ embeds: [embed], components, flags: EPHEMERAL });
}

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === M.commandNames.calc) {
    await runCalc(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith('calc_order:')) {
    const amount = Number(interaction.customId.split(':')[1]);
    if (!Number.isFinite(amount) || amount < 1) {
      await interaction.reply({ content: 'Invalid Robux amount.', flags: EPHEMERAL });
      return true;
    }
    await showForm(interaction, amount);
    return true;
  }
  return false;
}

module.exports = { commands, handle };
