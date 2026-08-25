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

// Advance one second. When a session finishes, move to the next mode and stop
// (the user starts the next session manually).
export function tick(
  state: PomodoroState,
  durations: PomodoroDurations,
): PomodoroState {
  if (!state.running) return state;
  if (state.secondsLeft > 1) {
    return { ...state, secondsLeft: state.secondsLeft - 1 };
  }
  const completedWork =
    state.mode === "work" ? state.completedWork + 1 : state.completedWork;
  const mode = nextMode(state.mode, completedWork);
  return {
    mode,
    secondsLeft: secondsFor(mode, durations),
    running: false,
    completedWork,
  };
}

export function start(state: PomodoroState): PomodoroState {
  return { ...state, running: true };
}

export function pause(state: PomodoroState): PomodoroState {
  return { ...state, running: false };
}

export function reset(
  state: PomodoroState,
  durations: PomodoroDurations,
): PomodoroState {
  return {
    ...state,
    secondsLeft: secondsFor(state.mode, durations),
    running: false,
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
