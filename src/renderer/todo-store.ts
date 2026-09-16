import type { Task, TaskSession } from "./todo-logic";

const TASKS_KEY = "md-mermaid-viewer-tasks";

export function readTasks(storage: Storage = window.localStorage): Task[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(TASKS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(isTask) : [];
  } catch {
    return [];
  }
}

export function writeTasks(
  tasks: Task[],
  storage: Storage = window.localStorage,
): Task[] {
  storage.setItem(TASKS_KEY, JSON.stringify(tasks));
  return tasks;
}

function isSession(value: unknown): value is TaskSession {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TaskSession>;
  return (
    (item.mode === "work" || item.mode === "short" || item.mode === "long") &&
    typeof item.seconds === "number" &&
    typeof item.completed === "boolean" &&
    typeof item.endedAt === "number"
  );
}

function isTask(value: unknown): value is Task {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Task>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.done === "boolean" &&
    typeof item.createdAt === "number" &&
    Array.isArray(item.sessions) &&
    item.sessions.every(isSession)
  );
}
