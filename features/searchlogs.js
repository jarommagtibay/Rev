// /searchlogs -> Staff only: semantic natural-language search over closed ticket transcripts
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLOR } = require('../config');
const { data, formatPeso } = require('../core/data');
const { EPHEMERAL, isStaff } = require('../core/helpers');
const { getTextEmbedding, cosineSimilarity, localSemanticScore } = require('../core/ai');

const commands = [
  new SlashCommandBuilder()
    .setName('searchlogs')
    .setDescription('Staff only: search closed ticket transcripts using natural language')
    .addStringOption((o) =>
      o
        .setName('query')
        .setDescription('Describe what you remember (e.g. "overpaid via SeaBank last week")')
        .setRequired(true)
        .setMaxLength(200)
    ),
];

async function runSearchLogs(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: 'Only staff can use this command.',
      flags: EPHEMERAL,
    });
  }

  const query = interaction.options.getString('query').trim();
  await interaction.deferReply({ flags: EPHEMERAL });

  const indexed = Array.isArray(data.transcriptIndex) ? data.transcriptIndex : [];

  // Also include completed ordersLog entries not yet in transcriptIndex so older history is searchable too
  const indexedIds = new Set(indexed.map((t) => t.orderId).filter(Boolean));
  const legacyEntries = (data.ordersLog || [])
    .filter((o) => o.orderId && !indexedIds.has(o.orderId))
    .map((o) => ({
      channelId: o.channelId,
      channelName: o.username || o.orderId,
      orderId: o.orderId,
      customerId: o.userId,
      orderInfo: `${o.label || `${o.amount || 0} Robux`} • ${formatPeso(o.price || 0)}`,
      summaryText: `Order #${o.orderId} • ${o.label || `${o.amount || 0} Robux`} • ${formatPeso(o.price || 0)} • Account: ${
        o.username || '-'
      } • Staff: @${o.staff || 'Staff'}${o.vouchText ? ` • Review: ${o.vouchText}` : ''}`,
      transcriptUrl: null,
      embedding: null,
      embeddingModel: null,
      closedAt: o.timestamp || Date.now(),
    }));

  const corpus = [...indexed, ...legacyEntries];
  if (corpus.length === 0) {
    return interaction.editReply({
      content: 'ℹ️ No closed ticket transcripts have been indexed yet.',
    });
  }

  const queryEmb = await getTextEmbedding(query);
  let usedVectorSearch = false;

  const scored = corpus.map((item) => {
    let score = 0;
    if (queryEmb && item.embedding && item.embeddingModel === queryEmb.model) {
      score = cosineSimilarity(queryEmb.vector, item.embedding);
      usedVectorSearch = true;
    } else {
      score = localSemanticScore(query, item.summaryText);
    }
    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const minThreshold = usedVectorSearch ? 0.30 : 0.12;
  const top = scored.filter((s) => s.score >= minThreshold).slice(0, 5);

  if (top.length === 0) {
    return interaction.editReply({
      content: `❌ No matching transcripts found for **"${query}"**.`,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`🔎  Semantic Transcript Search`)
    .setDescription(
      `Query: **"${query}"**\n` +
        `Mode: *${usedVectorSearch ? 'AI Vector Embeddings + Local Fallback' : 'Local Semantic Similarity'}*`
    )
    .setFooter({ text: `Searched ${corpus.length} archived ticket(s)` })
    .setTimestamp();

  for (const { item, score } of top) {
    const pct = Math.min(99, Math.max(1, Math.round(score * 100)));
    const linkLine = item.transcriptUrl ? `\n• **Transcript:** [Jump to Archived HTML](${item.transcriptUrl})` : '';
    const snippet =
      item.summaryText.length > 180 ? item.summaryText.slice(0, 177) + '…' : item.summaryText;

    embed.addFields({
      name: `#${item.orderId} • ${pct}% match`,
      value:
        `• **Customer:** ${item.customerId ? `<@${item.customerId}>` : 'Unknown'} • **Order:** ${item.orderInfo}\n` +
        `• **Closed:** <t:${Math.floor((item.closedAt || Date.now()) / 1000)}:R>\n` +
        `• **Summary:** ${snippet}` +
        linkLine,
      inline: false,
    });
  }

  return interaction.editReply({ embeds: [embed] });
}

async function handle(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'searchlogs') {
    await runSearchLogs(interaction);
    return true;
  }
  return false;
}

module.exports = { commands, handle };
