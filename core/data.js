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