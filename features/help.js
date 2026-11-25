// /help -> Interactive Customer Guide with Dropdown Menu by topic (only the user can see it).
// /staffhelp -> Complete cheat sheet of all staff commands and workflow (staff only).
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
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

const HELP_CATEGORIES = [
  {
    value: 'overview',
    label: 'Overview & Table of Contents',
    emoji: '📖',
    description: 'Welcome and summary index of all guide topics',
  },
  {
    value: 'how_to_buy',
    label: 'How to Place an Order',
    emoji: '🛒',
    description: 'Step-by-step instructions from ticket to delivery',
  },
  {
    value: 'games',
    label: 'Mobile Games Top-Up',
    emoji: '🎮',
    description: 'Mobile Legends, Honor of Kings & CODM guide',
  },
  {
    value: 'roblox',
    label: 'Roblox Robux Ordering',
    emoji: '🟥',
    description: 'Rates, calculation, avatar preview & delivery',
  },
  {
    value: 'payment',
    label: 'Payment & Receipts',
    emoji: '💳',
    description: 'GCash/Maya payment, receipts, and refund policy',
  },
  {
    value: 'express',
    label: 'Express Priority Pass',
    emoji: '⚡',
    description: 'Skip the waiting line with express delivery (+₱15)',
  },
  {
    value: 'commands',
    label: 'Customer Commands',
    emoji: '💬',
    description: 'Useful commands: /myorder, /history, /calc, /stock',
  },
  {
    value: 'faq',
    label: 'Shop Rules & Good to Know',
    emoji: '📌',
    description: 'Ticket limits, queue info, and staff duty notices',
  },
];

function buildCustomerHelpEmbed(category = 'overview') {
  const buyChannel = BUY_CHANNEL_ID ? `<#${BUY_CHANNEL_ID}>` : 'the buy channel';
  const embed = new EmbedBuilder().setColor(COLOR);

  switch (category) {
    case 'how_to_buy':
      embed
        .setTitle('🛒  Part 1: How to Place an Order')
        .setDescription('Follow these simple steps to place and receive your order smoothly:')
        .addFields(
          {
            name: '1️⃣  Choose What to Buy',
            value: `Go to ${buyChannel} and press the button corresponding to what you want to buy (Roblox or Mobile Games).`,
          },
          {
            name: '2️⃣  Fill Out the Order Form',
            value:
              'Select your desired package or enter the Robux amount, then enter your game IDs or username. You can also apply an optional promo code or express delivery pass.',
          },
          {
            name: '3️⃣  Private Ticket Created',
            value:
              'A private ticket channel opens immediately just for you, displaying your order summary, total price, and live queue position.',
          },
          {
            name: '4️⃣  Pay & Send Receipt',
            value:
              'Staff sends the GCash/Maya QR code and 1-tap copyable number. Once paid, **send your receipt screenshot in the ticket**. *(No receipt = no process!)*',
          },
          {
            name: '5️⃣  Processing & Delivery',
            value:
              'Staff confirms your payment, updates your ticket to Processing, and delivers your item with photo proof.',
          },
          {
            name: '6️⃣  Vouch & Rewards',
            value:
              'Click the **Vouch** button to leave feedback and earn customer loyalty points toward exclusive discounts!',
          }
        )
        .setFooter({ text: 'Part 1 of 7 • Use the dropdown below to explore other topics' });
      break;

    case 'games':
      embed
        .setTitle('🎮  Part 2: Mobile Games Top-Up Guide')
        .setDescription(
          'We provide fast, official ID-based top-ups for Mobile Legends, Honor of Kings, and Call of Duty Mobile:'
        )
        .addFields(
          {
            name: '📱  Mobile Legends: Bang Bang (MLBB)',
            value:
              '• Pick your diamond package or Weekly Diamond Pass directly from the dropdown.\n' +
              '• Fill in your **User ID** and **Zone ID** *(e.g. `12345678 (1234)` found in your MLBB profile)*.',
          },
          {
            name: '👑  Honor of Kings (HOK)',
            value:
              '• Select your Tokens package from the menu.\n' +
              '• Enter your **Player ID** *(copy it from your in-game profile settings)*.',
          },
          {
            name: '🔫  Call of Duty: Mobile (CODM)',
            value:
              '• Select your CP package from the menu.\n' +
              '• Enter your **UID** *(found in your CODM profile tab)*.',
          },
          {
            name: '⚠️  Accuracy Notice',
            value:
              'Always **double-check your IDs** before submitting! Top-ups sent to an incorrect ID provided by the customer cannot be refunded.',
          }
        )
        .setFooter({ text: 'Part 2 of 7 • Use the dropdown below to explore other topics' });
      break;

    case 'roblox':
      embed
        .setTitle('🟥  Part 3: Roblox Robux Ordering')
        .setDescription('Clean, fast, and secure Robux delivered straight to your account:')
        .addFields(
          {
            name: '💎  Stock & Rates',
            value:
              '• View real-time available stock and rate per 100 R$ with `/stock` or on the `#stock` board.\n' +
              '• Use `/calc` to preview the exact PHP price for any custom Robux amount.',
          },
          {
            name: '🛡️  Live Avatar & Profile Verification',
            value:
              'When you type your Roblox username, our bot automatically loads your Roblox Avatar photo and profile link into your ticket. Staff confirms "Is this your avatar?" before sending to prevent typos or wrong accounts!',
          },
          {
            name: '📦  Fulfillment',
            value:
              'Robux is transferred via gamepass, group payout, or private server. Staff provides quick, step-by-step instructions inside your ticket.',
          }
        )
        .setFooter({ text: 'Part 3 of 7 • Use the dropdown below to explore other topics' });
      break;

    case 'payment':
      embed
        .setTitle('💳  Part 4: Payment & Receipts Policy')
        .setDescription('Please review our payment instructions and verification guidelines:')
        .addFields(
          {
            name: '💵  Payment Methods',
            value:
              '• **GCash** & **Maya** accepted.\n' +
              '• Click **Pay to Hixsly** or **Pay to Ysha** in your ticket to receive their QR code and 1-tap mobile copy number.',
          },
          {
            name: '🧾  Receipt Verification (Strict)',
            value:
              '**No receipt = no process!** You must send a clear, full screenshot of your completed transfer in the ticket.',
          },
          {
            name: '🔍  Anti-Fraud Duplicate Detection',
            value:
              'Our system automatically hashes and checks every uploaded payment receipt. Reused or duplicate receipts from past tickets are flagged immediately to staff.',
          },
          {
            name: '⚠️  Force Refund Policy',
            value:
              '**For force refund, 30% of the total will be deducted.** Please be sure of your purchase before paying.',
          }
        )
        .setFooter({ text: 'Part 4 of 7 • Use the dropdown below to explore other topics' });
      break;

    case 'express':
      embed
        .setTitle('⚡  Part 5: Express Priority Pass')
        .setDescription('Need your order immediately? Jump straight to the front of the line!')
        .addFields(
          {
            name: '🚀  How It Works',
            value:
              'When submitting your order in the Buy modal, type **yes** or check the **⚡ Express Delivery (+₱15)** field.',
          },
          {
            name: '🥇  Queue Priority #1',
            value:
              'Your ticket is automatically prioritized ahead of all standard orders and assigned **#1 ⚡ EXPRESS** status.',
          },
          {
            name: '🔔  VIP Staff Notification',
            value:
              'The bot alerts staff with a priority alert: `⚡ VIP EXPRESS ORDER: Handle immediately!` so you get served first.',
          },
          {
            name: '💰  Fee',
            value: 'Only **+₱15** added directly to your ticket payment breakdown.',
          }
        )
        .setFooter({ text: 'Part 5 of 7 • Use the dropdown below to explore other topics' });
      break;

    case 'commands':
      embed
        .setTitle('💬  Part 6: Customer Commands Reference')
        .setDescription('You can use these slash commands anywhere in the server (replies are private to you):')
        .addFields(
          {
            name: '📋  Order & Account Tracking',
            value:
              '• `/myorder` — View your current active order, queue position, and estimated wait time.\n' +
              '• `/history` — View your completed past orders, total spend, and VIP loyalty progress.\n' +
              '• `/find [order] [user] [robloxname]` — Quick-search your order history and receipt details.',
          },
          {
            name: '💎  Stock & Pricing',
            value:
              '• `/stock` — Check current Robux stock level and live rate per 100 R$.\n' +
              '• `/calc [robux] [price]` — Robux price calculator (Robux → PHP or PHP → Robux).\n' +
              '• `/prices [game]` — View the complete price catalog for Robux and all mobile games.',
          },
          {
            name: '📖  Help Center',
            value: '• `/help` — Opens this interactive topic guide anytime.',
          }
        )
        .setFooter({ text: 'Part 6 of 7 • Use the dropdown below to explore other topics' });
      break;

    case 'faq':
      embed
        .setTitle('📌  Part 7: Shop Rules & Good to Know')
        .setDescription('Helpful policies to keep your ordering experience fast and pleasant:')
        .addFields(
          {
            name: '🎫  One Ticket at a Time',
            value:
              'Customers are limited to **1 active ticket** at a time. Finish or close your current ticket before opening another.',
          },
          {
            name: '⏳  Queue & Hold System',
            value:
              'Orders are served in order. If you need to step away, staff can place your ticket on **Hold** and resume when you return without losing your place.',
          },
          {
            name: '🌙  Staff Shift Mode (/duty)',
            value:
              'If staff members are taking a break or off-duty, an **Off-Duty Notice** will appear in new tickets. Your spot is reserved in the queue, and staff will send the payment QR code as soon as they return!',
          },
          {
            name: '🔒  Transcript Archives',
            value:
              'Upon completion, a complete HTML transcript of your ticket is archived for customer safety and order history.',
          }
        )
        .setFooter({ text: 'Part 7 of 7 • Use the dropdown below to explore other topics' });
      break;

    case 'overview':
    default:
      embed
        .setTitle('📖  Revéux Customer Help Center')
        .setDescription(
          `Welcome to **Revéux Shop**! Go to ${buyChannel} to start an order.\n\n` +
          '**Select a topic from the dropdown menu below** to read specific details:\n\n' +
          '• 🛒 **Part 1:** How to Place an Order\n' +
          '• 🎮 **Part 2:** Mobile Games Top-Up (MLBB, HOK, CODM)\n' +
          '• 🟥 **Part 3:** Roblox Robux Ordering & Avatar Preview\n' +
          '• 💳 **Part 4:** Payment & Receipts Policy\n' +
          '• ⚡ **Part 5:** Express Priority Pass (+₱15)\n' +
          '• 💬 **Part 6:** Customer Commands Reference\n' +
          '• 📌 **Part 7:** Shop Rules & Good to Know'
        )
        .setFooter({ text: 'Select any part from the dropdown menu below to view its guide' });
      break;
  }

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
          `• \`/${c.prices} [game] [public:true/false]\` — View price catalog or post it publicly\n` +
          '• `/flashdrop <start|stop|status>` — Launch or manage limited-time flash sales in `#daily-sale`',
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
          '• `/config <view|set> [rate] [express] [lowstock]` — Dynamically update rates & fees without restarting\n' +
          '• `/find [order] [user] [robloxname]` — Look up orders, payment receipts, and customer details\n' +
          '• `/afk <set|off|status> [reason]` — Temporarily step away with auto-reply in tickets\n' +
          '• `/checkreceipt` — View extracted Ref No, Amount, and split payment history (staff only)\n' +
          '• `/addpayment <amount> [note] [reset]` — Record or adjust a partial/split payment on a ticket\n' +
          '• `/duty <on|off|status> [note]` — Toggle staff on/off duty status (shows off-duty notice if all staff off-duty)\n' +
          '• `/staffstats` — Show leaderboard of processed, sent and completed orders per staff member\n' +
          '• `/report [today|week|all]` — Generate total revenue and sales volume report\n' +
          '• `/promo <create|delete|list|give>` — Create, manage, or give promo codes to customers in tickets\n' +
          '• `/remind <receipt|vouch|details> [note]` — Ping customer with a polite reminder (pinned to bottom)\n' +
          '• `/note <text>` — Post an internal team note inside the ticket channel (pinned to bottom)\n' +
          '• `/blacklist <add|remove|list>` — Block or unblock users from opening tickets',
      }
    )
    .setFooter({ text: 'Staff only cheat sheet • Reveux Shop' })
    .setTimestamp();
}

function buildHelpComponents(category = 'overview', isUserStaff = false) {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('help_category_select')
    .setPlaceholder('📂 Select a guide topic...')
    .addOptions(
      HELP_CATEGORIES.map((cat) => ({
        label: cat.label,
        value: cat.value,
        description: cat.description,
        emoji: cat.emoji,
        default: cat.value === category,
      }))
    );

  const rows = [new ActionRowBuilder().addComponents(selectMenu)];

  if (isUserStaff) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('view_staff_help')
          .setLabel('View Staff Commands')
          .setEmoji('🛡️')
          .setStyle(ButtonStyle.Danger)
      )
    );
  }

  return rows;
}

async function runHelp(interaction, category = 'overview') {
  const staff = isStaff(interaction.member);
  const embed = buildCustomerHelpEmbed(category);
  const components = buildHelpComponents(category, staff);

  const response = { embeds: [embed], components, flags: EPHEMERAL };
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
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
      await runHelp(interaction, 'overview');
      return true;
    }
    if (interaction.commandName === STAFF_HELP_CMD) {
      await runStaffHelp(interaction);
      return true;
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'help_category_select') {
      const selected = interaction.values[0] || 'overview';
      await runHelp(interaction, selected);
      return true;
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'view_staff_help') {
      await runStaffHelp(interaction);
      return true;
    }
    if (interaction.customId === 'view_customer_help') {
      await runHelp(interaction, 'overview');
      return true;
    }
  }

  return false;
}

module.exports = { commands, handle };
