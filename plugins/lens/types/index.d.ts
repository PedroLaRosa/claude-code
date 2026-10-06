// The agent tools this mod registers at session start, so `tool.call` matchers on them type-check.
declare module 'claude-code' {
  interface McpToolInputs {
    'mcp__lens__lens_diagnostics': { path?: string }
    'mcp__lens__lens_diagnostic_mark': { id: string; disposition: 'false-positive' | 'defer'; reason: string }
  }
}
export {}
