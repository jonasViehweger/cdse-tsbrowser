import type { Flags, FlagLabels } from '../types/state'

/** Catppuccin Mocha — pastel accents, readable on dark backgrounds */
export const FLAG_PALETTE_DARK = [
  '#f38ba8', '#a6e3a1', '#fab387', '#89dceb',
  '#cba6f7', '#f9e2af', '#89b4fa', '#eba0ac',
]

/** Catppuccin Latte — saturated accents, readable on light backgrounds */
export const FLAG_PALETTE_LIGHT = [
  '#d20f39', '#40a02b', '#fe640b', '#04a5e5',
  '#8839ef', '#df8e1d', '#1e66f5', '#dc8a78',
]

function currentPalette(): string[] {
  return document.documentElement.dataset.theme === 'light'
    ? FLAG_PALETTE_LIGHT
    : FLAG_PALETTE_DARK
}

/**
 * Returns a stable colour for a flag value.
 * Uses flagLabels key order when available so colours are consistent
 * regardless of which dates have been flagged.
 * Automatically picks the dark or light palette from the active theme.
 */
export function flagColour(value: string, flagLabels: FlagLabels, flags: Flags): string {
  const palette = currentPalette()
  const ordered = Object.keys(flagLabels).length > 0
    ? Object.keys(flagLabels)
    : [...new Set(Object.values(flags))]
  const index = ordered.indexOf(value)
  return palette[(index < 0 ? 0 : index) % palette.length]
}
