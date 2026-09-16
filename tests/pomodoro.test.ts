import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DURATIONS,
  type PomodoroDurations,
  type PomodoroState,
  cycleProgress,
  endedSession,
  formatTime,
  initialState,
  nextMode,
  pause,
  reset,
  setMode,
  start,
  sync,
  tick,
} from '../src/renderer/pomodoro-logic';

const quick: PomodoroDurations = { work: 1, short: 1, long: 1 };
const T0 = 1_700_000_000_000; // fixed epoch ms, so every test reads the same clock

// Run the timer forward to a point in time the way the app does: repeated ticks
// at `stepMs`. A small step models a visible tab, a huge one models a tab the
// browser throttled down to a single callback.
function advance(
  state: PomodoroState,
  durations: PomodoroDurations,
  fromMs: number,
  toMs: number,
  stepMs: number,
): PomodoroState {
  let current = state;
  for (let now = fromMs + stepMs; now <= toMs; now += stepMs) {
    current = tick(current, durations, now);
  }
  return current;
}

describe('pomodoro timer', () => {
  it('starts on work mode with the full work duration, paused', () => {
    const state = initialState(quick);
    expect(state.mode).toBe('work');
    expect(state.secondsLeft).toBe(60);
    expect(state.running).toBe(false);
    expect(state.endsAt).toBeNull();
  });

  it('tick only counts down while running', () => {
    const paused = initialState(quick);
    expect(tick(paused, quick, T0 + 1000).secondsLeft).toBe(60);
    const running = start(initialState(quick), T0);
    expect(tick(running, quick, T0 + 1000).secondsLeft).toBe(59);
  });

  it('start sets a wall-clock deadline from the remaining seconds', () => {
    const state = start(initialState(quick), T0);
    expect(state.endsAt).toBe(T0 + 60_000);
  });

  it('moves to a short break after work, then back to work', () => {
    let state = advance(start(initialState(quick), T0), quick, T0, T0 + 60_000, 1000);
    expect(state.mode).toBe('short');
    expect(state.running).toBe(false);
    expect(state.endsAt).toBeNull();
    state = advance(start(state, T0 + 60_000), quick, T0 + 60_000, T0 + 120_000, 1000);
    expect(state.mode).toBe('work');
    expect(state.completedWork).toBe(1);
  });

  it('gives a long break every fourth work session', () => {
    expect(nextMode('work', 0)).toBe('short');
    expect(nextMode('work', 1)).toBe('short');
    expect(nextMode('work', 2)).toBe('short');
    expect(nextMode('work', 3)).toBe('long');
  });

  it('tracks cycle progress within the current long-break block', () => {
    const base = initialState(quick);
    expect(cycleProgress({ ...base, completedWork: 0 })).toBe(0);
    expect(cycleProgress({ ...base, completedWork: 1 })).toBe(1);
    expect(cycleProgress({ ...base, completedWork: 4 })).toBe(0);
  });

  it('reset and setMode go back to a full paused session', () => {
    const state = start(setMode(initialState(quick), 'long', quick), T0);
    const resetState = reset(state, quick);
    expect(resetState.running).toBe(false);
    expect(resetState.secondsLeft).toBe(60);
    expect(resetState.endsAt).toBeNull();
    const switched = setMode(state, 'short', quick);
    expect(switched.mode).toBe('short');
    expect(switched.running).toBe(false);
    expect(switched.secondsLeft).toBe(60);
    expect(switched.endsAt).toBeNull();
  });

  it('formats time as mm:ss', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(1500)).toBe('25:00');
  });

  it('defaults to 25 / 5 / 15 minutes', () => {
    expect(DEFAULT_DURATIONS).toEqual({ work: 25, short: 5, long: 15 });
  });

  it('reports a work session that ran its clock out', () => {
    const running = start(initialState(quick), T0);
    const state = advance(running, quick, T0, T0 + 60_000, 1000);
    expect(endedSession(running, state, quick)).toEqual({ mode: 'work', seconds: 60, completed: true });
  });

  it('reports a completed break the same way', () => {
    const running = start(setMode(initialState(quick), 'short', quick), T0);
    const state = advance(running, quick, T0, T0 + 60_000, 1000);
    expect(endedSession(running, state, quick)).toEqual({ mode: 'short', seconds: 60, completed: true });
    expect(state.mode).toBe('work');
  });

  it('reports a paused session as partial, with the seconds already spent', () => {
    const state = advance(start(initialState(quick), T0), quick, T0, T0 + 20_000, 1000);
    expect(endedSession(state, pause(state, T0 + 20_000), quick)).toEqual({
      mode: 'work',
      seconds: 20,
      completed: false,
    });
  });

  it('treats a manual mode switch mid-session as partial, not completed', () => {
    const state = advance(start(initialState(quick), T0), quick, T0, T0 + 20_000, 1000);
    expect(endedSession(state, setMode(state, 'short', quick), quick)).toEqual({
      mode: 'work',
      seconds: 20,
      completed: false,
    });
  });

  it('reports nothing when the timer was not running or nothing elapsed', () => {
    const idle = initialState(quick);
    expect(endedSession(idle, tick(idle, quick, T0 + 1000), quick)).toBeNull();
    const running = start(idle, T0);
    expect(endedSession(running, pause(running, T0), quick)).toBeNull();
    expect(endedSession(running, tick(running, quick, T0), quick)).toBeNull();
  });
});

// A hidden browser tab gets its timers clamped, down to roughly one callback a
// minute. The clock has to survive on the deadline alone.
describe('pomodoro timer under a throttled tab', () => {
  const long: PomodoroDurations = { work: 25, short: 5, long: 15 };

  it('keeps the right time when ticks are dropped', () => {
    const running = start(initialState(long), T0);
    const throttled = advance(running, long, T0, T0 + 600_000, 60_000); // 10 ticks, 10 minutes
    const smooth = advance(running, long, T0, T0 + 600_000, 1000); // 600 ticks, same 10 minutes
    expect(throttled.secondsLeft).toBe(900);
    expect(smooth.secondsLeft).toBe(900);
  });

  it('finishes a session that ran out while the tab was hidden, in one tick', () => {
    const running = start(initialState(long), T0);
    // The tab was hidden for half an hour and gets a single callback back.
    const state = tick(running, long, T0 + 1_800_000);
    expect(state.mode).toBe('short');
    expect(state.running).toBe(false);
    expect(state.completedWork).toBe(1);
    expect(endedSession(running, state, long)).toEqual({ mode: 'work', seconds: 1500, completed: true });
  });

  it('never runs the clock past zero into the next session', () => {
    const running = start(initialState(long), T0);
    const state = tick(running, long, T0 + 5_400_000); // three work sessions' worth of absence
    expect(state.completedWork).toBe(1);
    expect(state.secondsLeft).toBe(300); // a fresh short break, not a negative clock
  });

  it('sync catches a stale state up without advancing the session', () => {
    const running = start(initialState(long), T0);
    const caught = sync(running, T0 + 90_000);
    expect(caught.secondsLeft).toBe(1410);
    expect(caught.mode).toBe('work');
    expect(caught.running).toBe(true);
  });

  it('sync leaves a paused timer alone', () => {
    const paused = pause(start(initialState(long), T0), T0 + 10_000);
    expect(paused.secondsLeft).toBe(1490);
    expect(sync(paused, T0 + 999_000)).toBe(paused);
  });

  it('charges the real elapsed time when a throttled session is paused', () => {
    const running = start(initialState(long), T0);
    // One late callback, then the user pauses on the same clock reading.
    const state = tick(running, long, T0 + 300_000);
    expect(endedSession(state, pause(state, T0 + 300_000), long)).toEqual({
      mode: 'work',
      seconds: 300,
      completed: false,
    });
  });
});
