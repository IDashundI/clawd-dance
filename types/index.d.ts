export type Beat = number

declare module 'claude-code' {
  interface PluginState {
    'clawd-dance': { beat: Beat; isBusy: boolean }
  }
}
