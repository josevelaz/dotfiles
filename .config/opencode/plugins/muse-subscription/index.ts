import { Credential, Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"

const INTEGRATION_ID = "muse-subscription"
const METHOD_ID = "meta-account"

// Public client identifier used by Meta's device-authorization flow.
const CLIENT_ID = "1031625952748946"
const DEVICE_AUTHORIZATION_URL = "https://auth.meta.com/oidc/device/authorization/"
const DEVICE_TOKEN_URL = "https://auth.meta.com/oidc/device/token/"
const MUSE_KEY_URL = "https://api.meta.ai/muse-code/key"
const MODEL_API_ORIGIN = "https://api.meta.ai"
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"

const API_VERSION = "1.0.0"
const CLIENT_HEADER = "tbh:exec"
const REQUEST_TIMEOUT_MS = 20_000
const DEFAULT_POLL_MS = 5_000
const MIN_POLL_MS = 1_000
const DEFAULT_EXPIRES_MS = 10 * 60_000
const MAX_EXPIRES_MS = 30 * 60_000
const MAX_RESPONSE_CHARS = 256 * 1024

type JsonRecord = Record<string, unknown>

interface DeviceAuthorization {
  readonly deviceCode: string
  readonly userCode: string
  readonly verificationURL: string
  readonly pollMs: number
  readonly expiresAt: number
}

interface MintResult {
  readonly apiKey: string
  readonly accountToken: string
  readonly email?: string
  readonly tier?: string
}

function record(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

function secondsToMs(value: unknown, fallback: number, maximum?: number): number {
  const seconds = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback
  const milliseconds = Math.max(MIN_POLL_MS, Math.round(seconds * 1_000))
  return maximum === undefined ? milliseconds : Math.min(maximum, milliseconds)
}

function requestSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
}

async function responseRecord(response: Response, stage: string, required = true): Promise<JsonRecord | undefined> {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_CHARS) {
    throw new Error(`${stage} returned an oversized response`)
  }
  const body = await response.text()
  if (body.length > MAX_RESPONSE_CHARS) throw new Error(`${stage} returned an oversized response`)
  try {
    const parsed = record(JSON.parse(body))
    if (parsed !== undefined) return parsed
  } catch {
    // A generic error below avoids echoing a response that may contain credentials.
  }
  if (required) throw new Error(`${stage} returned an unreadable response`)
  return undefined
}

function verificationURL(value: unknown): string | undefined {
  const candidate = text(value)
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    if (url.origin !== "https://auth.meta.com" || url.username || url.password) return undefined
    if (url.pathname !== "/oauth/device/" && url.pathname !== "/oauth/device") return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

async function requestDeviceAuthorization(signal: AbortSignal): Promise<DeviceAuthorization> {
  const response = await fetch(DEVICE_AUTHORIZATION_URL, {
    method: "POST",
    redirect: "error",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "x-api-version": API_VERSION,
    },
    body: new URLSearchParams({ client_id: CLIENT_ID }).toString(),
    signal: requestSignal(signal),
  })
  if (!response.ok) throw new Error(`Meta device authorization failed (HTTP ${response.status})`)

  const payload = await responseRecord(response, "Meta device authorization")
  if (!payload) throw new Error("Meta device authorization returned an unreadable response")
  const deviceCode = text(payload.device_code)
  const userCode = text(payload.user_code)
  // Meta's prefilled `verification_uri_complete` can be rejected by the
  // authenticated device page even while the grant is still pending. Use the
  // base verification page and let the user enter the separately issued code.
  const approvedURL = verificationURL(payload.verification_uri)
  if (!deviceCode || !userCode || !approvedURL) {
    throw new Error("Meta device authorization response is missing required fields")
  }
  return {
    deviceCode,
    userCode,
    verificationURL: approvedURL,
    pollMs: secondsToMs(payload.interval, DEFAULT_POLL_MS),
    expiresAt: Date.now() + secondsToMs(payload.expires_in, DEFAULT_EXPIRES_MS, MAX_EXPIRES_MS),
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after")?.trim()
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000)
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

async function pollDeviceToken(auth: DeviceAuthorization, signal: AbortSignal): Promise<string> {
  let pollMs = auth.pollMs
  while (true) {
    if (signal.aborted) throw signal.reason
    if (Date.now() >= auth.expiresAt) throw new Error("Meta device authorization expired; start login again")
    const response = await fetch(DEVICE_TOKEN_URL, {
      method: "POST",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "x-api-version": API_VERSION,
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        device_code: auth.deviceCode,
        grant_type: DEVICE_GRANT,
      }).toString(),
      signal: requestSignal(signal),
    })
    const payload = await responseRecord(response, "Meta device token exchange", response.ok)
    if (response.ok) {
      const accountToken = text(payload?.access_token)
      if (!accountToken) throw new Error("Meta device token response is missing an access token")
      return accountToken
    }

    const code = text(payload?.error)?.toLowerCase()
    if (code === "access_denied") throw new Error("Meta device authorization was denied")
    if (code === "expired_token") throw new Error("Meta device authorization expired; start login again")
    if (code === "slow_down") {
      pollMs = Math.max(retryAfterMs(response) ?? 0, pollMs + 5_000)
    } else if (code === "authorization_pending") {
      // Keep the server-advertised polling interval.
    } else if (!code && response.status === 429) {
      pollMs = Math.max(retryAfterMs(response) ?? 0, pollMs + 5_000)
    } else {
      throw new Error(`Meta device token exchange failed (HTTP ${response.status})`)
    }

    const remaining = auth.expiresAt - Date.now()
    if (remaining <= 0) throw new Error("Meta device authorization expired; start login again")
    if (pollMs >= remaining) throw new Error("Meta device authorization expired; start login again")
    await sleep(pollMs, signal)
  }
}

async function mintSubscriptionKey(accountToken: string, onboard: boolean, signal: AbortSignal): Promise<MintResult> {
  if (signal.aborted) throw signal.reason
  const response = await fetch(MUSE_KEY_URL, {
    method: "POST",
    redirect: "error",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accountToken}`,
      "Content-Type": "application/json",
      "x-api-version": API_VERSION,
    },
    body: JSON.stringify(onboard ? { onboard: true } : {}),
    signal: requestSignal(signal),
  })
  if (!response.ok) throw new Error(`Muse subscription key exchange failed (HTTP ${response.status})`)

  const payload = await responseRecord(response, "Muse subscription key exchange")
  if (!payload) throw new Error("Muse subscription key exchange returned an unreadable response")
  if (typeof payload.require_payment !== "boolean") {
    throw new Error("Meta returned an unknown payment state; refusing to enable model requests")
  }
  for (const field of ["action_url", "require_payment_action_url"] as const) {
    if (payload[field] !== undefined && payload[field] !== null && typeof payload[field] !== "string") {
      throw new Error("Meta returned an invalid payment action; refusing to enable model requests")
    }
  }
  const paymentURL = text(payload.action_url) ?? text(payload.require_payment_action_url)
  if (payload.require_payment || paymentURL) {
    throw new Error("Meta reports that this account requires a subscription or payment method; refusing to enable model requests")
  }
  if (payload.is_subs_active !== true) {
    throw new Error("Meta did not confirm an active Muse Code subscription; refusing to enable model requests")
  }

  const apiKey = text(payload.api_key)
  if (!apiKey || !/^LLM\|\d+\|[A-Za-z0-9_-]{10,}$/.test(apiKey)) {
    throw new Error("Meta returned no valid subscription Model API key")
  }
  return {
    apiKey,
    accountToken,
    ...(text(payload.user_email) ? { email: text(payload.user_email)!.toLowerCase() } : {}),
    ...(text(payload.subs_tier_name) ? { tier: text(payload.subs_tier_name) } : {}),
  }
}

function credential(methodID: string, result: MintResult): Credential.OAuth {
  return {
    type: "oauth",
    methodID: methodID as Credential.OAuth["methodID"],
    access: result.apiKey,
    // Meta's account token is retained only for a future key re-mint. Model requests
    // authenticate with `access`, which is the subscription-backed LLM| key.
    refresh: result.accountToken,
    expires: Number.MAX_SAFE_INTEGER,
    metadata: {
      source: "meta-device-oauth",
      ...(result.email ? { email: result.email } : {}),
      ...(result.tier ? { subscription: result.tier } : {}),
    },
  }
}

async function refreshCredential(current: Credential.OAuth, signal: AbortSignal): Promise<Credential.OAuth> {
  if (!current.refresh || current.refresh.startsWith("LLM|")) {
    throw new Error("Muse account token is unavailable; reconnect the Muse Subscription provider")
  }
  const refreshed = credential(current.methodID, await mintSubscriptionKey(current.refresh, false, signal))
  return { ...refreshed, metadata: { ...current.metadata, ...refreshed.metadata } }
}

export default Plugin.define({
  id: "local.muse-subscription",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((draft) => {
      draft.update(INTEGRATION_ID, (integration) => {
        integration.name = "Muse Subscription"
      })
      draft.method.update({
        integrationID: INTEGRATION_ID,
        method: {
          id: METHOD_ID,
          type: "oauth",
          label: "Meta account (Muse Code subscription)",
        },
        authorize: () => Effect.tryPromise({
          try: (signal) => requestDeviceAuthorization(signal),
          catch: (cause) => cause,
        }).pipe(Effect.map((auth) => ({
            url: auth.verificationURL,
            instructions: `Open the URL, enter code ${auth.userCode}, and approve it. OpenCode will continue automatically.`,
            expiresAt: auth.expiresAt,
            mode: "auto" as const,
            callback: Effect.tryPromise({
              try: async (signal) => {
                const accountToken = await pollDeviceToken(auth, signal)
                if (signal.aborted) throw signal.reason
                return credential(METHOD_ID, await mintSubscriptionKey(accountToken, true, signal))
              },
              catch: (cause) => cause,
            }),
          }))),
        refresh: (saved) => Effect.tryPromise({
          try: (signal) => refreshCredential(saved, signal),
          catch: (cause) => cause,
        }),
        label: (saved) => text(saved.metadata?.email) ?? text(saved.metadata?.subscription) ?? "Muse subscription",
      })
    })

    yield* ctx.session.hook("http.request", (event) => Effect.sync(() => {
      const url = new URL(event.request.url)
      if (url.origin !== MODEL_API_ORIGIN || url.pathname !== "/v1/responses") {
        throw new Error(`Muse Subscription blocked an unexpected model endpoint: ${url.origin}${url.pathname}`)
      }
      const headers = new Headers(event.request.headers)
      headers.set("x-api-version", API_VERSION)
      headers.set("x-client-id", CLIENT_HEADER)
      event.request = new Request(event.request, { headers, redirect: "error" })
    }), { providerID: INTEGRATION_ID })
  }),
})
