// @vitest-environment jsdom
import { StrictMode, act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePomodoro, type UsePomodoroResult } from '../src/renderer/hooks/use-pomodoro';
import type { EndedSession } from '../src/renderer/pomodoro-logic';

const T0 = 1_700_000_000_000;
const WORK_SECONDS = 25 * 60;

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
let api: UsePomodoroResult;
let ended: EndedSession[];

// Mount the hook on its own so the test drives the same effects the app does:
// the interval, and the visibilitychange listener.
function Probe({ onEnd }: { onEnd: (session: EndedSession) => void }) {
  const pomodoro = usePomodoro(onEnd);
  useEffect(() => {
    api = pomodoro;
  });
  api = pomodoro;
  return null;
}

function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => value,
  });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

// Move the wall clock without giving the page any timer callbacks — what a
// throttled background tab looks like — then let a single callback through.
function throttledJump(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  ended = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(
      createElement(StrictMode, null, createElement(Probe, { onEnd: (s) => ended.push(s) })),
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('usePomodoro in a throttled tab', () => {
  it('counts down normally while the tab is awake', () => {
    act(() => api.startTimer());
    act(() => vi.advanceTimersByTime(3000));
    expect(api.state.secondsLeft).toBe(WORK_SECONDS - 3);
  });

  it('loses no time when the browser withholds tick callbacks', () => {
    act(() => api.startTimer());
    throttledJump(10 * 60_000);
    expect(api.state.secondsLeft).toBe(WORK_SECONDS - 600);
    expect(api.state.running).toBe(true);
  });

  it('completes a session that ran out while hidden, on the next callback', () => {
    act(() => api.startTimer());
    throttledJump(26 * 60_000);
    expect(api.state.mode).toBe('short');
    expect(api.state.running).toBe(false);
    expect(ended).toEqual([{ mode: 'work', seconds: WORK_SECONDS, completed: true }]);
  });

  it('catches up the moment the tab becomes visible again', () => {
    act(() => api.startTimer());
    setVisibility('hidden');
    vi.setSystemTime(T0 + 5 * 60_000); // hidden, no callbacks at all
    expect(api.state.secondsLeft).toBe(WORK_SECONDS);
    setVisibility('visible');
    expect(api.state.secondsLeft).toBe(WORK_SECONDS - 300);
  });

  it('charges the real elapsed time when a throttled session is paused', () => {
    act(() => api.startTimer());
    vi.setSystemTime(T0 + 7 * 60_000); // no callbacks: state still reads 25:00
    act(() => api.pauseTimer());
    expect(ended).toEqual([{ mode: 'work', seconds: 420, completed: false }]);
    expect(api.state.secondsLeft).toBe(WORK_SECONDS - 420);
  });

  it('resumes from where it was paused, not from the old deadline', () => {
    act(() => api.startTimer());
    throttledJump(60_000);
    act(() => api.pauseTimer());
    vi.setSystemTime(Date.now() + 30 * 60_000); // a long break away from the keyboard
    act(() => api.startTimer());
    throttledJump(60_000);
    expect(api.state.secondsLeft).toBe(WORK_SECONDS - 120);
  });

  it('stops the clock when the timer is not running', () => {
    throttledJump(10 * 60_000);
    expect(api.state.secondsLeft).toBe(WORK_SECONDS);
    expect(ended).toEqual([]);
  });
});
