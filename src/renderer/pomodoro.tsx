import React, { useEffect, useRef, useState } from "react";
import {
  LONG_BREAK_EVERY,
  MODE_LABELS,
  type PomodoroDurations,
  type PomodoroMode,
  type PomodoroState,
  cycleProgress,
  formatTime,
} from "./pomodoro-logic";

const MODES: PomodoroMode[] = ["work", "short", "long"];

export interface PomodoroTimerProps {
  state: PomodoroState;
  durations: PomodoroDurations;
  activeTaskTitle: string | null;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onModeChange: (mode: PomodoroMode) => void;
  onDurationChange: (mode: PomodoroMode, delta: number) => void;
}

export function PomodoroTimer({
  state,
  durations,
  activeTaskTitle,
  onStart,
  onPause,
  onReset,
  onModeChange,
  onDurationChange,
}: PomodoroTimerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
  const taskSuffix = activeTaskTitle ? ` — ${activeTaskTitle}` : "";

  return (
    <div className="pomodoro" ref={rootRef}>
      <button
        className={`pomodoro-chip ${runningClass} mode-${state.mode}`}
        onClick={() => setOpen((current) => !current)}
        title={`Pomodoro — ${MODE_LABELS[state.mode]} (${formatTime(state.secondsLeft)})${taskSuffix}`}
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
                onClick={() => onModeChange(mode)}
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

          <div className="pomodoro-task" title={activeTaskTitle ?? undefined}>
            {activeTaskTitle ?? "No task — time is not being recorded"}
          </div>

          <div className="pomodoro-actions">
            {state.running ? (
              <button className="pomodoro-action" onClick={onPause}>
                Pause
              </button>
            ) : (
              <button className="pomodoro-action primary" onClick={onStart}>
                Start
              </button>
            )}
            <button className="pomodoro-action" onClick={onReset}>
              Reset
            </button>
          </div>

          <div className="pomodoro-durations">
            {MODES.map((mode) => (
              <label key={mode} className="pomodoro-duration">
                <span>{MODE_LABELS[mode].split(" ")[0]}</span>
                <button
                  onClick={() => onDurationChange(mode, -1)}
                  title={`Decrease ${MODE_LABELS[mode]} duration`}
                >
                  −
                </button>
                <span className="pomodoro-duration-value">
                  {durations[mode]}m
                </span>
                <button
                  onClick={() => onDurationChange(mode, 1)}
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
