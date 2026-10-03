# Security Assessment

Scope: dashboard auth, credential handling, API surface, token systems,
storage, injection/XSS, dependency posture. Reviewed against the deployed
threat model — a self-hosted single-operator trading bot holding live
exchange API keys.

**Overall score: 85 / 100**

Solid, thoughtful design for localhost/single-operator use. The previous
high-severity gap (plaintext exchange credentials) is now resolved —
credentials persist AES-256-GCM encrypted. Remaining items are one
medium (unauthenticated coin metadata writes) plus minor hardening. No
critical remote compromise path found; production fails closed when
`DASHBOARD_PIN` is unset.

## Score breakdown

| Area | Score | Notes |
|---|---|---|
| Dashboard authentication | 16/20 | HMAC session cookie, rate limit, timing-safe compare; rate-limit key is spoofable |
| Route protection coverage | 13/15 | `/` + `/api/system/**` enforced; `coin/metadata` write ops left open |
| Credential & secret handling | 17/20 | AES-256-GCM at rest + mask/strip pipeline; key source is env-derived |
| MCP token system | 14/15 | Hashed at rest, AES-256-GCM reveal, scoped permissions, timing-safe |
| Injection / XSS / SSRF | 9/10 | No eval, no raw HTML sinks, file-based storage; authenticated SSRF only |
| Secrets in repo / env hygiene | 8/10 | `.env` + `storage/` ignored, no tracked secrets; no dependency audit |
| Session management | 8/10 | Stateless HMAC with expiry; PIN rotation kills sessions; no revocation |

## Strengths (verified in code)

- **PIN login is properly built** — `src/pages/api/pin.ts`: 6-digit PIN,
  `timingSafeEqual` compare, 5 attempts per 10-minute window per client
  with `Retry-After`, HMAC-SHA256 session tokens (`v1.expires.nonce.sig`),
  `HttpOnly; SameSite=Lax; Secure` (prod) cookie, 24 h prod / 7 d dev
  expiry.
- **Edge enforcement** — `src/proxy.ts` guards `/` and `/api/system/**`
  via cookie signature verification; production returns 503 when
  `DASHBOARD_PIN` is missing (fail closed). Dev pages allow browsing
  without PIN but API still 401s.
- **MCP tokens are the best part of the design** —
  `src/lib/system/mcp/tokens.ts`: SHA-256 hashed at rest, AES-256-GCM
  encrypted for reveal, timing-safe hash compare, per-token permission
  scopes (`backtest.run`, …), `lastUsedAt` tracking, separate
  `SYNC_TOKEN` super-user evaluated before DB tokens.
- **Secret sanitization pipeline** —
  `src/lib/system/storage/sanitize.ts`: path-segment regex
  (`token|secret|password|api.?key|chat.?id|private|credential`) with
  `maskSecrets` for display and `stripSecrets` for export so restored
  configs can't overwrite live credentials.
- **Env/dev gating** — `isDevBacktestEnabled()` 404s `/api/dev/*` and
  `/dev/*` pages in production unless `ENABLE_DEV_BACKTEST=1`; MCP
  `devOnly` tools answer with a warning payload instead of dispatching.
- **Repo hygiene** — `.env` and `storage/` gitignored, only
  `.env.example` tracked, no committed credentials found.
- **No injection sinks** — no `eval`, no SQL (JSON file storage), only
  `dangerouslySetInnerHTML` use is MUI emotion style insertion
  (controlled), `child_process.fork` limited to the local backtest
  worker with a fixed entry.

## Findings

### High — resolved

**S1 — Exchange API credentials stored in plaintext** — **FIXED**

Was: `accounts.json` persisted `apiKey`/`apiSecret`/`passphrase` in
plaintext.

Now: `src/lib/system/runtime/credentials.ts` encrypts each field
AES-256-GCM into a `v1:<iv>:<tag>:<ct>` envelope at the disk boundary
(`runtimeCatalog.save`/`accounts.save` in
`src/lib/system/storage/catalog.ts`), and decrypts on `load()` and in
`normalizeCredentials`. In-memory and API-visible values stay plaintext,
so the settings reveal flow, `getExchangeCredentials`, and the env-var
fallback are unchanged.

Key derivation is domain-separated:
`sha256("account-credentials:" + secret + ":" + DASHBOARD_PIN_SALT)`
where `secret` = `ACCOUNT_CREDENTIALS_ENCRYPTION_SECRET` →
`MCP_TOKEN_ENCRYPTION_SECRET` → `DASHBOARD_PIN` (first set wins).
Operational notes:

- Legacy plaintext files load unchanged and are encrypted on next save.
- Envelopes that can't be decrypted resolve to `""` + one error log —
  the account fails exchange auth visibly instead of booting with
  garbage keys or crashing the catalog.
- Synced storage bundles now carry ciphertext; the receiving instance
  must share the same secret (or re-enter credentials).
- Rotating `DASHBOARD_PIN` breaks PIN-derived envelopes — set the
  dedicated env var to decouple (documented in `.env.example`).

Covered by
`src/__dev__/main/quality/unit/account-credentials-encryption.test.ts`
(9 tests: round-trip, IV freshness, wrong-key, legacy passthrough,
on-disk envelope + in-memory plaintext).

### Medium

**S2 — `/api/system/coin/metadata` accepts unauthenticated writes**
(~-4)

Deliberately excluded from the PIN gate (`src/proxy.ts:10,17`) for peer
sync, but `coinTagsHandler` also serves normal `POST`/`PUT` tag writes
without any credential — only the `syncState` replace checks the
`x-coin-metadata-token` header (`src/lib/dev/coins/api/coinTags.ts`).
Anyone who can reach the port can create/rename/delete tags and
descriptions, which then drive dashboard rendering and are broadcast to
peers.

Recommendation: require the session cookie (remove the proxy exception)
for `GET`/`POST`/`PUT`, and keep only the `syncState` broadcast path on
the sync token — that path is already token-gated.

**S3 — PIN rate-limit key is spoofable** (~-4)

`getClientKey()` trusts the first `x-forwarded-for` value
(`src/pages/api/pin.ts:21-27`). With no trusted-proxy boundary an
attacker rotates `X-Forwarded-For` per request and gets unlimited PIN
attempts (10^6 space, no other barrier). The in-memory `Map` also grows
per forged key.

Recommendation: use `req.socket.remoteAddress` only when a trusted proxy
is configured (env flag), cap the attempts map size, and/or add a global
per-IP-ignoring throttle as a second layer. A longer/expired lockout or
CAPTCHA is overkill for this app size.

### Low

**S4 — `x-sync-token` compared with `===`** (~-2)

`src/proxy.ts:34` uses a direct string comparison while `tokens.ts`
uses `timingSafeEqual` on hashes. Theoretical timing oracle; trivial to
fix for consistency.

**S5 — MCP path-token variant leaks tokens into URLs** (~-2)

`/api/mcp/[token]` accepts the token in the path
(`src/pages/api/mcp.ts:24-26`). URLs end up in proxy/access logs and
browser history. Bearer/`x-mcp-token` headers exist — prefer dropping
the path variant or documenting it as local-only.

**S6 — `/api/market/*` fully unauthenticated** (~-2)

`klines`, `volatility`, `funding-rates`, `initialize` sit outside the
proxy matcher. They expose cached market data and let anyone trigger
`initialize` (a compute/IO operation). Low sensitivity (public exchange
data) but worth a session check for consistency, or an explicit
"public by design" comment in `proxy.ts`.

**S7 — No dependency audit in the gate** (~-2)

`npm run quality` doesn't run `npm audit`. With axios/Next/MUI/recharts
in the supply chain, add `npm audit --omit=dev` (or a periodic CI job)
so known CVEs surface.

**S8 — Authenticated SSRF via `onlineBaseUrl`** (~-1)

`sync-online-to-local`/`sync-local-to-online` fetch a user-supplied URL
(`src/pages/api/system/debug/*`). It's behind PIN auth so exposure is
"the operator attacks their own network" — low, but an http(s)-only +
optional allowlist check costs little.

### Informational

- **Stateless sessions can't be revoked individually.** Acceptable: PIN
  change invalidates all sessions (key material is `pin:salt`). Note it
  as the documented revocation mechanism.
- **In-memory attempt store** resets on restart — fine for the threat
  model; noted only because a cluster deployment would weaken it.
- **`ENABLE_DEV_BACKTEST` footgun**: setting it in production reopens
  `/api/dev/*` which accept arbitrary backtest configs (compute DoS +
  file writes). Documented as intentional; treat as a privileged flag.
- **Worker `child_process.fork`** uses a fixed entry point and config
  JSON over IPC — no user-controlled command path observed.

## Threat-model caveat

The score assumes the documented deployment: localhost or trusted LAN,
single operator. If the instance is ever exposed to the public internet
without a trusted TLS proxy, drop ~8 points: S2 and S3 become
exploitable primitives and `x-forwarded-for` handling matters.

## Prioritized actions

1. ~~Encrypt `credentials.*` at rest~~ — done (S1). [resolved]
2. Move `coin/metadata` behind the session cookie; keep only `syncState` on the sync token. [S2]
3. Make the PIN attempt key proxy-aware (`TRUST_PROXY` env) or ignore `x-forwarded-for` by default. [S3]
4. `timingSafeEqual` for `x-sync-token` in `src/proxy.ts`. [S4]
5. Drop or gate the `/api/mcp/[token]` path variant. [S5]
6. Add `npm audit` to CI or the quality gate. [S7]
