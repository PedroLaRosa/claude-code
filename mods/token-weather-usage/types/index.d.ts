export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Cache = { at: number; read: number; write: number; fresh: number }

// Everything the band draws from, stamped with the time it was taken.
export type View = {
  now: number
  tokens: number[]
  window: number
  limits: Limit[]
  cache: Cache | null
  cacheOff: boolean
  cacheTtl: string
  cost: number | null
  lastPrompt: number | null
  agents: number
}

declare module 'claude-code' {
  interface PluginState {
    'token-weather-usage': { view: View | null }
  }
}
