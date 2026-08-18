# Dental Practice-Management Integration — US Market

**Bottom line: Open Dental is the only PMS with a genuinely open door, and everything touching Dentrix has just become a legal question rather than an engineering one.** A July 2026 federal injunction bars a competitor from shipping software that *writes* to Dentrix databases, and Henry Schein One publicly brands the entire middleware layer — NexHealth, Sikka, Kolla — as "unauthorized vendors." That reshapes the build order.

Date: 2026-08-14 · Status: assessment · Companion: [hipaa-readiness.md](hipaa-readiness.md) · Claims marked **verified** were checked directly against the primary source during this research, not taken from a summary.

---

## 1. Why this matters at all

We currently write appointments to **Google Calendar**. Our connector list is `GMAIL, TWILIO, GOOGLE_CALENDAR, VAPI, WHATSAPP, CALENDLY, TELEGRAM` — nothing dental.

A US dental practice runs its schedule in Dentrix, Eaglesoft, or Open Dental, and the front desk works out of that all day. An AI that books into a calendar nobody watches produces double-booked chairs in week one. That is the failure mode that ends a pilot and generates the review that costs the next ten deals.

---

## 2. 🚨 The legal situation (verified directly)

**Henry Schein One publishes a public "Unauthorized Vendors" list.** I fetched [the page](https://www.henryscheinone.com/dental-solutions/api-exchange/vendors-list/) myself. It opens: *"The vendors listed below may be utilizing an unauthorized connection to Henry Schein One."* Among ~57 names: **NexHealth, Sikka, Kolla, Swell, Adit, Simplifeye, Kleer, Rhinogram, DentalHQ, Denny.ai, Vyne.**

*(Worth noting: one of my research agents concluded this page didn't exist and told me to treat the claim as unsourced. It was wrong. I verified the page twice.)*

**A federal court has already enjoined write access.** From Henry Schein One's own [customer FAQ](https://www.henryscheinone.com/dental-solutions/api-exchange/customer-faqs/): HSOne sued Vyne Dental on October 3, 2025, and on **July 31, 2026 a federal court issued a preliminary injunction** barring Vyne from *"marketing, selling, or distributing software capable of writing data to Dentrix databases,"* with the court agreeing that *"this kind of write access creates real risk to data integrity and system stability."*

**And they contact your customers.** HSOne states plainly: *"If we find an unauthorized connection to your Dentrix system, you'll get several emails and a call from the Henry Schein One team."*

Three consequences:

1. **Never build direct-database or RPA integration against Dentrix or Eaglesoft.** This is no longer a "move fast" tradeoff; it is enjoined conduct in at least one live case. (Patterson's posture on Eaglesoft is worse — a researcher who disclosed an Eaglesoft server leaking patient records had his home raided by the FBI after Patterson referred it to law enforcement.)
2. **Middleware does not launder the problem.** Buying NexHealth or Sikka to reach Dentrix inherits the exposure rather than avoiding it, because HSOne names them by name and calls the practices using them.
3. **The injunction cut precisely along read/write.** Non-invasive *read* access was protected in the same ruling; unauthorized *write-back* was enjoined. That maps exactly onto the product decision below.

---

## 3. Open Dental — the one open door (verified)

Prices confirmed directly from [Open Dental's API permissions page](https://www.opendental.com/site/apipermissions.html):

| Tier | Price | What it allows |
|---|---|---|
| **Free** | **$0** | **Read All** (1 request / 5 sec throttle) — includes reading open slots |
| Tier 2 | $15/location/mo | Comm, Documents, InsuranceSimple, Setup, Queries |
| Tier 3 | $30/location/mo | All except Payments, PayPlans, Special — **includes creating appointments** |
| Tier 4 | $35/location/mo | All except Special |

Three things make this the obvious first integration:

- **Reading availability is free.** `GET Slots` costs nothing, forever.
- **The practice pays, not us** — pricing is per location and billed to the office's key.
- **No on-prem footprint on our side.** Open Dental offers a remote mode at `https://api.opendental.com/api/v1/`, explicitly *"for developers that want to access data without their software installed on a customer's local network."* The practice runs eConnector; we just call an HTTPS API.

Access takes **1–3 business days** by emailing `vendor.relations@opendental.com` with the resource list and permissions needed. Auth is two keys: `Authorization: ODFHIR {DeveloperKey}/{CustomerKey}`. A **BAA with each practice is required** — consistent with §4 of the HIPAA doc.

---

## 4. The middleware trap — why NexHealth doesn't solve our problem

NexHealth looks perfect on paper: 15+ practice-management systems through one API, read *and* write, self-serve sandbox in minutes, $0.10 per API call with 10,000 free calls a month. No sales call.

**But its own documentation disqualifies it for our specific product.** From [NexHealth's sync-status docs](https://docs.nexhealth.com/docs/interpreting-sync-status):

> *"For server-based integrations … syncing only occurs when the server is powered on. This means **downtime is expected when the office is closed, which may be as often as every night or every weekend**."*

And for cloud systems, sync only runs while staff are logged into a Chrome extension and *actively interacting with the schedule* — producing gaps *"not only overnight, on weekends, and during holidays, but also during lunch breaks."*

**That is exactly the window a missed-call AI receptionist lives in.** Our entire value proposition is answering when the practice can't. If we build on NexHealth, we must design for **stale reads and queued writes** and never assume live schedule state on an after-hours call.

Sikka is worse for this use case — its default sync is **nightly at 2 AM**, and write-back is restricted to Enterprise licenses. Kolla supports no cloud PMS at all and has no open-slot endpoint (you compute availability yourself).

There's also a conflict of interest worth naming: NexHealth sells practices a competing scheduling suite, and its developer marketing leads with "AI Receptionists" — it recruits our category while competing in it.

---

## 5. What direct Dentrix access costs

| Path | Up front | Recurring |
|---|---|---|
| **Dentrix Ascend** (cloud) | $5,000 | $47/location/mo — 30K calls, 3GB; overage $0.0018/call |
| **Dentrix desktop** (legacy DDP) | **$5,000 READ + $5,000 WRITE** | Unpublished monthly royalty by API category |
| **Dentrix Enterprise** | — | Requires **$3M/claim insurance** |
| **Eaglesoft** (Patterson) | **Unpublished** — no public docs, no published criteria or timeline | Unpublished |

Both Dentrix channels require an application, a use-case review, and a signed API agreement. **Dentrix Ascend additionally requires SOC 2 Type II** — which, per the HIPAA doc, is a $7k+ audit we've deliberately deferred to Phase 2. So the sanctioned Dentrix path is gated behind a compliance investment we haven't made yet, and that sequencing is worth knowing before promising anyone a Dentrix integration.

---

## 6. What competitors actually ship

The most useful datapoint in this entire research: **Weave — a public company doing ~$273M in revenue — gates its AI Receptionist auto-booking to exactly Dentrix, Eaglesoft, and Open Dental, with a waitlist for everything else.**

If the incumbent can only do three, doing **Open Dental well plus honest request-handling everywhere else** is a defensible launch position, not a compromise.

| Product | PMSs claimed | Booking behavior |
|---|---|---|
| **Weave** | 8 listed; **auto-booking limited to 3** | Direct write, waitlist beyond the three |
| **Arini** (YC W24) | Dentrix, Eaglesoft, Open Dental, Denticon | Claims direct write via official Dentrix API Exchange + Open Dental eConnector |
| **Peerlogic** | Dentrix, Open Dental, Denticon, Eaglesoft, DaySmart | Claims booking; mechanism unstated |
| **Dentina** | Exactly NexHealth's list | "Real bookings — not tasks for your front desk to chase" — $299–399/location/mo |
| **Doctible** | 24 dental systems | **Request queue by design**: *"We do not push any appointments to your EHR or PMS until you approve them"* |
| **RevenueWell** | 5 + CareCredit | **Both, switchable** — approval by default, opt-in "Direct Scheduling" bypass |

**RevenueWell's hybrid is the pattern worth copying**: booking requests go to an approval queue by default, and confident practices opt into true write-back. It de-risks the write while offering a path to full automation.

A useful diagnostic that held across every vendor examined: **list length reveals mechanism.** 50+ systems means resold middleware (Swell openly names NexHealth and Sikka as suppliers). 6–7 systems means hand-built deep integrations (Dental Intelligence, Weave). Anyone claiming "all major PMS platforms" without naming them is worth discounting.

---

## 7. Recommended sequencing

1. **Launch with no PMS integration.** Missed-call text-back plus voice, capturing a booking *request* that the front desk confirms. This works on our existing stack today. It monetizes the one undisputed fact in this market — roughly **a third of dental calls go unanswered** (Peerlogic's study of 4,280 calls across 26 locations found 38%, with AI follow-up recovering 144 appointments worth ~$47,000 in a month).
2. **Add Open Dental read-only immediately after.** Free, sanctioned, legally uncontroversial, ~1 week. This converts "a request into the void" into "a request against a slot we know is open" — killing the strongest sales objection at zero marginal cost.
3. **Then Open Dental write** at $30–35/location/month, paid by the practice.
4. **NexHealth only for Dentrix/Eaglesoft practices, and only with stale-data tolerance** — queued writes, cached availability, explicit "pending confirmation" UX. Price in the HSOne exposure.
5. **Dentrix Ascend direct** ($5,000 + $47/location) is the cheapest *sanctioned* Henry Schein One path — but only after SOC 2 Type II.
6. **Never** direct-DB or RPA against Dentrix or Eaglesoft.

**On HIPAA:** a no-PMS launch barely reduces the compliance burden — PHI exists the moment a caller says their name and why they're calling. What read-only genuinely buys is a smaller **blast radius**: we cannot corrupt a clinical record. That's a real argument for a practice's risk reviewer, not a compliance exemption.

---

## 8. Unconfirmed / needs validation

- **Market-share percentages are unsourceable.** The circulating figures (Dentrix 18–22%, Eaglesoft 15–20%) trace to SEO listicles with no methodology. Only vendor self-reported counts are real: Henry Schein One claims 48,000+ US practices; Planet DDS 13,000+. **Don't put percentages in a deck.**
- **Eaglesoft**: all costs, criteria, and timelines. Nothing is published.
- **Denticon and Curve** developer pricing — unpublished.
- **CareStack's** published developer pricing shows $500,000 registration and $6,000/location/month — almost certainly a formatting bug; confirm before believing it.
- **🚩 The biggest gap: practitioner sentiment.** Every claim about practices fearing double-booking traced back to *vendor marketing asserting the fear in order to sell against it*. No practice owner's actual view was found, and nobody publishes request→booked conversion rates. **This needs discovery calls, not more research** — it directly determines whether step 1 above is a viable wedge or a dead end.
- **Names to strike:** "Peartree" (parked domain), "Peerly" (political texting, not dental), Numa (car dealerships), Slang.ai (restaurants), Assort Health (17 medical specialties, dentistry absent). Overjet and Pearl are imaging AI, not receptionists.

---

## Sources

[HSOne Unauthorized Vendors list](https://www.henryscheinone.com/dental-solutions/api-exchange/vendors-list/) · [HSOne API Exchange customer FAQ](https://www.henryscheinone.com/dental-solutions/api-exchange/customer-faqs/) · [Dentrix Developer Program FAQ](https://ddp.dentrix.com/pages/faq) · [Open Dental API permissions](https://www.opendental.com/site/apipermissions.html) · [Open Dental API setup](https://www.opendental.com/site/apisetup.html) · [Open Dental remote API](https://www.opendental.com/site/apilocal.html) · [NexHealth sync status](https://docs.nexhealth.com/docs/interpreting-sync-status) · [Synchronizer API](https://synchronizer.io/) · [Sikka API packages](https://sikka.ai/api-packages) · [Weave AI Receptionist](https://www.getweave.com/ai-receptionist/) · [Peerlogic DSO case study](https://www.peerlogic.com/post/peerlogic-dso-case-study) · [Vyne/HSOne dispute coverage](https://www.dentistryiq.com/practice-management/industry/article/55321885/vyne-dental-and-henry-schein-one-file-dueling-lawsuits) · [Dentrix account of the dispute](https://www.dentrix.com/insights/blogs/dentrix-vyne-dental-dispute-explained/)

*Not legal advice — an engineering and commercial assessment to inform counsel and the build order.*
