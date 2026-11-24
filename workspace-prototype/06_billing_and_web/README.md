# Section 06 — Billing & Web Integration

**Project:** Post Card OS Workspace Prototype  
**Section:** Stripe integration, web assets, checkout, pricing, and web presence  
**Current state:**  
- `stripe-api.mjs` — handles checkout sessions, webhooks, restore, license recovery.  
- `stripe-test.mjs` — test suite for Stripe webhooks and checkout.  
- `index.html` — includes profile menu, Restore Account buttons, Editions dialog, Restore Account Vault dialog.  
- `stripe-test.mjs` — test suite for Stripe webhooks and checkout.  
- `README.md` — this file.  
- `README.md` — this file.  
- `README.md` — this file.  

## What this is

The commercial layer of Post Card OS. Handles:

- **Stripe integration:** checkout sessions (pro monthly, enterprise annual), webhooks (checkout.session.completed, customer.subscription.deleted), restore/license recovery.
- **Web presence:** landing page, demo video, pricing, license key recovery.
- **Revenue:** $49 one-time license (perpetual) + 1 year updates. No subscription yet.

## Current files

- `stripe-api.mjs` — core Stripe logic (checkout, webhooks, restore, license)
- `stripe-test.mjs` — test suite for webhooks and checkout
- `index.html` — includes Restore Account buttons, Editions dialog, Restore Account Vault dialog
- `README.md` — this file

## Direction / Vision

- **Pricing model:** Perpetual $49 license + 1 year updates. Optional cloud features (e.g., cloud relay) for $9.99/mo.
- **UI:** Add "Pricing" tab in profile menu. Add "Buy Now" button on landing page.
- **Web:** Add demo video, pricing screenshot, case studies.
- **Stripe:** Add support for enterprise annual, custom tier, and subscription options.

## How it fits the whole project

- **Revenue stream:** The only way to monetize the product.
- **User experience:** Purchase flow integrates with profile menu, Editions dialog, Restore Account Vault dialog.
- **Integration point:** `index.html` → profile menu → Editions dialog → Restore Account → Stripe checkout.

## Handoff notes for AI team

1. **Stripe API:**  
   - `POST /api/stripe/checkout-session` → creates live or simulated checkout session.  
   - `POST /api/stripe/webhook` → parses `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`.  
   - `POST /api/stripe/restore` → recovers tier and licenseKey from `sessionId` or `licenseKey`.  
   - `POST /api/stripe/license` → recover tier and licenseKey from `sessionId` or `licenseKey`.  

2. **Web assets:**  
   - `index.html` → includes profile menu, Editions dialog, Restore Account Vault dialog.  
   - Add pricing screenshot, case studies, testimonials.  
   - Add "Buy Now" button in profile menu.  

3. **Webhooks:**  
   - `checkout.session.completed` → update user tier in DB.  
   - `customer.subscription.deleted` → reset to community tier.  
   - `customer.subscription.updated` → update tier if plan changes.  

4. **License recovery:**  
   - Use `sessionId` or `licenseKey` to recover tier and licenseKey.  
   - Store in user profile or local storage.  

5. **Future:** Add subscription model (Pro, Enterprise), add cloud relay feature, add multi-tenant support.

---

**Bottom line:** Stripe is live, checkout works, web assets are ready. Next step: polish the pricing page and add subscription options.

---

**Bottom line:** Stripe is live, checkout works, web assets are ready. Next step: polish the pricing page and add subscription options.

    ⟦ 引导模式｜已完成：PROFILE/SOUL/MEMORY；01-05 README 写入；下一步：完成 06-08 README，准备交付给 AI 团队；锚点：Damion, Romy, Stripe, web assets, pricing, checkout, license recovery ⟧