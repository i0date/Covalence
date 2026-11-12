# What's next — plan

Status: agreed direction, 29 Oct 2026. Phases 1–3 of [roles and ARN linking](roles-and-arn-linking.md) are live.

## Order

1. **Home clean-up and the tour.** Small and visible, so it goes first.
2. **Phase 4 + the alarm.** Merchant pre-dispute alerts in Triage, merchant playbooks in Trio, the alarm (built with the Trio work), and the acquirer role.
3. **Disputes from the bank's app.** The biggest selling point for a design partner.
4. **Settings redesign.**
5. **Onboard with Covalence.** (built) Customer onboarding (KYC and KYB) for banks and FIs, so a customer's record starts the day they open the account.
6. **Claim form rework.** (built) Customers who find fraud a month or more later can't find the payment; the questions are weak; and the confirmation reads as if Covalence, not the bank, is acting. The bank has to be integrated so its own systems act and confirm.
7. **Settings, again.** (built) The redesign didn't land; go through it together first. Every function becomes a toggle there, and you only see what you've switched on (the acquirer and merchant views included).
8. **Home, tighter.** A tighter revamp of the home page.
9. **Every tool, with a fine-tooth comb.** After Onboard with Covalence: one tool at a time, list what's wrong, fix it.
10. **Credit underwriting.** Lending decisions for banks and FIs, built on what Covalence already knows about a customer: who they are from onboarding, how money moves through their account, and any fraud or disputes. The bank decides; Covalence lays out the case.

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

**Built** (onboarding PR): `src/onboarding.mjs` (the application, the checks, the rating), `api/_onboarding.js` served at `/api/onboarding` through `api/claims.js` (the free plan's 12-function limit), `supabase_onboarding.sql`, the hosted form at `/onboard/<token>` (`src/OnboardPage.jsx`; samples at `/onboard/demo` and `/onboard/demo-business`), and 005 Licit → Onboarding (`src/OnboardingQueue.jsx`). ID numbers go straight to the bank's endpoint (`onboarding.identity`) and only the last four digits are kept; the identity provider's result comes back as `{ idv }`; decisions go back as `onboarding.decided`. Not yet: a PEP list (the check rests on the customer's answer), the onboarding record on the customer's later cases, and opening a Licit case for enhanced due diligence.

A customer's record should start when they open the account, not at their first dispute. The bank's app or website opens Covalence's onboarding flow, like the hosted claim form, and the result lands on the same record every later case, alert and SAR uses.

- **The flow (hosted, in Covalence's style with the bank's name):** personal or business; the CIP fields the bank's programme requires (name, date of birth, address, ID number); an ID document and a selfie through the identity provider the bank already uses (Covalence connects to it rather than replacing it). The ID number goes straight to the bank's systems and isn't stored in Covalence.
- **Checks on arrival:** OFAC and PEP screening (`src/sanctionsMatch.mjs`), duplicate and synthetic-identity signals (the same phone, email, device or address on other applications), and the IP's country against the address.
- **Businesses (KYB):** the business's registration and its beneficial owners under the FinCEN CDD rule (25% owners and one controller), each screened.
- **A risk rating** with its reasons (low, medium, high), set in Settings, and an **Onboarding queue** in Licit: approve, ask for more, or decline, each with a reason, audited.
- **Back to the bank:** `onboarding.decided` to the bank's endpoint; enhanced due diligence opens a Licit case for a high rating.
- **Afterwards:** the onboarding record shows on the customer's later cases (how long they've been a customer, what was checked), which feeds fraud and scam decisions.
- **Before it ships:** counsel reviews the consent text and data retention; the identity-provider connection is tested with a real sandbox.

## 6. Claim form rework (the bank's customers)

What's wrong today:
- **Only recent payments.** The link carries the payments the bank sent with it, so a customer who notices fraud on a statement a month or more later can't find it. Card networks allow 120 days from processing, and Reg E gives 60 days from the statement it first appeared on. Late discovery is normal and has to be easy.
- **The questions are weak.** They don't follow how people actually find fraud (a statement, a declined card, an alert, a letter from a merchant) or the pattern it often takes (small test charges, then larger ones, over weeks).
- **Covalence sounds like the one acting.** "We've passed that on to Your bank" reads as if a third party is handling it. The customer is talking to their bank; Covalence should be invisible, and anything the customer asks for (a new card, a lock) has to be done and confirmed by the bank's own systems.

What it becomes:
- **Find any payment, not just recent ones.** Search by date range, merchant name and amount, back as far as the bank's records go (at least 13 months). The bank either sends a wider window with the link or answers a search from Covalence through its own API, scoped to that customer. If the customer still can't find it, "I can't find it" lets them describe it (roughly when, how much, who) so an analyst can trace it.
- **Late reports are taken, not blocked.** The form never refuses an old payment. The analyst sees how old it is against the Reg E and network time limits, and the claim is marked so nobody misses it.
- **Questions rewritten around discovery:** when and how they noticed; when they last saw a statement; whether the card was with them; whether anyone else uses the card or has their details; other payments they don't recognise since (with the earliest one); whether it repeats; whether they've contacted the merchant. Fewer, plainer questions, by claim type, reviewed with someone who has run a disputes operation, and by counsel for the consent text.
- **In the bank's voice, with the bank acting.** Every message is in the bank's name (no "Your bank" placeholder: a bank can't issue links until its name is set). Requests such as lock the card or send a new card go to the bank's endpoint while the customer waits; the confirmation shows what the bank's system actually did ("Your card ending 4412 is locked", with the bank's reference). If the bank's system doesn't confirm, the customer is told to call the bank's number, not that it's been "passed on".
- **Done when:** a customer can report a payment from three months ago without help; the questions read well to a disputes lead; and a lock or new card shown as done has been confirmed by the bank's system.

## 7. Settings, again

The Linear-style redesign (section 4) is live but doesn't work for you. Start by going through each page together and writing down what's wrong (too much on one page, wrong grouping, unclear wording, missing settings), then fix it in one pass.

**Everything is switched on in Settings, and only what's on shows.**
- **Sides first: the acquirer and merchant reminder.** The merchant views (Against your sales, Triage's Merchant side, pre-dispute alerts) and the acquirer view (Your merchants in 003 Multi) show only when the workspace has ticked Merchant or Acquirer under *What you do*. Today the demo shows every side, and a signed-in workspace falls back on its institution type; that fallback goes. Each side's tab, menu entry, Home figures and Your day rows follow the tick.
- **Then every function is a toggle.** Each tool (Triage, Desk, Multi, File, Licit, DFA, Duo, Trio, Insights) and each feature inside one (for example pre-dispute alerts, claims from the app, the hosted claim form, warn the merchant first, monitoring rules, sanctions screening, SARs, Onboard with Covalence, the alarm, pools) can be switched on or off. Off means gone: not in the menu, not on Home, not in Your day, not in search.
- **Who can change it:** admins only, audited, with a one-line description of each toggle and what turning it off hides. Turning a feature off never deletes its data; turning it back on brings it back.
- **New workspaces** start from what they said they do at sign-up, with a short list to switch on the rest.
- **The demo** keeps everything on, with the same toggles so a visitor can see what a switched-off workspace looks like.

## 8. Home, tighter

A tighter revamp of the home page: less on screen, the most important thing first, no repetition between the Brief, Your day and the numbers. Start with a walk-through of what you'd remove.

## 9. Every tool, with a fine-tooth comb

After Onboard with Covalence ships: go through each tool in menu order (Triage, Desk, Multi, File, Licit, DFA, Duo, Trio, Insights, Settings), on a phone and on a desktop, with real-looking data. For each: list what's wrong (wording, layout, missing steps, anything that doesn't match how the work is really done), agree the list, then fix it in one PR per tool.

## 10. Credit underwriting (banks and FIs)

Covalence already holds what most of an underwriting file needs: the customer's identity and checks from onboarding, a year or more of their transactions from monitoring, and their fraud, disputes and alerts. Underwriting puts that in front of a credit analyst, so a decision on a card, a loan or an overdraft is made with the whole picture.

What it covers:
- **Applications in, from the bank's systems or a hosted form** (the onboarding and claim-form pattern: the bank's name, a link that works once).
- **Cash-flow underwriting from the account's own history:** income and how regular it is, spending, balances, overdrafts and returned payments. This matters most for thin-file applicants, where a credit report says little.
- **Credit report data** through the bank's own bureau connection, under its permissible purpose (FCRA). Covalence doesn't pull reports itself.
- **Risk flags from the rest of Covalence:** fraud and scam claims, chargebacks, alerts, sanctions or adverse media from onboarding, and a recently opened account or recently changed details.
- **Explainable rules, like transaction monitoring:** every figure and flag says where it came from. No black-box score decides anything. A model, if added, goes through the bank's model risk review (SR 11-7) and stays explainable.
- **A credit analyst decides:** approve, decline, counter-offer (a lower limit or amount), or ask for more. Each decision is audited and sent to the bank's systems, which open the account or line.
- **Fair lending built in:** declines and counter-offers record the principal reasons, in words fit for the adverse action notice the bank sends (ECOA / Reg B, and FCRA when a report was used). Protected characteristics are never inputs.

To settle first:
- Which products come first: cards, personal loans, overdrafts or small-business lending.
- Where bureau data comes from, and in what format.
- Who issues the adverse action notice (the bank, from Covalence's reasons), and the review of its wording with counsel.

Done when: a bank can send an application, an analyst sees identity, cash flow, credit data and risk flags on one page with every figure explained, and the decision and its reasons go back to the bank's systems.
