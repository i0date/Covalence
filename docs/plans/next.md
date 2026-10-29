# What's next — plan

Status: agreed direction, 29 Oct 2026. Phases 1–3 of [roles and ARN linking](roles-and-arn-linking.md) are live.

## Order

1. **Home clean-up and the tour.** Small and visible, so it goes first.
2. **Phase 4 + the alarm.** Merchant pre-dispute alerts in Triage, merchant playbooks in Trio, the alarm (built with the Trio work), and the acquirer role.
3. **Disputes from the bank's app.** The biggest selling point for a design partner.
4. **Settings redesign.**

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

- **Merchant Triage:**
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
- **Acquirer role:** Multi grouped by merchant, merchant ratios, and checking merchants' responses before they're sent on.

## 3. Disputes from the bank's app

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
7. **The same pipe for others:**
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
