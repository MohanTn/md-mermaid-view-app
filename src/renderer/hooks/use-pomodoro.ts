import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_DURATIONS,
  type EndedSession,
  type PomodoroDurations,
  type PomodoroMode,
  type PomodoroState,
  endedSession,
  initialState,
  pause,
  reset,
  setMode,
  start,
  sync,
  tick,
} from "../pomodoro-logic";

// The clock is a wall-clock deadline, so this only sets how often the display
// catches up. Half a second keeps the digits honest without busy work.
const DISPLAY_INTERVAL_MS = 500;

// Pleasant two-tone chime generated with the Web Audio API (no audio asset).
let audioContext: AudioContext | null = null;
function playChime(): void {
  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) return;
    audioContext ??= new AudioContextCtor();
    void audioContext.resume();
    const now = audioContext.currentTime;
    const notes = [880, 1174.66]; // A5, D6
    notes.forEach((frequency, index) => {
      const startAt = now + index * 0.28;
      const oscillator = audioContext!.createOscillator();
      const gain = audioContext!.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(0.5, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + 1.2);
      oscillator.connect(gain);
      gain.connect(audioContext!.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 1.3);
    });
  } catch {
    // Audio unavailable in this environment — ignore.
  }
}

export interface UsePomodoroResult {
  state: PomodoroState;
  durations: PomodoroDurations;
  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  chooseMode: (mode: PomodoroMode) => void;
  changeDuration: (mode: PomodoroMode, delta: number) => void;
}

// Owns the single timer in the app. The toolbar chip and the task panel both
// read this state, which is why it no longer lives inside PomodoroTimer.
export function usePomodoro(
  onSessionEnd: (session: EndedSession) => void,
): UsePomodoroResult {
  const [durations, setDurations] =
    useState<PomodoroDurations>(DEFAULT_DURATIONS);
  const [state, setState] = useState<PomodoroState>(() => initialState());
  const pendingRef = useRef<EndedSession | null>(null);
  const onSessionEndRef = useRef(onSessionEnd);

  useEffect(() => {
    onSessionEndRef.current = onSessionEnd;
  });

  // Apply a transition and remember the session it ended, if any. Reporting
  // happens in an effect so the state updater stays free of side effects. The
  // state is synced to the wall clock first, so a transition that arrives after
  // a throttled stretch still measures the seconds that really elapsed.
  const transition = useCallback(
    (produce: (current: PomodoroState) => PomodoroState) => {
      setState((stale) => {
        const current = sync(stale, Date.now());
        const next = produce(current);
        const ended = endedSession(current, next, durations);
        if (ended) pendingRef.current = ended;
        return next;
      });
    },
    [durations],
  );

  // Re-read the clock while running. A background tab gets few of these calls,
  // which costs display smoothness only: each one recomputes from the deadline.
  useEffect(() => {
    if (!state.running) return;
    const advance = () => transition((current) => tick(current, durations));
    const id = window.setInterval(advance, DISPLAY_INTERVAL_MS);
    // Catch up the moment the tab comes back, without waiting for a tick.
    const onVisible = () => {
      if (document.visibilityState === "visible") advance();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state.running, durations, transition]);

  // Chime and report once per ended session. Only a session that ran its clock
  // out chimes — a pause or a manual switch is reported silently.
  useEffect(() => {
    const ended = pendingRef.current;
    if (!ended) return;
    pendingRef.current = null;
    if (ended.completed) playChime();
    onSessionEndRef.current(ended);
  }, [state]);

  const startTimer = useCallback(() => setState(start), []);
  const pauseTimer = useCallback(() => transition(pause), [transition]);
  const resetTimer = useCallback(
    () => transition((current) => reset(current, durations)),
    [transition, durations],
  );
  const chooseMode = useCallback(
    (mode: PomodoroMode) =>
      transition((current) => setMode(current, mode, durations)),
    [transition, durations],
  );
  const changeDuration = useCallback((mode: PomodoroMode, delta: number) => {
    setDurations((current) => ({
      ...current,
      [mode]: Math.max(1, current[mode] + delta),
    }));
  }, []);

  return {
    state,
    durations,
    startTimer,
    pauseTimer,
    resetTimer,
    chooseMode,
    changeDuration,
  };
}
