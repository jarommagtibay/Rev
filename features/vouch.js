// Vouch: the Vouch button, the vouch popup, posting to the vouch channel, auto-complete
const path = require('path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { COLOR, VOUCH_CHANNEL_ID } = require('../config');
const client = require('../core/client');
const M = require('../messages');
const { data, saveData, recordStaffAction, recordRating } = require('../core/data');
const { clearUnvouchedBuyer } = require('../core/unvouched');
const {
  EPHEMERAL,
  ticketMessage,
  fromTemplate,
  baseName,
  getCustomerId,
  tryLock,
  safeRenameChannel,
} = require('../core/helpers');
const {
  setPositionField,
  setStatusField,
  stageFromEmbed,
  isVouched,
  isRobuxOrder,
  getAmount,
  ticketRows,
  postReceipt,
  findStaffFromEmbed,
} = require('../core/ticket');

const commands = [];

// Vouch popup: message, optional rating (if not already chosen via star button) and an optional picture as evidence
function buildVouchModal(mainMessageId, presetRating = null) {
  const customId = presetRating
    ? `vouch_form:${mainMessageId}:${presetRating}`
    : `vouch_form:${mainMessageId}`;
  const title = presetRating
    ? `Rate Order: ${'⭐'.repeat(presetRating)}`.slice(0, 45)
    : 'Leave a Vouch';
  const reviewLabel = presetRating
    ? `Your Review (${presetRating} ⭐ rating selected)`
    : 'Your vouch';

  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title);

  // Older discord.js: no picture upload, classic layout
  if (!FileUploadBuilder || !LabelBuilder) {
    const messageInput = new TextInputBuilder()
      .setCustomId('vouch_message')
      .setLabel(reviewLabel)
      .setPlaceholder('e.g. Fast delivery, trusted seller! Thank you!')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500);

    const rows = [new ActionRowBuilder().addComponents(messageInput)];
    if (!presetRating) {
      const ratingInput = new TextInputBuilder()
        .setCustomId('vouch_rating')
        .setLabel('Rating from 1 to 5 (optional)')
        .setPlaceholder('5')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(1);
      rows.push(new ActionRowBuilder().addComponents(ratingInput));
    }

    return modal.addComponents(...rows);
  }

  const messageInput = new TextInputBuilder()
    .setCustomId('vouch_message')
    .setPlaceholder('e.g. Fast delivery, trusted seller! Thank you!')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);

  const pictureUpload = new FileUploadBuilder().setCustomId('vouch_proof').setRequired(false);

  const labels = [
    new LabelBuilder().setLabel(reviewLabel).setTextInputComponent(messageInput),
  ];

  if (!presetRating) {
    const ratingInput = new TextInputBuilder()
      .setCustomId('vouch_rating')
      .setPlaceholder('5')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(1);
    labels.push(
      new LabelBuilder()
        .setLabel('Rating from 1 to 5 (optional)')
        .setTextInputComponent(ratingInput)
    );
  }

  labels.push(
    new LabelBuilder()
      .setLabel('Picture (optional)')
      .setDescription('Attach a screenshot as evidence')
      .setFileUploadComponent(pictureUpload)
  );

  return modal.addLabelComponents(...labels);
}

// Star rating buttons (1 to 5 ⭐)
async function starVouchButton(interaction) {
  if (interaction.user.id !== getCustomerId(interaction.channel)) {
    return interaction.reply({
      content: 'Only the customer of this ticket can leave a rating.',
      flags: EPHEMERAL,
    });
  }

  if (!VOUCH_CHANNEL_ID) {
    return interaction.reply({
      content: 'The vouch channel is not set up yet. Please tell staff.',
      flags: EPHEMERAL,
    });
  }

  const [, stars, mainMessageId] = interaction.customId.split(':');
  const rating = Number(stars) || 5;

  return interaction.showModal(buildVouchModal(mainMessageId, rating));
}

// Vouch button (in the bottom message) -> only the customer of this ticket
async function vouchButton(interaction) {
  if (interaction.user.id !== getCustomerId(interaction.channel)) {
    return interaction.reply({
      content: 'Only the customer of this ticket can leave a vouch.',
      flags: EPHEMERAL,
    });
  }

  if (!VOUCH_CHANNEL_ID) {
    return interaction.reply({
      content: 'The vouch channel is not set up yet. Please tell staff.',
      flags: EPHEMERAL,
    });
  }

  const mainMessageId = interaction.customId.split(':')[1];
  return interaction.showModal(buildVouchModal(mainMessageId));
}

// Vouch form submitted. Holds the same lock as Complete Order, so a vouch and a staff click at the
// same moment can't both complete the order (and count it twice in the shop stats).
async function vouchForm(interaction) {
  if (interaction.user.id !== getCustomerId(interaction.channel)) {
    return interaction.reply({
      content: 'Only the customer of this ticket can leave a vouch.',
      flags: EPHEMERAL,
    });
  }

  const release = tryLock(`order:${interaction.channel.id}`);
  if (!release) {
    return interaction.reply({
      content: 'Your vouch is being processed. Please wait a moment.',
      flags: EPHEMERAL,
    });
  }
  try {
    await postVouch(interaction);
  } finally {
    release();
  }
}

// Posts the vouch (with the optional picture) and auto-completes the order
async function postVouch(interaction) {
  if (interaction.user.id !== getCustomerId(interaction.channel)) {
    return interaction.reply({
      content: 'Only the customer of this ticket can leave a vouch.',
      flags: EPHEMERAL,
    });
  }

  const vouchText = interaction.fields.getTextInputValue('vouch_message').trim();
  const parts = interaction.customId.split(':');
  const modalStars = parts[2] ? parts[2] : null;
  let ratingText = modalStars;
  if (!ratingText) {
    try {
      ratingText = interaction.fields.getTextInputValue('vouch_rating').trim();
    } catch {
      ratingText = '5';
    }
  }

  const finalRating = Math.min(5, Math.max(1, Number(ratingText) || 5));

  // Optional picture
  let attachment = null;
  try {
    const files = interaction.fields.getUploadedFiles('vouch_proof');
    attachment = (files && files.first()) || null;
  } catch {
    attachment = null; // no picture attached (or older discord.js)
  }
  if (attachment && !(attachment.contentType || '').startsWith('image/')) {
    return interaction.reply({
      content: 'The attached file must be a picture (PNG or JPG). Please try again.',
      flags: EPHEMERAL,
    });
  }

  // Acknowledge now: downloading and re-uploading the picture can take a few seconds
  const fromMessage = interaction.isFromMessage();
  if (fromMessage) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: EPHEMERAL });

  const mainMessageId = interaction.customId.split(':')[1];
  const mainMessage = await interaction.channel.messages.fetch({ message: mainMessageId, force: true });
  const ticketEmbed = EmbedBuilder.from(mainMessage.embeds[0]);

  if (isVouched(ticketEmbed)) {
    return interaction.followUp({
      content: 'You already left a vouch for this order. Thank you!',
      flags: EPHEMERAL,
    });
  }

  const amountField = (ticketEmbed.data.fields || []).find((f) => f.name === 'Robux Amount');
  const gameField = (ticketEmbed.data.fields || []).find((f) => f.name === 'Game');
  const packageField = (ticketEmbed.data.fields || []).find((f) => f.name === 'Package');

  const vouchEmbed = new EmbedBuilder()
    .setTitle('New Vouch')
    .setColor(COLOR)
    .setDescription(vouchText)
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields({ name: 'Customer', value: `${interaction.user}`, inline: true })
    .setTimestamp();

  if (amountField) {
    vouchEmbed.addFields({
      name: 'Robux Amount',
      value: amountField.value,
      inline: true,
    });
  }
  if (gameField && packageField) {
    vouchEmbed.addFields(
      { name: 'Game', value: gameField.value, inline: true },
      { name: 'Package', value: packageField.value, inline: true }
    );
  }
  vouchEmbed.addFields({
    name: 'Rating',
    value: '⭐'.repeat(finalRating),
    inline: true,
  });

  // Show the customer's picture inside the vouch
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

  // Mark as vouched, and auto-complete the order if staff did not complete it yet
  const wasCompleted = stageFromEmbed(ticketEmbed) === 'completed';
  ticketEmbed.addFields({ name: 'Vouch', value: 'Posted ✅' });

  // Update shop record stats
  data.totalVouches = (data.totalVouches || 0) + 1;
  if (!wasCompleted) {
    data.totalOrders = (data.totalOrders || 0) + 1;
    if (isRobuxOrder(ticketEmbed)) {
      data.totalRobuxDelivered = (data.totalRobuxDelivered || 0) + getAmount(ticketEmbed);
    }
    // If not already marked as sent (which already credited completed), credit staff for completing this order
    const wasSent = stageFromEmbed(ticketEmbed) === 'sent';
    if (!wasSent) {
      const staff = findStaffFromEmbed(ticketEmbed, interaction.channel.id);
      if (staff && staff.userId) {
        recordStaffAction(staff.userId, staff.username, 'completed');
      }
    }
  }

  // Record star rating and update orders log
  const orderIdField = (ticketEmbed.data.fields || []).find((f) => f.name === 'Order ID');
  const orderId = orderIdField ? orderIdField.value.replace(/[`#]/g, '').trim() : 'REV-XXXX';
  recordRating(finalRating, orderId, interaction.user.id, vouchText);
  if (Array.isArray(data.ordersLog)) {
    for (const ord of data.ordersLog) {
      if (ord.orderId === orderId || ord.channelId === interaction.channel.id) {
        ord.rating = finalRating;
        ord.vouchText = vouchText;
      }
    }
  }

  saveData();

  if (!wasCompleted) {
    setPositionField(ticketEmbed, 'Done');
    setStatusField(ticketEmbed, `Completed (vouched by ${interaction.user})`);
  }

  await mainMessage.edit({
    embeds: [ticketEmbed],
    components: ticketRows('completed'),
  });

  if (!wasCompleted) {
    await postReceipt(ticketEmbed, interaction.channel);
    safeRenameChannel(interaction.channel, `done-${baseName(interaction.channel.name)}`);
    await interaction.channel.send(
      ticketMessage('thanks', {
        userId: interaction.user.id,
        ...fromTemplate(M.vouched),
      })
    );
  }

  // Clear unvouched penalty immediately if they were tracked as unvouched
  await clearUnvouchedBuyer(interaction.guild, interaction.user.id).catch(console.error);

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

// Unlock button handler: shown when an unvouched customer is blocked or pinged in 24h
async function vouchUnlockButton(interaction) {
  const parts = interaction.customId.split(':');
  const targetUserId = parts[1];
  const orderId = parts[2] || 'REV-XXXX';

  if (targetUserId && interaction.user.id !== targetUserId) {
    return interaction.reply({
      content: `This vouch unlock button is only for <@${targetUserId}>.`,
      flags: EPHEMERAL,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`vouch_unlock_form:${orderId}`)
    .setTitle(`Vouch for Order #${orderId}`.slice(0, 45));

  // Older discord.js: no picture upload, classic layout
  if (!FileUploadBuilder || !LabelBuilder) {
    const messageInput = new TextInputBuilder()
      .setCustomId('vouch_message')
      .setLabel('Your vouch / feedback')
      .setPlaceholder('e.g. Fast, smooth transaction and trusted! Thank you!')
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

    modal.addComponents(
      new ActionRowBuilder().addComponents(messageInput),
      new ActionRowBuilder().addComponents(ratingInput)
    );
    return interaction.showModal(modal);
  }

  const messageInput = new TextInputBuilder()
    .setCustomId('vouch_message')
    .setPlaceholder('e.g. Fast, smooth transaction and trusted! Thank you!')
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

  modal.addLabelComponents(
    new LabelBuilder().setLabel('Your vouch / feedback').setTextInputComponent(messageInput),
    new LabelBuilder()
      .setLabel('Rating from 1 to 5 (optional)')
      .setTextInputComponent(ratingInput),
    new LabelBuilder()
      .setLabel('Picture (optional)')
      .setDescription('Attach a screenshot as evidence')
      .setFileUploadComponent(pictureUpload)
  );

  return interaction.showModal(modal);
}

// Unlock modal submitted -> post vouch (with optional picture), record rating, clear @Unvouched Buyer role
async function vouchUnlockForm(interaction) {
  const orderId = interaction.customId.split(':')[1] || 'REV-XXXX';
  const vouchText = interaction.fields.getTextInputValue('vouch_message').trim();
  const ratingText = interaction.fields.getTextInputValue('vouch_rating').trim();

  if (ratingText && !/^[1-5]$/.test(ratingText)) {
    return interaction.reply({
      content: 'Rating must be a number from 1 to 5. Please try again.',
      flags: EPHEMERAL,
    });
  }

  // Optional picture upload
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

  await interaction.deferReply({ flags: EPHEMERAL });

  const finalRating = ratingText ? Number(ratingText) : 5;
  const vouchEmbed = new EmbedBuilder()
    .setTitle('New Vouch')
    .setColor(COLOR)
    .setDescription(vouchText)
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      { name: 'Customer', value: `${interaction.user}`, inline: true },
      { name: 'Order ID', value: `#${orderId}`, inline: true },
      { name: 'Rating', value: '⭐'.repeat(finalRating), inline: true }
    )
    .setTimestamp();

  let proofFile = null;
  if (attachment) {
    const ext = (path.extname(attachment.name || '') || '.png').toLowerCase();
    const proofName = `vouch-proof${ext}`;
    vouchEmbed.setImage(`attachment://${proofName}`);
    proofFile = new AttachmentBuilder(attachment.url, { name: proofName });
  }

  if (VOUCH_CHANNEL_ID) {
    try {
      const vouchChannel = await client.channels.fetch(VOUCH_CHANNEL_ID).catch(() => null);
      if (vouchChannel) {
        try {
          await vouchChannel.send({ embeds: [vouchEmbed], files: proofFile ? [proofFile] : [] });
        } catch (uploadErr) {
          if (!attachment) throw uploadErr;
          vouchEmbed.setImage(attachment.url);
          await vouchChannel.send({ embeds: [vouchEmbed] });
        }
      }
    } catch (err) {
      console.error('Could not post vouch from unlock modal:', err);
    }
  }

  data.totalVouches = (data.totalVouches || 0) + 1;
  recordRating(finalRating, orderId, interaction.user.id, vouchText);
  if (Array.isArray(data.ordersLog)) {
    for (const ord of data.ordersLog) {
      if (ord.orderId === orderId) {
        ord.rating = finalRating;
        ord.vouchText = vouchText;
      }
    }
  }
  saveData();

  await clearUnvouchedBuyer(interaction.guild, interaction.user.id);

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00ff88)
        .setTitle('✅  Penalty Removed & Ordering Unlocked!')
        .setDescription(
          `Thank you for your review, <@${interaction.user.id}>!\n\n` +
          `• Your vouch for order **#${orderId}** was posted in <#${VOUCH_CHANNEL_ID}>.\n` +
          `• The **@Unvouched Buyer** role has been removed from your profile.\n` +
          `• Your account is now fully unlocked and you may place new orders anytime!`
        )
        .setTimestamp(),
    ],
  });
}

async function handle(interaction) {
  if (interaction.isButton() && interaction.customId.startsWith('vouch_star:')) {
    await starVouchButton(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith('vouch:')) {
    await vouchButton(interaction);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('vouch_form:')) {
    await vouchForm(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith('vouch_unlock:')) {
    await vouchUnlockButton(interaction);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('vouch_unlock_form:')) {
    await vouchUnlockForm(interaction);
    return true;
  }

  return false;
}

module.exports = { commands, handle };