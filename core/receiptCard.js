// Digital Graphic Receipt Generator
// Generates a sleek, high-resolution visual PNG invoice receipt for completed orders.
// Uses @napi-rs/canvas if available, and gracefully falls back to Discord Embed if canvas is not installed.
const crypto = require('crypto');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { COLOR } = require('../config');

let createCanvas = null;
let loadImage = null;

try {
  const canvasPkg = require('@napi-rs/canvas');
  createCanvas = canvasPkg.createCanvas;
  loadImage = canvasPkg.loadImage;
} catch {
  // @napi-rs/canvas not installed yet, fallback is used
}

function roundRect(ctx, x, y, width, height, radius) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Generates an aesthetic PNG digital receipt card.
 * @param {Object} order
 * @param {string} order.orderId
 * @param {string} order.customerName
 * @param {string} order.customerId
 * @param {string} [order.customerAvatar]
 * @param {string} order.productName
 * @param {string} order.priceText
 * @param {string} [order.accountInfo]
 * @param {string} [order.gameName]
 * @param {string} [order.staffName]
 * @param {number} [order.timestamp]
 * @returns {Promise<{ attachment: AttachmentBuilder | null, embed: EmbedBuilder }>}
 */
async function generateReceiptCard(order) {
  const orderId = order.orderId || 'REV-XXXX';
  const customerName = order.customerName || 'Customer';
  const customerId = order.customerId || '';
  const productName = order.productName || 'Order Item';
  const priceText = order.priceText || '₱0.00';
  const accountInfo = order.accountInfo || '-';
  const gameName = order.gameName || 'Roblox';
  const staffName = order.staffName || 'Staff';
  const timestamp = order.timestamp || Date.now();
  const dateStr = new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const authCode = crypto
    .createHash('md5')
    .update(`${orderId}-${customerId}-${timestamp}`)
    .digest('hex')
    .substring(0, 8)
    .toUpperCase();

  // If Canvas is available, draw the graphic receipt
  if (createCanvas) {
    try {
      const width = 850;
      const height = 480;
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');

      // 1. Base Background with sleek dark gradient
      const bgGrad = ctx.createLinearGradient(0, 0, width, height);
      bgGrad.addColorStop(0, '#15161a');
      bgGrad.addColorStop(0.5, '#111215');
      bgGrad.addColorStop(1, '#0c0d10');
      roundRect(ctx, 0, 0, width, height, 16);
      ctx.fillStyle = bgGrad;
      ctx.fill();

      // Outer Glowing Border
      roundRect(ctx, 2, 2, width - 4, height - 4, 16);
      ctx.strokeStyle = '#94030f';
      ctx.lineWidth = 3;
      ctx.stroke();

      // 2. Top Header Accent Line
      const accentGrad = ctx.createLinearGradient(20, 0, width - 20, 0);
      accentGrad.addColorStop(0, '#94030f');
      accentGrad.addColorStop(0.5, '#ff4655');
      accentGrad.addColorStop(1, '#f59e0b');
      ctx.fillStyle = accentGrad;
      ctx.fillRect(20, 16, width - 40, 3);

      // Header Brand Text
      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = '#a1a1aa';
      ctx.fillText('REVÉUX  •  OFFICIAL TRANSACTION RECEIPT', 24, 38);

      // Holographic Stamp: [ ✔ PAID & VERIFIED ]
      const stampX = width - 180;
      const stampY = 24;
      roundRect(ctx, stampX, stampY, 156, 26, 13);
      ctx.fillStyle = '#0f291e';
      ctx.fill();
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#4ade80';
      ctx.fillText('✔ PAID & VERIFIED', stampX + 16, stampY + 17);

      // Order ID & Date
      ctx.font = 'bold 26px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`ORDER #${orderId}`, 24, 82);

      ctx.font = '13px sans-serif';
      ctx.fillStyle = '#71717a';
      ctx.fillText(`Issued on: ${dateStr}`, width - 240, 80);

      // Divider line
      ctx.strokeStyle = '#27272a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(24, 96);
      ctx.lineTo(width - 24, 96);
      ctx.stroke();

      // 3. Left Panel: Customer Information
      const panelY = 112;
      const panelW = 385;
      const panelH = 260;

      roundRect(ctx, 24, panelY, panelW, panelH, 12);
      ctx.fillStyle = '#18191e';
      ctx.fill();
      ctx.strokeStyle = '#27272a';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#71717a';
      ctx.fillText('CUSTOMER DETAILS', 40, panelY + 28);

      // Try loading avatar if provided
      let avatarLoaded = false;
      if (order.customerAvatar && loadImage) {
        try {
          const img = await loadImage(order.customerAvatar);
          ctx.save();
          ctx.beginPath();
          ctx.arc(65, panelY + 70, 25, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(img, 40, panelY + 45, 50, 50);
          ctx.restore();

          ctx.beginPath();
          ctx.arc(65, panelY + 70, 25, 0, Math.PI * 2);
          ctx.strokeStyle = '#ff4655';
          ctx.lineWidth = 2;
          ctx.stroke();
          avatarLoaded = true;
        } catch {
          avatarLoaded = false;
        }
      }

      if (!avatarLoaded) {
        // Fallback Initial Avatar Circle
        ctx.beginPath();
        ctx.arc(65, panelY + 70, 25, 0, Math.PI * 2);
        ctx.fillStyle = '#94030f';
        ctx.fill();
        ctx.font = 'bold 20px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(customerName.charAt(0).toUpperCase(), 65, panelY + 77);
        ctx.textAlign = 'left';
      }

      // Customer name and ID
      ctx.font = 'bold 17px sans-serif';
      ctx.fillStyle = '#f4f4f5';
      ctx.fillText(customerName, 104, panelY + 66);

      ctx.font = '12px monospace';
      ctx.fillStyle = '#71717a';
      ctx.fillText(`ID: ${customerId}`, 104, panelY + 84);

      // In-game Account / Username
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#a1a1aa';
      ctx.fillText('IN-GAME ACCOUNT / ID:', 40, panelY + 128);

      roundRect(ctx, 40, panelY + 136, panelW - 32, 34, 6);
      ctx.fillStyle = '#111215';
      ctx.fill();
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = '#ffffff';
      const cleanAccount = String(accountInfo).replace(/```\n?/g, '').trim();
      ctx.fillText(cleanAccount.length > 32 ? cleanAccount.slice(0, 32) + '...' : cleanAccount, 52, panelY + 158);

      // Payment Info
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#a1a1aa';
      ctx.fillText('PAYMENT METHOD:', 40, panelY + 196);
      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('GCash / Maya Transfer (Verified)', 40, panelY + 214);

      // Fulfillment
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#949ba4';
      ctx.fillText(`Fulfilled by: @${staffName}`, 40, panelY + 242);

      // 4. Right Panel: Order Breakdown & Total Price
      const rightX = 435;
      roundRect(ctx, rightX, panelY, panelW, panelH, 12);
      ctx.fillStyle = '#18191e';
      ctx.fill();
      ctx.strokeStyle = '#27272a';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#71717a';
      ctx.fillText('PURCHASE BREAKDOWN', rightX + 16, panelY + 28);

      // Product Item
      ctx.font = 'bold 19px sans-serif';
      ctx.fillStyle = '#ffffff';
      const truncProd = productName.length > 28 ? productName.slice(0, 28) + '...' : productName;
      ctx.fillText(truncProd, rightX + 16, panelY + 64);

      ctx.font = '13px sans-serif';
      ctx.fillStyle = '#949ba4';
      ctx.fillText(`Category: ${gameName}`, rightX + 16, panelY + 86);

      // Inset Total Box
      const totalBoxY = panelY + 112;
      roundRect(ctx, rightX + 16, totalBoxY, panelW - 32, 90, 10);
      ctx.fillStyle = '#101114';
      ctx.fill();
      ctx.strokeStyle = '#94030f';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#ff6b6b';
      ctx.fillText('TOTAL AMOUNT PAID', rightX + 32, totalBoxY + 30);

      ctx.font = 'bold 34px sans-serif';
      ctx.fillStyle = '#22c55e';
      ctx.fillText(priceText, rightX + 32, totalBoxY + 70);

      // Barcode simulation on bottom of right panel
      const barcodeX = rightX + 16;
      const barcodeY = panelY + 218;
      const barcodeWidths = [2, 1, 3, 1, 2, 4, 1, 2, 1, 3, 2, 1, 4, 2, 1, 3, 1, 2, 3, 1, 2, 4, 1, 3, 2, 1, 4, 1, 2, 3, 2, 1, 4, 2, 1, 3];
      let curBx = barcodeX;
      ctx.fillStyle = '#71717a';
      for (const w of barcodeWidths) {
        ctx.fillRect(curBx, barcodeY, w, 24);
        curBx += w + 2;
      }
      ctx.font = '10px monospace';
      ctx.fillStyle = '#71717a';
      ctx.fillText(`REF-${authCode}`, curBx + 12, barcodeY + 17);

      // 5. Bottom Footer Note
      ctx.font = 'italic 11px sans-serif';
      ctx.fillStyle = '#52525b';
      ctx.fillText('Thank you for choosing Revéux Shop! Keep this receipt for your records & warranty.', 24, height - 24);

      const buffer = canvas.toBuffer('image/png');
      const attachment = new AttachmentBuilder(buffer, { name: `receipt-${orderId}.png` });

      const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`🧾  Official Receipt: #${orderId}`)
        .setDescription(`**${customerName}**, thank you for ordering with **Revéux Shop**!\nHere is your official digital invoice:`)
        .setImage(`attachment://receipt-${orderId}.png`)
        .setFooter({ text: `Order #${orderId} • Fulfilled by @${staffName}` })
        .setTimestamp(timestamp);

      return { attachment, embed };
    } catch (err) {
      console.warn('Canvas receipt generation error, using embed fallback:', err);
    }
  }

  // Fallback: Rich Discord Embed with ASCII receipt formatting
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`🧾  Official Receipt: #${orderId}`)
    .setDescription(
      `\`\`\`\n` +
      `==========================================\n` +
      `         REVÉUX GAMING SHOP RECEIPT       \n` +
      `==========================================\n` +
      `ORDER ID:     #${orderId}\n` +
      `DATE:         ${dateStr}\n` +
      `CUSTOMER:     @${customerName}\n` +
      `PRODUCT:      ${productName}\n` +
      `ACCOUNT:      ${accountInfo}\n` +
      `TOTAL PAID:   ${priceText}\n` +
      `STATUS:       [ ✔ PAID & VERIFIED ]\n` +
      `STAFF:        @${staffName}\n` +
      `AUTH CODE:    REF-${authCode}\n` +
      `==========================================\n` +
      `\`\`\``
    )
    .setFooter({ text: `Order #${orderId} • Reveux Shop` })
    .setTimestamp(timestamp);

  return { attachment: null, embed };
}

module.exports = {
  generateReceiptCard,
};
