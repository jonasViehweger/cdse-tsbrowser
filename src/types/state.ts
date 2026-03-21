export type Flags = Record<string, string>

export interface FlagLabels {
  [value: string]: string
}

export interface SampleData {
  flags?: Flags
  flagLabels?: FlagLabels
  comment?: string
  interpreter?: string
  [key: string]: unknown
}
