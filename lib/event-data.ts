// ============================================================================
// EVENT DATA — replace the placeholder values below with your real data.
//
// This is the data that originally came from the backend. Each event needs:
//   - enabled:    whether the event is currently running (set false to grey it out)
//   - stage_name: the event/stage name shown in the Stage dropdown
//   - end_time:   the event end, as "YYYY-MM-DDTHH:mm" interpreted in UTC+8.
//                 Use null if there is no end time.
//   - columns:    the list of selectable stages. Each stage has:
//                   energy → stamina cost per run
//                   points → base points earned per run (before Bonus %)
//                   name   → (optional) custom label; falls back to
//                            "<stage_name> (<energy>)" or "Stage N"
// ============================================================================

export type StageColumn = {
  name?: string
  energy: number
  points: number
}

export type EventConfig = {
  enabled: boolean
  stage_name: string
  end_time: string | null
  columns: StageColumn[]
}

export type EventData = {
  main: EventConfig
  rerun: EventConfig
}

export const EVENT_DATA: EventData = {
  main: {
    enabled: true,
    stage_name: "Main Event",
    end_time: "2026-09-20T12:00", // UTC+8
    columns: [
      { energy: 15, points: 100 },
      { energy: 20, points: 155 },
      { energy: 30, points: 210 },
      { energy: 50, points: 210 },
    ],
  },
  rerun: {
    enabled: true,
    stage_name: "Rerun Event",
    end_time: "2026-10-01T12:00", // UTC+8
    columns: [
      { energy: 15, points: 55 },
      { energy: 20, points: 85 },
      { energy: 30, points: 115 },
      { energy: 50, points: 150 },
    ],
  },
}
