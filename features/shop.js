// /shop  -> staff opens or closes the shop and posts the open/closed picture
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const {
  ROOT,
  COLOR,
  SHOP_IMAGES,
  BUY_CHANNEL_ID,
  SHOP_STATUS_CHANNEL_ID,
  SHOP_PING_ROLE_ID,
} = require('../config');
const client = require('../core/client');
const { data, saveData } = require('../core/data');
const M = require('../messages');
const { EPHEMERAL, isStaff, fill } = require('../core/helpers');

const commands = [
  new SlashCommandBuilder()
    .setName(M.commandNames.shop)
    .setDescription('Staff only: open or close the shop')
    .addStringOption((o) =>
      o
        .setName('status')
        .setDescription('Open or close the shop')
        .setRequired(true)
        .addChoices({ name: 'Open', value: 'open' }, { name: 'Closed', value: 'closed' })
    ),
];

// Posts the open or closed picture in the status channel and removes the previous one.
// Returns { warning } if something could not be done.
async function postShopStatus(isOpen) {
  if (!SHOP_STATUS_CHANNEL_ID) {
    return { warning: 'SHOP_STATUS_CHANNEL_ID is not set in your .env, so no picture was posted.' };
  }

  const channel = await client.channels.fetch(SHOP_STATUS_CHANNEL_ID);

  // Delete the previous status picture so only the latest one stays
  if (data.statusMessageId) {
    try {
      const old = await channel.messages.fetch(data.statusMessageId);
      await old.delete();
    } catch {
      // already deleted, ignore
    }
  }

  const key = isOpen ? 'open' : 'closed';
  const fileName = SHOP_IMAGES[key];
  const file = path.join(ROOT, fileName);

  const description = isOpen
    ? fill(M.shopOpen.text, {
        buyChannel: BUY_CHANNEL_ID ? `<#${BUY_CHANNEL_ID}>` : 'the buy channel',
      })
    : fill(M.shopClosed.text);

  const embed = new EmbedBuilder().setColor(COLOR).setDescription(description).setTimestamp();
  const options = { embeds: [embed] };
  if (SHOP_PING_ROLE_ID) {
    options.content = `<@&${SHOP_PING_ROLE_ID}>`;
    options.allowedMentions = { roles: [SHOP_PING_ROLE_ID] };
  }
  let warning;

  if (fs.existsSync(file)) {
    embed.setImage(`attachment://${fileName}`);
    options.files = [new AttachmentBuilder(file, { name: fileName })];
  } else {
    console.warn(`${fileName} not found, posting the status without the picture.`);
    warning = `${fileName} was not found next to index.js, so the status was posted without the picture.`;
  }

  const sent = await channel.send(options);
  data.statusMessageId = sent.id;
  saveData();
  return { warning };
}

async function runShop(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can use this command.',
      flags: EPHEMERAL,
    });
  }

  const wantOpen = interaction.options.getString('status') === 'open';

  if (data.shopOpen === wantOpen) {
    return interaction.reply({
      content: `The shop is already **${wantOpen ? 'open' : 'closed'}**.`,
      flags: EPHEMERAL,
    });
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  data.shopOpen = wantOpen;
  saveData();

  let note = '';
  try {
    const result = await postShopStatus(wantOpen);
    if (result.warning) note = `\n⚠️ ${result.warning}`;
  } catch (err) {
    console.error('Could not post shop status:', err);
    note = '\n⚠️ Could not post the picture in the status channel. Check SHOP_STATUS_CHANNEL_ID and the bot\'s permissions there.';
  }

  return interaction.editReply(
    `The shop is now **${wantOpen ? 'open' : 'closed'}**.${note}`
  );
}

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === M.commandNames.shop) {
    await runShop(interaction);
    return true;
  }
  return false;
}

module.exports = { commands, handle };
