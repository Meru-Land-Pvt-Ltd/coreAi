# Google Workspace Limited Use — enforcement module

Central home for the technical controls behind the Google API Services User
Data Policy (Limited Use) compliance posture.

- `workspace-ai-guard.ts` — data classifications (GENERAL / GOOGLE_WORKSPACE_RAW /
  GOOGLE_WORKSPACE_DERIVED), fail-closed confirmation flags, provider alias
  normalization, and the `ResolvedVoicePipeline` gate. RAW Workspace data is
  never AI-eligible. DERIVED data requires the master switch plus every flag of
  every provider hop in the resolved pipeline (orchestrator, transcriber, LLM,
  voice). Unknown providers and providers with no confirmation pathway
  (cartesia, playht, azure, lmnt, rime-ai, neets) are always blocked.
- `ai-safe-results.ts` — whitelist sanitizers applied at the Vapi webhook
  dispatch point; opaque HMAC appointment refs. Date/time fields come only
  from explicit business-local values, never from UTC timestamps.
- `disclosure-consent.ts` — versioned pre-OAuth consent records, freshness gate
  for the OAuth-URL endpoints, 24-month retention (`prune:disclosure-consents`
  script), pseudonymization on account deletion.
- `log-redaction.ts` — masks phones/names, drops raw calendar payload keys,
  strips signed-URL query strings.
- `elevenlabs-params.ts` — adds `enable_logging=false` to direct ElevenLabs TTS
  requests only when `ELEVENLABS_ZRM_CONFIRMED` attests plan support.

## Deepgram path audit (July 2026)

Full-repo search for `api.deepgram.com`, Deepgram SDK packages, `wss://`,
WebSocket, streaming, and Voice Agent usage found exactly these paths:

| Path | Type | Coverage |
| --- | --- | --- |
| `ai-provider-engine/providers/deepgram.adapter.ts` — pre-recorded REST `/v1/listen` | **Direct** (only direct call site; no SDK, no streaming/WebSocket/Voice Agent usage exists in the repo) | `mip_opt_out=true` always sent in code (`buildQueryString`) |
| Vapi assistant `transcriber: { provider: "deepgram" }` (vapi-connector) | **Vapi-managed** — Triven never calls Deepgram here; Vapi does | NOT covered by a code parameter. Requires the Deepgram account-level Model Improvement Program opt-out and/or Vapi HIPAA/ZDR arrangement, attested by `DEEPGRAM_MIP_OPT_OUT_CONFIRMED` |
| Vapi `smartEndpointingPlan: { provider: "livekit" }` (turn detection) | **Vapi-managed** | Covered by the Vapi confirmations (`VAPI_*_CONFIRMED`) |

If a new direct Deepgram surface is ever added (streaming SDK, Voice Agent,
WebSocket `wss://agent.deepgram.com`), it must send `mip_opt_out=true` where
supported and be added to this table.
