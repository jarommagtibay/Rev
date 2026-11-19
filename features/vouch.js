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
const { data, saveData } = require('../core/data');
const {
  EPHEMERAL,
  ticketMessage,
  fromTemplate,
  baseName,
  getCustomerId,
  parseOrderAmount,
} = require('../core/helpers');
const {
  setPositionField,
  setStatusField,
  stageFromEmbed,
  isVouched,
  ticketRows,
  postReceipt,
} = require('../core/ticket');

const commands = [];

// Vouch popup: message, optional rating and an optional picture as evidence
function buildVouchModal(mainMessageId) {
  const modal = new ModalBuilder()
    .setCustomId(`vouch_form:${mainMessageId}`)
    .setTitle('Leave a Vouch');

  // Older discord.js: no picture upload, classic layout
  if (!FileUploadBuilder || !LabelBuilder) {
    const messageInput = new TextInputBuilder()
      .setCustomId('vouch_message')
      .setLabel('Your vouch')
      .setPlaceholder('e.g. Fast and legit, thank you!')
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
    .setPlaceholder('e.g. Fast and legit, thank you!')
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
    new LabelBuilder()
      .setLabel('Rating from 1 to 5 (optional)')
      .setTextInputComponent(ratingInput),
    new LabelBuilder()
      .setLabel('Picture (optional)')
      .setDescription('Attach a screenshot as evidence')
      .setFileUploadComponent(pictureUpload)
  );
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

// Vouch form submitted -> post the vouch (with the optional picture) and auto-complete the order
async function vouchForm(interaction) {
  if (interaction.user.id !== getCustomerId(interaction.channel)) {
    return interaction.reply({
      content: 'Only the customer of this ticket can leave a vouch.',
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
  if (ratingText) {
    vouchEmbed.addFields({
      name: 'Rating',
      value: '⭐'.repeat(Number(ratingText)),
      inline: true,
    });
  }

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
    if (amountField) {
      data.totalRobuxDelivered = (data.totalRobuxDelivered || 0) + parseOrderAmount(amountField.value);
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
    interaction.channel
      .setName(`done-${baseName(interaction.channel.name)}`)
      .catch(() => { });
    await interaction.channel.send(
      ticketMessage('thanks', {
        userId: interaction.user.id,
        ...fromTemplate(M.vouched),
      })
    );
  }

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

async function handle(interaction) {
  if (interaction.isButton() && interaction.customId.startsWith('vouch:')) {
    await vouchButton(interaction);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('vouch_form:')) {
    await vouchForm(interaction);
    return true;
  }

  return false;
}

module.exports = { commands, handle };