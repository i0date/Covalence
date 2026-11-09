# What's next — plan

Status: agreed direction, 29 Oct 2026. Phases 1–3 of [roles and ARN linking](roles-and-arn-linking.md) are live.

## Order

1. **Home clean-up and the tour.** Small and visible, so it goes first.
2. **Phase 4 + the alarm.** Merchant pre-dispute alerts in Triage, merchant playbooks in Trio, the alarm (built with the Trio work), and the acquirer role.
3. **Disputes from the bank's app.** The biggest selling point for a design partner.
4. **Settings redesign.**
5. **Onboard with Covalence.** Customer onboarding (KYC and KYB) for banks and FIs, so a customer's record starts the day they open the account. Listed on the sign-up page as coming.

## 1. Home and the tour — show, don't tell

- **Remove:**
  - the Brief's intro blurb and its collapse toggle;
  - the eight-tools strip, which repeats the menu;
  - the large demo banner (it becomes one line).
- **Home opens on *Your day*,** then the date range, cases and numbers.
- **A new workspace gets a *Get set up* checklist** instead of an empty page. Each item ticks itself off:
  - connect your systems;
  - invite your team;
  - import your cases;
  - set what you do;
  - record your 314(b) registration (banks).
- **The tour:**
  - Fix the "1 OF 7" count; there are eight slides.
  - Next: a guided tour on the real screens with demo data, in three paths of 60–90 seconds each: bank fraud analyst, compliance, merchant. It can be resumed, and it lives under a "?" menu.

## 2. Phase 4 and the alarm

- **Warn the merchant first (banks):** (done) on a Visa or Mastercard case before filing, Desk's WARN MCH sends the warning through the bank's systems to Verifi CDRN or Ethoca (`dispute.merchant_warning`, `src/merchantWarning.mjs`). A refund in the 72-hour window resolves the case with no dispute; no refund or no answer means file. Reg E / Reg Z clocks keep running.
- **Already a chargeback (merchants):** (done) an alert sent after the bank filed (`chargebackFiled: true`) can't be refunded, because that pays twice; it's acknowledged and answered on Desk.
- **Merchant Triage:** (done: pre-dispute alerts PR — `src/preDispute.mjs`, `supabase_predispute.sql`, `/api/intake { preDispute }`, decisions sent as `predispute.decided`)
  - Alerts: "The network warned you". Pre-dispute alerts (Ethoca, Verifi, Order Insight), so the merchant can refund before a chargeback.
  - Claims: customer complaints and refund requests.
- **Merchant playbooks in Trio:**
  - card-testing attack;
  - account takeover and drop addresses;
  - merchant data breach (network notice and forensic deadlines);
  - chargeback spike against the network ratio;
  - refund or "item not received" abuse ring.
- **Sound the alarm,** reachable from every screen:

  | Level | Meaning | Who's told | Who can raise it |
  |---|---|---|---|
  | 1 · Watch | Something looks off | Fraud team, quiet banner | Anyone |
  | 2 · Alert | Confirmed pattern, losses possible | Whole team, Slack; a Trio incident opens | Anyone |
  | 3 · Critical | Active attack, real losses | Everyone and leadership; playbook starts | Reviewer or admin, or an analyst with confirmation |

  - Every alarm names an owner, a "do this now" line, a next-update time and a stand-down.
  - A duplicate report joins the alarm that's already open.
  - Every alarm is audited.
  - Only level 3 is red.
- **Acquirer role:** (done) 003 Multi → Merchant / Acquirer → *Your merchants* (`src/acquirer.mjs`, `src/AcquirerView.jsx`): chargebacks against the acquirer's merchants (`side: 'acquirer'`), grouped by merchant, the ones near a Visa VAMP or Mastercard ECM threshold first, with each merchant's 30-day ratio from its monthly card sales. Each chargeback goes received → with the merchant (10 days, never later than 3 days before the network's deadline) → the merchant's answer, checked against the evidence its reason code needs → sent to the network, sent back, or closed when the merchant accepts. Acquirer cases stay out of the merchant's own and the issuer's views. Later: notifying merchants from Covalence (today the stage is recorded; the acquirer's systems tell the merchant), and merchants answering through Covalence directly.

## 3. Disputes from the bank's app

Built so far (claims API PR): `/api/claims` with `supabase_claims.sql`; claims land in Triage → Claims tagged by channel, with the Reg E / Reg Z clock from the customer's report and *Ready for Desk*; "Triage this" fills the claim form; handing off or closing moves the claim on and sends `claim.updated`; the Desk case keeps the claim and starts its clocks at the report. Then (claim events PR): AI triage reads each claim on arrival (kind of problem, route, priority, what to ask) and fills the claim type when the customer gave none; the Desk case's provisional credit, filing and resolution are sent as `claim.provisional_credit`, `claim.filed` and `claim.resolved`, each once, and resolving closes the claim. Then: questions by claim type, served to the bank's app (`GET /api/claims?questions=`, `src/claimQuestions.mjs`), with required answers counting towards *Ready for Desk*; and *Is this yours?* cards (`POST /api/claims { isThisYours }`, `src/isThisYours.mjs`): the merchant as people know it, where and when, and whether the customer has paid them before, with "That was me" closing the claim at intake. Then (hosted form PR): the hosted claim form at `/claim/<token>` (`src/ClaimFormPage.jsx`, `src/claimLinks.mjs`, `supabase_claim_links.sql`), in Covalence's style with the bank's name and logo, which the bank's app or website opens when a customer taps "Report a problem" (a link from `POST /api/claims { link }`, used once; Covalence never sends links to customers). Customers can ask for what they need now (lock the card, a new card, stop the merchant, a call), sent to the bank's endpoint at once as `claim.instructions`. A dispute about a purchase goes straight to the Dispute Desk's own *From your app and website* box (`src/DeskClaims.jsx`) without triage; fraud and scams stay in Triage → Claims. Then (all sides PR): "Send to the Desk" in Triage → Claims for a claim the customer called fraud that's really a purchase dispute (the kind is picked and noted, and the Desk's box shows it), `partial_delivery` as a kind, and the same pipe for exchanges (`segment: 'ce'`: unauthorised withdrawals, missing deposits and withdrawals, wrong address or network; freeze the account, stop withdrawals, reset 2FA) and merchants (`segment: 'mx'`, a Merchant side of Triage → Claims: order problems and refunds; refund, replacement, cancel; settled there with Refunded / Replacement sent / Looking into it). Running `supabase_claim_links.sql` allows the merchant side in the database.

1. **Claims API (`/api/claims`, keyed like `/api/intake`).** The bank's app posts the claim:
   - the customer;
   - the transaction or transactions from the bank's own records;
   - the customer's answers;
   - the statement;
   - attachments;
   - consent.
2. **Questions by claim type.** Covalence serves them to the bank's app, so answers fit network and Reg E rules.
3. **"Is this yours?" first.** For an unrecognised transaction, show the merchant's full name, logo and location first. "That was me" closes the claim at intake.
4. **On arrival:**
   - AI triage runs;
   - the Reg E clock starts at the customer's report;
   - the claim lands in Triage → Claims tagged *From app* (or *Web*, *Agent*, *Phone*);
   - complete, high-confidence claims are marked *Ready for Desk*.
5. **Status events back to the bank's app:** received, provisional credit, filed, resolved.
6. **A hosted, bank-branded form** for banks without developers, opened by a signed link to the transaction.
7. **The same pipe for others:** (done)
   - exchanges: "report an unauthorised withdrawal" → Triage's exchange side;
   - merchants: complaints → merchant Triage.

## 4. Settings

- **A Linear-style left-hand list, grouped:**
  - Workspace;
  - Team & access;
  - Cases & workflow;
  - Financial crime;
  - Integrations;
  - Records.
- **A search box** that finds any setting.
- **On each setting:** a one-line description, a dot when it's changed from the default, and a lock icon when only admins can change it.
- **Only what applies,** e.g. merchant settings for merchant workspaces.
- **Deep links (`cov:go`) keep working.**

## 5. Onboard with Covalence (banks and FIs)

A customer's record should start when they open the account, not at their first dispute. The bank's app or website opens Covalence's onboarding flow, like the hosted claim form, and the result lands on the same record every later case, alert and SAR uses.

- **The flow (hosted, in Covalence's style with the bank's name):** personal or business; the CIP fields the bank's programme requires (name, date of birth, address, ID number); an ID document and a selfie through the identity provider the bank already uses (Covalence connects to it rather than replacing it). The ID number goes straight to the bank's systems and isn't stored in Covalence.
- **Checks on arrival:** OFAC and PEP screening (`src/sanctionsMatch.mjs`), duplicate and synthetic-identity signals (the same phone, email, device or address on other applications), and the IP's country against the address.
- **Businesses (KYB):** the business's registration and its beneficial owners under the FinCEN CDD rule (25% owners and one controller), each screened.
- **A risk rating** with its reasons (low, medium, high), set in Settings, and an **Onboarding queue** in Licit: approve, ask for more, or decline, each with a reason, audited.
- **Back to the bank:** `onboarding.decided` to the bank's endpoint; enhanced due diligence opens a Licit case for a high rating.
- **Afterwards:** the onboarding record shows on the customer's later cases (how long they've been a customer, what was checked), which feeds fraud and scam decisions.
- **Before it ships:** counsel reviews the consent text and data retention; the identity-provider connection is tested with a real sandbox.
