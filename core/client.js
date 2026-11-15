// One shared bot client, so every file uses the same one.
const { Client, GatewayIntentBits } = require('discord.js');

module.exports = new Client({ intents: [GatewayIntentBits.Guilds] });
