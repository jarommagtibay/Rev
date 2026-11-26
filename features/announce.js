// /announce -> Staff-only AI Promo & Flash Drop Writer with preview, edit, regenerate, and 1-click post
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { COLOR, SHOP_STATUS_CHANNEL_ID, BUY_CHANNEL_ID, SHOP_PING_ROLE_ID } = require('../config');
const { data } = require('../core/data');
const { EPHEMERAL, isStaff } = require('../core/helpers');
const { availableStock } = require('../core/queue');
const { generateAnnouncement } = require('../core/ai');

const commands = [
  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Staff only: AI writes a promo or flash drop announcement to preview & post')
    .addStringOption((o) =>
      o
        .setName('topic')
        .setDescription('What to announce (e.g. "10k Robux Flash Drop at ₱170/1k")')
        .setRequired(true)
        .setMaxLength(300)
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Target channel to post in (defaults to status/buy channel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName('ping')
        .setDescription('Who to ping when posted (default: none)')
        .setRequired(false)
        .addChoices(
          { name: 'No ping', value: 'none' },
          { name: 'Shop Ping Role', value: 'shop' },
          { name: '@here', value: 'here' },
          { name: '@everyone', value: 'everyone' }
        )
    ),
];

const draftCache = new Map();
const CACHE_TTL_MS = 20 * 60 * 1000;

function saveDraft(token, draft) {
  const now = Date.now();
  for (const [k, v] of draftCache.entries()) {
    if (now - v.createdAt > CACHE_TTL_MS) draftCache.delete(k);
  }
  draftCache.set(token, { ...draft, createdAt: now });
}

function buildPreviewPayload(token, draft) {
  const pingLabel =
    draft.ping === 'everyone'
      ? '@everyone'
      : draft.ping === 'here'
      ? '@here'
      : draft.ping === 'shop' && SHOP_PING_ROLE_ID
      ? `<@&${SHOP_PING_ROLE_ID}>`
      : 'None';

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(draft.title)
    .setDescription(draft.body)
    .setFooter({
      text: `Preview • Target: #${draft.channelName} • Ping: ${pingLabel} • ${draft.engine}`,
    })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`announce_post:${token}`)
      .setLabel('Post Announcement')
      .setEmoji('📢')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`announce_edit:${token}`)
      .setLabel('Edit')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`announce_regen:${token}`)
      .setLabel('Regenerate')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

async function runAnnounce(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can use `/announce`.', flags: EPHEMERAL });
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  const topic = interaction.options.getString('topic', true).trim();
  const chosenChannel = interaction.options.getChannel('channel');
  const ping = interaction.options.getString('ping') || 'none';

  const targetChannelId =
    (chosenChannel && chosenChannel.id) ||
    SHOP_STATUS_CHANNEL_ID ||
    BUY_CHANNEL_ID ||
    interaction.channel.id;

  const targetChannel =
    interaction.guild.channels.cache.get(targetChannelId) ||
    (await interaction.guild.channels.fetch(targetChannelId).catch(() => null)) ||
    interaction.channel;

  const generated = await generateAnnouncement({
    topic,
    rate: data.rate,
    stock: availableStock(),
  });

  const token = `${interaction.user.id.slice(-4)}_${Date.now().toString(36)}`;
  const draft = {
    userId: interaction.user.id,
    topic,
    title: generated.title,
    body: generated.body,
    engine: generated.engine,
    channelId: targetChannel.id,
    channelName: targetChannel.name || 'channel',
    ping,
  };
  saveDraft(token, draft);

  return interaction.editReply(buildPreviewPayload(token, draft));
}

async function handleAnnounceButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can use this.', flags: EPHEMERAL });
  }

  const [action, token] = interaction.customId.split(':');
  const draft = draftCache.get(token);
  if (!draft) {
    return interaction.reply({
      content: '⌛ This announcement draft expired. Run `/announce` again.',
      flags: EPHEMERAL,
    });
  }

  if (action === 'announce_edit') {
    const modal = new ModalBuilder()
      .setCustomId(`announce_modal:${token}`)
      .setTitle('Edit Announcement');
    const titleInput = new TextInputBuilder()
      .setCustomId('ann_title')
      .setLabel('Headline')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(120)
      .setValue(draft.title);
    const bodyInput = new TextInputBuilder()
      .setCustomId('ann_body')
      .setLabel('Announcement Body')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1500)
      .setValue(draft.body);
    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(bodyInput)
    );
    return interaction.showModal(modal);
  }

  if (action === 'announce_regen') {
    await interaction.deferUpdate();
    const generated = await generateAnnouncement({
      topic: draft.topic,
      rate: data.rate,
      stock: availableStock(),
    });
    draft.title = generated.title;
    draft.body = generated.body;
    draft.engine = generated.engine;
    saveDraft(token, draft);
    return interaction.editReply(buildPreviewPayload(token, draft));
  }

  if (action === 'announce_post') {
    await interaction.deferUpdate();
    const targetChannel =
      interaction.guild.channels.cache.get(draft.channelId) ||
      (await interaction.guild.channels.fetch(draft.channelId).catch(() => null));
    if (!targetChannel) {
      return interaction.editReply({
        content: '❌ Could not find the target channel to post in.',
        embeds: [],
        components: [],
      });
    }

    let pingText = '';
    if (draft.ping === 'everyone') pingText = '@everyone';
    else if (draft.ping === 'here') pingText = '@here';
    else if (draft.ping === 'shop' && SHOP_PING_ROLE_ID) pingText = `<@&${SHOP_PING_ROLE_ID}>`;

    const postEmbed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(draft.title)
      .setDescription(draft.body)
      .setFooter({ text: `Revéux Shop • Posted by @${interaction.user.username}` })
      .setTimestamp();

    const sent = await targetChannel.send({
      content: pingText || undefined,
      embeds: [postEmbed],
      allowedMentions: { parse: ['everyone', 'roles'] },
    });

    draftCache.delete(token);
    return interaction.editReply({
      content: `✅ Announcement posted in <#${targetChannel.id}>: ${sent.url}`,
      embeds: [],
      components: [],
    });
  }
}

async function handleAnnounceModal(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: 'Only staff can edit announcements.', flags: EPHEMERAL });
  }
  const token = interaction.customId.split(':')[1];
  const draft = draftCache.get(token);
  if (!draft) {
    return interaction.reply({
      content: '⌛ This announcement draft expired. Run `/announce` again.',
      flags: EPHEMERAL,
    });
  }
  draft.title = (interaction.fields.getTextInputValue('ann_title') || '').trim().slice(0, 120);
  draft.body = (interaction.fields.getTextInputValue('ann_body') || '').trim().slice(0, 1500);
  draft.engine = 'Edited by Staff';
  saveDraft(token, draft);
  return interaction.update(buildPreviewPayload(token, draft));
}

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'announce') {
    await runAnnounce(interaction);
    return true;
  }
  if (
    interaction.isButton() &&
    (interaction.customId.startsWith('announce_post:') ||
      interaction.customId.startsWith('announce_edit:') ||
      interaction.customId.startsWith('announce_regen:'))
  ) {
    await handleAnnounceButton(interaction);
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('announce_modal:')) {
    await handleAnnounceModal(interaction);
    return true;
  }
  return false;
}

module.exports = { commands, handle };
