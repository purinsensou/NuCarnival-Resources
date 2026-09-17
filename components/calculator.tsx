"use client"

import { useEffect, useMemo, useState } from "react"
import { EVENT_DATA } from "@/lib/event-data"
import {
  buildStageOptions,
  computeBudget,
  formatCountdown,
  gemsForDeficit,
  parseEndTime,
  BOOST_VALUES,
  DAILY_PURCHASE_CAP,
  type Budget,
  type StageOption,
} from "@/lib/calc"

type EventKey = "main" | "rerun"

type EventInput = {
  currentScore: string
  target: string
  stageIdx: number
  bonus: string
}

type State = {
  main: EventInput
  rerun: EventInput
  hasMonthlyPass: boolean
  hasVipPass: boolean
  dailyQuestCost: string
  boosts: { tiny: string; basic: string; strong: string }
}

const DEFAULT_STATE: State = {
  main: { currentScore: "", target: "", stageIdx: 0, bonus: "" },
  rerun: { currentScore: "", target: "", stageIdx: 0, bonus: "" },
  hasMonthlyPass: false,
  hasVipPass: false,
  dailyQuestCost: "",
  boosts: { tiny: "", basic: "", strong: "" },
}

const STORAGE_KEY = "nuc_calc_v1"
const PRIORITY_KEY = "nuc_priority_v1"

function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : DEFAULT_STATE
  } catch {
    return DEFAULT_STATE
  }
}

const fmt = (n: number) => n.toLocaleString("en-US")

export function Calculator() {
  const [state, setState] = useState<State>(DEFAULT_STATE)
  const [hydrated, setHydrated] = useState(false)
  const [priority, setPriority] = useState<EventKey>("main")
  const [, forceTick] = useState(0)

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    setState(loadState())
    try {
      const p = localStorage.getItem(PRIORITY_KEY)
      if (p === "main" || p === "rerun") setPriority(p)
    } catch {}
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {}
  }, [state, hydrated])

  // Re-render every 30s to keep countdowns/budgets fresh
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 30000)
    return () => clearInterval(id)
  }, [])

  function setPriorityPersisted(key: EventKey) {
    setPriority(key)
    try {
      localStorage.setItem(PRIORITY_KEY, key)
    } catch {}
  }

  function updateEvent(key: EventKey, field: keyof EventInput, value: string | number) {
    setState((s) => ({ ...s, [key]: { ...s[key], [field]: value } }))
  }
  function updateRoot<K extends keyof State>(field: K, value: State[K]) {
    setState((s) => ({ ...s, [field]: value }))
  }
  function updateBoost(field: keyof State["boosts"], value: string) {
    setState((s) => ({ ...s, boosts: { ...s.boosts, [field]: value } }))
  }

  const rows = useMemo(() => {
    const now = Date.now()

    const boostStamina =
      (Number(state.boosts.tiny) || 0) * BOOST_VALUES.tiny +
      (Number(state.boosts.basic) || 0) * BOOST_VALUES.basic +
      (Number(state.boosts.strong) || 0) * BOOST_VALUES.strong

    const options: Record<EventKey, StageOption[]> = {
      main: buildStageOptions(EVENT_DATA.main),
      rerun: buildStageOptions(EVENT_DATA.rerun),
    }

    const enabled: Record<EventKey, boolean> = {
      main: EVENT_DATA.main.enabled !== false,
      rerun: EVENT_DATA.rerun.enabled !== false,
    }

    const endMs: Record<EventKey, number | null> = {
      main: parseEndTime(EVENT_DATA.main.end_time),
      rerun: parseEndTime(EVENT_DATA.rerun.end_time),
    }

    // Dual mode: both events active with end times → priority allocation applies
    const dual = enabled.main && enabled.rerun && !!endMs.main && !!endMs.rerun
    // The event that ends first is the primary priority (J); the other is secondary (Y)
    const primaryKey: EventKey = dual && (endMs.main as number) <= (endMs.rerun as number) ? "main" : "rerun"
    const secondaryKey: EventKey = primaryKey === "main" ? "rerun" : "main"
    const earliestEnd = dual ? Math.min(endMs.main as number, endMs.rerun as number) : null

    // Effective user priority (auto-forced when only one event is active)
    const effectivePriority: EventKey = !enabled.main && enabled.rerun
      ? "rerun"
      : enabled.main && !enabled.rerun
        ? "main"
        : priority

    const budgetArgs = (nowMs: number, key: EventKey) => ({
      nowMs,
      endTimeStr: EVENT_DATA[key].end_time,
      hasMonthlyPass: state.hasMonthlyPass,
      hasVipPass: state.hasVipPass,
      dailyQuestCost: state.dailyQuestCost,
    })
    const withBoost = (b: Budget | null) => (b ? { ...b, totalAvailable: b.totalAvailable + boostStamina } : null)

    // Priority budget: whole remaining time counts toward the primary event.
    const primaryBudget = dual ? withBoost(computeBudget(budgetArgs(now, primaryKey))) : null
    // Secondary budget: only the leftover time after the earliest end counts (no boost added).
    const secondaryBudget = dual && earliestEnd ? computeBudget(budgetArgs(earliestEnd, secondaryKey)) : null

    const singleBudget = (key: EventKey) => withBoost(computeBudget(budgetArgs(now, key)))

    // Base per-event computation
    const base = (["main", "rerun"] as EventKey[]).map((key) => {
      const input = state[key]
      const disabled = !enabled[key]
      const curr = Number(input.currentScore) || 0
      const target = Number(input.target) || 0
      const targetErr = input.target !== "" && target < curr
      const needed = !disabled && target >= curr ? target - curr : null
      const stage = options[key][input.stageIdx]
      const bonus = Math.min(100, Math.max(0, Number(input.bonus) || 0))
      const ptsPerRun = stage ? (Number(stage.points) || 0) * (1 + bonus / 100) : 0
      const stamina = (stage && Number(stage.energy)) || 0
      const runsNeeded = !disabled && ptsPerRun > 0 && needed !== null ? Math.ceil(needed / ptsPerRun) : null
      const totalStaminaNeeded = runsNeeded !== null ? runsNeeded * stamina : null
      const end = endMs[key]
      const remaining = end ? Math.max(0, end - now) : null
      const evDaysLeft = remaining != null ? Math.floor(remaining / 864e5) : null
      const countdown = remaining != null ? formatCountdown(remaining) : null
      const runsPerDay = runsNeeded != null && evDaysLeft && evDaysLeft > 0 ? runsNeeded / evDaysLeft : null

      return {
        key,
        label: EVENT_DATA[key].stage_name || (key === "main" ? "Main Event" : "Rerun Event"),
        disabled,
        curr,
        target,
        targetErr,
        needed,
        stage,
        bonus,
        ptsPerRun,
        stamina,
        runsNeeded,
        totalStaminaNeeded,
        countdown,
        runsPerDay,
        evDaysLeft,
        input,
        options: options[key],
      }
    })

    const primaryRow = base.find((r) => r.key === primaryKey)!
    const secondaryRow = base.find((r) => r.key === secondaryKey)!
    const primaryNeed = dual && !primaryRow.disabled ? primaryRow.totalStaminaNeeded ?? null : null
    const secondaryNeed = dual && !secondaryRow.disabled ? secondaryRow.totalStaminaNeeded ?? null : null

    // Available stamina for a given event, after priority allocation.
    function availableFor(key: EventKey): number {
      if (!dual) return singleBudget(key)?.totalAvailable ?? 0
      const primaryTotal = primaryBudget?.totalAvailable ?? 0
      const secondaryLeftover = secondaryBudget?.totalAvailable ?? 0

      if (effectivePriority === primaryKey) {
        const toPrimary = primaryNeed != null ? Math.min(primaryTotal, primaryNeed) : primaryTotal
        const leftover = Math.max(0, primaryTotal - toPrimary)
        return key === primaryKey ? toPrimary : leftover + secondaryLeftover
      } else {
        const secRemainingNeed = secondaryNeed != null ? Math.max(0, secondaryNeed - secondaryLeftover) : 0
        const fromPrimary = Math.min(primaryTotal, secRemainingNeed)
        const primaryLeftover = Math.max(0, primaryTotal - fromPrimary)
        return key === secondaryKey ? fromPrimary + secondaryLeftover : primaryLeftover
      }
    }

    const result = base.map((r) => {
      const available = availableFor(r.key)
      const deficit = !r.disabled && r.totalStaminaNeeded != null ? Math.max(0, r.totalStaminaNeeded - available) : 0
      const netGemsNeeded = r.disabled || r.totalStaminaNeeded == null ? null : gemsForDeficit(deficit)
      const daysAtCap = deficit > 0 ? Math.ceil(deficit / DAILY_PURCHASE_CAP) : 0
      const capExceeded = daysAtCap > 0 && r.evDaysLeft != null && daysAtCap > r.evDaysLeft
      return { ...r, available, deficit, netGemsNeeded, daysAtCap, capExceeded, isPriority: r.key === effectivePriority }
    })

    const active = result.filter((r) => !r.disabled)
    const totalStamina = active.reduce((sum, r) => sum + (r.totalStaminaNeeded ?? 0), 0)
    const totalGems = active.reduce((sum, r) => sum + (r.netGemsNeeded ?? 0), 0)
    const totalDeficit = active.reduce((sum, r) => sum + Math.max(0, (r.totalStaminaNeeded ?? 0) - r.available), 0)

    return { result, dual, effectivePriority, totalStamina, totalGems, totalDeficit, boostStamina }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, priority, hydrated])

  return (
    <div className="calc">
      <table className="sheet">
        <thead>
          <tr>
            <th className="config-head">Configuration</th>
            {rows.result.map((r) => (
              <th key={r.key} className="event-head" style={{ opacity: r.disabled ? 0.35 : 1 }}>
                {r.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <ConfigRow label="Current Score">
            {rows.result.map((r) => (
              <td key={r.key}>
                {r.disabled ? <Dash /> : (
                  <NumberInput
                    value={r.input.currentScore}
                    onChange={(v) => updateEvent(r.key, "currentScore", v)}
                    max={100000}
                    placeholder="0"
                  />
                )}
              </td>
            ))}
          </ConfigRow>

          <ConfigRow label="Target Score">
            {rows.result.map((r) => (
              <td key={r.key}>
                {r.disabled ? <Dash /> : (
                  <>
                    <NumberInput
                      value={r.input.target}
                      onChange={(v) => updateEvent(r.key, "target", v)}
                      max={100000}
                      placeholder="0"
                      error={r.targetErr}
                    />
                    {r.targetErr && <p className="err">Must be ≥ current score</p>}
                  </>
                )}
              </td>
            ))}
          </ConfigRow>

          <ConfigRow label="Stage">
            {rows.result.map((r) => (
              <td key={r.key}>
                {r.disabled ? <Dash /> : (
                  <select
                    className="select"
                    value={r.input.stageIdx}
                    onChange={(e) => updateEvent(r.key, "stageIdx", Number(e.target.value))}
                  >
                    {r.options.map((o) => (
                      <option key={o.idx} value={o.idx}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
              </td>
            ))}
          </ConfigRow>

          <ConfigRow label="Bonus %">
            {rows.result.map((r) => (
              <td key={r.key}>
                {r.disabled ? <Dash /> : (
                  <NumberInput
                    value={r.input.bonus}
                    onChange={(v) => updateEvent(r.key, "bonus", v)}
                    max={100}
                    placeholder="0"
                  />
                )}
              </td>
            ))}
          </ConfigRow>

          <tr>
            <td className="row-label">Monthly Pass</td>
            <td colSpan={2} className="center-cell">
              <Checkbox checked={state.hasMonthlyPass} onChange={(v) => updateRoot("hasMonthlyPass", v)} />
            </td>
          </tr>
          <tr>
            <td className="row-label">VIP Pass</td>
            <td colSpan={2} className="center-cell">
              <Checkbox checked={state.hasVipPass} onChange={(v) => updateRoot("hasVipPass", v)} />
            </td>
          </tr>

          <tr>
            <td className="row-label">Boosts</td>
            <td colSpan={2} className="boosts-cell">
              <div className="boosts">
                {([
                  { key: "tiny", mult: BOOST_VALUES.tiny },
                  { key: "basic", mult: BOOST_VALUES.basic },
                  { key: "strong", mult: BOOST_VALUES.strong },
                ] as const).map(({ key, mult }) => (
                  <div key={key} className="boost">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={state.boosts[key] ?? ""}
                      placeholder="0"
                      title={`×${mult} stamina each`}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/[^0-9]/g, "")
                        const clamped = digits === "" ? "" : String(Math.min(100, Math.max(0, parseInt(digits, 10))))
                        updateBoost(key, clamped)
                      }}
                      className="boost-input"
                    />
                    <span className="boost-mult">×{mult}</span>
                  </div>
                ))}
              </div>
            </td>
          </tr>

          <tr>
            <td className="row-label">Daily Quest Cost</td>
            <td colSpan={2} className="center-cell">
              <NumberInput
                value={state.dailyQuestCost}
                onChange={(v) => updateRoot("dailyQuestCost", v)}
                max={1000}
                placeholder="0"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <div className="results">
        {rows.result.map((r) => (
          <div key={r.key} className="result-box" style={{ opacity: r.disabled ? 0.45 : 1 }}>
            <div className="result-top">
              <span className="result-title">{r.label}</span>
              {!r.disabled && rows.dual && (
                <button
                  className={`prio-btn ${r.isPriority ? "on" : ""}`}
                  onClick={() => setPriorityPersisted(r.key)}
                  title={r.isPriority ? "Priority: ON" : "Set as priority"}
                >
                  {r.isPriority ? "Priority" : "Less Priority"}
                </button>
              )}
            </div>

            {r.disabled ? (
              <div className="result-metrics">
                {["Gems needed", "Runs needed"].map((l) => (
                  <div key={l}>
                    <div className="result-label">{l}</div>
                    <div className="result-x">✕</div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="result-metrics">
                  <div>
                    <div className="result-label">Gems needed</div>
                    <div className="gem-value">
                      {r.netGemsNeeded === null ? (
                        <span className="muted-value">—</span>
                      ) : (
                        <span className="result-value" style={{ color: r.capExceeded ? "var(--danger)" : undefined }}>
                          {fmt(r.netGemsNeeded)}
                        </span>
                      )}
                    </div>
                  </div>
                  {r.runsNeeded !== null && (
                    <div style={{ textAlign: "right" }}>
                      <div className="result-label">Runs needed</div>
                      <div className="run-value">
                        <span className="result-value accent">{fmt(r.runsNeeded)}</span>
                        <span className="unit">runs</span>
                      </div>
                    </div>
                  )}
                </div>

                {r.ptsPerRun > 0 && (
                  <div className="result-foot">
                    <div className="foot-line">
                      <span>{Math.floor(r.ptsPerRun)} pts/run</span>
                      {r.runsPerDay != null && <span>{r.runsPerDay.toFixed(1)} runs/day</span>}
                      {r.daysAtCap > 0 && (
                        <span className={r.capExceeded ? "cap danger" : "cap"}>{r.daysAtCap}d at cap</span>
                      )}
                    </div>
                    {r.capExceeded && (
                      <div className="cap-warn">
                        ⚠ Event ends in {r.evDaysLeft}d — daily cap ({fmt(DAILY_PURCHASE_CAP)}/day) prevents buying all
                        stamina in time.
                      </div>
                    )}
                    {r.countdown && (
                      <div className="countdown">{r.countdown === "Ended" ? "Ended" : `Ends in ${r.countdown}`}</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <div className="summary">
        <div className="summary-title">Combined Total</div>
        <div className="summary-grid">
          <div>
            <div className="result-label">Total stamina needed</div>
            <div className="summary-value">{fmt(rows.totalStamina)}</div>
          </div>
          <div>
            <div className="result-label">Stamina deficit</div>
            <div className="summary-value">{fmt(rows.totalDeficit)}</div>
          </div>
          <div>
            <div className="result-label">Total gems needed</div>
            <div className="summary-value accent">{fmt(rows.totalGems)}</div>
          </div>
        </div>
        {rows.boostStamina > 0 && (
          <div className="summary-note">Includes {fmt(rows.boostStamina)} stamina from boosts.</div>
        )}
      </div>
    </div>
  )
}

function ConfigRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td className="row-label">{label}</td>
      {children}
    </tr>
  )
}

function Dash() {
  return <span className="dash">—</span>
}

function NumberInput({
  value,
  onChange,
  min = 0,
  max,
  placeholder,
  error,
}: {
  value: string
  onChange: (v: string) => void
  min?: number
  max?: number
  placeholder?: string
  error?: boolean
}) {
  const display = value !== "" && value != null ? Number(value).toLocaleString("en-US") : ""
  return (
    <input
      type="text"
      inputMode="numeric"
      className="num-input"
      style={error ? { borderColor: "var(--danger)" } : undefined}
      value={display}
      placeholder={placeholder}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^0-9]/g, "")
        if (digits === "") return onChange("")
        const n = parseInt(digits, 10)
        if (Number.isNaN(n)) return
        const clamped = max != null ? Math.min(max, Math.max(min, n)) : Math.max(min, n)
        onChange(String(clamped))
      }}
    />
  )
}

function Checkbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
