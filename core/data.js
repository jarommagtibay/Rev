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
      totalRobuxDelivered: typeof d.totalRobuxDelivered === 'number' ? d.totalRobuxDelivered : (parseInt(d.totalRobuxDelivered, 10) || 0),
      blacklist: Array.isArray(d.blacklist) ? d.blacklist : [],
      staffStats: d.staffStats && typeof d.staffStats === 'object' ? d.staffStats : {},
      ordersLog: Array.isArray(d.ordersLog) ? d.ordersLog : [],
      promos: Array.isArray(d.promos) ? d.promos : [],
      completionTimes: Array.isArray(d.completionTimes) ? d.completionTimes : [],
      receiptHashes: Array.isArray(d.receiptHashes) ? d.receiptHashes : [],
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
      staffStats: {},
      ordersLog: [],
      promos: [],
      completionTimes: [],
      receiptHashes: [],
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

// Reconciles and syncs staff completed counts from historical ordersLog
function syncStaffStats() {
  if (!data.staffStats) data.staffStats = {};
  if (!Array.isArray(data.ordersLog)) return;

  const countsById = {};
  const countsByName = {};
  for (const o of data.ordersLog) {
    if (o.staffId) {
      countsById[o.staffId] = (countsById[o.staffId] || 0) + 1;
    }
    if (o.staff) {
      countsByName[o.staff] = (countsByName[o.staff] || 0) + 1;
    }
  }

  let changed = false;
  for (const [userId, s] of Object.entries(data.staffStats)) {
    const fromId = countsById[userId] || 0;
    const fromName = (s.username && countsByName[s.username]) || 0;
    const logCount = Math.max(fromId, fromName);
    if (logCount > (s.completed || 0)) {
      s.completed = logCount;
      changed = true;
    }
  }
  if (changed) saveData();
}

syncStaffStats();

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

// Records staff activity for /staffstats (processed, sent, completed)
function recordStaffAction(userId, username, actionType) {
  if (!userId) return;
  if (!data.staffStats) data.staffStats = {};
  if (!data.staffStats[userId]) {
    data.staffStats[userId] = { username, processed: 0, sent: 0, completed: 0 };
  }
  const s = data.staffStats[userId];
  s.username = username || s.username;
  if (actionType === 'processed') s.processed = (s.processed || 0) + 1;
  else if (actionType === 'sent') s.sent = (s.sent || 0) + 1;
  else if (actionType === 'completed') s.completed = (s.completed || 0) + 1;
  saveData();
}

// Records an order completion into the historical log
function recordCompletedOrder(order) {
  if (!Array.isArray(data.ordersLog)) data.ordersLog = [];
  data.ordersLog.push({
    id: `ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    ...order,
    completedAt: Date.now(),
  });
  // Keep the most recent 10,000 orders
  if (data.ordersLog.length > 10000) {
    data.ordersLog = data.ordersLog.slice(-10000);
  }
  saveData();
}

// Records completion duration in minutes for rolling ETA estimation
function recordCompletionDuration(minutes) {
  if (typeof minutes !== 'number' || minutes <= 0 || isNaN(minutes)) return;
  if (!Array.isArray(data.completionTimes)) data.completionTimes = [];
  data.completionTimes.push(Math.round(minutes));
  if (data.completionTimes.length > 50) {
    data.completionTimes = data.completionTimes.slice(-50);
  }
  saveData();
}

// Gets average completion time in minutes (default to 20 mins if insufficient data)
function getAverageETA() {
  const times = data.completionTimes || [];
  if (times.length === 0) return 20;
  const sum = times.reduce((a, b) => a + b, 0);
  return Math.max(5, Math.round(sum / times.length));
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
  recordStaffAction,
  recordCompletedOrder,
  recordCompletionDuration,
  getAverageETA,
  isBlacklisted,
  syncStaffStats,
};