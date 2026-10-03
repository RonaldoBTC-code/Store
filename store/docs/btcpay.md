# Bitcoin and Lightning payments (BTCPay Server)

Gato Gang can take Bitcoin on-chain and Lightning through a BTCPay Server the store owner runs, next to any other payment method such as PayPhone. The Medusa provider is registered only when all four environment variables below are set, and the Ecuador region script attaches it to region `ec` only.

This is not legal advice. Bitcoin is not legal tender in Ecuador. The owner should ask an accountant how these payments should be invoiced and reported for tax.

## Hosting BTCPay Server

BTCPay Server is free software. The store backend talks to whatever base URL you put in `BTCPAY_URL`. Official deployment notes:

- Docker installation: <https://docs.btcpayserver.org/Docker/>
- Current sizing guide: <https://docs.btcpayserver.org/Docker/specs/>
- Lightning on Docker: <https://docs.btcpayserver.org/Docker/lightning/>
- Lightning setup and liquidity: <https://docs.btcpayserver.org/LightningNetwork/>
- Deployment options, including third-party hosts: <https://docs.btcpayserver.org/Deployment/>
- Deployment FAQ: <https://docs.btcpayserver.org/FAQ/Deployment/>

### Self-host on a VPS with Docker

Use a dedicated Linux host that can run containers (`x86_64`, `armv7l`, or `aarch64`) with root access. The Docker specs page gives this starting point for a deployment that runs its own chain:

| Resource | Starting point from the Docker specs |
| --- | --- |
| Memory | 4 GB RAM |
| CPU | 2 virtual cores |
| Storage | 50 GB usable SSD as a bare minimum; pick a larger disk for headroom |
| Bandwidth | Enough for the initial chain download; unmetered is preferred |

The deployment FAQ still lists a tighter profile for Bitcoin plus Lightning with pruning enabled: 2 GB RAM, 80 GB of storage, and Docker. Those two official pages do not match. Size the VPS from the Docker specs page, and treat the FAQ numbers as an older lower bound.

Pruning fragments (`opt-save-storage`, down to `opt-save-storage-xxs` at about 5 GB) are documented on the specs page. That page says not to use `opt-save-storage-xxs` when Lightning is enabled.

### Lightning

Lightning is optional in BTCPay and off unless you select an implementation before setup (`BTCPAYGEN_LIGHTNING=clightning`, `lnd`, or `phoenixd`). On-chain Bitcoin still works if Lightning is left off. This integration does not force `BTC-CHAIN` or `BTC-LN` on the invoice, so the invoice shows whatever the BTCPay store has enabled. Enable both on the store if you want both.

A merchant needs inbound liquidity to receive Lightning payments. Opening a channel yourself usually gives outbound capacity only. Inbound capacity comes from someone else opening a channel to you, from spending, or from a Lightning service provider. See the Lightning docs linked above. Channel backups matter: a Lightning node without backups can lose funds.

### Third-party host

The deployment docs also describe third-party hosts for people who do not want to run a node. If you use one, payments follow that host's wallet setup. The Lightning FAQ warns that Lightning payments on a third-party host go to the host's wallet, and that this should be a host you trust. The same `BTCPAY_URL`, store id, API key, and webhook secret are all this codebase needs.

## Create the BTCPay store

1. Open your BTCPay instance and create a store.
2. Set the store's default currency to USD. Medusa rejects any invoice that is not USD.
3. Enable on-chain Bitcoin. Enable Lightning on the store as well if you want Lightning checkout.
4. Copy the store id. It is the `BTCPAY_STORE_ID` value.
5. Connect a watch-only wallet. Do this before the store takes a payment. The steps for Ramoide are in the next section.

Do not put customer addresses or emails on the invoice. The backend sends the cart id, the Medusa payment session id, and the USD amount in cents. BTCPay documents `orderId` as the external order id and indexes it: <https://docs.btcpayserver.org/Development/ecommerce-integration-guide/>

## Watch-only wallet (Ramoide)

The BTCPay store must use a watch-only extended public key. Do not put a hot private key, seed, or xprv on this server.

BTCPay's wallet guide is <https://docs.btcpayserver.org/Wallet/>. A watch-only wallet lets the server derive receive addresses and see payments. It cannot sign or spend.

1. On an offline computer or a hardware wallet, export the account extended public key (`xpub`, `ypub`, or `zpub`). Do not export the seed or any private key.
2. In BTCPay, open the store, then Bitcoin wallet, then set up or replace the wallet.
3. Choose to connect an existing wallet and paste only that extended public key.
4. Check the derivation scheme against the wallet's address preview before saving. BTCPay shows the addresses it will watch.
5. Confirm the wallet screen says the wallet is watch-only. If BTCPay generated a seed on the server, remove that wallet and start again from the public key.

Never paste a seed, private key, or hot-wallet backup into the BTCPay host or the Medusa host. The API key below is not a wallet key. It cannot spend if the store wallet is watch-only.

## API key (least privilege)

Create the key under Account, Manage account, API keys, and limit it to this one store. The header format is `Authorization: token <api key>` (<https://docs.btcpayserver.org/Developers/api/>). The key is backend-only. The name is `BTCPAY_API_KEY`, never `NEXT_PUBLIC_BTCPAY_API_KEY`.

The minimum permissions for taking a payment are create and view invoices for that store only:

| Permission | Why |
| --- | --- |
| `btcpay.store.cancreateinvoice` | `POST /api/v1/stores/{storeId}/invoices` |
| `btcpay.store.canviewinvoices` | `GET /api/v1/stores/{storeId}/invoices/{invoiceId}` |

The webhook secret is not an API-key permission. It is the separate value BTCPay shows when the webhook is created, stored as `BTCPAY_WEBHOOK_SECRET`.

This code also calls two other routes when those actions are used. Leave the permissions off unless you use the action:

| Permission | Used only for |
| --- | --- |
| `btcpay.store.canmodifyinvoices` | Canceling an unpaid `New` invoice (`POST .../invoices/{invoiceId}/status` with `Invalid`) |
| `btcpay.store.cancreatenonapprovedpullpayments` | A refund pull payment (`POST .../invoices/{invoiceId}/refund`) |

The ecommerce guide also lists `btcpay.store.webhooks.canmodifywebhooks` and `btcpay.store.canviewstoresettings` for an automated connect flow. This codebase does not call those endpoints. Leave them off. The refund action on current BTCPay source is authorized with `btcpay.store.cancreatenonapprovedpullpayments`, not the broader `btcpay.store.cancreatepullpayments`.

Neither the API key nor the webhook secret is written to logs or error messages. Request failures replace those values with `[redacted]`.

## Webhook

In the store: Settings, Webhooks. Point the webhook at:

```text
https://<medusa-backend>/hooks/payment/btcpay_btcpay
```

Medusa 2.21.0 builds the provider id as `pp_` plus that path segment, which matches `pp_btcpay_btcpay`. The `pp_` prefix in the URL itself is documented as working only from Medusa 2.21.2. This repo is 2.21.0, so do not use `/hooks/payment/pp_btcpay_btcpay`.

Put the webhook secret in `BTCPAY_WEBHOOK_SECRET`. Subscribe at least to:

- `InvoiceSettled`
- `InvoiceProcessing`
- `InvoiceExpired`
- `InvoiceInvalid`
- `InvoiceReceivedPayment`
- `InvoicePaymentSettled`

`POST /hooks/payment/btcpay_btcpay` keeps the raw body (`preserveRawBody: true` on that route). Express stores those bytes on `req.rawBody` before it parses JSON. Middleware computes HMAC-SHA256 over that buffer, not over `JSON.stringify` of the parsed object. The header is `BTCPay-Sig: sha256=` plus the lowercase hex digest, keyed with `BTCPAY_WEBHOOK_SECRET` (<https://docs.btcpayserver.org/Development/GreenFieldExample-NodeJS/>). The comparison uses `crypto.timingSafeEqual` after a length check. A missing header, a missing raw body, or a bad signature returns HTTP 401 `{ "message": "Unauthorized" }` and does not call the route. Nothing is queued, stored, or processed. The provider checks the same raw-body signature again before it re-fetches the invoice. A valid signature is still not trusted for the amount or the status: the backend loads the invoice again with `GET /api/v1/stores/{storeId}/invoices/{invoiceId}` and compares it to the `btcpay_payment` row.

## Environment variables

Set these on the Medusa backend only. Leave them empty in `.env.template`. Do not prefix them with `NEXT_PUBLIC_`. The provider never writes them to logs.

| Variable | Purpose |
| --- | --- |
| `BTCPAY_URL` | BTCPay base URL, no path, for example `https://btcpay.example` |
| `BTCPAY_STORE_ID` | Store id the API key is scoped to |
| `BTCPAY_API_KEY` | Greenfield API key |
| `BTCPAY_WEBHOOK_SECRET` | Secret shown when the webhook is created. Also the HMAC key for stored IP and session hashes when `BTCPAY_PII_HMAC_SECRET` is empty |
| `BTCPAY_PII_HMAC_SECRET` | Optional dedicated key for those hashes. Leave empty to use the webhook secret |
| `BTCPAY_MAX_PENDING_PER_CART` | Kept for compatibility. The database allows one open invoice per cart, so a higher value is ignored |
| `BTCPAY_MAX_PENDING_PER_SESSION` | Open invoices allowed for one Medusa payment session. Default `1` |
| `BTCPAY_MAX_PENDING_PER_CUSTOMER` | Open invoices allowed for one logged-in customer. Default `2`. Guests are not grouped together |
| `BTCPAY_MAX_NEW_INVOICES_PER_IP` | New invoices allowed from one IP inside the window. Default `5` |
| `BTCPAY_NEW_INVOICE_WINDOW_SECONDS` | Length of that IP window. Default `3600` |
| `BTCPAY_MAX_UNITS_PER_PENDING_ORDER` | Largest unit count on one pending invoice. Default `4` |
| `BTCPAY_STATUS_MAX_REQUESTS` | Status polls allowed per IP and per cart inside the window. Default `30` |
| `BTCPAY_STATUS_WINDOW_SECONDS` | Length of that status window. Default `60` |

Blank values keep the defaults. If any of the four connection variables is missing or blank, Medusa does not register the provider and the storefront will not offer it.

An open invoice holds stock until it expires, is canceled, or settles. The hold is skipped when a limit blocks the invoice, and the API returns `code: "BTCPAY_PENDING_LIMIT"` with no counts in the message. The storefront shows "Ya tienes un pago pendiente, termínalo o espera a que venza". `GET /store/btcpay/status` includes `expires_at` from the invoice `expirationTime` so the return page can count down the hold. BTCPay's store FAQ default timer is 15 minutes when the response omits `expirationTime`: <https://docs.btcpayserver.org/FAQ/Stores/>

Pending rows live in `btcpay_payment`. Lookup indexes are `(provider, status, cart_id)` and `(provider, status, customer_id)`.

Open rows in this table use status `holding` (the slot is taken and BTCPay has not returned an invoice yet) and `pending` (the invoice exists and is not settled). Those are not BTCPay's `New` and `Processing` statuses.

The database enforces one open row per cart with partial unique index `IDX_btcpay_payment_open_cart_unique` on `cart_id` where `status IN ('holding', 'pending')` and `deleted_at IS NULL`. A second insert hits Postgres `23505` and the provider returns `BTCPAY_PENDING_LIMIT` without reserving stock. `BTCPAY_MAX_PENDING_PER_CART` cannot raise that cap.

`IDX_btcpay_payment_provider_invoice_id_unique` is `UNIQUE (provider, invoice_id)` where `invoice_id IS NOT NULL` and `deleted_at IS NULL`. It was not on the table before. Holding rows keep a null invoice id, and Postgres allows more than one null, so the slot can be taken before BTCPay responds. After the invoice id is stored, a second row for that provider and invoice is rejected.

Session and customer caps are counts, so the insert transaction takes `pg_advisory_xact_lock` on the session hash and, when the shopper is logged in, on the customer id. The lock is held for the count and the insert. Guests are not locked together.

USD amounts are integer cents (`amount_cents` integer, `unit_count` integer). There is no float column and no sats column, because this integration does not persist a bitcoin amount. A sats value would be `bigint`.

The raw IP and the raw Medusa payment session id are not stored. Both are HMAC-SHA256 hex, keyed with `BTCPAY_PII_HMAC_SECRET` or, if that is empty, `BTCPAY_WEBHOOK_SECRET`. The invoice metadata sent to BTCPay still carries the payment session id so the return check can match it. A daily job (`btcpay-redact-personal-data`, cron `0 3 * * *`) nulls `ip_hash` and `payment_session_hash` on closed rows (`settled`, `expired`, `invalid`, `canceled`) older than 30 days, and nulls the session hash on claim rows older than 30 days. The log line is the number of rows updated.

`GET /store/btcpay/status` reads `cart_id` and `payment_session_id` only. An invoice id in the query is ignored. The payment session must belong to that cart. If the cart is assigned to a customer, the caller must be that customer. The JSON body is `state`, `message`, and sometimes `expires_at` and `order_id`. It does not include a name, email, address, or invoice id. Requests are limited per IP and per cart (`BTCPAY_STATUS_MAX_REQUESTS`, default 30, and `BTCPAY_STATUS_WINDOW_SECONDS`, default 60). A blocked caller gets HTTP 429 and a message with no counts.

### Status JSON the return page reads

`expires_at` is omitted when BTCPay did not send `expirationTime`. `order_id` is present only after the cart has an order.

| Situation | HTTP | JSON |
| --- | --- | --- |
| Invoice `New`, row matches | 200 | `{ "state": "pending", "message": "pago pendiente de confirmación", "expires_at": "<iso>" }` |
| Invoice `Processing` and additional status `None`, row matches | 200 | `{ "state": "processing", "message": "pago pendiente de confirmación", "expires_at": "<iso>" }` |
| Invoice `Settled` with `None` or `Marked`, row matches | 200 | `{ "state": "settled", "message": "Pago confirmado.", "expires_at": "<iso>" }` |
| Same, and the cart already has an order | 200 | `{ "state": "settled", "message": "Pago confirmado.", "order_id": "<order id>" }` |
| Invoice `Expired` | 200 | `{ "state": "expired", "message": "El pago con Bitcoin no se completó. Puedes intentar de nuevo.", "expires_at": "<iso>" }` |
| Invoice `Invalid` | 200 | `{ "state": "invalid", "message": "El pago con Bitcoin no se completó. Puedes intentar de nuevo.", "expires_at": "<iso>" }` |
| `PaidPartial` | 200 | `{ "state": "partial", "message": "El pago con Bitcoin no se completó. Puedes intentar de nuevo.", "expires_at": "<iso>" }` |
| `PaidLate` | 200 | `{ "state": "paid_late", "message": "El pago llegó tarde y está en revisión. No se confirmó automáticamente.", "expires_at": "<iso>" }` |
| `PaidOver` | 200 | `{ "state": "paid_over", "message": "El pago supera el total y está en revisión. No se confirmó automáticamente.", "expires_at": "<iso>" }` |
| Poll limit | 429 | `{ "state": "limit_reached", "message": "Demasiadas consultas. Espera un momento e inténtalo de nuevo." }` |
| Store id, cents, currency, or cart does not match the row | 200 | `{ "state": "mismatch", "message": "El pago no coincide con este carrito." }` |
| Cart total changed | 200 | `{ "state": "cart_changed", "message": "El total del carrito cambió. Vuelve al checkout para generar un nuevo pago." }` |
| Missing cart, or the session is not this caller's | 200 | `{ "state": "failed", "message": "No encontramos el carrito." }` |
| BTCPay env is unset | 200 | `{ "state": "failed", "message": "Los pagos con Bitcoin no están habilitados." }` |
| Cart is not Ecuador | 200 | `{ "state": "failed", "message": "Bitcoin solo está disponible para Ecuador." }` |
| Cart has no BTCPay session | 200 | `{ "state": "failed", "message": "Este carrito no tiene un pago con Bitcoin." }` |

The return page (`btcpay-return`) shows `pago pendiente de confirmación` and the countdown for `pending` and `processing` (`data-testid="btcpay-pending-confirmation"`). For `settled` with `order_id` it redirects to `/{country}/order/{order_id}/confirmed`. For `settled` without `order_id` it calls `placeOrder` and keeps the pending sentence while that runs. Every other state sets `data-testid="btcpay-payment-error"` and shows `message`. `paid_late` and `paid_over` use that error paragraph. They do not show "Pago confirmado."

The storefront SDK throws on HTTP 429, and the return page catch keeps `pago pendiente de confirmación` on the waiting screen. It does not render the `limit_reached` body. The checkout payment step is a different limit: `BTCPAY_PENDING_LIMIT` shows "Ya tienes un pago pendiente, termínalo o espera a que venza".

The return URL sent to BTCPay must use an origin already listed in `STORE_CORS`, and the path must end with `/checkout/btcpay/return`.

After the variables are set, run the backend migrations so `btcpay_invoice_claim` and `btcpay_payment` exist (`pnpm exec medusa db:migrate` from `apps/backend`). The claim table's `invoice_id` unique index stops a webhook and the shopper's return from creating two orders for one invoice.

The Ecuador region itself is created by the region seed, not by this payment provider. After that region exists, run `src/scripts/enable-btcpay-on-ec.ts`. It appends `pp_btcpay_btcpay` to region `ec` when the four connection variables are set, and it leaves every other provider in place. You can also enable that provider on Ecuador in the Medusa admin. Do not enable it on other regions.

## Checkout flow

1. On the payment step the shopper chooses **Pagar con Bitcoin / Lightning** (`data-testid="btcpay-payment-option"`).
2. Medusa creates a payment session. The provider creates a USD invoice:
   - `POST /api/v1/stores/{storeId}/invoices`
   - Body includes `amount` (two-decimal USD string), `currency: "USD"`, `metadata.orderId` / `metadata.cartId` (the cart id), `metadata.paymentSessionId`, `metadata.amountCents`, and `checkout.redirectURL` plus `checkout.redirectAutomatically: true`.
   - Docs: <https://docs.btcpayserver.org/Development/ecommerce-integration-guide/> and <https://docs.btcpayserver.org/Developers/api/examples/>
3. The browser is sent to the invoice `checkoutLink` on the BTCPay origin. The modal (`{BTCPAY_URL}/modal/btcpay.js`) is documented by BTCPay and is not what this storefront uses.
4. BTCPay sends the shopper back to `/{country}/checkout/btcpay/return`. That page ignores payment status in the query string. It asks the backend `GET /store/btcpay/status?cart_id=...`, which loads the cart and re-fetches the invoice.
5. Until the invoice is `Settled`, the page shows **pago pendiente de confirmación** (`data-testid="btcpay-pending-confirmation"`).
6. When the invoice is settled, the page completes the cart. An `InvoiceSettled` webhook does the same through Medusa's payment webhook. Authorization requires every one of these to match the `btcpay_payment` row: invoice `storeId` equals `BTCPAY_STORE_ID`, the amount in integer US cents, currency USD, and `cart_id` in the invoice metadata. A mismatch does not authorize, including when BTCPay says `Settled`. The log line is `BTCPay confirmation rejected: <reason code>` and does not include an id or an amount.
7. The first confirmation inserts a row in `btcpay_invoice_claim`. The unique `invoice_id` makes the other confirmation fail instead of placing a second order.

### How invoice states are treated

BTCPay's guide says to read both `status` and `additionalStatus`: <https://docs.btcpayserver.org/Development/ecommerce-integration-guide/>

| Server-side state | What we do |
| --- | --- |
| `Settled` and additional status `None`, and the row matches | Authorize and, inside Medusa, mark the payment captured. The bitcoin is already settled; capture does not move more funds. |
| `Settled` and `Marked`, and the row matches | Authorize. A BTCPay store admin marked the invoice settled. |
| `PaidOver` on any status, including `Settled` | Manual review. Do not auto-authorize. The hold stays so stock is not released while a person checks the overpay. |
| `PaidLate` on any status, including `Settled` | Manual review. Do not auto-authorize. BTCPay accepted a payment after expiry; this store does not complete the order from that flag. The hold stays. |
| `Processing` or `New` with additional status `None`, and the row matches | Do not authorize. The return page stays on "pago pendiente de confirmación". The webhook action is `not_supported`, so Medusa does not complete the cart. `Processing` means the payment was seen and is waiting for confirmations. |
| `PaidPartial` on any status | Do not authorize. The invoice is underpaid. |
| `Expired` | Do not authorize. |
| `Invalid` | Do not authorize. |
| `New`, `Processing`, `Expired`, or `Invalid` with `Marked`, `PaidPartial`, `PaidLate`, or `PaidOver` | Do not authorize. `PaidLate` and `PaidOver` are the manual-review cases above. |
| Store id, integer cents, USD, or cart id does not match the `btcpay_payment` row | Do not authorize, even when the invoice is `Settled`. The log is a reason code only. |

## Cancel and refund

BTCPay refunds are pull payments. `POST /api/v1/stores/{storeId}/invoices/{invoiceId}/refund` returns a pull payment whose `viewLink` is the page where the customer claims the refund. This code uses `refundVariant: "Custom"` with `customAmount` and `customCurrency: "USD"`. It does not broadcast a bitcoin transaction. The API key permission above creates a non-approved pull payment when the payout currency is not USD, so someone still has to approve the payout in BTCPay, and the customer has to open `viewLink`.

If BTCPay does not return `viewLink`, the refund call fails with that explanation instead of pretending the customer was paid.

Cancel:

- `New` (nothing paid): the provider marks the invoice `Invalid`.
- `Processing`: cancel throws. A payment has been seen. Wait for `Settled` and refund, or wait for expiry.
- `Settled`: cancel throws. Use refund. Cancel cannot claw bitcoin back.
- `Expired` or `Invalid`: cancel changes nothing and moves no funds.

The refund route and the `Invalid` mark are taken from the current BTCPay Server Greenfield controller (`GreenfieldInvoiceController`), not from an older example that sent `paymentMethod`. Current source accepts `payoutMethods` (and still accepts obsolete `payoutMethodId`) and, if neither is sent, uses the invoice's default payout method. This integration omits `payoutMethods` for that reason.

## Browser domains and CSP

Replace `<btcpay-origin>` below with the origin of `BTCPAY_URL` (scheme, host, and port only). Example: `BTCPAY_URL=https://btcpay.example` gives `https://btcpay.example`.

This storefront does not load BTCPay JavaScript and does not embed an iframe. Checkout is a full-page redirect to `checkoutLink` on that origin. The modal (`<btcpay-origin>/modal/btcpay.js`) is documented and is not used.

Origins Security should add for the storefront CSP in the current integration:

| Directive | Origin | Why |
| --- | --- | --- |
| `form-action` | `<btcpay-origin>` | Checkout page. The invoice URL is `{BTCPAY_URL}/i/{invoiceId}` on this origin. |
| Navigation, if the policy restricts it | `<btcpay-origin>` | Same full-page redirect. |

Not required on the storefront for this integration:

| Directive | Origin | Why it is omitted |
| --- | --- | --- |
| `script-src` | none | The modal script is not loaded. |
| `frame-src` | none | No iframe and no modal. |
| `connect-src` | none | The storefront polls its own backend. It does not open a socket to BTCPay. |

BTCPay's own checkout page does open a websocket. BTCPay's CSP adds `connect-src` for `wss://<host>` when the page is served over https, and `ws://<host>` when it is served over http, on the same host as the request ([CSP change](https://github.com/btcpayserver/btcpayserver/commit/fc4e47cec608cc3dba24b19d0145ac69320b975e)). That socket belongs to the BTCPay origin, not the storefront. The storefront policy does not need it unless checkout is embedded later.

If the modal is enabled later, the ecommerce guide says to load `{BTCPAY_URL}/modal/btcpay.js` ([guide](https://docs.btcpayserver.org/Development/ecommerce-integration-guide/)). That would add:

| Directive | Origin |
| --- | --- |
| `script-src` | `<btcpay-origin>` |
| `frame-src` | `<btcpay-origin>` |
| `connect-src` | `wss://<btcpay-host>` (or `ws://<btcpay-host>` when `BTCPAY_URL` is http) |

The shopper returns to the storefront origin in `checkout.redirectURL`, which must also be in `STORE_CORS`. Webhook and API calls are server to server.

## What was checked against the docs, and what was not

Checked against docs.btcpayserver.org and the current BTCPay Server source on GitHub:

- Create invoice: `POST /api/v1/stores/{storeId}/invoices` with `amount`, `currency`, `metadata`, `checkout.redirectURL`, `checkout.redirectAutomatically`.
- Read invoice: `GET /api/v1/stores/{storeId}/invoices/{invoiceId}`.
- Mark invalid: `POST /api/v1/stores/{storeId}/invoices/{invoiceId}/status` with `{ "status": "Invalid" }`.
- Refund: `POST /api/v1/stores/{storeId}/invoices/{invoiceId}/refund`, response includes `viewLink` from `CreatePullPaymentData`.
- Webhook header `BTCPay-Sig` as `sha256=<hex hmac of the raw body>`.
- Invoice `status` and `additionalStatus` values from the ecommerce integration guide.
- Auth header `Authorization: token <api key>`.

Not verified against a running BTCPay Server or with real funds:

- A live webhook delivery, including the exact JSON field set (`deliveryId`, `invoiceId`, `type`, `storeId`, `metadata`). Those names come from BTCPay's own issue reports and from the re-fetched invoice, which is what we act on. The rendered OpenAPI page at <https://docs.btcpayserver.org/API/Greenfield/v1/> did not load as static HTML.
- Whether every BTCPay version echoes custom metadata keys (`cartId`, `paymentSessionId`, `amountCents`) unchanged on `GET` invoice. If a version drops them, the webhook will not authorize and the return page will show a mismatch instead of completing the order.
- The modal script and its `postMessage` statuses (`complete`, `paid`, `expired`). They are quoted from the ecommerce guide only.
- End-to-end checkout in a browser, or `medusa db:migrate` on a production database. Unit tests cover the provider with a mocked HTTP client. Postgres integration tests apply the migrations, including `down`, and check concurrent cart inserts, the session advisory lock, HMAC storage, 30-day redaction, and one claim when webhook and return confirmation run together. The claim unique index is `IDX_btcpay_invoice_claim_invoice_id_unique`. The payment unique index is `IDX_btcpay_payment_provider_invoice_id_unique`.
- A live invoice `expirationTime` payload. The countdown reads that field when BTCPay sends a unix timestamp or an ISO date. The 15 minute fallback is the store FAQ default, not a value measured on an instance.
- Inventory reservation against a running Medusa database. The provider calls the inventory module when a sales channel has a stock location and the variant manages inventory. Unit tests assert that a blocked invoice never calls that reservation step.
- The deployment FAQ's 2 GB / 80 GB numbers versus the Docker specs page's 4 GB / 2 cores / 50 GB starting point. Both are linked above; the specs page is the one to follow.
