// Digital Graphic Receipt Generator
// Generates a clean, minimalist red-themed PNG receipt card for completed orders.
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

// Truncate text to fit within a given pixel width
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

/**
 * Generates a minimalist red-themed PNG receipt card.
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
      // ── Layout constants ──
      const W = 780;
      const H = 420;
      const PAD = 32;
      const canvas = createCanvas(W, H);
      const ctx = canvas.getContext('2d');

      // ── Colour palette (red theme, minimalist) ──
      const BG        = '#0d0d0d';
      const CARD_BG   = '#141414';
      const RED        = '#c8102e';
      const RED_LIGHT  = '#e63946';
      const RED_DIM    = '#3a0a10';
      const WHITE      = '#f5f5f5';
      const GREY       = '#8a8a8a';
      const GREY_DIM   = '#3a3a3a';
      const GREEN      = '#34d399';
      const GREEN_DIM  = '#0d2818';

      // ── Background ──
      ctx.fillStyle = BG;
      roundRect(ctx, 0, 0, W, H, 14);
      ctx.fill();

      // Thin red accent line across the very top
      ctx.fillStyle = RED;
      ctx.fillRect(0, 0, W, 3);

      // ── Inner card ──
      roundRect(ctx, PAD - 8, 24, W - (PAD - 8) * 2, H - 48, 10);
      ctx.fillStyle = CARD_BG;
      ctx.fill();

      // ═══════════════════════════════════════════
      //  HEADER ROW: Brand + Verified Badge
      // ═══════════════════════════════════════════
      const headerY = 46;

      // "R" logo circle
      ctx.beginPath();
      ctx.arc(PAD + 14, headerY + 8, 14, 0, Math.PI * 2);
      ctx.fillStyle = RED;
      ctx.fill();
      ctx.font = 'bold 16px sans-serif';
      ctx.fillStyle = WHITE;
      ctx.textAlign = 'center';
      ctx.fillText('R', PAD + 14, headerY + 14);
      ctx.textAlign = 'left';

      // Brand name
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = WHITE;
      ctx.fillText('REVÉUX', PAD + 36, headerY + 4);

      ctx.font = '10px sans-serif';
      ctx.fillStyle = GREY;
      ctx.fillText('OFFICIAL RECEIPT', PAD + 36, headerY + 18);

      // Verified pill (right side)
      const pillText = 'VERIFIED';
      ctx.font = 'bold 10px sans-serif';
      const pillW = ctx.measureText(pillText).width + 26;
      let pillX = W - PAD - pillW;

      // Draw customer avatar if available
      if (loadImage && order.customerAvatar) {
        try {
          const img = await loadImage(order.customerAvatar);
          const avSize = 28;
          const avX = W - PAD - avSize;
          const avY = headerY - 5;
          ctx.save();
          ctx.beginPath();
          ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(img, avX, avY, avSize, avSize);
          ctx.restore();

          // Border around avatar
          ctx.strokeStyle = RED;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2);
          ctx.stroke();

          pillX = avX - pillW - 10;
        } catch {
          // Fallback if avatar fails to load
        }
      }

      roundRect(ctx, pillX, headerY - 4, pillW, 22, 11);
      ctx.fillStyle = GREEN_DIM;
      ctx.fill();
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = GREEN;
      ctx.fillText('✓ ' + pillText, pillX + 8, headerY + 10);

      // ── Thin divider ──
      const divY = headerY + 32;
      ctx.strokeStyle = GREY_DIM;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD, divY);
      ctx.lineTo(W - PAD, divY);
      ctx.stroke();

      // ═══════════════════════════════════════════
      //  ORDER ID + DATE ROW
      // ═══════════════════════════════════════════
      const orderRowY = divY + 22;

      ctx.font = 'bold 22px sans-serif';
      ctx.fillStyle = WHITE;
      ctx.fillText(`#${orderId}`, PAD, orderRowY);

      ctx.font = '11px sans-serif';
      ctx.fillStyle = GREY;
      ctx.textAlign = 'right';
      ctx.fillText(dateStr, W - PAD, orderRowY);
      ctx.textAlign = 'left';

      // ═══════════════════════════════════════════
      //  MAIN INFO GRID: 2 columns
      // ═══════════════════════════════════════════
      const gridY = orderRowY + 24;
      const colW = (W - PAD * 2 - 24) / 2;
      const leftX = PAD;
      const rightX = PAD + colW + 24;

      // ── Helper to draw a label + value pair ──
      function drawField(x, y, label, value, valueColor = WHITE) {
        ctx.font = '10px sans-serif';
        ctx.fillStyle = GREY;
        ctx.fillText(label, x, y);
        ctx.font = 'bold 13px sans-serif';
        ctx.fillStyle = valueColor;
        const truncVal = fitText(ctx, String(value).replace(/```\n?/g, '').trim(), colW - 8);
        ctx.fillText(truncVal, x, y + 16);
        return 40; // row height
      }

      const cleanCustomer = String(customerName || 'Customer')
        .replace(/^@+/, '')
        .trim();
      const cleanStaff = String(staffName || 'Staff')
        .replace(/^Received by\s*/i, '')
        .replace(/^@+/, '')
        .trim();

      // Left column
      let ly = gridY;
      ly += drawField(leftX, ly, 'CUSTOMER', `@${cleanCustomer}`);
      ly += drawField(leftX, ly, 'ACCOUNT', accountInfo);
      ly += drawField(leftX, ly, 'FULFILLED BY', `@${cleanStaff || 'Staff'}`);

      // Right column
      let ry = gridY;
      ry += drawField(rightX, ry, 'PRODUCT', productName);
      ry += drawField(rightX, ry, 'CATEGORY', gameName);
      ry += drawField(rightX, ry, 'PAYMENT', 'GCash / Maya');

      // ═══════════════════════════════════════════
      //  TOTAL AMOUNT BOX
      // ═══════════════════════════════════════════
      const totalBoxY = Math.max(ly, ry) + 8;
      const totalBoxH = 60;
      roundRect(ctx, PAD, totalBoxY, W - PAD * 2, totalBoxH, 8);
      ctx.fillStyle = RED_DIM;
      ctx.fill();

      // Left side of box: label
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = RED_LIGHT;
      ctx.fillText('TOTAL AMOUNT', PAD + 16, totalBoxY + 24);

      ctx.font = '10px sans-serif';
      ctx.fillStyle = GREY;
      ctx.fillText('All fees included', PAD + 16, totalBoxY + 42);

      // Right side of box: price
      ctx.font = 'bold 28px sans-serif';
      ctx.fillStyle = WHITE;
      ctx.textAlign = 'right';
      ctx.fillText(priceText, W - PAD - 16, totalBoxY + 40);
      ctx.textAlign = 'left';

      // ═══════════════════════════════════════════
      //  FOOTER: auth code + thank you
      // ═══════════════════════════════════════════
      const footerY = totalBoxY + totalBoxH + 18;

      ctx.font = '10px monospace';
      ctx.fillStyle = GREY_DIM;
      ctx.fillText(`REF ${authCode}`, PAD, footerY);

      ctx.font = '10px sans-serif';
      ctx.fillStyle = GREY_DIM;
      ctx.textAlign = 'right';
      ctx.fillText('Thank you for choosing Revéux ♥', W - PAD, footerY);
      ctx.textAlign = 'left';

      // ── Render ──
      const buffer = canvas.toBuffer('image/png');
      const attachment = new AttachmentBuilder(buffer, { name: `receipt-${orderId}.png` });

      const embed = new EmbedBuilder()
        .setColor(0xc8102e)
        .setImage(`attachment://receipt-${orderId}.png`)
        .setFooter({ text: `Revéux Shop • Official Receipt '${orderId}'` })
        .setTimestamp(timestamp);

      return { attachment, embed };
    } catch (err) {
      console.warn('Canvas receipt generation error, using embed fallback:', err);
    }
  }

  // Fallback: Rich Discord Embed with clean receipt formatting
  const embed = new EmbedBuilder()
    .setColor(0xc8102e)
    .setTitle(`🧾  Receipt #${orderId}`)
    .setDescription(
      `\`\`\`\n` +
      `  REVÉUX  ·  OFFICIAL RECEIPT\n` +
      `─────────────────────────────────\n` +
      `  ORDER       #${orderId}\n` +
      `  DATE        ${dateStr}\n` +
      `  CUSTOMER    @${customerName}\n` +
      `  PRODUCT     ${productName}\n` +
      `  ACCOUNT     ${accountInfo}\n` +
      `  TOTAL       ${priceText}\n` +
      `  STAFF       @${staffName}\n` +
      `─────────────────────────────────\n` +
      `  ✓ PAID & VERIFIED  REF ${authCode}\n` +
      `\`\`\``
    )
    .setFooter({ text: `Revéux Shop • Receipt #${orderId}` })
    .setTimestamp(timestamp);

  return { attachment: null, embed };
}

module.exports = {
  generateReceiptCard,
};
