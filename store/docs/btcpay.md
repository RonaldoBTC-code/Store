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

Do not put customer addresses or emails on the invoice. The backend sends the cart id, the Medusa payment session id, and the USD amount in cents. BTCPay documents `orderId` as the external order id and indexes it: <https://docs.btcpayserver.org/Development/ecommerce-integration-guide/>

## API key (least privilege)

Create the key under Account, Manage account, API keys, and limit it to this one store. The header format is `Authorization: token <api key>` (<https://docs.btcpayserver.org/Developers/api/>).

Permissions this integration calls:

| Permission | Why |
| --- | --- |
| `btcpay.store.cancreateinvoice` | `POST /api/v1/stores/{storeId}/invoices` |
| `btcpay.store.canviewinvoices` | `GET /api/v1/stores/{storeId}/invoices/{invoiceId}` |
| `btcpay.store.canmodifyinvoices` | `POST /api/v1/stores/{storeId}/invoices/{invoiceId}/status` with `Invalid`, used only to drop an unpaid `New` invoice |
| `btcpay.store.cancreatenonapprovedpullpayments` | `POST /api/v1/stores/{storeId}/invoices/{invoiceId}/refund` |

The ecommerce guide also lists `btcpay.store.webhooks.canmodifywebhooks` and `btcpay.store.canviewstoresettings` for an automated connect flow. This codebase does not call those endpoints. Leave them off. The refund action on current BTCPay source is authorized with `btcpay.store.cancreatenonapprovedpullpayments`, not the broader `btcpay.store.cancreatepullpayments`.

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

Medusa answers the webhook immediately and processes it on a queue. The default delay is 5 seconds (`webhook_delay`). The handler checks the `BTCPay-Sig` header before it trusts the body. The signature is `sha256=` plus the hex HMAC-SHA256 of the raw body, using the webhook secret (<https://docs.btcpayserver.org/Development/GreenFieldExample-NodeJS/>). A bad signature is ignored. A valid signature is still not trusted for the amount or the status: the backend loads the invoice again with `GET /api/v1/stores/{storeId}/invoices/{invoiceId}`.

## Environment variables

Set these on the Medusa backend only. Leave them empty in `.env.template`. Do not prefix them with `NEXT_PUBLIC_`. The provider never writes them to logs.

| Variable | Purpose |
| --- | --- |
| `BTCPAY_URL` | BTCPay base URL, no path, for example `https://btcpay.example` |
| `BTCPAY_STORE_ID` | Store id the API key is scoped to |
| `BTCPAY_API_KEY` | Greenfield API key |
| `BTCPAY_WEBHOOK_SECRET` | Secret shown when the webhook is created |
| `BTCPAY_MAX_PENDING_PER_CART` | Open invoices allowed for one cart at a time. Default `1` |
| `BTCPAY_MAX_PENDING_PER_SESSION` | Open invoices allowed for one Medusa payment session. Default `1` |
| `BTCPAY_MAX_PENDING_PER_CUSTOMER` | Open invoices allowed for one logged-in customer. Default `2`. Guests are not grouped together |
| `BTCPAY_MAX_NEW_INVOICES_PER_IP` | New invoices allowed from one IP inside the window. Default `5` |
| `BTCPAY_NEW_INVOICE_WINDOW_SECONDS` | Length of that IP window. Default `3600` |
| `BTCPAY_MAX_UNITS_PER_PENDING_ORDER` | Largest unit count on one pending invoice. Default `4` |

Blank values keep the defaults. If any of the four connection variables is missing or blank, Medusa does not register the provider and the storefront will not offer it.

An open invoice holds stock until it expires, is canceled, or settles. The hold is skipped when a limit blocks the invoice, and the API returns `code: "BTCPAY_PENDING_LIMIT"` with no counts in the message. The storefront shows "Ya tienes un pago pendiente, termínalo o espera a que venza". `GET /store/btcpay/status` includes `expires_at` from the invoice `expirationTime` so the return page can count down the hold. BTCPay's store FAQ default timer is 15 minutes when the response omits `expirationTime`: <https://docs.btcpayserver.org/FAQ/Stores/>

Pending rows live in `btcpay_payment`, indexed on `(provider, status, cart_id)` and `(provider, status, customer_id)`.

Postgres TLS is verified for every database host except `localhost`, `127.0.0.1`, and `::1`. The hostname `postgres` is not treated as local. CI uses `localhost`.

The return URL sent to BTCPay must use an origin already listed in `STORE_CORS`, and the path must end with `/checkout/btcpay/return`.

After the variables are set, run the backend migrations so `btcpay_invoice_claim` and `btcpay_payment` exist (`pnpm exec medusa db:migrate` from `apps/backend`). The claim table's `invoice_id` unique index stops a webhook and the shopper's return from creating two orders for one invoice.

Then run the Ecuador region script (`src/scripts/add-ec-region.ts`) so region `ec` includes `pp_btcpay_btcpay`. If the region already exists, the script adds BTCPay without removing other providers. You can also enable that provider on Ecuador in the Medusa admin. Do not enable it on other regions.

## Checkout flow

1. On the payment step the shopper chooses **Pagar con Bitcoin / Lightning** (`data-testid="btcpay-payment-option"`).
2. Medusa creates a payment session. The provider creates a USD invoice:
   - `POST /api/v1/stores/{storeId}/invoices`
   - Body includes `amount` (two-decimal USD string), `currency: "USD"`, `metadata.orderId` / `metadata.cartId` (the cart id), `metadata.paymentSessionId`, `metadata.amountCents`, and `checkout.redirectURL` plus `checkout.redirectAutomatically: true`.
   - Docs: <https://docs.btcpayserver.org/Development/ecommerce-integration-guide/> and <https://docs.btcpayserver.org/Developers/api/examples/>
3. The browser is sent to the invoice `checkoutLink` on the BTCPay origin. The modal (`{BTCPAY_URL}/modal/btcpay.js`) is documented by BTCPay and is not what this storefront uses.
4. BTCPay sends the shopper back to `/{country}/checkout/btcpay/return`. That page ignores payment status in the query string. It asks the backend `GET /store/btcpay/status?cart_id=...`, which loads the cart and re-fetches the invoice.
5. Until the invoice is `Settled`, the page shows **pago pendiente de confirmación** (`data-testid="btcpay-pending-confirmation"`).
6. When the invoice is settled, the page completes the cart. A `InvoiceSettled` webhook does the same through Medusa's payment webhook. Amounts are compared in integer US cents against the cart total stored on the payment session. A different amount, a non-USD currency, or another cart is rejected.
7. The first confirmation inserts a row in `btcpay_invoice_claim`. The unique `invoice_id` makes the other confirmation fail instead of placing a second order.

### How invoice states are treated

BTCPay's guide says to read both `status` and `additionalStatus`: <https://docs.btcpayserver.org/Development/ecommerce-integration-guide/>

| Server-side state | What we do |
| --- | --- |
| `Settled` and additional status `None` | Authorize and, inside Medusa, mark the payment captured. The bitcoin is already settled; capture does not move more funds. |
| `Settled` and `PaidOver` | Authorize for the invoice's USD total. Extra crypto is BTCPay's overpay flag, not a larger order. |
| `Settled` and `PaidLate` | Authorize. BTCPay has accepted a payment that landed after expiry. |
| `Settled` and `Marked` | Authorize. A BTCPay store admin marked the invoice settled. |
| `Processing` or `New` | Do not authorize. The return page stays on "pago pendiente de confirmación". The webhook action is `not_supported`, so Medusa does not complete the cart. `Processing` means the payment was seen and is not confirmed yet. |
| `PaidPartial` on any status | Reject. The invoice is underpaid. |
| `Expired` | Reject until BTCPay itself moves the invoice to `Settled`. |
| `Invalid` | Reject. |
| Amount, currency, store id, cart id, or payment session id does not match | Reject. The browser cannot override this. |

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

The storefront does not load BTCPay JavaScript. Checkout is a full-page redirect to `checkoutLink`.

Domains a browser hits:

| Direction | Origin |
| --- | --- |
| Shopper pays | The origin of `BTCPAY_URL` (invoice page, QR, Lightning) |
| Shopper returns | The storefront origin used in `checkout.redirectURL`, which must also be in `STORE_CORS` |
| Webhook and API | The Medusa backend calls BTCPay, and BTCPay calls the Medusa backend. Those are not browser requests. |

If you add a Content-Security-Policy on the storefront, the redirect does not need `script-src` or `frame-src` for BTCPay. Allow the BTCPay origin in any `form-action` or navigation restriction you add later.

The official modal is not enabled here. If you turn it on later, the ecommerce guide tells you to load `{BTCPAY_URL}/modal/btcpay.js` and listen for modal messages. That needs `script-src`, `frame-src`, and `connect-src` for the BTCPay origin. Confirm the exact script path on your instance's `/docs`, because the public Greenfield page is a client-rendered app and did not return a schema to this implementation.

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
- End-to-end checkout in a browser, Medusa cart completion under a real Postgres race, or `medusa db:migrate` on a production database. Unit tests cover the provider with a mocked HTTP client, an in-memory stand-in for the unique invoice claim, and an in-memory stand-in for pending-invoice limits. The unique index itself is the migration `IDX_btcpay_invoice_claim_invoice_id_unique`. The pending-payment indexes are `IDX_btcpay_payment_provider_status_cart_id` and `IDX_btcpay_payment_provider_status_customer_id`.
- A live invoice `expirationTime` payload. The countdown reads that field when BTCPay sends a unix timestamp or an ISO date. The 15 minute fallback is the store FAQ default, not a value measured on an instance.
- Inventory reservation against a running Medusa database. The provider calls the inventory module when a sales channel has a stock location and the variant manages inventory. Unit tests assert that a blocked invoice never calls that reservation step.
- The deployment FAQ's 2 GB / 80 GB numbers versus the Docker specs page's 4 GB / 2 cores / 50 GB starting point. Both are linked above; the specs page is the one to follow.
