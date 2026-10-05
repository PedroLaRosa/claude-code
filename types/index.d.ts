// A level of effort, tied to the model it was seen on or picked for.
export type Level = { model: string; level: string }

declare module 'claude-code' {
  interface PluginState {
    'model-effort': { pick: Level | null; base: Level | null; ultra: boolean }
  }
}
