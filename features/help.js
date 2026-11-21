// /help -> How to use the bot and place an order (only the user can see it).
// /staffhelp -> Complete cheat sheet of all staff commands and workflow (staff only).
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');
const { COLOR, BUY_CHANNEL_ID } = require('../config');
const M = require('../messages');
const { EPHEMERAL, fill, isStaff } = require('../core/helpers');

const STAFF_HELP_CMD = (M.commandNames && M.commandNames.staffhelp) || 'staffhelp';

const commands = [
  new SlashCommandBuilder()
    .setName(M.commandNames.help)
    .setDescription('How to use Reveux and how to order (only you can see it)'),
  new SlashCommandBuilder()
    .setName(STAFF_HELP_CMD)
    .setDescription('Staff only: cheat sheet of all staff commands and ticket workflow'),
];

function buildCustomerHelpEmbed() {
  const T = M.help;
  const buyChannel = BUY_CHANNEL_ID ? `<#${BUY_CHANNEL_ID}>` : 'the buy channel';

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(T.title)
    .setDescription(fill(T.intro, { buyChannel }))
    .addFields(
      T.sections.map((s) => ({
        name: s.name,
        value: fill(s.text, { buyChannel }),
      }))
    );
  if (T.footer) embed.setFooter({ text: T.footer });
  return embed;
}

function buildStaffHelpEmbed() {
  const c = M.commandNames;
  const editCmd = c.editorder || 'edit';

  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('🛡️  Revéux Staff Command & Workflow Cheat Sheet')
    .setDescription(
      'Here is the complete reference of all staff commands and ticket controls so your team never gets confused!'
    )
    .addFields(
      {
        name: '🛒  Shop & Stock Management',
        value:
          `• \`/${c.setup} [stock] [rate]\` — Set Robux stock amount and rate per 100 R$ (updates stock board)\n` +
          `• \`/${c.shop} <open|close> [reason]\` — Open or close the shop (posts banner & pings ping role)\n` +
          `• \`/${c.publicstock}\` — Post or refresh the live public Robux stock board in \`#stock\`\n` +
          `• \`/${c.buy}\` — Post the main Buy panel with game buttons and Roblox in \`#buy\`\n` +
          `• \`/${c.prices} [game] [public:true/false]\` — View price catalog or post it publicly`,
      },
      {
        name: '🎫  Inside Tickets: Order Workflow',
        value:
          `• \`/${c.paymentreceived}\` — Mark payment as received *(or click **Payment Received** button)*\n` +
          `• \`/${c.processing}\` — Mark order as processing *(or click **Processing** button)*\n` +
          `• \`/${c.sent} [proof]\` — Mark order sent & attach up to 10 proof photos *(or click **Sent** button)*\n` +
          `• \`/${editCmd}\` — Edit Robux amount or switch game package/price *(or click **Edit Order** button)*\n` +
          `• \`/${c.closeticket}\` — Archives full HTML transcript to \`#ticket-logs\` and deletes channel *(or click **Close Ticket** button)*`,
      },
      {
        name: '⏸️  Queue & Hold Controls',
        value:
          `• \`/${c.hold}\` — Put customer on hold (pauses queue position, renames channel to \`hold-name\`)\n` +
          `• \`/${c.unhold}\` — Resume customer back to their active queue position\n` +
          `• \`/${c.move} <position>\` — Move a ticket manually to a specific position in the queue\n` +
          `• \`/${c.queue}\` — View the list of all active orders in the queue\n` +
          `• \`/${c.next}\` — View who is currently next in line`,
      },
      {
        name: '🔘  Ticket Buttons Quick Guide',
        value:
          `• **Pay to Hixsly / Ysha:** Sends payee's QR code and 1-tap mobile copyable GCash number\n` +
          `• **Copy Info:** Modal popup with account/username/game IDs for 1-tap copy on mobile\n` +
          `• **Hold / Resume:** 1-click red button to pause or resume queue position\n` +
          `• **Complete Order:** Finishes order, posts receipt to \`#receipts\`, and records shop stats\n` +
          `• **Close Ticket:** Generates HTML transcript for \`#ticket-logs\` and deletes channel (staff only)`,
      },
      {
        name: '🛡️  Staff Tools & Moderation',
        value:
          '• `/duty <on|off|status> [note]` — Toggle staff on/off duty status (shows night notice if all staff off-duty)\n' +
          '• `/staffstats` — Show leaderboard of processed, sent and completed orders per staff member\n' +
          '• `/report [today|week|all]` — Generate total revenue and sales volume report\n' +
          '• `/promo <create|delete|list|give>` — Create, manage, or give promo codes to customers in tickets\n' +
          '• `/remind <receipt|vouch|details> [note]` — Ping customer with a polite reminder\n' +
          '• `/note <text>` — Post an internal team note inside the ticket channel\n' +
          '• `/blacklist <add|remove|list>` — Block or unblock users from opening tickets',
      }
    )
    .setFooter({ text: 'Staff only cheat sheet • Reveux Shop' })
    .setTimestamp();
}

async function runHelp(interaction) {
  const embed = buildCustomerHelpEmbed();
  const staff = isStaff(interaction.member);

  const response = { embeds: [embed], flags: EPHEMERAL };
  if (staff) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('view_staff_help')
        .setLabel('View Staff Commands')
        .setEmoji('🛡️')
        .setStyle(ButtonStyle.Danger)
    );
    response.components = [row];
  }

  if (interaction.isButton()) {
    return interaction.update(response);
  }
  return interaction.reply(response);
}

async function runStaffHelp(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can view the staff command list.',
      flags: EPHEMERAL,
    });
  }

  const embed = buildStaffHelpEmbed();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('view_customer_help')
      .setLabel('View Customer Guide')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Secondary)
  );

  const response = { embeds: [embed], components: [row], flags: EPHEMERAL };
  if (interaction.isButton()) {
    return interaction.update(response);
  }
  return interaction.reply(response);
}

async function handle(interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === M.commandNames.help) {
      await runHelp(interaction);
      return true;
    }
    if (interaction.commandName === STAFF_HELP_CMD) {
      await runStaffHelp(interaction);
      return true;
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'view_staff_help') {
      await runStaffHelp(interaction);
      return true;
    }
    if (interaction.customId === 'view_customer_help') {
      await runHelp(interaction);
      return true;
    }
  }

  return false;
}

module.exports = { commands, handle };
