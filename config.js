// All settings and constants live here.
// This file must stay in the same folder as index.js (it points to your image files).
const path = require('path');

const env = process.env;

const TOKEN = env.TOKEN;
const CLIENT_ID = env.CLIENT_ID;
const GUILD_ID = env.GUILD_ID;
const STAFF_ROLE_ID = env.STAFF_ROLE_ID;
const CATEGORY_ID = env.CATEGORY_ID;
const BUY_CHANNEL_ID = env.BUY_CHANNEL_ID;
const VOUCH_CHANNEL_ID = env.VOUCH_CHANNEL_ID;
const RECEIPT_CHANNEL_ID = env.RECEIPT_CHANNEL_ID;
const SHOP_STATUS_CHANNEL_ID = env.SHOP_STATUS_CHANNEL_ID;
const SHOP_PING_ROLE_ID = env.SHOP_PING_ROLE_ID;
const STOCK_CHANNEL_ID = env.STOCK_CHANNEL_ID;
const AUDIT_CHANNEL_ID = env.AUDIT_CHANNEL_ID;
const DAILY_SALE_CHANNEL_ID = env.DAILY_SALE_CHANNEL_ID || '';
const UNVOUCHED_ROLE_ID = env.UNVOUCHED_ROLE_ID || '';
const UNVOUCHED_CATEGORY_ID = env.UNVOUCHED_CATEGORY_ID || '';
const LOW_STOCK_THRESHOLD = Number(env.LOW_STOCK_THRESHOLD) || 500;
const EXPRESS_FEE = Number(env.EXPRESS_FEE) || 15;
const GEMINI_API_KEY = env.GEMINI_API_KEY || '';
const OPENAI_API_KEY = env.OPENAI_API_KEY || '';
const VISION_MODE = (env.VISION_MODE || 'fallback').toLowerCase(); // 'fallback' | 'always' | 'off'

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

// Who can be paid. To add or remove a payee, edit THIS list only: the "Pay to ..." buttons in the
// ticket and the QR handling are built from it.
//   key     short id, lowercase letters / numbers / _ only (it becomes the button id pay_<key>)
//   name    shown on the button and in the QR message
//   qrFile  QR picture, upload it next to index.js
//   details account / GCash number shown for copying (put it in .env as PAYMENT_<KEY>)
// Discord allows at most 25 buttons in a message, the ticket shows the first 5.
const PAYEES = [
  { key: 'hixsly', name: 'Hixsly', qrFile: 'payment-qr-hixsly.png', details: process.env.PAYMENT_HIXSLY },
  { key: 'ysha', name: 'Ysha', qrFile: 'payment-qr-ysha.png', details: process.env.PAYMENT_YSHA },
].map((p) => ({ ...p, qrFile: path.join(ROOT, p.qrFile), details: p.details || '' }));

// Lookups by key (used by the payment buttons)
const QR_FILES = Object.fromEntries(PAYEES.map((p) => [p.key, p.qrFile]));
const QR_NAMES = Object.fromEntries(PAYEES.map((p) => [p.key, p.name]));
const QR_DETAILS = Object.fromEntries(PAYEES.map((p) => [p.key, p.details]));

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
  DAILY_SALE_CHANNEL_ID,
  UNVOUCHED_ROLE_ID,
  UNVOUCHED_CATEGORY_ID,
  LOW_STOCK_THRESHOLD,
  EXPRESS_FEE,
  GEMINI_API_KEY,
  OPENAI_API_KEY,
  VISION_MODE,
  ROOT,
  CURRENCY,
  MAX_TICKETS_PER_PRODUCT,
  COLOR,
  SHOP_IMAGES,
  PAYEES,
  QR_FILES,
  QR_NAMES,
  QR_DETAILS,
  STICKERS,
  SHOP_CLOSED_TEXT,
};