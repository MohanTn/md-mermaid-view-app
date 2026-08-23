import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DURATIONS,
  type PomodoroDurations,
  cycleProgress,
  formatTime,
  initialState,
  nextMode,
  reset,
  setMode,
  start,
  tick,
} from '../src/renderer/pomodoro-logic';

const quick: PomodoroDurations = { work: 1, short: 1, long: 1 };

describe('pomodoro timer', () => {
  it('starts on work mode with the full work duration, paused', () => {
    const state = initialState(quick);
    expect(state.mode).toBe('work');
    expect(state.secondsLeft).toBe(60);
    expect(state.running).toBe(false);
  });

  it('tick only counts down while running', () => {
    const paused = initialState(quick);
    expect(tick(paused, quick).secondsLeft).toBe(60);
    const running = start(initialState(quick));
    expect(tick(running, quick).secondsLeft).toBe(59);
  });

  it('moves to a short break after work, then back to work', () => {
    let state = start(initialState(quick));
    for (let i = 0; i < 60; i += 1) state = tick(state, quick);
    expect(state.mode).toBe('short');
    expect(state.running).toBe(false);
    state = start(state);
    for (let i = 0; i < 60; i += 1) state = tick(state, quick);
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
    expect(cycleProgress({ mode: 'work', secondsLeft: 0, running: false, completedWork: 0 })).toBe(0);
    expect(cycleProgress({ mode: 'work', secondsLeft: 0, running: false, completedWork: 1 })).toBe(1);
    expect(cycleProgress({ mode: 'work', secondsLeft: 0, running: false, completedWork: 4 })).toBe(0);
  });

  it('reset and setMode go back to a full paused session', () => {
    const state = start(setMode(initialState(quick), 'long', quick));
    const resetState = reset(state, quick);
    expect(resetState.running).toBe(false);
    expect(resetState.secondsLeft).toBe(60);
    const switched = setMode(state, 'short', quick);
    expect(switched.mode).toBe('short');
    expect(switched.running).toBe(false);
    expect(switched.secondsLeft).toBe(60);
  });

  it('formats time as mm:ss', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(1500)).toBe('25:00');
  });

  it('defaults to 25 / 5 / 15 minutes', () => {
    expect(DEFAULT_DURATIONS).toEqual({ work: 25, short: 5, long: 15 });
  });
});
