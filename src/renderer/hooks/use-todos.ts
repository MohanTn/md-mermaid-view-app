import { useCallback, useMemo, useState } from "react";
import type { EndedSession } from "../pomodoro-logic";
import {
  type Task,
  addTask,
  firstUnfinished,
  logSession,
  removeTask,
  toggleTask,
} from "../todo-logic";
import { readTasks, writeTasks } from "../todo-store";

export interface UseTodosResult {
  tasks: Task[];
  activeTaskId: string | null;
  activeTask: Task | null;
  createTask: (title: string) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  selectTask: (id: string) => void;
  claimActiveTask: () => string | null;
  recordSession: (session: EndedSession) => void;
}

export function useTodos(): UseTodosResult {
  const [tasks, setTasks] = useState<Task[]>(() => readTasks());
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const persist = useCallback((next: Task[]) => {
    setTasks(writeTasks(next));
  }, []);

  const createTask = useCallback(
    (title: string) => persist(addTask(tasks, title)),
    [persist, tasks],
  );

  const toggle = useCallback(
    (id: string) => {
      const next = toggleTask(tasks, id);
      persist(next);
      // A finished task stops being the one the timer is tagging.
      if (next.find((task) => task.id === id)?.done && id === activeTaskId) {
        setActiveTaskId(null);
      }
    },
    [persist, tasks, activeTaskId],
  );

  const deleteTask = useCallback(
    (id: string) => {
      persist(removeTask(tasks, id));
      if (id === activeTaskId) setActiveTaskId(null);
    },
    [persist, tasks, activeTaskId],
  );

  const selectTask = useCallback((id: string) => setActiveTaskId(id), []);

  // Called just before the timer starts: keep the current task when it is still
  // unfinished, otherwise fall to the first unfinished task in the list.
  const claimActiveTask = useCallback((): string | null => {
    const current = tasks.find((task) => task.id === activeTaskId && !task.done);
    if (current) return current.id;
    const next = firstUnfinished(tasks);
    setActiveTaskId(next?.id ?? null);
    return next?.id ?? null;
  }, [tasks, activeTaskId]);

  // Tag an ended session onto the active task. The active task is not cleared
  // afterwards, so the break that follows a work session lands on the same task.
  const recordSession = useCallback(
    (session: EndedSession) => {
      if (!activeTaskId) return;
      setTasks((current) =>
        writeTasks(
          logSession(current, activeTaskId, { ...session, endedAt: Date.now() }),
        ),
      );
    },
    [activeTaskId],
  );

  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? null,
    [tasks, activeTaskId],
  );

  return {
    tasks,
    activeTaskId,
    activeTask,
    createTask,
    toggleTask: toggle,
    deleteTask,
    selectTask,
    claimActiveTask,
    recordSession,
  };
}
