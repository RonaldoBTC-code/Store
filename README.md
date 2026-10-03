# Gato Gang Store

Gato Gang · Medusa v2 storefront — dad hats, scroll editorial, SEO cableado

Storefront Gato Gang sobre Medusa v2: home editorial (hero + traits + drop), store dark, titles/metas/H1 desde `seo/`, packshots con alts. Práctica del evento: https://github.com/martinruizn/supaday-usfq

**Repo:** [github.com/RonaldoBTC-code/Store](https://github.com/RonaldoBTC-code/Store)  
**Preview local:** `http://localhost:8000/ec`

---

## Project pitch

**Gato Gang** es una marca de dad hats streetwear: silueta curva, corona unstructured y parche bordado en relieve. Este repo es la tienda — **Medusa v2** + storefront Next — pensada como drop, no como catálogo genérico.

Home en `/ec`: hero de estudio → trait caps **Parche / Visor / Material** → **El drop completo**. Marca oscura, menú limpio, packshots true-alpha (sin damero ni placas blancas).

---

## What was built

- **Hero** con video de estudio (`transparente-3-fondo-negro.mp4`) y packshots true-alpha. Sin damero, sin placas blancas.
- **Home:** hero → trait caps **Parche / Visor / Material** → **El drop completo** (Fish Hug, Lo-Fi Cat, Busy Dog, Cat Online).
- **Dark brand** Gato Gang: ink, acento neon, logo visible.
- **Menú limpio:** HOME / STORE / ACCOUNT / CART sobre overlay negro (sin Sort / Size / Color).
- **Store** (`/ec/store`): grilla de packshots sobre ink. Sin filtros Size/Color; solo sort compacto.
- **SEO** cableado desde `seo/` + `store/apps/storefront/src/lib/seo/copy.ts` (titles, metas, H1, alts). El copy de producto no se reescribe aquí.

SKUs del drop: **Fish Hug · Lo-Fi Cat · Busy Dog · Cat Online**.

---

## Screenshots

Capturas del storefront en `http://localhost:8000/ec`.

### Hero / home

![Hero Gato Gang — Street. Suave. Un poco picara.](docs/screenshots/01-hero-home.webp)

### Trait chapter — Parche

![Capítulo Parche — bordado en relieve sobre dad hat negra](docs/screenshots/02-trait-parche.webp)

### El drop completo

![El drop completo — cuatro packshots true-alpha sobre ink](docs/screenshots/03-drop-collection.webp)

### Store grid

![Store /ec/store — grilla oscura sin filtros Size/Color](docs/screenshots/04-store-grid.webp)

### Clean menu

![Menú HOME / STORE / ACCOUNT / CART](docs/screenshots/05-clean-menu.webp)

---

## Practice / event repo

Este Store creció a partir de la práctica de **Supaday USFQ**:

**[github.com/martinruizn/supaday-usfq](https://github.com/martinruizn/supaday-usfq)**

El workshop fue el punto de partida (Medusa, catálogo, storefront). Gato Gang es el proyecto que Ramoide armó después: misma base de práctica, marca y drop propios.

Crédito a los organizadores de Supaday USFQ y al repo de práctica.

---

## Repo

- **Store (este proyecto):** [https://github.com/RonaldoBTC-code/Store](https://github.com/RonaldoBTC-code/Store)
- **Práctica Supaday USFQ:** [https://github.com/martinruizn/supaday-usfq](https://github.com/martinruizn/supaday-usfq)

---

## How to run

Desde `store/` (Node 20+, PostgreSQL 15+, pnpm 10+):

```bash
# backend — http://localhost:9000  (admin: /app)
cd apps/backend
cp .env.template .env   # set DATABASE_URL
pnpm migrate            # schema + fresh Ecuador store seed
pnpm seed:ec            # safe to re-run: USD, region ec, IVA 15%, shipping
# FIX_EC_ZONES and FIX_EC_SHIPPING_PROFILE apply only when setup runs:
# pnpm seed:ec, or the first migrate before initial-data-seed.ts has finished_at.
# Remove them from the environment as soon as the fix has been applied.
# If left set, the next seed:ec or a recreated database deletes zones or moves
# shipping options again without anyone asking.
# Setting a flag and deploying applies nothing after that script_migrations row is finished.
# In production, setup logs that same warning while either flag is still true.
# If that script's preflight blocks, finished_at stays unset and migrate keeps failing.
# Fix the conflict the error names, then run pnpm migrate again.
# Medusa serializes migration scripts with pg_try_advisory_lock.
# ensureEcuadorStore also locks key 7482910365542101 so seed:ec can run beside
# another seed:ec or the first migrate. The sales channel has no unique index.
# The lock borrows PG_CONNECTION via acquireConnection and pg_try_advisory_lock.
# A miss returns the connection and retries with jitter for up to five minutes.
# seed:ec and migrate must connect directly to Postgres or through a session-mode pooler.
# The advisory lock is session-scoped and does not protect behind PgBouncer or the
# Supabase transaction-mode pooler (port 6543).
# Real certificate verification arrives with PR #8. Merge order is #10, then #8, then #6.
# Moving the shipping option leaves products on the old profile without it.
# fill TODO sku / price / stock in src/data/cap-products.ts
pnpm seed:caps
pnpm catalog:sync
pnpm exec medusa develop

# storefront — http://localhost:8000  (home: /ec)
cd apps/storefront
cp .env.template .env.local
# NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
# NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000
# NEXT_PUBLIC_DEFAULT_REGION=ec
pnpm dev
```

O desde `store/`: `pnpm dev` levanta ambos.

---

## PRs / timeline

1. **SEO** — titles, metas, H1 y alts desde `seo/` + `copy.ts` (#1)
2. **Chapter scroll** — home editorial (#2)
3. **Assets / brand** — hero de estudio, true-alpha, Gato Gang dark (#3)
4. **Traits + menu** — Parche / Visor / Material, menú HOME/STORE/ACCOUNT/CART, store sin Size/Color (#4)
