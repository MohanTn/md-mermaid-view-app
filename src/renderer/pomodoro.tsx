import React, { useEffect, useRef, useState } from "react";
import {
  DEFAULT_DURATIONS,
  LONG_BREAK_EVERY,
  MODE_LABELS,
  type PomodoroDurations,
  type PomodoroMode,
  type PomodoroState,
  cycleProgress,
  formatTime,
  initialState,
  pause,
  reset,
  setMode,
  start,
  tick,
} from "./pomodoro-logic";

const MODES: PomodoroMode[] = ["work", "short", "long"];

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
      const start = now + index * 0.28;
      const oscillator = audioContext!.createOscillator();
      const gain = audioContext!.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.5, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 1.2);
      oscillator.connect(gain);
      gain.connect(audioContext!.destination);
      oscillator.start(start);
      oscillator.stop(start + 1.3);
    });
  } catch {
    // Audio unavailable in this environment — ignore.
  }
}

export function PomodoroTimer(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [durations, setDurations] =
    useState<PomodoroDurations>(DEFAULT_DURATIONS);
  const [state, setState] = useState<PomodoroState>(() => initialState());
  const rootRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef(false);

  // Tick once per second while running; flag when a session completes.
  useEffect(() => {
    if (!state.running) return;
    const id = window.setInterval(() => {
      setState((current) => {
        const next = tick(current, durations);
        if (next.mode !== current.mode) completedRef.current = true;
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [state.running, durations]);

  // Chime when a session just completed (the flag is only set by the tick above,
  // never by manual mode switches or resets).
  useEffect(() => {
    if (!completedRef.current) return;
    completedRef.current = false;
    playChime();
  }, [state]);

  // Close the panel on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node))
        setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const cycle = cycleProgress(state);
  const runningClass = state.running ? "running" : "";

  return (
    <div className="pomodoro" ref={rootRef}>
      <button
        className={`pomodoro-chip ${runningClass} mode-${state.mode}`}
        onClick={() => setOpen((current) => !current)}
        title={`Pomodoro — ${MODE_LABELS[state.mode]} (${formatTime(state.secondsLeft)})`}
        aria-expanded={open}
      >
        <span className="pomodoro-dot" aria-hidden="true" />
        <span className="pomodoro-time">{formatTime(state.secondsLeft)}</span>
        <span className="pomodoro-caret" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="pomodoro-panel">
          <div className="pomodoro-mode-row">
            {MODES.map((mode) => (
              <button
                key={mode}
                className={`pomodoro-mode ${state.mode === mode ? "active" : ""}`}
                onClick={() => setState(setMode(state, mode, durations))}
              >
                {MODE_LABELS[mode]}
              </button>
            ))}
          </div>

          <div className="pomodoro-status">
            <span>{MODE_LABELS[state.mode]}</span>
            <span className="pomodoro-big">
              {formatTime(state.secondsLeft)}
            </span>
            <span
              className="pomodoro-cycle"
              title={`${cycle}/${LONG_BREAK_EVERY} work sessions in this cycle`}
            >
              {Array.from({ length: LONG_BREAK_EVERY }, (_, index) => (
                <span
                  key={index}
                  className={`pomodoro-cycle-dot ${index < cycle ? "filled" : ""}`}
                  aria-hidden="true"
                />
              ))}
              <span className="pomodoro-cycle-label">
                {cycle}/{LONG_BREAK_EVERY}
              </span>
            </span>
          </div>

          <div className="pomodoro-actions">
            {state.running ? (
              <button
                className="pomodoro-action"
                onClick={() => setState(pause(state))}
              >
                Pause
              </button>
            ) : (
              <button
                className="pomodoro-action primary"
                onClick={() => setState(start(state))}
              >
                Start
              </button>
            )}
            <button
              className="pomodoro-action"
              onClick={() => setState(reset(state, durations))}
            >
              Reset
            </button>
          </div>

          <div className="pomodoro-durations">
            {MODES.map((mode) => (
              <label key={mode} className="pomodoro-duration">
                <span>{MODE_LABELS[mode].split(" ")[0]}</span>
                <button
                  onClick={() =>
                    setDurations((current) => ({
                      ...current,
                      [mode]: Math.max(1, current[mode] - 1),
                    }))
                  }
                  title={`Decrease ${MODE_LABELS[mode]} duration`}
                >
                  −
                </button>
                <span className="pomodoro-duration-value">
                  {durations[mode]}m
                </span>
                <button
                  onClick={() =>
                    setDurations((current) => ({
                      ...current,
                      [mode]: current[mode] + 1,
                    }))
                  }
                  title={`Increase ${MODE_LABELS[mode]} duration`}
                >
                  ＋
                </button>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
