// Reveux main file. It only starts the bot and loads every file inside /features.
// To add a new feature: create a new file in /features that exports { commands, handle }.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Events, REST, Routes, EmbedBuilder } = require('discord.js');

const { TOKEN, CLIENT_ID, GUILD_ID, STAFF_ROLE_ID, AUDIT_CHANNEL_ID } = require('./config');
const client = require('./core/client');
const { data, saveData } = require('./core/data');
const { refreshQueue, removeFromQueue } = require('./core/queue');
const { EPHEMERAL, isStaff } = require('./core/helpers');
const { extractReceiptDetails, comparePaymentPrice } = require('./core/receiptScanner');
const { checkUnvouchedInterval } = require('./core/unvouched');
const { repositionSticky, clearSticky } = require('./core/sticky');
const { setPaymentProgressField } = require('./core/ticket');

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

  // Unvouched buyer 24-hour penalty interval check (runs immediately & every 15 minutes)
  checkUnvouchedInterval(client).catch((err) => console.error('Initial unvouched check failed:', err));
  setInterval(() => {
    checkUnvouchedInterval(client).catch((err) => console.error('Periodic unvouched check failed:', err));
  }, 15 * 60 * 1000);
});

// If a ticket channel is deleted (closed or manually), remove it from the queue
client.on(Events.ChannelDelete, async (channel) => {
  clearSticky(channel.id);
  if (removeFromQueue(channel.id)) {
    await refreshQueue(channel.guild);
  }
});

// ---------- Receipt Auto-Detection ----------
// When a customer uploads an image/receipt into their ticket channel before payment is marked received
client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;

  // 1. Auto-clear staff AFK status as soon as staff speaks in the server
  if (data.staffAfk && data.staffAfk[message.author.id]) {
    delete data.staffAfk[message.author.id];
    saveData();
    message.channel
      .send(`👋 Welcome back <@${message.author.id}>! Your AFK status has been removed.`)
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 4000))
      .catch(() => {});
  }

  const topic = message.channel.topic || '';
  if (!topic.startsWith('ticket:')) return;

  // Reposition any pinned sticky notes or customer reminders to the bottom
  repositionSticky(message).catch((err) =>
    console.error('[sticky] Error repositioning sticky messages:', err)
  );

  // 2. Staff AFK Auto-Responder to customer messages in tickets
  if (!isStaff(message.member)) {
    const afkList = Object.values(data.staffAfk || {});
    if (afkList.length > 0) {
      const entry = data.queue.find((e) => e.channelId === message.channel.id);
      const now = Date.now();
      // Cooldown: reply at most once every 10 minutes per ticket
      if (!entry || !entry._lastAfkReply || now - entry._lastAfkReply > 10 * 60 * 1000) {
        if (entry) entry._lastAfkReply = now;
        const reasons = afkList.map((a) => `• <@${a.userId}>: *"${a.reason}"*`).join('\n');
        await message.channel
          .send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x2b2d31)
                .setTitle('⏸️  Staff Is Temporarily Away')
                .setDescription(
                  `Our staff is temporarily stepped away:\n\n${reasons}\n\n` +
                  `They will attend to your ticket as soon as they return! Thank you for your patience.`
                )
                .setTimestamp(),
            ],
          })
          .catch(() => {});
      }
    }
  }

  // 3. Receipt Auto-Detection
  // Only trigger if an image or receipt attachment was sent
  const hasImage =
    message.attachments.some(
      (a) =>
        (a.contentType && a.contentType.startsWith('image/')) ||
        /\.(png|jpe?g|webp)$/i.test(a.name || '')
    ) || /https?:\/\/.*\.(png|jpe?g|webp)/i.test(message.content);

  if (!hasImage) return;

  const entry = data.queue.find((e) => e.channelId === message.channel.id);

  // Check if payment was already marked received
  try {
    let mainMsg = null;
    let embed = null;
    if (entry && entry.messageId) {
      mainMsg = await message.channel.messages.fetch({ message: entry.messageId, force: true }).catch(() => null);
      if (mainMsg && mainMsg.embeds.length > 0) embed = mainMsg.embeds[0];
    }
    if (!embed) {
      // Fallback: search recent messages for ticket embed
      const msgs = await message.channel.messages.fetch({ limit: 10 }).catch(() => null);
      if (msgs) {
        const found = msgs.find(
          (m) =>
            m.embeds &&
            m.embeds.length > 0 &&
            (m.embeds[0].data?.fields || m.embeds[0].fields || []).some(
              (f) => f.name === 'Queue Position' || f.name === 'Status'
            )
        );
        if (found) {
          mainMsg = found;
          embed = found.embeds[0];
        }
      }
    }

    const fields = embed ? (embed.data?.fields || embed.fields || []) : [];
    const isPaid = fields.some((f) => f.name === 'Payment');
    if (isPaid) return; // already marked as received

    // Duplicate Receipt Fraud Detection
    const imgAttachment = message.attachments.find(
      (a) =>
        (a.contentType && a.contentType.startsWith('image/')) ||
        /\.(png|jpe?g|webp)$/i.test(a.name || '')
    );

    let isDuplicate = false;
    let scanResult = { refNo: null, amount: null, ocrAvailable: false };

    if (imgAttachment && imgAttachment.url) {
      try {
        const imgRes = await fetch(imgAttachment.url).catch(() => null);
        if (imgRes && imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const imgHash = crypto.createHash('sha256').update(buf).digest('hex');

          // Auto-scan GCash / Maya Reference Number & Amount
          try {
            scanResult = await extractReceiptDetails(buf, message.content, imgAttachment.name);
          } catch (scanErr) {
            console.warn('Receipt text extraction warning:', scanErr);
          }

          // If the image is not a payment receipt (e.g. customer avatar, profile screenshot, meme), ignore it!
          if (!scanResult.isReceipt) return;

          // Check if the screenshot is a FAILED / UNPROCESSED transaction (e.g. "Unable to Send Money")
          if (scanResult.isFailed) {
            if (AUDIT_CHANNEL_ID) {
              const auditChan = await client.channels.fetch(AUDIT_CHANNEL_ID).catch(() => null);
              if (auditChan) {
                await auditChan.send({
                  content: `<@&${STAFF_ROLE_ID}> ⚠️ **FAILED / REJECTED PAYMENT SCREENSHOT!**`,
                  embeds: [
                    new EmbedBuilder()
                      .setColor(0xff3333)
                      .setTitle('⚠️ WARNING: Failed / Unprocessed Transaction Detected!')
                      .setDescription(
                        `A screenshot showing an **unsuccessful / failed transfer** was posted in **#${message.channel.name}** (<#${message.channel.id}>)!\n\n` +
                        `• **Status:** ❌ **"Unable to Send Money" / Transaction Incomplete**\n` +
                        `• **Bank / App:** ${scanResult.provider}\n` +
                        `• **Ref No:** ${scanResult.refNo ? `\`${scanResult.refNo}\` *(tap to copy)*` : '*Not detected*'}\n` +
                        `• **Amount:** ${scanResult.amount ? `\`${scanResult.amount}\`` : '*Not detected*'}\n` +
                        `• **Customer:** <@${message.author.id}> (@${message.author.username})\n\n` +
                        `🛑 **DO NOT DELIVER:** The money was NOT sent to your account!`
                      )
                      .setThumbnail(imgAttachment.url)
                      .setTimestamp(),
                  ],
                });
              }
            }

            await message.channel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0xff9900)
                  .setTitle('⚠️  Transaction Notice: Incomplete Transfer')
                  .setDescription(
                    `The screenshot you uploaded indicates a **failed or incomplete transfer** (*"Unable to Send Money"*).\n\n` +
                    `Please check your banking app and send a **successful** transaction receipt once your payment goes through!`
                  )
                  .setTimestamp(),
              ],
            });
            return;
          }

          if (!Array.isArray(data.receiptHashes)) data.receiptHashes = [];
          const previous = data.receiptHashes.find(
            (r) => r.hash === imgHash && r.channelId !== message.channel.id
          );

          if (previous) {
            isDuplicate = true;
            // 1. Post urgent fraud alert in staff audit channel
            if (AUDIT_CHANNEL_ID) {
              const auditChan = await client.channels.fetch(AUDIT_CHANNEL_ID).catch(() => null);
              if (auditChan) {
                await auditChan.send({
                  content: `<@&${STAFF_ROLE_ID}> 🚨 **DUPLICATE RECEIPT FRAUD ALERT!**`,
                  embeds: [
                    new EmbedBuilder()
                      .setColor(0xff0000)
                      .setTitle('🚨 FRAUD WARNING: Reused Payment Receipt!')
                      .setDescription(
                        `A receipt screenshot that was **previously uploaded in another ticket** was just posted!\n\n` +
                        `• **Current Ticket:** #${message.channel.name} (<#${message.channel.id}>)\n` +
                        `• **Current User:** <@${message.author.id}> (@${message.author.username})\n` +
                        `• **Previously Used In:** #${previous.channelName || previous.channelId}\n` +
                        `• **Previously Uploaded By:** <@${previous.userId}> (@${previous.username})\n` +
                        `• **Original Upload Date:** <t:${Math.floor(previous.timestamp / 1000)}:R>\n` +
                        `• **Ref No:** ${scanResult.refNo ? `\`${scanResult.refNo}\`` : '*Not detected*'}\n` +
                        `• **Amount:** ${scanResult.amount ? `\`${scanResult.amount}\`` : '*Not detected*'}\n\n` +
                        `⚠️ **Action Required:** Do NOT process this order until staff manually verifies genuine transaction history in GCash.`
                      )
                      .setThumbnail(imgAttachment.url)
                      .setTimestamp(),
                  ],
                });
              }
            }

            // 2. Post alert inside the ticket channel
            await message.channel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0xff0000)
                  .setTitle('⚠️  Security Warning: Duplicate Receipt Detected')
                  .setDescription(
                    'This receipt screenshot matches an image that was **previously uploaded in another ticket**.\n' +
                    'Staff has been notified and will perform a manual payment verification before proceeding.'
                  )
                  .setTimestamp(),
              ],
            });
          } else {
            // Save hash
            data.receiptHashes.push({
              hash: imgHash,
              channelId: message.channel.id,
              channelName: message.channel.name,
              userId: message.author.id,
              username: message.author.username,
              refNo: scanResult.refNo,
              amount: scanResult.amount,
              timestamp: Date.now(),
            });
            if (data.receiptHashes.length > 5000) {
              data.receiptHashes = data.receiptHashes.slice(-5000);
            }
            saveData();

            // Resolve order expected price from entry or embed
            let expectedPrice = entry?.price ?? null;
            if (expectedPrice == null && fields.length > 0) {
              const priceField = fields.find((f) => f.name === 'Price' || f.name === 'Flash Price');
              if (priceField && priceField.value) {
                const cleanPrice = priceField.value.split('\n')[0].replace(/,/g, '');
                const matchPrice = cleanPrice.match(/([0-9]+(?:\.[0-9]+)?)/);
                if (matchPrice) expectedPrice = parseFloat(matchPrice[1]);
              }
            }

            // Track partial / split payments on this ticket
            let newPaymentRecorded = false;
            if (entry && scanResult.amountValue > 0) {
              if (!Array.isArray(entry.payments)) entry.payments = [];
              const alreadyCounted = entry.payments.some(
                (p) =>
                  (p.hash && p.hash === imgHash) ||
                  (scanResult.refNo && p.refNo && p.refNo === scanResult.refNo)
              );
              if (!alreadyCounted) {
                entry.payments.push({
                  amount: scanResult.amountValue,
                  refNo: scanResult.refNo || null,
                  provider: scanResult.provider || 'E-Wallet / Bank',
                  hash: imgHash,
                  source: 'ocr',
                  timestamp: Date.now(),
                });
                entry.amountPaid = entry.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
                newPaymentRecorded = true;
                saveData();

                // Update Payment Progress field directly on the main ticket embed
                if (mainMsg && embed && expectedPrice != null) {
                  try {
                    const updatedEmbed = EmbedBuilder.from(embed);
                    setPaymentProgressField(
                      updatedEmbed,
                      entry.amountPaid,
                      expectedPrice,
                      entry.payments.length
                    );
                    await mainMsg.edit({ embeds: [updatedEmbed] });
                    embed = updatedEmbed;
                  } catch (editErr) {
                    console.warn('Could not update Payment Progress on ticket embed:', editErr.message);
                  }
                }
              }
            }

            const effectivePaid =
              entry && typeof entry.amountPaid === 'number' && entry.amountPaid > 0
                ? entry.amountPaid
                : scanResult.amountValue;
            const comparison = comparePaymentPrice(effectivePaid, expectedPrice);
            const paymentCount = entry && Array.isArray(entry.payments) ? entry.payments.length : 1;

            // Post Staff-Only Scanned Receipt Log in Staff Audit Channel
            if (AUDIT_CHANNEL_ID) {
              const auditChan = await client.channels.fetch(AUDIT_CHANNEL_ID).catch(() => null);
              if (auditChan) {
                const refDisplay = scanResult.refNo
                  ? `\`${scanResult.refNo}\` *(tap to copy on mobile)*`
                  : '*Not detected (please verify manually)*';
                const amountDisplay = scanResult.amount ? `**${scanResult.amount}**` : '*Not detected*';
                const expectedDisplay = expectedPrice != null ? `**₱${Number(expectedPrice).toFixed(2)}**` : '*Unknown*';

                let comparisonLine = `• **Price Comparison:** ${comparison.badge}`;
                let auditContent = null;
                let embedColor = 0x00b0f4;

                if (comparison.status === 'underpaid') {
                  embedColor = 0xff3333;
                  auditContent = `<@&${STAFF_ROLE_ID}> ⚠️ **PAYMENT UNDERPAYMENT DETECTED in #${message.channel.name}!**`;
                  comparisonLine = `• **Price Comparison:** ⚠️ **UNDERPAID (Short by ₱${comparison.shortage.toFixed(2)})**\n• **Warning:** 🛑 *Customer sent LESS than the required total. Do not process until full balance is paid.*`;
                } else if (comparison.status === 'match') {
                  embedColor = 0x00c853;
                  comparisonLine = paymentCount > 1
                    ? `• **Price Comparison:** ✅ **Split Payment Complete (${paymentCount} transfers = Paid in Full)**`
                    : `• **Price Comparison:** ✅ **Exact Match (Paid in Full)**`;
                } else if (comparison.status === 'overpaid') {
                  comparisonLine = `• **Price Comparison:** ℹ️ **Overpaid (+₱${comparison.excess.toFixed(2)})**`;
                }

                const splitSummaryLine =
                  paymentCount > 1 && entry?.amountPaid > 0
                    ? `• **Total Paid So Far:** **₱${entry.amountPaid.toFixed(2)}** (${paymentCount} transfers)\n`
                    : '';

                const logEmbed = new EmbedBuilder()
                  .setColor(embedColor)
                  .setTitle(
                    comparison.status === 'underpaid'
                      ? `⚠️  Receipt Scanned (Underpaid): #${message.channel.name}`
                      : paymentCount > 1 && comparison.status !== 'underpaid'
                      ? `✅  Split Payment Complete: #${message.channel.name}`
                      : `🧾  Receipt Scanned: #${message.channel.name}`
                  )
                  .setDescription(
                    `A payment screenshot was submitted in **#${message.channel.name}** (<#${message.channel.id}>):\n\n` +
                    `• **Bank / App:** ${scanResult.provider}\n` +
                    `• **Ref No:** ${refDisplay}\n` +
                    `• **This Receipt:** ${amountDisplay}\n` +
                    splitSummaryLine +
                    `• **Order Total:** ${expectedDisplay}\n` +
                    `${comparisonLine}\n` +
                    `• **Duplicate Check:** ✅ **Unique Receipt** (First time seen)\n` +
                    `• **Customer:** <@${message.author.id}> (\`${message.author.id}\`)\n` +
                    `• **Ticket Channel:** #${message.channel.name} (<#${message.channel.id}>)\n` +
                    `• **Uploaded:** <t:${Math.floor(Date.now() / 1000)}:R>`
                  )
                  .setThumbnail(imgAttachment.url)
                  .setFooter({ text: 'Staff-Only Receipt Log • Reveux Shop' })
                  .setTimestamp();

                await auditChan.send({ content: auditContent, embeds: [logEmbed] });
              }
            }

            // Cache on entry so staff can run /checkreceipt in the ticket
            if (entry) {
              entry.lastScannedReceipt = {
                refNo: scanResult.refNo,
                amount: scanResult.amount,
                amountValue: scanResult.amountValue,
                amountPaidTotal: entry.amountPaid || scanResult.amountValue,
                paymentCount,
                expectedPrice,
                comparison,
                provider: scanResult.provider,
                isFailed: scanResult.isFailed,
                isDuplicate,
                newPaymentRecorded,
                timestamp: Date.now(),
              };
            }
          }
        }
      } catch (hashErr) {
        console.error('Error processing receipt screenshot:', hashErr);
      }
    }

    if (!isDuplicate) {
      const newRecorded = entry?.lastScannedReceipt?.newPaymentRecorded;
      // Prevent duplicate normal alerts in a short burst (30 seconds) unless a new transfer was just recorded
      if (entry && !newRecorded) {
        if (entry._lastReceiptAlert && Date.now() - entry._lastReceiptAlert < 30000) return;
        entry._lastReceiptAlert = Date.now();
      } else if (entry) {
        entry._lastReceiptAlert = Date.now();
      }

      // Resolve comparison for ticket alert
      const receiptComparison = entry?.lastScannedReceipt?.comparison;
      const expectedPriceVal = entry?.lastScannedReceipt?.expectedPrice;
      const totalPaidVal = entry?.amountPaid || scanResult.amountValue;
      const transferCount = entry?.payments?.length || 1;

      if (receiptComparison && receiptComparison.status === 'underpaid') {
        const isTopUp = transferCount > 1;
        await message.channel.send({
          content: `<@${message.author.id}>`,
          embeds: [
            new EmbedBuilder()
              .setColor(0xff9900)
              .setTitle(
                isTopUp
                  ? `⏳  Partial Payment #${transferCount} Recorded`
                  : '⚠️  Payment Notice: Underpayment Detected'
              )
              .setDescription(
                (isTopUp
                  ? `We recorded your transfer #${transferCount}, and your **Payment Progress** has been updated:\n\n` +
                    `• **This Transfer:** **${scanResult.amount}**\n` +
                    `• **Total Paid So Far:** **₱${Number(totalPaidVal).toFixed(2)}** / **₱${Number(expectedPriceVal).toFixed(2)}**\n`
                  : `We scanned your receipt, but the detected amount is **less than the required order total**:\n\n` +
                    `• **Order Total:** **₱${Number(expectedPriceVal).toFixed(2)}**\n` +
                    `• **Receipt Amount Detected:** **${scanResult.amount}**\n`) +
                `• **Remaining Balance Needed:** **₱${receiptComparison.shortage.toFixed(2)}**\n\n` +
                `ℹ️ *Please send the remaining **₱${receiptComparison.shortage.toFixed(2)}** and upload the next receipt here — it will be added automatically!*\n` +
                `*(If our scanner misread your screenshot, don't worry! Staff can manually adjust it shortly.)*`
              )
              .setTimestamp(),
          ],
        });
      } else if (receiptComparison && (receiptComparison.status === 'match' || receiptComparison.status === 'overpaid')) {
        const isSplitComplete = transferCount > 1;
        await message.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x00c853)
              .setTitle(
                isSplitComplete
                  ? '✅  Split Payment Complete & Verified'
                  : '🧾  Receipt Detected & Amount Verified'
              )
              .setDescription(
                (isSplitComplete
                  ? `Transfer #${transferCount} received — your payments now cover the full order total!\n\n` +
                    `• **This Transfer:** **${scanResult.amount}**\n` +
                    `• **Total Paid:** **₱${Number(totalPaidVal).toFixed(2)}** / **₱${Number(expectedPriceVal).toFixed(2)}** (${transferCount} transfers ✅)\n`
                  : `Receipt screenshot received:\n\n` +
                    `• **Amount Detected:** **${scanResult.amount}** (${receiptComparison.status === 'overpaid' ? `✅ Covers total (+₱${receiptComparison.excess.toFixed(2)})` : '✅ Matches order total'})\n`) +
                (scanResult.refNo ? `• **Ref No:** \`${scanResult.refNo}\`\n\n` : '\n') +
                `Staff has been notified to verify your payment. Please wait a moment while we process your order!`
              )
              .setTimestamp(),
          ],
        });
      } else {
        await message.channel.send({
          content:
            `🧾 **Receipt screenshot detected!**\n` +
            `> Staff has been notified to verify your payment. Please wait a moment while we process your order!`,
        });
      }
    }
  } catch (err) {
    console.error('Error detecting receipt screenshot:', err);
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