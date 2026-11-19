# Revéux shop bot

Discord bot for a Robux and game-credit shop: private order tickets, a queue, stock and rate,
payment QR, proof of delivery, vouches, receipts, an audit log with transcripts, and giveaways.

## Setup

1. Install Node.js 20.6 or newer.
2. `npm install`
3. Copy `.env.example` to `.env` and fill it in. `TOKEN`, `CLIENT_ID`, `GUILD_ID` and `STAFF_ROLE_ID` are required.
4. Upload your pictures next to `index.js`:
   - `shop-open.png`, `shop-closed.png`
   - `sticker-payment-received.jpg`, `sticker-processing.jpg`, `sticker-order-sent.jpg`, `sticker-please-vouch.jpg`, `sticker-thank-you.jpg`
   - one QR picture per payee (default: `payment-qr-hixsly.png`, `payment-qr-ysha.png`)
   A missing shop or sticker picture is just left out. A missing QR picture makes the Pay button answer "QR not available".
5. `npm start`
6. In your server run `/panel` once to post the Buy panel, then `/setup stock:... rate:...` to set the stock and price per 100 Robux.
   (Command names are in `messages.js` under `commandNames`.)

## Where to change things

| What | File |
| --- | --- |
| Game packages and prices | `catalog.js` |
| Payees (who can be paid) | `PAYEES` in `config.js` |
| Currency, ticket limit, colors | `config.js` |
| All wording and command names | `messages.js` |
| Channel and role ids, payment numbers | `.env` |

To add a feature, create a file in `features/` that exports `{ commands, handle }`. It is loaded automatically.

## Saved data

`data.json` (stock, rate, queue, blacklist, shop stats) and `giveaways.json` are created next to `index.js`.
They hold customer information and are listed in `.gitignore`. Back them up. If `data.json` is ever
unreadable the bot keeps a copy as `data.json.broken` before starting empty.

## Notes

- A price is saved on the order when it is created, so changing the rate does not change open orders.
  Editing an order prices it again at the current rate.
- Staff can only mark an order Sent or Completed after pressing Payment Received.
- Ticket channel names show the queue position, but Discord limits renames (about 2 per 10 minutes
  per channel), so the name can lag a little. The position inside the ticket embed is always correct.
