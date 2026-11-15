// ============================================================
//  MESSAGES - the only file you need to edit for wording and command names.
//  Change titles, text, footers, emojis and command letters here, then restart the bot.
//
//  Words in { } are filled in by the bot, keep them as they are:
//    {staff}  = the staff member who pressed the button / ran the command
//    {user}   = the person who closed the ticket
//    {item}   = "Robux" or "order"
//    {price}  = the price, e.g. ₱117
//    {count}  = number of orders in the queue
//    {stock}  = Robux stock
//    {buyChannel} = link to your buy channel
//  Use **text** for bold. Use \n for a new line.
//  Leave a footer as '' (empty) if you don't want a footer.
// ============================================================

// ---------- COMMAND NAMES ----------
// One short word each (lowercase letters only, no spaces, max 32 characters).
// Two commands can NOT share the same name. The bot tells you if you do.
// These names are also used inside the texts below.
const commandNames = {
  buy: 'panel',              // staff: post the Buy panel
  stock: 'stock',            // everyone: private stock + rate
  publicstock: 'board',      // staff: public stock board
  setup: 'setup',            // staff: set stock and rate
  shop: 'shop',              // staff: open / close the shop
  queue: 'queue',            // staff: full order queue
  next: 'next',              // staff: who is next
  paymentreceived: 'paid',   // staff: payment received (inside a ticket)
  processing: 'process',     // staff: processing (inside a ticket)
  sent: 'sent',              // staff: delivered / sent (inside a ticket)
  closeticket: 'close',      // staff: close the ticket
  calc: 'calc',              // everyone: Robux calculator (private)
  help: 'help',              // everyone: how to use the bot (private)
};

module.exports = {
  commandNames,

  // ---------- Ticket messages ----------
  paymentReceived: {
    title: '✅  Payment Received',
    text: 'Your payment has been **received**. Thank you!',
    footer: 'Confirmed by {staff}',
  },

  processing: {
    title: '⏳  Processing',
    text: 'Your order is now being **processed**. Please wait a moment.',
    footer: 'Handled by {staff}',
  },

  sent: {
    title: '📦  Order Sent',
    text: 'Your {item} has been **sent**!',
    footer: 'Sent by {staff}',
    proofTitle: 'Proof of delivery',
  },

  // Message with the Vouch button (after the order is sent)
  vouchPrompt: {
    title: '⭐  Leave a Vouch',
    text: 'Please check your account, then tap **Vouch** below to leave a vouch and complete your order. Thank you!',
    footer: '',
  },

  // Message with the Vouch button (when staff completes without pressing Sent)
  vouchReminder: {
    title: '⭐  Leave a Vouch',
    text: 'Tap **Vouch** below to leave a vouch.',
    footer: '',
  },

  // When staff presses Complete Order
  complete: {
    title: '🎉  Order Complete',
    text: 'Your order is complete. Thank you!',
    footer: 'Completed by {staff}',
  },

  // After the customer posts a vouch
  vouched: {
    title: '🎉  Order Complete',
    text: 'Thank you for your vouch! Your order is now **complete**.',
    footer: '',
  },

  nextInLine: {
    title: '🔔  You\'re Next in Line',
    text: 'You are **next in line**! Please wait for staff to assist you.',
    footer: '',
  },

  orderUpdated: {
    title: '✏️  Order Updated',
    text: 'Your order was updated by {staff}.',
    footer: '',
  },

  closing: {
    title: '🔒  Closing Ticket',
    text: 'This ticket will be deleted in **5 seconds**.',
    footer: 'Closed by {user}',
  },

  // The payment message with the "Pay to ..." buttons
  payment: {
    title: 'Payment',
    text: 'You need to pay **{price}** for **{item}**.\nStaff will send you the QR code here. Once you have paid, send your receipt in this ticket.\n**No receipt = no process!**\n\n**NOTE: FOR FORCE REFUND, 30% OF THE TOTAL WILL BE DEDUCTED!**',
  },

  // ---------- Buy panel (/b) ----------
  buyPanel: {
    title: 'Buy',
    text: `Pick what you want to buy with the buttons below.\nA private ticket will open for your order.\nOrders are served in the order they come in.\nUse \`/${commandNames.stock}\` to check the Robux stock and rate, \`/${commandNames.calc}\` to calculate a price, or \`/${commandNames.help}\` to see how everything works.`,
    robloxButton: 'Roblox',
  },

  // ---------- Shop open / closed announcements (/o) ----------
  shopOpen: {
    text: '**The shop is now open!** You can place your order in {buyChannel}.',
  },
  shopClosed: {
    text: '**The shop is now closed.** Please check back later.',
  },
  // Shown privately when someone tries to buy while the shop is closed
  shopClosedReply: 'The shop is currently **closed**. Please check back when we are open again.',

  // ---------- Public stock board (/p) ----------
  publicStock: {
    author: 'REVÉUX  •  ROBUX STOCK',
    titleOpen: '🟢  SHOP OPEN',
    titleClosed: '🔴  SHOP CLOSED',
    descOpen: 'Robux is **ready to order!** Use the Buy panel to open a ticket.',
    descClosed: 'The shop is **closed** right now. Please check back soon!',
    descOutOfStock: 'We are currently **out of stock**. Please check back later!',
    inStockLabel: '💎  In Stock',
    rateLabel: '💰  Rate',
    queueLabel: '📋  Queue',
    queueEmpty: 'No waiting',
    queueCount: '{count} in line',
    priceListLabel: '🏷️  Price List',
    footer: 'Reveux  •  Prices may change, check before you order',
    // Amounts shown in the price list (only amounts that are in stock are shown)
    priceListAmounts: [100, 500, 1000, 2000, 5000, 10000],
  },

  // ---------- Robux calculator (/c) - only the person who used it can see it ----------
  calculator: {
    title: '🧮  Robux Calculator',
    usage: 'Fill in only **one** option: `robux` (to see the price) **or** `price` (to see how much Robux you get).',
    noRate: 'The Robux rate is not set yet. Please check back later.',
    robuxLabel: '💎  Robux',
    priceLabel: '💰  Price',
    rateLabel: '📈  Rate',
    availabilityLabel: '📦  Availability',
    inStock: '✅ In stock',
    overStock: '⚠️ Over our current stock ({stock} Robux)',
    footer: 'Prices may change, check before you order',
  },

  // ---------- How to use the bot (/h) ----------
  // Add, remove or reorder sections as you like. Each section needs a name and text
  // (text can be up to 1000 characters).
  help: {
    title: '📖  How to Use Reveux',
    intro: 'Everything you need to place an order. Go to {buyChannel} to start!',
    sections: [
      {
        name: '🛒  How to buy',
        text: '**1.** Go to {buyChannel} and press the button of what you want to buy.\n**2.** Choose your package and fill in the form.\n**3.** A private ticket opens just for you.\n**4.** Pay and send your receipt in the ticket.\n**5.** Wait for staff to process and send your order.\n**6.** Press **Vouch** to leave a vouch. Thank you!',
      },
      {
        name: '🎮  Mobile Legends, Honor of Kings, CODM',
        text: 'Pick your package from the dropdown (no typing needed), then fill in your IDs:\n• **Mobile Legends:** User ID + Zone ID\n• **Honor of Kings:** Player ID\n• **CODM:** UID\n**Double-check your IDs!** A wrong ID can send the order to the wrong account.',
      },
      {
        name: '🟥  Roblox',
        text: 'Choose **Order by Robux amount** or **Order by price**, then fill in your account name, your username and the amount. The price is calculated for you.',
      },
      {
        name: '💳  Payment',
        text: 'Staff will send the payment QR in your ticket. Pay the exact amount, then send your **receipt** in the ticket.\n**No receipt = no process!**',
      },
      {
        name: '💬  Commands you can use',
        text: `\`/${commandNames.stock}\`  Check the Robux stock and rate (only you can see it)\n\`/${commandNames.calc}\`  Robux calculator: Robux → price, or price → Robux (only you can see it)\n\`/${commandNames.help}\`  Show this guide (only you can see it)`,
      },
      {
        name: '📌  Good to know',
        text: '• You can have **one ticket** at a time.\n• Orders are served **in order**. Your ticket shows your queue position and tells you when you are next.\n• If the shop is **closed**, you can\'t open a ticket until it opens again.\n• Staff will close your ticket when your order is done.',
      },
    ],
    footer: 'Need help? Ask staff in your ticket.',
  },
};
