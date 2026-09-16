import type { PomodoroMode } from "./pomodoro-logic";

// A session is always one of the timer's three modes, so tasks reuse that type
// instead of inventing a parallel one.
export type SessionMode = PomodoroMode;

export interface TaskSession {
  mode: SessionMode;
  seconds: number;
  completed: boolean;
  endedAt: number;
}

export interface Task {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
  sessions: TaskSession[];
}

export interface TaskStats {
  workSessions: number;
  shortBreaks: number;
  longBreaks: number;
  focusSeconds: number;
}

export function createTaskId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// Append a task. A blank title is not a task, so the list comes back unchanged.
export function addTask(tasks: Task[], title: string): Task[] {
  const trimmed = title.trim();
  if (!trimmed) return tasks;
  return [
    ...tasks,
    {
      id: createTaskId(),
      title: trimmed,
      done: false,
      createdAt: Date.now(),
      sessions: [],
    },
  ];
}

export function toggleTask(tasks: Task[], id: string): Task[] {
  return tasks.map((task) =>
    task.id === id ? { ...task, done: !task.done } : task,
  );
}

export function removeTask(tasks: Task[], id: string): Task[] {
  return tasks.filter((task) => task.id !== id);
}

export function firstUnfinished(tasks: Task[]): Task | null {
  return tasks.find((task) => !task.done) ?? null;
}

export function logSession(
  tasks: Task[],
  id: string,
  session: TaskSession,
): Task[] {
  return tasks.map((task) =>
    task.id === id ? { ...task, sessions: [...task.sessions, session] } : task,
  );
}

// Totals are folded from the session list on every read, so a stored counter can
// never drift away from the sessions it claims to summarise. A partial work
// session adds its seconds to focus time but is not counted as a session.
export function taskStats(task: Task): TaskStats {
  const stats: TaskStats = {
    workSessions: 0,
    shortBreaks: 0,
    longBreaks: 0,
    focusSeconds: 0,
  };
  for (const session of task.sessions) {
    if (session.mode === "work") {
      stats.focusSeconds += session.seconds;
      if (session.completed) stats.workSessions += 1;
    } else if (session.completed) {
      if (session.mode === "short") stats.shortBreaks += 1;
      else stats.longBreaks += 1;
    }
  }
  return stats;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// One-line summary for a task row. Empty for a task nobody has worked on yet, so
// a fresh task shows its title alone instead of a row of zeros.
export function describeStats(stats: TaskStats): string {
  const parts: string[] = [];
  if (stats.workSessions) parts.push(plural(stats.workSessions, "session"));
  if (stats.shortBreaks) parts.push(plural(stats.shortBreaks, "short break"));
  if (stats.longBreaks) parts.push(plural(stats.longBreaks, "long break"));
  if (stats.focusSeconds) parts.push(formatDuration(stats.focusSeconds));
  return parts.join(", ");
}
