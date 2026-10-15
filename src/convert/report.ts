// Conversion report: what moved exactly, what was approximated, what needs manual work.

export type Level = 'ok' | 'approx' | 'manual' | 'info'

export interface ReportItem { level: Level; area: string; text: string }

export class Report {
  items: ReportItem[] = []
  add(level: Level, area: string, text: string) { this.items.push({ level, area, text }) }
  ok(area: string, text: string) { this.add('ok', area, text) }
  warn(area: string, text: string) { this.add('approx', area, text) }
  manual(area: string, text: string) { this.add('manual', area, text) }
  info(area: string, text: string) { this.add('info', area, text) }
  count(level: Level) { return this.items.filter(i => i.level === level).length }
}
