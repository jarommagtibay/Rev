// All settings and constants live here.
// This file must stay in the same folder as index.js (it points to your image files).
const path = require('path');

const {
  TOKEN,
  CLIENT_ID,
  GUILD_ID,
  STAFF_ROLE_ID,
  CATEGORY_ID,
  BUY_CHANNEL_ID,
  VOUCH_CHANNEL_ID,
  RECEIPT_CHANNEL_ID,
  SHOP_STATUS_CHANNEL_ID,
  SHOP_PING_ROLE_ID,
  STOCK_CHANNEL_ID,
} = process.env;

const ROOT = __dirname;

// Change this to your currency symbol
const CURRENCY = '₱';

// Embed color
const COLOR = 0x94030f;

// Shop open / closed pictures (upload both next to index.js)
const SHOP_IMAGES = {
  open: 'shop-open.png',
  closed: 'shop-closed.png',
};

// Payment QR images (upload both next to index.js)
const QR_FILES = {
  hixsly: path.join(ROOT, 'payment-qr-hixsly.png'),
  ysha: path.join(ROOT, 'payment-qr-ysha.png'),
};
const QR_NAMES = { hixsly: 'Hixsly', ysha: 'Ysha' };

// Sticker images shown in the ticket (upload them next to index.js)
const STICKERS = {
  paymentReceived: 'sticker-payment-received.jpg',
  processing: 'sticker-processing.jpg',
  sent: 'sticker-order-sent.jpg',
  vouch: 'sticker-please-vouch.jpg',
  thanks: 'sticker-thank-you.jpg',
};

const SHOP_CLOSED_TEXT = require('./messages').shopClosedReply;

module.exports = {
  TOKEN,
  CLIENT_ID,
  GUILD_ID,
  STAFF_ROLE_ID,
  CATEGORY_ID,
  BUY_CHANNEL_ID,
  VOUCH_CHANNEL_ID,
  RECEIPT_CHANNEL_ID,
  SHOP_STATUS_CHANNEL_ID,
  SHOP_PING_ROLE_ID,
  STOCK_CHANNEL_ID,
  ROOT,
  CURRENCY,
  COLOR,
  SHOP_IMAGES,
  QR_FILES,
  QR_NAMES,
  STICKERS,
  SHOP_CLOSED_TEXT,
};
