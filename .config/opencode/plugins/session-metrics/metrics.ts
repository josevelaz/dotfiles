export interface TokenUsage {
  readonly input: number
  readonly cache: {
    readonly read: number
    readonly write: number
  }
}

export function cacheHitPercentage(tokens: TokenUsage): number {
  const cached = Math.max(0, tokens.cache.read)
  const prompt = Math.max(0, tokens.input) + cached + Math.max(0, tokens.cache.write)
  if (prompt === 0) return 0
  return (cached / prompt) * 100
}

export function formatCacheHitPercentage(tokens: TokenUsage): string {
  return `${cacheHitPercentage(tokens).toFixed(1)}%`
}

export function formatCost(cost: number): string {
  const safe = Number.isFinite(cost) ? Math.max(0, cost) : 0
  return `$${safe.toFixed(safe < 0.01 ? 4 : 2)}`
}

export function formatTimestamp(date: Date): string {
  const part = (value: number) => value.toString().padStart(2, "0")
  return `${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}`
}

export function warmingLogFilename(channel: string): string {
  return channel === "local" ? "opencode-local.log" : "opencode.log"
}

export interface WarmingLogEvent {
  readonly sessionID: string
  readonly sentAt?: Date
}

export function warmingLogEvent(line: string): WarmingLogEvent | undefined {
  if (!line.includes('message="warming session"')) return undefined
  const sessionID = /(?:^|\s)sessionID=([^\s]+)/.exec(line)?.[1]
  if (sessionID === undefined) return undefined

  const rawTimestamp = /(?:^|\s)timestamp=([^\s]+)/.exec(line)?.[1]
  if (rawTimestamp === undefined) return { sessionID }
  const sentAt = new Date(rawTimestamp)
  return Number.isNaN(sentAt.getTime()) ? { sessionID } : { sessionID, sentAt }
}
