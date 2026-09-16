export type PomodoroMode = "work" | "short" | "long";

export interface PomodoroDurations {
  work: number; // minutes
  short: number; // minutes
  long: number; // minutes
}

export const DEFAULT_DURATIONS: PomodoroDurations = {
  work: 25,
  short: 5,
  long: 15,
};
export const LONG_BREAK_EVERY = 4;

export interface PomodoroState {
  mode: PomodoroMode;
  secondsLeft: number;
  running: boolean;
  completedWork: number; // total completed work sessions
  // Wall-clock deadline (epoch ms) while running, null while paused. The clock
  // is the deadline, not the tick count: browsers throttle a hidden tab's
  // timers to about one callback per minute, so counting ticks loses time.
  // secondsLeft is a cache of the deadline, refreshed by sync().
  endsAt: number | null;
  completedSessions: number; // sessions of any mode that ran their clock out
}

export const MODE_LABELS: Record<PomodoroMode, string> = {
  work: "Work",
  short: "Short break",
  long: "Long break",
};

export function initialState(
  durations: PomodoroDurations = DEFAULT_DURATIONS,
): PomodoroState {
  return {
    mode: "work",
    secondsLeft: durations.work * 60,
    running: false,
    completedWork: 0,
    endsAt: null,
    completedSessions: 0,
  };
}

function secondsFor(mode: PomodoroMode, durations: PomodoroDurations): number {
  return durations[mode] * 60;
}

export function nextMode(
  mode: PomodoroMode,
  completedWork: number,
): PomodoroMode {
  if (mode === "work") {
    return (completedWork + 1) % LONG_BREAK_EVERY === 0 ? "long" : "short";
  }
  return "work";
}

// Refresh secondsLeft from the wall clock. Safe to call at any cadence: a tab
// that was throttled for ten minutes lands on the right number in one call.
export function sync(state: PomodoroState, now: number): PomodoroState {
  if (!state.running || state.endsAt === null) return state;
  const secondsLeft = Math.max(0, Math.ceil((state.endsAt - now) / 1000));
  return secondsLeft === state.secondsLeft ? state : { ...state, secondsLeft };
}

// Re-read the clock. When the deadline has passed, move to the next mode and
// stop (the user starts the next session manually).
export function tick(
  state: PomodoroState,
  durations: PomodoroDurations,
  now: number = Date.now(),
): PomodoroState {
  if (!state.running) return state;
  const current = sync(state, now);
  if (current.secondsLeft > 0) return current;
  const completedWork =
    current.mode === "work" ? current.completedWork + 1 : current.completedWork;
  const mode = nextMode(current.mode, completedWork);
  return {
    mode,
    secondsLeft: secondsFor(mode, durations),
    running: false,
    completedWork,
    endsAt: null,
    completedSessions: current.completedSessions + 1,
  };
}

export interface EndedSession {
  mode: PomodoroMode;
  seconds: number;
  completed: boolean;
}

// Compare the state before and after one transition (a tick, a pause, a reset or
// a manual mode switch) and report the session that just ended, or null when
// nothing ended. Only tick() bumps completedSessions, so that counter is what
// separates a clock that ran out from a pause or a manual switch, which are
// partial sessions worth the seconds already spent. Pass a previous state that
// is in sync with the clock, otherwise a throttled tab reports too few seconds.
export function endedSession(
  previous: PomodoroState,
  next: PomodoroState,
  durations: PomodoroDurations,
): EndedSession | null {
  if (!previous.running) return null;
  const full = secondsFor(previous.mode, durations);
  if (next.completedSessions > previous.completedSessions) {
    return { mode: previous.mode, seconds: full, completed: true };
  }
  if (next.running) return null;
  const elapsed = full - previous.secondsLeft;
  return elapsed > 0
    ? { mode: previous.mode, seconds: elapsed, completed: false }
    : null;
}

export function start(
  state: PomodoroState,
  now: number = Date.now(),
): PomodoroState {
  return { ...state, running: true, endsAt: now + state.secondsLeft * 1000 };
}

export function pause(
  state: PomodoroState,
  now: number = Date.now(),
): PomodoroState {
  return { ...sync(state, now), running: false, endsAt: null };
}

export function reset(
  state: PomodoroState,
  durations: PomodoroDurations,
): PomodoroState {
  return {
    ...state,
    secondsLeft: secondsFor(state.mode, durations),
    running: false,
    endsAt: null,
  };
}

export function setMode(
  state: PomodoroState,
  mode: PomodoroMode,
  durations: PomodoroDurations,
): PomodoroState {
  return {
    ...state,
    mode,
    secondsLeft: secondsFor(mode, durations),
    running: false,
    endsAt: null,
  };
}

// Work sessions completed in the current cycle (0..LONG_BREAK_EVERY-1).
export function cycleProgress(state: PomodoroState): number {
  return state.completedWork % LONG_BREAK_EVERY;
}

export function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
