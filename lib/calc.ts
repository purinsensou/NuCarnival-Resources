import type { EventConfig } from "./event-data"

// Game constants (recovered from the original calculator)
export const NATURAL_STAMINA_PER_MIN = 1 / 5 // 1 stamina per 5 minutes
export const DAILY_REWARD_STAMINA = 30 // base daily reward
export const MONTHLY_PASS_STAMINA = 60 // extra stamina/day with Monthly Pass
export const VIP_PASS_STAMINA = 100 // extra stamina/day with VIP Pass
export const MONDAY_STAMINA = 200 // stamina granted each Monday (UTC+8)
export const STAMINA_PER_REFILL = 120 // stamina gained per gem refill
export const GEMS_PER_REFILL = 200 // gems spent per refill
export const DAILY_PURCHASE_CAP = 3000 // max stamina purchasable per day
export const BOOST_VALUES = { tiny: 10, basic: 30, strong: 100 } as const

const DAY_MS = 864e5
const HOUR_MS = 36e5
const MIN_MS = 6e4
const UTC8_OFFSET = 288e5 // +8h in ms

/** Count Mondays (UTC+8) strictly after `startMs` and up to `endMs`. */
export function countMondays(startMs: number, endMs: number): number {
  const start = new Date(startMs + UTC8_OFFSET)
  const end = new Date(endMs + UTC8_OFFSET)
  let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1)
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  let count = 0
  for (; cursor <= last; cursor += DAY_MS) {
    if (new Date(cursor).getUTCDay() === 1) count++
  }
  return count
}

/** Parse an "YYYY-MM-DDTHH:mm" string as UTC+8 into epoch ms. */
export function parseEndTime(value: string | null | undefined): number | null {
  return value ? new Date(value + ":00+08:00").getTime() : null
}

/** Format a remaining-ms duration as "Xd Yh Zm" (or "Ended"). */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "Ended"
  const d = Math.floor(ms / DAY_MS)
  const h = Math.floor((ms % DAY_MS) / HOUR_MS)
  const m = Math.floor((ms % HOUR_MS) / MIN_MS)
  return `${d}d ${h}h ${m}m`
}

export type Budget = {
  daysLeft: number
  minutesLeft: number
  naturalStamina: number
  passStamina: number
  dailyRewardStamina: number
  totalDailyStamina: number
  mondayCount: number
  mondayStamina: number
  rewardStamina: number
  questDeduction: number
  totalAvailable: number
}

export type BudgetArgs = {
  nowMs: number
  endTimeStr: string | null
  hasMonthlyPass: boolean
  hasVipPass: boolean
  dailyQuestCost: number | string
}

/** Compute how much stamina will naturally accrue before an event ends. */
export function computeBudget({
  nowMs,
  endTimeStr,
  hasMonthlyPass,
  hasVipPass,
  dailyQuestCost,
}: BudgetArgs): Budget | null {
  const end = parseEndTime(endTimeStr)
  if (!end) return null

  const remaining = end - nowMs
  if (remaining <= 0) {
    return {
      daysLeft: 0,
      minutesLeft: 0,
      naturalStamina: 0,
      passStamina: 0,
      dailyRewardStamina: 0,
      totalDailyStamina: 0,
      mondayCount: 0,
      mondayStamina: 0,
      rewardStamina: 0,
      questDeduction: 0,
      totalAvailable: 0,
    }
  }

  const daysLeft = Math.floor(remaining / DAY_MS)
  const minutesLeft = Math.floor(remaining / MIN_MS)
  const naturalStamina = Math.floor(minutesLeft / 5)
  const passStamina = (hasMonthlyPass ? MONTHLY_PASS_STAMINA : 0) + (hasVipPass ? VIP_PASS_STAMINA : 0)
  const dailyRewardStamina = DAILY_REWARD_STAMINA + passStamina
  const totalDailyStamina = daysLeft * dailyRewardStamina
  const mondayCount = countMondays(nowMs, end)
  const mondayStamina = mondayCount * MONDAY_STAMINA
  const rewardStamina = totalDailyStamina + mondayStamina
  const questDeduction = daysLeft * Math.max(0, Number(dailyQuestCost) || 0)
  const totalAvailable = Math.max(0, naturalStamina + rewardStamina - questDeduction)

  return {
    daysLeft,
    minutesLeft,
    naturalStamina,
    passStamina,
    dailyRewardStamina,
    totalDailyStamina,
    mondayCount,
    mondayStamina,
    rewardStamina,
    questDeduction,
    totalAvailable,
  }
}

export type StageOption = {
  label: string
  idx: number
  energy: number
  points: number
}

/** Build the Stage dropdown options for an event config. */
export function buildStageOptions(cfg?: EventConfig): StageOption[] {
  if (!cfg?.columns?.length) return []
  const name = cfg.stage_name || ""
  return cfg.columns.map((col, idx) => ({
    label: name && col.energy ? `${name} (${col.energy})` : col.name || `Stage ${idx + 1}`,
    idx,
    energy: col.energy,
    points: col.points,
  }))
}

/** Gems required to refill a stamina deficit (0 if none). */
export function gemsForDeficit(deficit: number): number {
  if (deficit <= 0) return 0
  return Math.ceil(deficit / STAMINA_PER_REFILL) * GEMS_PER_REFILL
}
