// Saved data (stock, rate, queue, shop status) stored in data.json
const fs = require('fs');
const path = require('path');
const { CURRENCY } = require('../config');

const DATA_FILE = path.join(__dirname, '..', 'data.json');
const TEMP_FILE = DATA_FILE + '.tmp';

function loadData() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      stock: d.stock || 0,
      rate: d.rate || 0,
      queue: Array.isArray(d.queue) ? d.queue : [],
      shopOpen: d.shopOpen !== false, // open by default
      statusMessageId: d.statusMessageId || null,
      stockMessageId: d.stockMessageId || null,
      stockPostedAt: d.stockPostedAt || 0,
      totalOrders: typeof d.totalOrders === 'number' ? d.totalOrders : 0,
      totalVouches: typeof d.totalVouches === 'number' ? d.totalVouches : 0,
      totalRobuxDelivered: typeof d.totalRobuxDelivered === 'number' ? d.totalRobuxDelivered : 0,
      blacklist: Array.isArray(d.blacklist) ? d.blacklist : [],
    };
  } catch (err) {
    // If data.json exists but is broken, keep a copy so it is not overwritten and lost
    if (err.code !== 'ENOENT') {
      console.error('data.json could not be read, starting empty. A copy was saved as data.json.broken:', err);
      try {
        fs.copyFileSync(DATA_FILE, DATA_FILE + '.broken');
      } catch {
        // nothing to copy, ignore
      }
    }
    return {
      stock: 0,
      rate: 0,
      queue: [],
      shopOpen: true,
      statusMessageId: null,
      stockMessageId: null,
      stockPostedAt: 0,
      totalOrders: 0,
      totalVouches: 0,
      totalRobuxDelivered: 0,
      blacklist: [],
    };
  }
}

const data = loadData();

// Writes to a temp file first, then renames it over data.json.
// A crash in the middle of saving can no longer leave a half-written data.json.
function saveData() {
  try {
    fs.writeFileSync(TEMP_FILE, JSON.stringify(data, null, 2));
    fs.renameSync(TEMP_FILE, DATA_FILE);
  } catch (err) {
    console.error('Could not save data.json:', err);
  }
}

// Price in pesos (a whole number) of a Robux amount at the CURRENT rate.
// Use this once when an order is created or edited, then store it on the queue entry.
function robuxPrice(amount) {
  return Math.round((amount * data.rate) / 100);
}

function formatPrice(amount) {
  return `${CURRENCY}${robuxPrice(amount).toLocaleString('en-US')}`;
}

// Fixed price in pesos (used for game packages)
function formatPeso(amount) {
  return `${CURRENCY}${Number(amount).toLocaleString('en-US')}`;
}

// Price text of a queue entry. Uses the price saved on the entry, so changing the rate with /setup
// never reprices an order that is already open. Entries saved before prices were stored
// (old Robux orders) fall back to the current rate.
function orderPriceText(entry) {
  if (typeof entry.price === 'number') return formatPeso(entry.price);
  return formatPrice(entry.amount);
}

// Checks if a Discord user id is blacklisted from opening tickets
function isBlacklisted(userId) {
  return Array.isArray(data.blacklist) && data.blacklist.some((b) => b.userId === userId);
}

module.exports = {
  data,
  saveData,
  robuxPrice,
  formatPrice,
  formatPeso,
  orderPriceText,
  isBlacklisted,
};