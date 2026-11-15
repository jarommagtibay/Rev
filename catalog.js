// GAME CATALOG - edit prices / packages here, then restart the bot.
// price = number in pesos (no symbol). Each package shows in the dropdown as "label  -  price".
// fields = what the customer must fill in (digits: true = numbers only, isName: true = in-game name).
// Discord dropdowns allow a maximum of 25 packages per game.

const GAMES = {
  ml: {
    name: 'Mobile Legends',
    currency: 'Diamonds',
    fields: [
      { id: 'user_id', label: 'User ID', placeholder: 'e.g. 123456789', digits: true },
      { id: 'zone_id', label: 'Zone ID', placeholder: 'e.g. 1234', digits: true },
      { id: 'ign', label: 'In-game name', placeholder: 'Your MLBB nickname', isName: true },
    ],
    packages: [
      { label: '112 Diamonds', price: 117 },
      { label: '168 Diamonds', price: 174 },
      { label: '232 Diamonds', price: 230 },
      { label: '279 Diamonds', price: 291 },
      { label: '301 Diamonds', price: 310 },
      { label: '336 Diamonds', price: 354 },
      { label: '358 Diamonds', price: 367 },
      { label: '403 Diamonds', price: 413 },
      { label: '448 Diamonds', price: 458 },
      { label: '457 Diamonds', price: 470 },
      { label: '560 Diamonds', price: 573 },
      { label: 'Weekly Elite Bundle', price: 60 },
      { label: 'Monthly Epic Bundle', price: 284 },
      { label: 'Weekly Diamond Pass', price: 123 },
    ],
  },

  hok: {
    name: 'Honor of Kings',
    currency: 'Tokens',
    fields: [
      { id: 'player_id', label: 'Player ID', placeholder: 'e.g. 1234567890', digits: true },
      { id: 'ign', label: 'In-game name', placeholder: 'Your HOK nickname', isName: true },
    ],
    packages: [
      { label: '16 Tokens', price: 15 },
      { label: '80 Tokens', price: 62 },
      { label: '240 Tokens', price: 181 },
      { label: '400 Tokens', price: 300 },
      { label: '560 Tokens', price: 419 },
      { label: '800 Tokens', price: 597 },
      { label: '1200 Tokens', price: 894 },
      { label: '2400 Tokens', price: 1786 },
    ],
  },

  codm: {
    name: 'Call of Duty Mobile',
    currency: 'CP',
    note: 'PRICE MAY VARY, SO INQUIRE FIRST!',
    fields: [
      { id: 'uid', label: 'UID', placeholder: 'e.g. 6742000000000000000', digits: true },
      { id: 'ign', label: 'In-game name', placeholder: 'Your CODM nickname', isName: true },
    ],
    packages: [
      { label: '100 CP', price: 55 },
      { label: '208 CP', price: 104 },
      { label: '416 CP', price: 203 },
      { label: '648 CP', price: 300 },
      { label: '1080 CP', price: 498 },
      { label: '2320 CP', price: 990 },
    ],
  },
};

module.exports = { GAMES };
