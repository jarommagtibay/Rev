// /giveaway -> staff starts a Robux or GCash giveaway (a popup form opens)      /reroll -> new winner(s)
//
// How it works:
//  1. Staff runs /giveaway, picks "Robux amount", "Pesos worth of Robux" or "GCash prize" and fills in the popup.
//     A Robux prize is shown with its peso value beside it, e.g. 1,000 Robux (₱350).
//     A GCash prize is a cash prize in pesos, e.g. ₱100 via GCash (no Robux rate needed).
//  2. People tap the Enter button. When the time is up the bot picks the winner(s).
//     NO ticket opens by itself, so a reroll is easy.
//  3. Under the announcement each winner has a Claim button. ONLY that winner can press it.
//     A popup asks for their account name and Roblox username (for a GCash prize: their GCash
//     name and number), then their claim ticket opens.
//  4. In the ticket: staff press "Prize Sent" and attach a proof of delivery picture (like the
//     buying tickets), then the winner taps Vouch to confirm the giveaway is real.
//
// Everything for this feature is in this one file. Giveaways are saved in giveaways.json.
const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  ROOT,
  COLOR,
  CURRENCY,
  GUILD_ID,
  STAFF_ROLE_ID,
  CATEGORY_ID,
  VOUCH_CHANNEL_ID,
} = require('../config');
const client = require('../core/client');
const { data, formatPrice } = require('../core/data');
const M = require('../messages');
const {
  EPHEMERAL,
  isStaff,
  getCustomerId,
  parseOrderAmount,
  ticketMessage,
} = require('../core/helpers');
const { makeSafeName } = require('../core/ticket');

// Command names (one word each)
const NAMES = { giveaway: 'giveaway', reroll: 'reroll' };

// Look of the giveaway embeds
const ENDED_COLOR = 0x4f545c; // grey for a finished giveaway
const LINE = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';
const AUTHOR = { name: 'REVÉUX  •  GIVEAWAY' };

const MIN_TIME = 10 * 1000; // 10 seconds
const MAX_TIME = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_GCASH_PRIZE = 100000; // biggest GCash prize in pesos (stops typing mistakes)

// ---------- Saved data ----------
const FILE = path.join(ROOT, 'giveaways.json');

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}

const giveaways = load(); // { [giveaway message id]: giveaway }
const ending = new Set(); // giveaways being ended right now
const dirty = new Set(); // giveaways whose entry count needs to be refreshed

function save() {
  fs.writeFileSync(FILE, JSON.stringify(giveaways, null, 2));
}

// ---------- Commands ----------
const commands = [
  new SlashCommandBuilder()
    .setName(NAMES.giveaway)
    .setDescription('Staff only: start a giveaway (opens a form)')
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription('What is the prize?')
        .setRequired(true)
        .addChoices(
          { name: 'Robux amount', value: 'robux' },
          { name: `Pesos worth of Robux (${CURRENCY})`, value: 'price' },
          { name: `GCash prize (${CURRENCY} cash)`, value: 'gcash' }
        )
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Where to post it (default: this channel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    ),
  new SlashCommandBuilder()
    .setName(NAMES.reroll)
    .setDescription('Staff only: pick a new winner for a finished giveaway')
    .addStringOption((o) =>
      o
        .setName('giveaway')
        .setDescription('Message ID or link of the giveaway (default: the last one in this channel)')
    )
    .addUserOption((o) =>
      o
        .setName('winner')
        .setDescription('Only replace this winner (default: replace all winners)')
    ),
];

// ---------- Small helpers ----------
function parseDuration(text) {
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  const clean = String(text).toLowerCase().replace(/\s+/g, '');
  if (!/^(\d+[smhdw])+$/.test(clean)) return null;
  let total = 0;
  for (const [, n, u] of clean.matchAll(/(\d+)([smhdw])/g)) total += Number(n) * units[u];
  return total;
}

function unix(ms) {
  return Math.floor(ms / 1000);
}

function giveawayLink(g) {
  return `https://discord.com/channels/${GUILD_ID}/${g.channelId}/${g.id}`;
}

function btn(id, label, style = ButtonStyle.Danger, disabled = false) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
}

function enterRow(disabled) {
  return new ActionRowBuilder().addComponents(btn('gw_enter', '🎉  Enter', ButtonStyle.Danger, disabled));
}

function closeRow() {
  return new ActionRowBuilder().addComponents(btn('close_ticket', 'Close Ticket'));
}

// Sets (or adds) a field on an embed
function setField(embed, name, value, inline = false) {
  const fields = (embed.data.fields || []).filter((f) => f.name !== name);
  fields.push({ name, value, inline });
  embed.setFields(fields);
}

function hasField(embed, name) {
  return (embed.data.fields || []).some((f) => f.name === name);
}

function formatPesos(n) {
  return `${CURRENCY}${Number(n).toLocaleString('en-US')}`;
}

// Big prize headline used on every giveaway card: the Robux amount large, the peso value under it.
// (Old giveaways saved before this update only have the prize text, so they fall back to that.)
function prizeHeadline(g) {
  if (g.kind === 'gcash') {
    return `### 💸  GCash prize\n## ${formatPesos(g.pesos)}`;
  }
  if (g.amount && g.priceText) {
    return `### 💎  ${Number(g.amount).toLocaleString('en-US')} Robux\n## ${g.priceText}`;
  }
  return `### 🎁  ${g.prize}`;
}

// ---------- The giveaway message ----------
function giveawayEmbed(g) {
  const embed = new EmbedBuilder().setTimestamp().setAuthor(AUTHOR);
  if (g.hostAvatar) embed.setThumbnail(g.hostAvatar);

  if (!g.ended) {
    return embed
      .setColor(COLOR)
      .setTitle('🎉  GIVEAWAY  🎉')
      .setDescription(
        `${prizeHeadline(g)}\n${LINE}\n` +
        'Tap **🎉 Enter** below to join!\n\n' +
        `⏰  Ends <t:${unix(g.endsAt)}:R>  •  <t:${unix(g.endsAt)}:f>`
      )
      .addFields(
        { name: '🏆  Winners', value: `**${g.winnersCount}**`, inline: true },
        { name: '👥  Entries', value: `**${g.entrants.length}**`, inline: true },
        { name: '👑  Hosted by', value: `<@${g.hostId}>`, inline: true }
      )
      .setFooter({ text: 'Good luck everyone!' });
  }

  return embed
    .setColor(ENDED_COLOR)
    .setTitle('🎉  GIVEAWAY ENDED')
    .setDescription(`${prizeHeadline(g)}\n${LINE}`)
    .addFields(
      {
        name: g.winners.length === 1 ? '🏆  Winner' : '🏆  Winners',
        value: g.winners.length ? g.winners.map((id) => `<@${id}>`).join('\n') : 'No valid entries',
        inline: true,
      },
      { name: '👥  Entries', value: `**${g.entrants.length}**`, inline: true },
      { name: '👑  Hosted by', value: `<@${g.hostId}>`, inline: true }
    )
    .setFooter({ text: 'This giveaway has ended' });
}

async function fetchGiveawayMessage(g) {
  const channel = await client.channels.fetch(g.channelId).catch(() => null);
  if (!channel) return { channel: null, message: null };
  const message = await channel.messages.fetch(g.id).catch(() => null);
  return { channel, message };
}

async function refreshGiveawayMessage(g) {
  const { message } = await fetchGiveawayMessage(g);
  if (!message) return;
  await message
    .edit({ embeds: [giveawayEmbed(g)], components: [enterRow(g.ended)] })
    .catch((err) => console.error('Could not update the giveaway message:', err));
}

// ---------- Picking and announcing winners ----------
// Picks random winners from the entrants. Skips anyone who was already drawn before and
// anyone who left the server.
async function pickWinners(g, count) {
  const guild = await client.guilds.fetch(GUILD_ID);
  const pool = g.entrants.filter((id) => !g.drawn.includes(id));

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const picked = [];
  for (const id of pool) {
    if (picked.length >= count) break;
    const member = await guild.members.fetch(id).catch(() => null);
    if (member) picked.push(id);
  }
  return picked;
}

// Announcement with one Claim button per winner. Only that winner can press their button.
// Nothing opens by itself, so a reroll is easy.
async function announceWinners(g, channel, winnerIds, rerolled) {
  const mentions = winnerIds.map((id) => `<@${id}>`).join(', ');
  const users = await Promise.all(winnerIds.map((id) => client.users.fetch(id).catch(() => null)));

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor(AUTHOR)
    .setTitle(rerolled ? '🔁  New Winner' : '🎊  We Have a Winner!')
    .setDescription(
      `## Congratulations!\n${mentions}\n\n` +
      `You won\n${prizeHeadline(g)}\n${LINE}\n` +
      '> Tap **Claim** below to open your claim ticket. Only the winner can press their own button.'
    )
    .setFooter({ text: 'Claim your prize before staff close the giveaway' })
    .setTimestamp();

  const buttons = winnerIds.map((id, i) =>
    btn(
      `gw_claim:${g.id}:${id}`,
      (winnerIds.length === 1 ? 'Claim prize' : `Claim: ${users[i] ? users[i].username : id}`).slice(0, 80)
    )
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }

  await channel.send({
    content: mentions,
    embeds: [embed],
    components: rows,
    reply: { messageReference: g.id, failIfNotExists: false },
  });
}

async function endGiveaway(g) {
  if (g.ended || ending.has(g.id)) return;
  ending.add(g.id);
  try {
    const channel = await client.channels.fetch(g.channelId).catch(() => null);
    if (!channel) {
      // The channel was deleted, nothing to announce
      g.ended = true;
      g.winners = [];
      save();
      return;
    }

    const winners = await pickWinners(g, g.winnersCount);
    g.ended = true;
    g.winners = winners;
    g.drawn.push(...winners);
    save();

    await refreshGiveawayMessage(g);

    if (winners.length === 0) {
      await channel.send({
        content: `The giveaway for **${g.prize}** ended, but there were no valid entries.`,
        reply: { messageReference: g.id, failIfNotExists: false },
      });
    } else {
      await announceWinners(g, channel, winners, false);
    }
  } catch (err) {
    console.error('Could not end the giveaway:', err);
  } finally {
    ending.delete(g.id);
  }
}

// Checks every few seconds: ends giveaways whose time is up and refreshes entry counts.
// This also takes care of giveaways that ended while the bot was offline.
setInterval(async () => {
  if (!client.isReady()) return;
  for (const g of Object.values(giveaways)) {
    if (g.ended) continue;
    if (Date.now() >= g.endsAt) {
      await endGiveaway(g);
    } else if (dirty.has(g.id)) {
      dirty.delete(g.id);
      await refreshGiveawayMessage(g);
    }
  }
}, 5000);

// ---------- /giveaway (opens a popup form) ----------
function buildGiveawayModal(channelId, mode) {
  const amount = new TextInputBuilder()
    .setCustomId('gw_amount')
    .setLabel(
      mode === 'robux'
        ? 'How much Robux is the prize?'
        : mode === 'gcash'
          ? `How many pesos is the GCash prize? (${CURRENCY})`
          : `How many pesos worth of Robux? (${CURRENCY})`
    )
    .setPlaceholder(mode === 'robux' ? 'e.g. 1000' : 'e.g. 100')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10);
  const time = new TextInputBuilder()
    .setCustomId('gw_time')
    .setLabel('How long? (30m, 2h, 1d, 1d12h)')
    .setPlaceholder('e.g. 1d')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);
  const winners = new TextInputBuilder()
    .setCustomId('gw_winners')
    .setLabel('Number of winners (1 to 10, default 1)')
    .setPlaceholder('1')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(2);

  return new ModalBuilder()
    .setCustomId(`gw_start:${channelId}:${mode}`)
    .setTitle(
      mode === 'robux' ? 'Giveaway: Robux amount' : mode === 'gcash' ? 'Giveaway: GCash prize' : 'Giveaway: pesos worth'
    )
    .addComponents(
      new ActionRowBuilder().addComponents(amount),
      new ActionRowBuilder().addComponents(time),
      new ActionRowBuilder().addComponents(winners)
    );
}

function rateMissingText() {
  return `The Robux rate is not set yet, so I can not work out the pesos. Set it with \`/${M.commandNames.setup}\` first.`;
}

async function runGiveaway(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can use this command.', flags: EPHEMERAL });
  }
  const mode = interaction.options.getString('type');
  // A GCash prize does not use the Robux rate
  if (mode !== 'gcash' && data.rate <= 0) {
    return interaction.reply({ content: rateMissingText(), flags: EPHEMERAL });
  }

  const channel = interaction.options.getChannel('channel') || interaction.channel;
  return interaction.showModal(buildGiveawayModal(channel.id, mode));
}

// The form was submitted -> post the giveaway
async function giveawayForm(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can start giveaways.', flags: EPHEMERAL });
  }
  const [, channelId, mode] = interaction.customId.split(':');
  if (mode !== 'gcash' && data.rate <= 0) {
    return interaction.reply({ content: rateMissingText(), flags: EPHEMERAL });
  }
  const value = interaction.fields.getTextInputValue('gw_amount');
  const time = interaction.fields.getTextInputValue('gw_time');
  const winnersText = interaction.fields.getTextInputValue('gw_winners').trim();

  let amount = null;
  let priceText = null;
  let pesos = null;
  if (mode === 'gcash') {
    // GCash prize: a plain amount of pesos
    const clean = value.replace(/[,\s₱]/g, '');
    if (!/^\d+$/.test(clean) || Number(clean) < 1 || Number(clean) > MAX_GCASH_PRIZE) {
      return interaction.reply({
        content: `The GCash prize must be a whole number of pesos from 1 to ${MAX_GCASH_PRIZE.toLocaleString('en-US')}. Run the command again.`,
        flags: EPHEMERAL,
      });
    }
    pesos = Number(clean);
  } else {
    // Robux amount or pesos -> always ends up as a Robux amount (same rules as the buy form)
    const parsed = parseOrderAmount(mode === 'robux' ? value : '', mode === 'price' ? value : '');
    if (parsed.error) {
      return interaction.reply({ content: `${parsed.error} Run the command again.`, flags: EPHEMERAL });
    }
    amount = parsed.amount;
    priceText = formatPrice(amount);
  }

  const ms = parseDuration(time);
  if (!ms) {
    return interaction.reply({
      content: 'I could not read that time. Use something like `30m`, `2h`, `1d` or `1d12h`. Run the command again.',
      flags: EPHEMERAL,
    });
  }
  if (ms < MIN_TIME || ms > MAX_TIME) {
    return interaction.reply({
      content: 'The time must be between 10 seconds and 30 days. Run the command again.',
      flags: EPHEMERAL,
    });
  }

  let winnersCount = 1;
  if (winnersText) {
    if (!/^\d+$/.test(winnersText) || Number(winnersText) < 1 || Number(winnersText) > 10) {
      return interaction.reply({
        content: 'Winners must be a number from 1 to 10. Run the command again.',
        flags: EPHEMERAL,
      });
    }
    winnersCount = Number(winnersText);
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    return interaction.editReply('I could not find that channel.');
  }

  const g = {
    id: null,
    channelId: channel.id,
    kind: mode === 'gcash' ? 'gcash' : 'robux',
    // Shown everywhere: the Robux amount with what it is worth in pesos beside it (or the GCash pesos)
    prize: mode === 'gcash' ? `${formatPesos(pesos)} via GCash` : `${amount.toLocaleString('en-US')} Robux (${priceText})`,
    amount,
    priceText,
    pesos,
    hostId: interaction.user.id,
    hostAvatar: interaction.user.displayAvatarURL(),
    endsAt: Date.now() + ms,
    winnersCount,
    entrants: [],
    drawn: [], // everyone who was ever picked (never picked twice)
    winners: [], // current winners
    claims: {}, // winner id -> claim ticket channel id
    ended: false,
  };

  try {
    const message = await channel.send({ embeds: [giveawayEmbed(g)], components: [enterRow(false)] });
    g.id = message.id;
  } catch (err) {
    console.error('Could not post the giveaway:', err);
    return interaction.editReply('I could not post in that channel. Check my permissions there.');
  }

  giveaways[g.id] = g;
  save();

  return interaction.editReply(
    `Giveaway for **${g.prize}** started in ${channel}. It ends <t:${unix(g.endsAt)}:R>.`
  );
}

// ---------- /reroll ----------
function findGiveaway(input, channelId) {
  if (input) {
    const match = input.match(/(\d{17,20})\s*$/);
    return match ? giveaways[match[1]] : null;
  }
  return (
    Object.values(giveaways)
      .filter((g) => g.channelId === channelId && g.ended)
      .sort((a, b) => b.endsAt - a.endsAt)[0] || null
  );
}

async function runReroll(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can use this command.', flags: EPHEMERAL });
  }

  const g = findGiveaway(interaction.options.getString('giveaway'), interaction.channelId);
  if (!g) {
    return interaction.reply({
      content:
        'I could not find that giveaway. Use this command in the giveaway channel, or give the message ID / link.',
      flags: EPHEMERAL,
    });
  }
  if (!g.ended) {
    return interaction.reply({ content: 'That giveaway has not ended yet.', flags: EPHEMERAL });
  }

  const target = interaction.options.getUser('winner');
  let keep = [];
  let count = g.winnersCount;
  if (target) {
    if (!g.winners.includes(target.id)) {
      return interaction.reply({
        content: `${target} is not a current winner of that giveaway.`,
        flags: EPHEMERAL,
      });
    }
    keep = g.winners.filter((id) => id !== target.id);
    count = 1;
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  const picked = await pickWinners(g, count);
  if (picked.length === 0) {
    return interaction.editReply('Nobody is left to pick. Everyone who entered was already drawn.');
  }

  g.winners = [...keep, ...picked];
  g.drawn.push(...picked);
  save();

  const channel = await client.channels.fetch(g.channelId).catch(() => null);
  if (channel) await announceWinners(g, channel, picked, true);
  await refreshGiveawayMessage(g);

  return interaction.editReply(
    `Rerolled. New winner${picked.length > 1 ? 's' : ''}: ${picked.map((id) => `<@${id}>`).join(', ')}`
  );
}

// ---------- Enter / leave ----------
async function enterButton(interaction) {
  const g = giveaways[interaction.message.id];
  if (!g || g.ended) {
    return interaction.reply({ content: 'This giveaway has ended.', flags: EPHEMERAL });
  }

  if (g.entrants.includes(interaction.user.id)) {
    return interaction.reply({
      content: 'You already entered this giveaway.',
      components: [
        new ActionRowBuilder().addComponents(btn(`gw_leave:${g.id}`, 'Leave Giveaway')),
      ],
      flags: EPHEMERAL,
    });
  }

  g.entrants.push(interaction.user.id);
  save();
  dirty.add(g.id);
  return interaction.reply({ content: "You're in! 🎉 Good luck!", flags: EPHEMERAL });
}

async function leaveButton(interaction) {
  const g = giveaways[interaction.customId.split(':')[1]];
  if (!g || g.ended) {
    return interaction.update({ content: 'This giveaway has ended.', components: [] });
  }
  g.entrants = g.entrants.filter((id) => id !== interaction.user.id);
  save();
  dirty.add(g.id);
  return interaction.update({ content: 'You left the giveaway.', components: [] });
}

// ---------- Claim ticket (the WINNER taps their Claim button) ----------
function buildClaimModal(giveawayId, winnerId, kind) {
  const gcash = kind === 'gcash';
  const nameInput = new TextInputBuilder()
    .setCustomId('account_name')
    .setLabel(gcash ? 'GCash account name' : 'Account name (display name)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);
  const usernameInput = new TextInputBuilder()
    .setCustomId('account_username')
    .setLabel(gcash ? 'GCash number (09XXXXXXXXX)' : 'Account username')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(gcash ? 20 : 50);
  if (gcash) usernameInput.setPlaceholder('09123456789');

  return new ModalBuilder()
    .setCustomId(`gw_claim_form:${giveawayId}:${winnerId}`)
    .setTitle(gcash ? 'Claim Your GCash Prize' : 'Claim Your Prize')
    .addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(usernameInput)
    );
}

// Returns { g, error } for a Claim button / form of this user
async function checkClaim(interaction, giveawayId, winnerId) {
  if (interaction.user.id !== winnerId) {
    return { error: `This button is only for <@${winnerId}>, the winner.` };
  }
  const g = giveaways[giveawayId];
  if (!g || !g.winners.includes(winnerId)) {
    return { error: 'This claim is no longer valid (the giveaway was rerolled).' };
  }
  if (g.claims[winnerId]) {
    const existing = await interaction.guild.channels.fetch(g.claims[winnerId]).catch(() => null);
    if (existing) return { error: `You already have a claim ticket: ${existing}` };
  }
  return { g };
}

// Claim button -> only the winner. Opens the popup for name and Roblox username.
async function claimButton(interaction) {
  const [, giveawayId, winnerId] = interaction.customId.split(':');
  const check = await checkClaim(interaction, giveawayId, winnerId);
  if (check.error) {
    return interaction.reply({ content: check.error, flags: EPHEMERAL });
  }
  return interaction.showModal(buildClaimModal(giveawayId, winnerId, check.g.kind));
}

// Popup submitted -> create the private claim ticket
async function claimForm(interaction) {
  const [, giveawayId, winnerId] = interaction.customId.split(':');
  const check = await checkClaim(interaction, giveawayId, winnerId);
  if (check.error) {
    return interaction.reply({ content: check.error, flags: EPHEMERAL });
  }
  const g = check.g;

  const gcash = g.kind === 'gcash';
  const name = interaction.fields.getTextInputValue('account_name').trim();
  let username = interaction.fields.getTextInputValue('account_username').trim();

  // GCash number: accept 09XXXXXXXXX, 9XXXXXXXXX with +63 / 63, spaces or dashes. Saved as 09XXXXXXXXX.
  if (gcash) {
    const match = username.replace(/[\s-]/g, '').match(/^(?:\+?63|0)(9\d{9})$/);
    if (!match) {
      return interaction.reply({
        content: 'That does not look like a GCash number. Use the format `09XXXXXXXXX`. Tap **Claim** again and try once more.',
        flags: EPHEMERAL,
      });
    }
    username = `0${match[1]}`;
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  const allow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
  ];

  const channel = await interaction.guild.channels.create({
    name: `giveaway-${makeSafeName(interaction.user)}`,
    type: ChannelType.GuildText,
    parent: CATEGORY_ID || null,
    topic: `ticket:${winnerId}`, // same format as order tickets, so Close Ticket works
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: winnerId, allow },
      { id: STAFF_ROLE_ID, allow: [...allow, PermissionFlagsBits.ManageChannels] },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
    ],
  });

  g.claims[winnerId] = channel.id;
  save();

  // Field names (Account Name, Prize, Status, Vouch ...) are read by the code below: keep them as they are
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor(AUTHOR)
    .setTitle('🎁  Giveaway Claim')
    .setDescription(
      `## Congratulations!\n${prizeHeadline(g)}\n${LINE}\n` +
      (gcash
        ? 'Staff will send your prize to the GCash number below. Please make sure it is correct.\n'
        : 'Staff will send your prize to the account below.\n') +
      'After you receive it, tap **Vouch** to confirm the giveaway is real. Thank you!'
    )
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      { name: gcash ? 'GCash Name' : 'Account Name', value: name, inline: true },
      { name: gcash ? 'GCash Number' : 'Account Username', value: username, inline: true },
      { name: 'Prize', value: g.prize, inline: true },
      { name: 'Winner', value: `${interaction.user}`, inline: true },
      { name: 'Giveaway', value: `[Jump to giveaway](${giveawayLink(g)})`, inline: true },
      { name: 'Status', value: 'Waiting for staff to send the prize' }
    )
    .setFooter({ text: 'Tap Vouch after you receive your prize' })
    .setTimestamp();

  await channel.send({
    content: `${interaction.user} <@&${STAFF_ROLE_ID}>`,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        btn('gw_sent', 'Prize Sent (Staff)'),
        btn('close_ticket', 'Close Ticket')
      ),
    ],
    allowedMentions: { parse: ['users', 'roles'] },
  });

  // Grey out this winner's Claim button so it is not pressed twice
  if (interaction.isFromMessage() && interaction.message) {
    try {
      const target = `gw_claim:${giveawayId}:${winnerId}`;
      const rows = interaction.message.components.map((row) => {
        const copy = ActionRowBuilder.from(row);
        copy.components.forEach((c) => {
          if (c.data.custom_id === target) c.setDisabled(true);
        });
        return copy;
      });
      await interaction.message.edit({ components: rows });
    } catch (err) {
      console.error('Could not update the winner buttons:', err);
    }
  }

  return interaction.editReply(`Your claim ticket is ready: ${channel}`);
}

// ---------- Prize sent (staff, with proof of delivery like the buying ticket) ----------
function getField(embed, name) {
  return ((embed.data.fields || []).find((f) => f.name === name) || {}).value || '';
}

// sent-user / done-user, keeping the giveaway part of the name
function retag(channelName, prefix) {
  return `${prefix}-${channelName.replace(/^(sent|done)-/, '')}`;
}

function buildSentModal(mainMessageId) {
  const upload = new FileUploadBuilder().setCustomId('proof').setRequired(true);
  const label = new LabelBuilder()
    .setLabel('Proof of delivery')
    .setDescription('Attach a picture showing the prize was sent to the account')
    .setFileUploadComponent(upload);

  return new ModalBuilder()
    .setCustomId(`gw_sent_form:${mainMessageId}`)
    .setTitle('Mark Prize as Sent')
    .addLabelComponents(label);
}

// Marks the claim as sent: proof picture in the ticket, then the Vouch button for the winner
async function markPrizeSent(message, channel, user, proof) {
  const embed = EmbedBuilder.from(message.embeds[0]);
  if (/^(Sent|Completed)/.test(getField(embed, 'Status'))) {
    return { error: 'The prize was already marked as sent.' };
  }

  setField(embed, 'Status', `Sent by ${user}`);
  await message.edit({ embeds: [embed], components: [closeRow()] });
  channel.setName(retag(channel.name, 'sent')).catch(() => { });

  const sentOptions = {
    userId: getCustomerId(channel),
    title: '📦  Prize Sent',
    text: `### 🎁  ${getField(embed, 'Prize') || 'Your prize'}\n${LINE}\nYour prize has been **sent**!`,
    footer: `Sent by ${user.username}`,
  };

  if (proof) {
    const ext = (path.extname(proof.name || '') || '.png').toLowerCase();
    const proofName = `proof${ext}`;
    sentOptions.extraEmbeds = [
      new EmbedBuilder()
        .setTitle(M.sent.proofTitle)
        .setColor(COLOR)
        .setImage(`attachment://${proofName}`),
    ];
    sentOptions.extraFiles = [new AttachmentBuilder(proof.url, { name: proofName })];
  }

  try {
    await channel.send(ticketMessage('sent', sentOptions));
  } catch (err) {
    // If the proof picture could not be re-uploaded, link it directly instead
    console.error('Could not upload the proof picture:', err);
    await channel.send(
      ticketMessage(null, {
        userId: sentOptions.userId,
        title: sentOptions.title,
        text: sentOptions.text,
        footer: sentOptions.footer,
        extraEmbeds: proof
          ? [new EmbedBuilder().setTitle(M.sent.proofTitle).setColor(COLOR).setImage(proof.url)]
          : [],
      })
    );
  }

  await channel.send(
    ticketMessage('vouch', {
      title: '⭐  Leave a Vouch',
      text:
        (hasField(embed, 'GCash Number') ? '### 📦  Check your GCash!\n' : '### 📦  Check your account!\n') +
        `${LINE}\n` +
        (hasField(embed, 'GCash Number') ? 'Please check your GCash' : 'Please check your account') +
        ', then tap **Vouch** below to confirm the giveaway is real. Thank you!',
      components: [
        new ActionRowBuilder().addComponents(btn(`gw_vouch:${message.id}`, 'Vouch')),
      ],
    })
  );
  return {};
}

// Prize Sent button -> staff only. Opens the proof popup.
async function sentButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can use this button.', flags: EPHEMERAL });
  }

  const embed = EmbedBuilder.from(interaction.message.embeds[0]);
  if (/^(Sent|Completed)/.test(getField(embed, 'Status'))) {
    return interaction.reply({ content: 'The prize was already marked as sent.', flags: EPHEMERAL });
  }

  // Older discord.js versions can't show a file upload popup: mark as sent without proof
  if (!FileUploadBuilder || !LabelBuilder) {
    console.warn('This discord.js version has no file upload popup. Run: npm install discord.js@latest');
    await interaction.deferReply({ flags: EPHEMERAL });
    const result = await markPrizeSent(interaction.message, interaction.channel, interaction.user, null);
    return interaction.editReply(
      result.error || 'Prize marked as sent. (No proof popup: discord.js needs updating.)'
    );
  }

  return interaction.showModal(buildSentModal(interaction.message.id));
}

// Proof popup submitted -> mark as sent
async function sentForm(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can mark prizes as sent.',
      flags: EPHEMERAL,
    });
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  const files = interaction.fields.getUploadedFiles('proof');
  const attachment = files && files.first();
  if (!attachment || !(attachment.contentType || '').startsWith('image/')) {
    return interaction.editReply(
      'Please attach a picture (PNG or JPG). Press **Prize Sent** again and try once more.'
    );
  }

  const message = await interaction.channel.messages.fetch(interaction.customId.split(':')[1]);
  const result = await markPrizeSent(message, interaction.channel, interaction.user, {
    url: attachment.url,
    name: attachment.name,
  });

  return interaction.editReply(result.error || '📦 Prize marked as sent with proof.');
}

// ---------- Vouch ----------
function buildVouchModal(mainMessageId) {
  const modal = new ModalBuilder()
    .setCustomId(`gw_vouch_form:${mainMessageId}`)
    .setTitle('Giveaway Vouch');

  // Older discord.js: no picture upload, classic layout
  if (!FileUploadBuilder || !LabelBuilder) {
    const messageInput = new TextInputBuilder()
      .setCustomId('vouch_message')
      .setLabel('Your vouch')
      .setPlaceholder('e.g. Got my prize, legit giveaway!')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500);
    const ratingInput = new TextInputBuilder()
      .setCustomId('vouch_rating')
      .setLabel('Rating from 1 to 5 (optional)')
      .setPlaceholder('5')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(1);
    return modal.addComponents(
      new ActionRowBuilder().addComponents(messageInput),
      new ActionRowBuilder().addComponents(ratingInput)
    );
  }

  const messageInput = new TextInputBuilder()
    .setCustomId('vouch_message')
    .setPlaceholder('e.g. Got my prize, legit giveaway!')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);
  const ratingInput = new TextInputBuilder()
    .setCustomId('vouch_rating')
    .setPlaceholder('5')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(1);
  const pictureUpload = new FileUploadBuilder().setCustomId('vouch_proof').setRequired(false);

  return modal.addLabelComponents(
    new LabelBuilder().setLabel('Your vouch').setTextInputComponent(messageInput),
    new LabelBuilder().setLabel('Rating from 1 to 5 (optional)').setTextInputComponent(ratingInput),
    new LabelBuilder()
      .setLabel('Picture (optional)')
      .setDescription('Attach a screenshot as evidence')
      .setFileUploadComponent(pictureUpload)
  );
}

async function vouchButton(interaction) {
  if (interaction.user.id !== getCustomerId(interaction.channel)) {
    return interaction.reply({
      content: 'Only the winner of this ticket can leave a vouch.',
      flags: EPHEMERAL,
    });
  }
  if (!VOUCH_CHANNEL_ID) {
    return interaction.reply({
      content: 'The vouch channel is not set up yet. Please tell staff.',
      flags: EPHEMERAL,
    });
  }
  return interaction.showModal(buildVouchModal(interaction.customId.split(':')[1]));
}

async function vouchForm(interaction) {
  if (interaction.user.id !== getCustomerId(interaction.channel)) {
    return interaction.reply({
      content: 'Only the winner of this ticket can leave a vouch.',
      flags: EPHEMERAL,
    });
  }

  const vouchText = interaction.fields.getTextInputValue('vouch_message').trim();
  const ratingText = interaction.fields.getTextInputValue('vouch_rating').trim();

  if (ratingText && !/^[1-5]$/.test(ratingText)) {
    return interaction.reply({
      content: 'Rating must be a number from 1 to 5. Please try again.',
      flags: EPHEMERAL,
    });
  }

  // Optional picture
  let attachment = null;
  try {
    const files = interaction.fields.getUploadedFiles('vouch_proof');
    attachment = (files && files.first()) || null;
  } catch {
    attachment = null;
  }
  if (attachment && !(attachment.contentType || '').startsWith('image/')) {
    return interaction.reply({
      content: 'The attached file must be a picture (PNG or JPG). Please try again.',
      flags: EPHEMERAL,
    });
  }

  const fromMessage = interaction.isFromMessage();
  if (fromMessage) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: EPHEMERAL });

  const mainMessageId = interaction.customId.split(':')[1];
  const mainMessage = await interaction.channel.messages.fetch(mainMessageId);
  const ticketEmbed = EmbedBuilder.from(mainMessage.embeds[0]);

  if (hasField(ticketEmbed, 'Vouch')) {
    return interaction.followUp({
      content: 'You already left a vouch. Thank you!',
      flags: EPHEMERAL,
    });
  }

  const prize = ((ticketEmbed.data.fields || []).find((f) => f.name === 'Prize') || {}).value || '-';

  const vouchEmbed = new EmbedBuilder()
    .setAuthor(AUTHOR)
    .setTitle('⭐  Giveaway Vouch')
    .setColor(COLOR)
    .setDescription(`> ${vouchText.replace(/\n/g, '\n> ')}`)
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      { name: '🏆  Winner', value: `${interaction.user}`, inline: true },
      { name: '🎁  Prize', value: prize, inline: true }
    )
    .setTimestamp();

  if (ratingText) {
    vouchEmbed.addFields({ name: '⭐  Rating', value: '⭐'.repeat(Number(ratingText)), inline: true });
  }

  let proofFile = null;
  if (attachment) {
    const ext = (path.extname(attachment.name || '') || '.png').toLowerCase();
    const proofName = `vouch-proof${ext}`;
    vouchEmbed.setImage(`attachment://${proofName}`);
    proofFile = new AttachmentBuilder(attachment.url, { name: proofName });
  }

  try {
    const vouchChannel = await client.channels.fetch(VOUCH_CHANNEL_ID);
    try {
      await vouchChannel.send({ embeds: [vouchEmbed], files: proofFile ? [proofFile] : [] });
    } catch (err) {
      if (!attachment) throw err;
      // Could not re-upload the picture: link it directly instead
      console.error('Could not upload the vouch picture:', err);
      vouchEmbed.setImage(attachment.url);
      await vouchChannel.send({ embeds: [vouchEmbed] });
    }
  } catch (err) {
    console.error('Could not post vouch:', err);
    return interaction.followUp({
      content: 'Could not post your vouch. Please tell staff.',
      flags: EPHEMERAL,
    });
  }

  // Mark the ticket as completed
  setField(ticketEmbed, 'Status', `Completed (vouched by ${interaction.user})`);
  ticketEmbed.addFields({ name: 'Vouch', value: 'Posted ✅' });
  await mainMessage.edit({ embeds: [ticketEmbed], components: [closeRow()] });

  if (!interaction.channel.name.startsWith('done-')) {
    interaction.channel.setName(retag(interaction.channel.name, 'done')).catch(() => { });
  }

  await interaction.channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('🎉  Giveaway Complete')
        .setDescription(
          '### Thank you for your vouch!\n' + `${LINE}\n` + 'Staff will close this ticket soon.'
        )
        .setTimestamp(),
    ],
  });

  // Remove the Vouch button from the bottom message
  if (fromMessage) {
    await interaction.editReply({ components: [] });
    await interaction.followUp({
      content: 'Thank you! Your vouch has been posted.',
      flags: EPHEMERAL,
    });
  } else {
    await interaction.editReply('Thank you! Your vouch has been posted.');
  }
}

// ---------- Router ----------
async function handle(interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === NAMES.giveaway) {
      await runGiveaway(interaction);
      return true;
    }
    if (interaction.commandName === NAMES.reroll) {
      await runReroll(interaction);
      return true;
    }
    return false;
  }

  if (interaction.isButton()) {
    const id = interaction.customId;
    if (id === 'gw_enter') {
      await enterButton(interaction);
      return true;
    }
    if (id.startsWith('gw_leave:')) {
      await leaveButton(interaction);
      return true;
    }
    if (id.startsWith('gw_claim:')) {
      await claimButton(interaction);
      return true;
    }
    if (id === 'gw_sent') {
      await sentButton(interaction);
      return true;
    }
    if (id.startsWith('gw_vouch:')) {
      await vouchButton(interaction);
      return true;
    }
    return false;
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('gw_start:')) {
      await giveawayForm(interaction);
      return true;
    }
    if (interaction.customId.startsWith('gw_claim_form:')) {
      await claimForm(interaction);
      return true;
    }
    if (interaction.customId.startsWith('gw_sent_form:')) {
      await sentForm(interaction);
      return true;
    }
    if (interaction.customId.startsWith('gw_vouch_form:')) {
      await vouchForm(interaction);
      return true;
    }
  }

  return false;
}

module.exports = { commands, handle };