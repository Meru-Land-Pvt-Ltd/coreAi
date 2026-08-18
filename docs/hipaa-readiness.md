# HIPAA Readiness — US Dental Market

**Verdict: not compliant today, and no real patient call should be routed through the system until the agreements below are signed.** The good news is that this is mostly a procurement-and-configuration problem, not a rebuild: the `compliance/` module already has the right architecture (fail-closed per-provider flags checked on every pipeline hop), and it generalizes from Google Limited Use to HIPAA almost directly.

Date: 2026-08-14 · Status: assessment · Scope: HIPAA only — dental practice-management integration (Dentrix et al.) is tracked separately.

---

## 1. Why HIPAA applies to us

A dental practice is a **covered entity** if it bills electronically — which virtually all do. We would be its **business associate**: the ADA's own guidance names *"appointment scheduling software vendors that handle or access PHI"* as business associates. The "conduit exception" (which covers pure transmission, like the postal service) does not apply to us because we **store** conversations, transcripts, and leads.

The trap people fall into is assuming PHI means clinical records. It doesn't. **A caller's name and phone number, combined with the fact that they contacted a dental practice, is already PHI.** "Tooth pain" certainly is. So essentially every payload our agent touches is regulated.

Obligations flow downstream: we need BAAs with every vendor that touches PHI (45 CFR 164.308(b), 164.502(e)(2)). That is why the vendor table below is the core of this document.

---

## 2. Where PHI flows today

| Hop | Carries PHI | Covered today |
|---|---|---|
| Twilio — inbound call, missed-call SMS | Caller number, appointment content | ❌ no BAA |
| Vapi — voice conversation, transcripts, recordings | Everything the patient says | ❌ HIPAA mode hardcoded off |
| LLM provider — reply generation | Full conversation context | ❌ no BAA |
| **Pinecone — memory chunks** | **Verbatim conversation text** | ❌ **no BAA — see §4** |
| Postgres — MemoryRecord, facts, leads | Everything | ✅ ours (AWS BAA covers RDS) |
| AWS SES — follow-up email | Appointment details | ❌ BAA available, not signed |
| Google Calendar — appointment events | Patient name | ⚠️ practice's own Workspace BAA |
| WhatsApp/Meta | Anything sent | 🚫 **can never be covered — §5** |
| Stripe — subscription billing | Should carry none | ✅ n/a — §5 |

---

## 3. Vendor BAA table

| Vendor | BAA | Tier required | Cost | Key exclusions / gotchas |
|---|---|---|---|---|
| **Twilio** | Yes, sales-led | **Security or Enterprise Edition** | Not published — sales-gated | Voice/SMS/MMS eligible **US area codes only**. Editions must be maintained for the life of the BAA. HIPAA project designation is self-serve *after* signing. **SendGrid is excluded entirely** and Twilio will not sign for it |
| **Vapi** | Yes — email security@vapi.ai | Works on pay-as-you-go **Build** tier | **$2,000/mo** add-on | Org-level toggle, not per-assistant, not API-settable. Holds BAAs with OpenAI/Anthropic/Google/Deepgram/ElevenLabs — **using Vapi's keys inherits that coverage**. HIPAA and ZDR are mutually exclusive. **Telephony is not addressed — our own Twilio BAA is required** |
| **Pinecone** | Yes, by request | Enterprise (Standard add-on claimed) | Unconfirmed | **Whether PHI is permitted in vector _metadata_ specifically is unconfirmed — ask directly (§4)** |
| **OpenAI** | Yes — email baa@openai.com, case-by-case, ~days | No enterprise agreement needed for the API | No fee mentioned | **ZDR is *not* a prerequisite** (a common myth). Excluded: **live Web Search** and **Codex cloud**. ChatGPT BAAs are Enterprise/Edu only — Business/Team/Plus are ineligible. If you do enable ZDR it disables Assistants/Threads/Vector Stores/Files/Batch |
| **Anthropic** | Yes — **self-serve in Console** (Settings → Privacy → HIPAA) | Claude API; Enterprise plan for Claude.ai | Not published | **Use HIPAA readiness, not ZDR — asking for both is the wrong config.** Excludes Batch, Files, Skills, code execution, MCP connector, web fetch, Workbench. Exclusions are **enforced in-API with a 400**, not just contractually. Enabling is **permanent and org-wide** — use a separate org for non-PHI work |
| **Google Gemini** | Via Google Cloud only | GCP project under Cloud BAA | **$0 — same pricing as non-HIPAA** | ⚠️ **"Vertex AI" has been renamed "Gemini Enterprise Agent Platform"** — searching the HIPAA list for the old name wrongly suggests it isn't covered. **AI Studio / `generativelanguage` keys are NOT covered**, and their terms bar clinical use outright |
| **AWS** (RDS, S3, SES, Lambda…) | Yes, free via Artifact | Any account | Free | SES is eligible; PHI in email bodies is still a separate risk |
| **Google Workspace / Calendar** | Practice's own BAA (Calendar **is** a covered service) | Workspace tenant with an accepted BAA | Not published | **Google's BAA explicitly excludes third-party apps "including through authorizing API access to PHI"** — so we are the practice's business associate and need our own BAA with each practice. A GCP BAA does not substitute. **A personal Gmail account has no coverage at all — and an OAuth token looks identical either way (§5)** |
| **ElevenLabs** | Yes | **Enterprise only** | Not published | Requires Zero Retention Mode, which destroys transcripts, history, and analytics — fights our dashboard |
| **Stripe** | Offers none publicly; not needed for our use | — | — | B2B subscription billing contains no patient data, so the business-associate threshold (45 CFR 160.103) is never reached. Keep patient data out of `metadata`, `description`, invoice text, and statement descriptors — Stripe's own docs prohibit PII there |

**The efficient path:** Vapi's $2,000/mo add-on inherits their BAAs across the entire model layer (STT, LLM, TTS) — one line item instead of six negotiations. That coverage applies **only when using Vapi's keys**. Any direct provider call we make needs our own BAA.

**Two myths worth killing before anyone budgets around them.** First, zero-data-retention is *not* a precondition for a BAA at either OpenAI or Anthropic — Anthropic states outright that if you handle PHI you want HIPAA readiness *instead of* ZDR, since it applies broader safeguards rather than forced deletion. Second, the direct BAAs are cheaper and faster to obtain than expected: Anthropic's is now self-serve in the Console, Google charges nothing and applies standard pricing, and **Azure (for OpenAI models via Foundry) requires no signature at all** — the BAA is included in the Microsoft Product Terms automatically. If we ever need first-party LLM access for PHI outside Vapi's umbrella, Azure is the lowest-friction route.

**Model-selection note:** Claude **Fable 5 and Mythos 5 are "Covered Models"** requiring 30-day retention, so they're excluded from ZDR and explicitly carved out of AWS Bedrock's HIPAA eligibility. If our provider engine falls back to those models on a PHI path, that's a compliance break — worth a check in `llm-credentials.ts` resolution order.

---

## 4. Verified gaps in our code

Each of these was confirmed by reading the source, not inferred.

**① Raw patient conversation is written into Pinecone metadata.** [smart-memory.ts:537](apps/backend/src/modules/memory/smart-memory.ts#L537) upserts `content: chunk.content` — verbatim conversation text — as vector metadata. Tenant namespaces isolate it correctly, but this is unprotected PHI in a third-party index. **This is the single largest exposure.** Options: sign a Pinecone BAA (confirming metadata is in scope), or stop storing raw text in metadata and hydrate chunk text from Postgres by `recordId` at read time — the redesign already keeps Postgres as the source of truth, so the second option is a small change with an infrastructure-independent payoff.

**② The Deepgram Flux path sends no model-improvement opt-out.** [node-registry.ts:478](packages/shared/src/node-registry.ts#L478) builds the live-transcription URL. The standard `/v1/listen` branch correctly sends `mip_opt_out=true`; the **Flux `/v2/listen` branch does not**, because Flux rejects most parameters. Until it's confirmed that Flux accepts the flag, `flux-*` models must not process patient audio.

**③ The compliance audit table is stale.** [compliance/README.md](apps/backend/src/modules/compliance/README.md) states the only direct Deepgram surface is the pre-recorded REST adapter, and mandates that any new streaming surface be added. `deepgram-live-proxy.ts` opens a direct `wss://api.deepgram.com` connection and is not in the table. Same audit that gates the Google submission.

**④ WhatsApp can never carry PHI.** We have a live Meta integration (`modules/whatsapp/meta-client.ts`). **Meta does not offer a BAA**, so WhatsApp is permanently ineligible for patient communication — this is a product boundary, not a to-do.

**Already in our favor:** `log-redaction.ts` masks `patient_name`/`patient_phone` patterns; `disclosure-consent.ts` gives versioned consent records; `workspace-ai-guard.ts` enforces fail-closed per-provider gating across every pipeline hop; env attestation flags (`ELEVENLABS_ZRM_CONFIRMED`, `DEEPGRAM_MIP_OPT_OUT_CONFIRMED`, `VAPI_HIPAA_OR_ZDR_CONFIRMED`) already exist. We also use **no Twilio Studio**, which avoids Twilio's Message-Redaction-vs-Studio incompatibility.

---

## 5. Channel-by-channel constraints

**SMS is inherently insecure and Twilio says so.** Messages sit unencrypted on personal handsets and carriers aren't HIPAA-regulated. Twilio's position is that PHI over SMS is permissible if the patient is (i) warned texting is insecure, (ii) authorizes it, and (iii) the consent is documented. Our `SmsConsent` infrastructure covers TCPA — **HIPAA additionally requires capturing the insecurity acknowledgement**, which is a schema and copy change, not a rebuild.

**The cheapest near-term posture is to keep PHI out of message bodies entirely** — "your appointment is confirmed" with a callback number or portal link, never a condition or treatment. This materially lowers exposure while the BAAs are being signed.

**Email (AWS SES)** is HIPAA-eligible with no exclusions, and the AWS BAA is free and self-serve in Artifact. But two things matter more than eligibility:

- **SES silently sends unencrypted when TLS negotiation fails.** By default `TlsPolicy` is `Optional` — SES attempts a secure connection to the receiving mail server and, if it can't establish one, **delivers in plaintext anyway**. Setting `TlsPolicy=Require` on the configuration set is a one-line hardening step and should be done regardless of BAA timing. AWS's own guidance requires PHI to be encrypted to the HHS standard, which default SES does not meet.
- **The "HIPAA allows unencrypted patient email" rule is narrower than it's usually cited.** That permission is a *patient-initiated right-of-access* mechanism — a patient can request their own records by unencrypted email after being warned of the risk. It does **not** authorize a vendor to push PHI into email bodies as a product default. Notification-plus-link, rather than content-in-body, sidesteps the question entirely.

*(A correction worth carrying: the common claim that using a non-eligible AWS service "voids the BAA" is unsourceable. AWS's actual rule is that non-eligible services may run freely in a HIPAA account — PHI just must never enter them.)*

**Google Calendar has a structural problem worth solving in design rather than paperwork.** We cannot tell from an OAuth token whether the connected account is BAA-covered — a practice connecting a personal Gmail, a Workspace Individual plan, or a tenant that never accepted the BAA produces a token indistinguishable from a covered tenant. Writing a patient's name into that calendar puts PHI somewhere with no coverage at any layer. Gating on customer attestation helps, but **the robust fix is to keep PHI out of calendar events entirely**: opaque event titles plus an internal reference, with patient detail held in our own BAA-covered store. That design stays correct no matter what account the buyer connects — and it's cheaper than policing attestations forever.

**Voice recordings** come from Vapi, not Twilio, so Twilio's public-recording-URL trap doesn't apply to us. Vapi's HIPAA mode moves recordings to a private bucket fetchable only via API with a private key — which is what [fix-vapi-hipaa-recordings.ts](apps/backend/scripts/fix-vapi-hipaa-recordings.ts) exists to reconcile, and which will change how the dashboard player works.

---

## 6. Sequence

1. **Decide the Pinecone question first** (§4①) — either sign the BAA or stop putting raw text in metadata. This is the only item that's a live exposure regardless of launch timing.
2. **Twilio** Security Edition + BAA — unlocks Voice and SMS.
3. **Vapi** HIPAA add-on + BAA — $2,000/mo, inherits the model-layer BAAs. Budget the dashboard/recording regression.
4. **AWS** BAA via Artifact (free).
5. **Direct provider BAAs** only where we bypass Vapi's keys — audit for Anthropic Batch/Files and OpenAI Assistants/Threads usage, both excluded.
6. **Move Gemini off AI Studio keys** to Vertex AI.
7. **Calendar:** move to opaque event titles (§5) rather than relying on attestation; add a practice-facing BAA since Google's does not cover us.
8. **Cheap hardening, do now regardless of BAA timing:** set SES `TlsPolicy=Require`; fix the Flux opt-out; refresh the compliance audit table; add the SMS insecurity acknowledgement.
9. **Mark WhatsApp** as non-PHI-eligible in product surfaces.
10. **Publish a standing BAA + control-mapped security page** — cheap, and it beats every AI-native competitor on the dimension procurement actually checks (§9).

---

## 7. What compliance actually costs

The two halves of this are wildly different in price, and conflating them is the expensive mistake.

**Phase 1 — legally required. Low four figures, do it before the first paying customer.**

| Item | Cost |
|---|---|
| Risk analysis — HHS/ONC's own **SRA Tool**, explicitly aimed at small providers | **$0** |
| Written policies + workforce training (e.g. Accountable HQ, which publishes pricing) | **~$2,000–$3,100/yr** |
| Customer-facing BAA (one-time legal drafting) | not sourced |
| **Subcontractor BAAs** (Twilio, Vapi, Pinecone, AWS, Google) | **$0 — it's paperwork** |
| §164.312 controls: encryption, MFA, unique user IDs, session timeout, audit logging | engineering time only |

**Phase 2 — commercially optional. Only when a specific DSO deal justifies it.** SOC 2 Type II audit from ~**$7,000** at the low end for a tight single-product scope, plus a penetration test at **$5,000–$15,000**, plus a compliance platform (Vanta/Drata/Secureframe all quote-only — none publish pricing). **HITRUST is not a near-term goal**: no published pricing, requires a paid external assessor, aimed at health systems.

**There is no government HIPAA certification.** HHS does not certify or approve any product. Anyone selling a "HIPAA certified" seal is selling a private attestation with no regulatory standing.

**The failure mode to avoid:** buying Phase 2 for the website badge while Phase 1's subcontractor BAAs are still unsigned. That combination buys a certificate while leaving direct liability under §164.502(e)(2) fully exposed.

## 8. Two regimes that are not HIPAA but bite anyway

**TCPA** governs our SMS independently, has a **private right of action**, and HIPAA compliance is no defense. The FCC rule cross-references the HIPAA definitions — being a business associate is what exempts genuine *health-care* messages from the heightened **written**-consent standard. But baseline prior-express-consent still applies, and promotional content ("book your whitening special") does **not** qualify as a health-care message. Our `SmsConsent` gate is the right architecture; its scope needs counsel review.

**California's CMIA reaches us directly.** Civil Code §56.06 deems any business that maintains medical information, or offers software designed to maintain it, to be a **provider of health care** — independent of the BAA chain, with its own penalties and its own **private right of action** (which HIPAA lacks). California is one of the largest dental markets in the US, so this is not an edge case. Texas Ch. 181 is reportedly broader than HIPAA too, but I could not verify its specifics from primary sources — needs counsel.

## 9. The competitive picture — and the opening in it

I had earlier repeated a secondary-source claim that Weave publishes its BAA on all plans. **Direct checking shows that is wrong.** Weave's public posture is specific on encryption (AES-128+ at rest, TLS 1.2+, GCP KMS) but carefully hedged on its own status — "designed with features to support **you** in complying with HIPAA," which puts the obligation on the practice — and **it does not publish a BAA anywhere**. Its security page also cites *Google Cloud's* SOC 2, not its own.

Across eleven vendors checked, **only one — Dental Intelligence — publishes an actual BAA** (standing, auto-incorporating, and it plainly self-identifies as a Business Associate). Hello Patient is the only one that acknowledges BAAs in *both* directions, upstream and downstream.

Most striking: **our two closest competitors publish nothing verifiable.** Arini (AI dental receptionist) has a dead Trust Center link, a non-resolving trust subdomain, and a 404 privacy policy. Peerlogic (AI dental front desk, near-identical missed-call text-back) has a 404 privacy policy and 404 legal page. Neither states a HIPAA or SOC 2 claim publicly.

That is a **competitive opening, not just a category embarrassment**. A published standing BAA plus a real security page mapped to §164.312 controls would put us ahead of every AI-native competitor on the exact dimension a DSO's procurement reviewer evaluates — and it costs almost nothing relative to the SOC 2 the incumbents are hiding behind.

## 10. Open questions

- **Cost of Twilio Security Edition** — not published anywhere; sales-gated, possibly with minimum spend and multi-year term.
- **Pinecone's position on PHI in metadata**, and their HIPAA pricing.
- **Texas Ch. 181 specifics** — primary sources were unreachable; verify with counsel.

**Regulatory direction (verified):** the January 2025 Security Rule NPRM has **not** been finalized — it sits in OMB's "Long-Term Actions" with final action projected **July 2027**. So encryption at rest and in transit remain *addressable*, and mandatory MFA/asset inventory/annual pentesting are **proposals only**. Two caveats: "addressable" does **not** mean optional — you must implement it, or document why not *and* deploy an equivalent alternative (§164.306(d)), and for a 2026 cloud SaaS there is no defensible reason not to encrypt. And build to the NPRM anyway, since enterprise buyers will demand those controls before 2027 regardless — just don't *market* them as current legal requirements.

**One encryption note worth internalizing:** properly encrypted breached data, with keys uncompromised, falls within the breach **safe harbor** — it converts a reportable breach into a non-event. That single fact is the strongest practical argument for rigorous key management.

---

## Sources

[HHS Covered Entities](https://www.hhs.gov/hipaa/for-professionals/covered-entities/index.html) · [ADA Business Associate FAQ](https://www.ada.org/resources/practice/legal-and-regulatory/faqs-on-hipaa-business-associates) · [Twilio HIPAA](https://www.twilio.com/en-us/hipaa) · [Twilio HIPAA Accounts](https://www.twilio.com/docs/iam/twilio-editions/hippa) · [Twilio HIPAA-Eligible Services PDF (Jun 30 2026)](https://www.twilio.com/content/dam/twilio-com/global/en/other/hipaa/pdf/HIPAA-Eligible-Services.pdf) · [Architecting for HIPAA PDF](https://www.twilio.com/content/dam/twilio-com/global/en/other/hipaa/pdf/Architecting-for-HIPAA.pdf) · [SendGrid not HIPAA-eligible](https://www.twilio.com/docs/sendgrid/ui/account-and-settings/hipaa-compliant) · [Twilio Message Redaction](https://www.twilio.com/docs/messaging/guides/privacy-message-redaction) · [Vapi HIPAA](https://docs.vapi.ai/security-and-privacy/hipaa) · [Vapi data flow](https://docs.vapi.ai/security-and-privacy/data-flow) · [Vapi pricing](https://vapi.ai/pricing) · [Pinecone HIPAA](https://www.pinecone.io/contact/hipaa/) · [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) · [Anthropic BAA](https://privacy.claude.com/en/articles/8114513-business-associate-agreements-baa-for-commercial-customers) · [Anthropic covered models](https://support.claude.com/en/articles/15455031-covered-models-under-a-business-associate-agreement-baa) · [AWS HIPAA-eligible services](https://aws.amazon.com/compliance/hipaa-eligible-services-reference/) · [ElevenLabs HIPAA](https://elevenlabs.io/docs/eleven-agents/legal/hipaa) · [ElevenLabs ZRM](https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode) · [Google Workspace BAA](https://workspace.google.com/terms/2015/1/hipaa_baa/) · [Security Rule delay](https://www.clarkhill.com/news-events/news/hipaa-security-rule-update-delayed-until-2027/)

*Not legal advice — this is an engineering assessment to scope the work and inform counsel.*
