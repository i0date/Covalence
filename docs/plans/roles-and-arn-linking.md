# Roles, the merchant journey, and ARN linking — plan

Status: draft for review. Nothing here is built yet.

## 1. What we're solving

- Merchants (and later acquirers) need to fight chargebacks filed against them. Today that stops at Desk's Merchant / Acquirer toggle: it writes the letters, but there's no queue, no tracking after the response, and nothing after a win.
- We don't want a hard "merchant mode" that hides the main tools. Merchants will grow into Triage, Trio and Duo, and rebuilding the tools later is the cost to avoid.
- When the issuer and the merchant both use Covalence, the two sides of the same dispute should be able to find each other by ARN and coordinate.

## 2. Two settings, not one mode

| Setting | Values | What it decides |
|---|---|---|
| **Institution type** (exists) | Bank, Credit union, Fintech, Money service business, Crypto exchange, **Merchant** (new), **Payment processor / acquirer** (new) | FI vs crypto wording and rules (Triage's side, exchange actions) |
| **What you do** (new, pick one or more) | **Issuer**, **Acquirer**, **Merchant** | Which side of a dispute this workspace works, which views each tool shows, the menu order |

- Defaults come from the type: banks, credit unions, fintechs and exchanges get Issuer; merchants get Merchant; processors get Acquirer. An admin can add roles. Many banks are both Issuer and Acquirer.
- Roles never delete or hide tools for good. They set the order of the menu and each tool's default view. A "Show all tools" switch in Settings keeps everything reachable.
- Desk's Issuer / Merchant toggle shows only the roles the workspace has. The demo keeps every role, so visitors can see each side.

## 3. Data: two new fields on each case

- `side`: `issuer` | `acquirer` | `merchant`. Migration: cases with `mode: 'merchant'` become `merchant`, everything else `issuer`. `mode` stays readable during the switch, and the 18 places that check it move to `side`.
- `arn`: the network's Acquirer Reference Number, 23 digits. Today "ARN" is only one of the names the import recognises for a generic case reference. It becomes its own column in imports, the API and the Desk form.
- On the server, linking needs a lookup across workspaces without exposing case data: `arn_index (arn_hash, institution_id, case_id, side, amount, created_at)`. It stores only a keyed hash of the ARN, never the ARN itself, and is maintained by the database when cases are saved.

## 4. Each tool, by role

| Tool | Issuer (today) | Merchant (new) | Acquirer (later) |
|---|---|---|---|
| **Home** | Caseload, deadlines, win rate | Chargebacks due this week, win rate, money recovered, chargeback ratio vs network thresholds | Merchants over the ratio thresholds, cases due |
| **001 Triage** | Alerts: "The bank found it" / Claims: "The customer reported it" | Phase 4: Alerts "The network warned you" (pre-dispute alerts such as Ethoca or Verifi, to refund before it becomes a chargeback) / Claims: customer complaints and refund requests | — |
| **002 Desk** | Build the case, decide, file | Evidence, fight or accept, representment and Pre-Arbitration letters (exists today) | Review merchant responses before sending them on |
| **003 Multi** | Queues, My Queue, batch filing | **The chargeback queue**: arrivals sorted by response deadline, assignment, bulk-accept under a threshold, batch responses | The same queue, grouped by merchant (this is the "many clients" idea) |
| **004 File** | Filed cases through to won or lost | **Responses submitted**: lifecycle through Pre-Arbitration and arbitration, then the after-a-win checks (§5) | — |
| **005 Licit** | AML, sanctions, SARs | Off the menu by default | Merchant monitoring (later) |
| **007 Duo** | Bank to bank, bank to exchange | **ARN linking with the issuer** (§6) | Same |
| **008 Trio** | Fraud incident room | Same tool; merchant playbooks such as a card-testing attack (later) | Same |
| **Settings** | — | Auto-accept below $X, response deadline per network, merchant evidence defaults | — |

## 5. The merchant journey: one case, three places

```
Chargeback arrives (feed, API, file)
  → 003 Multi    status: received        response deadline counting down
  → 002 Desk     status: responding      evidence, fight or accept, letter
  → 004 File     status: responded | accepted
                 → issuer accepts the response → won
                 → Pre-Arbitration → arbitration → won | lost
  after a win    reversal expected → received (or short) → final once the escalation window closes
```

- **Response deadline:** the acquirer's deadline, which is usually shorter than the network's. It's set per network in Settings and can be overridden per case.
- **Fight or accept:** Desk compares the amount, the odds and the cost of fighting. Below the auto-accept threshold, Multi offers a bulk accept.
- **After a win**, File shows:
  - **Money back:** the expected reversal, the date it arrived, and whether fees left it short.
  - **Final:** a countdown until the issuer can no longer escalate. Roughly 30 days for Visa and 45 for Mastercard, to be confirmed per network.
  - **Ratio:** most network programs still count a won chargeback, so the ratio on Home doesn't drop when a case is won.
  - **Customer:** a repeat-disputer flag, and the winning evidence saved for reuse under Visa Compelling Evidence 3.0.
- **New statuses:** `received`, `responding`, `responded`, `accepted`. The existing `representment`, `pre_arb`, `arbitration`, `won` and `lost` are reused. The deadline clocks (`clocks.mjs`) gain the merchant deadlines.

## 6. ARN linking in Duo

**Finding the other side**
1. Any case with an ARN shows **Find the other side** (issuer and merchant cases alike).
2. The database looks the ARN up in `arn_index` on the opposite side. A match also needs the amount to agree and a plausible date, so a guessed ARN finds nothing. Lookups are rate-limited.
3. If there's a match, the other workspace gets a **Duo invite** in its queue: "Issuer X wants to coordinate on ARN …1234". Both sides already know the ARN, so the invite reveals nothing new. The sender is never told whether a match exists, only "If the other side uses Covalence, they'll get your invite."
4. Nothing is shared until the other side accepts.

**Once linked, the Duo session adds**
- **Both cases side by side:** the issuer's reason code and stage, and the merchant's stage.
- **Stage sync**, if each side switches it on. When the merchant responds in File, the issuer's case shows "Merchant responded". When the issuer files Pre-Arbitration, the merchant's case shows it. Each side still records its own official status from the network.
- **Settle early:** the merchant offers a refund, the issuer withdraws the chargeback, and both cases close with "settled in Duo". This saves both sides the fees and weeks.
- **Audit entries:** `duo.arn_invite`, `duo.arn_linked`, `duo.stage_synced`, `duo.settled`.

**Guardrails**
- **314(b) doesn't cover banks and merchants.** Merchants generally can't register. The 314(b) panel from PR #29 gains a third state: **Dispute coordination — 314(b) doesn't apply. Share only dispute details.** The purpose step offers "Resolve this dispute" for these sessions.
- **The network still decides.** Duo coordinates. The official response and filing go through the network and acquirer as usual, and the session says so.
- **Evidence:** neither side's evidence or customer data is shared automatically, only what someone types into the session.

## 7. Order of work

1. **Roles:**
   - the "What you do" setting, the two new institution types, and the `side` tag with its migration;
   - menu order, "Show all tools", and the Triage tab labels by workspace;
   - Desk's toggle limited to the workspace's roles. Small, with no new screens.
2. **The merchant journey:**
   - Multi's chargeback queue;
   - File's merchant view, the new statuses and deadlines, and bulk accept;
   - the after-a-win checks and the Home numbers for merchants;
   - demo data for a merchant workspace.
3. **ARN linking:**
   - the `arn` field in Desk, imports and the API, plus `arn_index`;
   - Find the other side, invites, stage sync, settle early;
   - the 314(b) third state.
4. **Later:**
   - merchant Triage (pre-dispute alerts) and merchant playbooks in Trio;
   - the acquirer role, with Multi grouped by merchant.

## 8. Questions for you

1. **Acquirer:** is it phase 4, or does a design partner need it sooner?
2. **Stage sync:** on by default once both sides accept, or off until each side switches it on?
3. **Who the first merchants are:** small merchants need simple defaults (auto-accept, plain language). Large ones need the queue, assignment and bulk actions first.
4. **Settle early:** record only that the case was settled, or also the refund amount and reference?
