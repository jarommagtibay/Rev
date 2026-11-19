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

  // Periodic ticket inactivity check (runs every 30 minutes)
  // Sends a gentle reminder after 12h of inactivity; auto-holds if unpaid after 24h
  setInterval(async () => {
    try {
      const now = Date.now();
      const guild = await client.guilds.fetch(GUILD_ID);

      for (const entry of [...data.queue]) {
        if (!entry.channelId) continue;
        const channel = guild.channels.cache.get(entry.channelId) || (await guild.channels.fetch(entry.channelId).catch(() => null));
        if (!channel) continue;

        const ageMs = now - (entry.joinedAt || now);
        const hours = ageMs / (1000 * 60 * 60);

        // Fetch last message to see when the channel was active
        const messages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
        const lastMsg = messages ? messages.first() : null;
        const lastActivity = lastMsg ? lastMsg.createdTimestamp : entry.joinedAt || now;
        const silenceHours = (now - lastActivity) / (1000 * 60 * 60);

        // 12 hours silence reminder
        if (silenceHours >= 12 && !entry._inactivityReminded) {
          entry._inactivityReminded = true;
          saveData();
          await channel.send({
            content: `<@${entry.userId}>`,
            embeds: [
              {
                color: 0x94030f,
                title: '⏰ Ticket Inactivity Notice',
                description:
                  'Hello! This ticket has been idle for over 12 hours.\n' +
                  'Please send your payment receipt or message our staff if you still wish to proceed, otherwise this ticket may be placed on hold.',
              },
            ],
          }).catch(() => {});
        }

        // 24 hours silence: put on hold if not already on hold
        if (silenceHours >= 24 && !entry.onHold) {
          entry.onHold = true;
          entry.holdReason = 'Auto-hold: 24+ hours of inactivity';
          saveData();
          await channel.send({
            content: `<@${entry.userId}>`,
            embeds: [
              {
                color: 0x94030f,
                title: '⏸️ Order Automatically Placed on Hold',
                description:
                  'This ticket was placed on hold due to inactivity (24+ hours). Reserved stock has been released.\n' +
                  'When you are ready, tag staff in this ticket to resume your position!',
              },
            ],
          }).catch(() => {});
          await refreshQueue(guild);
        }
      }

      // Check for unvouched orders older than 24h to auto-send DM reminder
      for (const ord of (data.ordersLog || []).slice(-100)) {
        if (!ord.vouched && !ord._vouchReminded && ord.sentAt) {
          const hoursSinceSent = (now - ord.sentAt) / (1000 * 60 * 60);
          if (hoursSinceSent >= 24) {
            ord._vouchReminded = true;
            saveData();
            const customer = await client.users.fetch(ord.userId).catch(() => null);
            if (customer) {
              await customer.send({
                embeds: [
                  {
                    color: 0x94030f,
                    title: '⭐ Vouch Reminder — Revéux Shop',
                    description:
                      `Hello ${customer}! Your order for **${ord.label || `${ord.amount} Robux`}** was delivered yesterday.\n\n` +
                      `If you are satisfied with our service, we would truly appreciate it if you could leave a vouch in the server!\n` +
                      `Thank you for trusting Revéux!`,
                  },
                ],
              }).catch(() => {});
            }
          }
        }
      }
    } catch (err) {
      console.error('Error during ticket inactivity check:', err);
    }
  }, 30 * 60 * 1000);
});

// If a ticket channel is deleted (closed or manually), remove it from the queue
client.on(Events.ChannelDelete, async (channel) => {
  if (removeFromQueue(channel.id)) {
    await refreshQueue(channel.guild);
  }
});

// ---------- Receipt Auto-Detection ----------
// When a customer uploads an image/receipt into their ticket channel before payment is marked received
client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;
  const topic = message.channel.topic || '';
  if (!topic.startsWith('ticket:')) return;

  // Only trigger if an image or receipt attachment was sent
  const hasImage =
    message.attachments.some(
      (a) =>
        (a.contentType && a.contentType.startsWith('image/')) ||
        /\.(png|jpe?g|webp)$/i.test(a.name || '')
    ) || /https?:\/\/.*\.(png|jpe?g|webp)/i.test(message.content);

  if (!hasImage) return;

  const entry = data.queue.find((e) => e.channelId === message.channel.id);
  if (!entry) return;

  // Check if payment was already marked received
  try {
    const mainMsg = await message.channel.messages.fetch({ message: entry.messageId, force: true });
    const embed = mainMsg.embeds[0];
    const isPaid = (embed && embed.fields ? embed.fields : []).some((f) => f.name === 'Payment');
    if (isPaid) return; // already marked as received

    // Prevent duplicate alerts in a short burst
    if (entry._lastReceiptAlert && Date.now() - entry._lastReceiptAlert < 60000) return;
    entry._lastReceiptAlert = Date.now();

    await message.channel.send({
      content:
        `🧾 **Receipt screenshot detected!**\n` +
        `> Staff has been notified to verify your payment. Please wait a moment while we process your order!`,
    });
  } catch (err) {
    // ignore fetch errors
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