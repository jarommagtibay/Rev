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
  AUDIT_CHANNEL_ID,
} = process.env;

const ROOT = __dirname;

// Change this to your currency symbol
const CURRENCY = '₱';

// How many open tickets one customer can have for the same product
// (Robux counts as one product, and each game is its own product)
const MAX_TICKETS_PER_PRODUCT = 2;

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
const QR_DETAILS = {
  hixsly: process.env.PAYMENT_HIXSLY || '',
  ysha: process.env.PAYMENT_YSHA || '',
};

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
  AUDIT_CHANNEL_ID,
  ROOT,
  CURRENCY,
  MAX_TICKETS_PER_PRODUCT,
  COLOR,
  SHOP_IMAGES,
  QR_FILES,
  QR_NAMES,
  QR_DETAILS,
  STICKERS,
  SHOP_CLOSED_TEXT,
};