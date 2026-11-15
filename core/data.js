// Saved data (stock, rate, queue, shop status) stored in data.json
const fs = require('fs');
const path = require('path');
const { CURRENCY } = require('../config');

const DATA_FILE = path.join(__dirname, '..', 'data.json');

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
    };
  } catch {
    return {
      stock: 0,
      rate: 0,
      queue: [],
      shopOpen: true,
      statusMessageId: null,
      stockMessageId: null,
      stockPostedAt: 0,
    };
  }
}

const data = loadData();

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function formatPrice(amount) {
  // Always a whole number
  const price = Math.round((amount * data.rate) / 100);
  return `${CURRENCY}${price.toLocaleString('en-US')}`;
}

// Fixed price in pesos (used for game packages)
function formatPeso(amount) {
  return `${CURRENCY}${Number(amount).toLocaleString('en-US')}`;
}

module.exports = { data, saveData, formatPrice, formatPeso };
