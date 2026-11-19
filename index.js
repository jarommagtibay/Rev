// Reveux main file. It only starts the bot and loads every file inside /features.
// To add a new feature: create a new file in /features that exports { commands, handle }.
const fs = require('fs');
const path = require('path');
const { Events, REST, Routes } = require('discord.js');

const { TOKEN, CLIENT_ID, GUILD_ID, STAFF_ROLE_ID } = require('./config');
const client = require('./core/client');
const { data, saveData } = require('./core/data');
const { refreshQueue, removeFromQueue } = require('./core/queue');
const { EPHEMERAL } = require('./core/helpers');

// Fail fast if critical config is missing
const required = { TOKEN, CLIENT_ID, GUILD_ID, STAFF_ROLE_ID };
const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
if (missing.length > 0) {
  throw new Error(
    `Missing required .env variables: ${missing.join(', ')}. ` +
    'Make sure your .env is loaded (e.g. node --env-file=.env index.js).'
  );
}

// Keep the bot alive if something unexpected fails: log it instead of crashing
process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
client.on(Events.Error, (err) => {
  console.error('Discord client error:', err);
});

// Load every feature file
const features = fs
  .readdirSync(path.join(__dirname, 'features'))
  .filter((file) => file.endsWith('.js'))
  .map((file) => require(`./features/${file}`));

const commands = features.flatMap((f) => (f.commands || []).map((c) => c.toJSON()));

// Stop with a clear message if two commands share the same name (see commandNames in messages.js)
const names = commands.map((c) => c.name);
const duplicates = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
if (duplicates.length > 0) {
  throw new Error(
    `Two commands have the same name: ${duplicates.join(', ')}. Fix commandNames in messages.js.`
  );
}

// ---------- Ready ----------
client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });
    console.log('Slash commands registered.');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }

  // Clean out queue entries whose ticket channel no longer exists
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channels = await guild.channels.fetch();
    data.queue = data.queue.filter((e) => channels.has(e.channelId));
    saveData();
    await refreshQueue(guild);
  } catch (err) {
    console.error('Could not sync queue:', err);
  }
});

// If a ticket channel is deleted (closed or manually), remove it from the queue
client.on(Events.ChannelDelete, async (channel) => {
  if (removeFromQueue(channel.id)) {
    await refreshQueue(channel.guild);
  }
});

// ---------- Interactions ----------
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    for (const feature of features) {
      if (await feature.handle(interaction)) return; // first feature that claims it wins
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      const msg = { content: 'Something went wrong.', flags: EPHEMERAL };
      const p = interaction.deferred || interaction.replied
        ? interaction.followUp(msg)
        : interaction.reply(msg);
      p.catch(() => { });
    }
  }
});

client.login(TOKEN);