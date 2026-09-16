import { describe, expect, it } from 'vitest';
import {
  type Task,
  type TaskSession,
  addTask,
  describeStats,
  firstUnfinished,
  formatDuration,
  logSession,
  removeTask,
  taskStats,
  toggleTask,
} from '../src/renderer/todo-logic';
import { readTasks, writeTasks } from '../src/renderer/todo-store';

function createStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => data.delete(key),
    setItem: (key, value) => data.set(key, value),
  };
}

const session = (
  mode: TaskSession['mode'],
  seconds: number,
  completed = true,
): TaskSession => ({ mode, seconds, completed, endedAt: 0 });

function withSessions(sessions: TaskSession[]): Task {
  return { id: 't1', title: 'Write spec', done: false, createdAt: 0, sessions };
}

describe('todo list', () => {
  it('adds tasks and ignores blank titles', () => {
    const tasks = addTask(addTask([], 'Write spec'), '   ');
    expect(tasks.map((task) => task.title)).toEqual(['Write spec']);
    expect(tasks[0].done).toBe(false);
    expect(tasks[0].sessions).toEqual([]);
  });

  it('trims the title it stores', () => {
    expect(addTask([], '  Fix bug  ')[0].title).toBe('Fix bug');
  });

  it('toggles and removes a task by id', () => {
    const tasks = addTask(addTask([], 'one'), 'two');
    const id = tasks[0].id;
    expect(toggleTask(tasks, id)[0].done).toBe(true);
    expect(removeTask(tasks, id).map((task) => task.title)).toEqual(['two']);
  });

  it('picks the first unfinished task', () => {
    const tasks = addTask(addTask([], 'Write spec'), 'Fix bug');
    expect(firstUnfinished(tasks)?.title).toBe('Write spec');
    const afterFinish = toggleTask(tasks, tasks[0].id);
    expect(firstUnfinished(afterFinish)?.title).toBe('Fix bug');
    expect(firstUnfinished(afterFinish.map((task) => ({ ...task, done: true })))).toBeNull();
  });

  it('logs a session onto the named task only', () => {
    const tasks = addTask(addTask([], 'one'), 'two');
    const logged = logSession(tasks, tasks[1].id, session('work', 1500));
    expect(logged[0].sessions).toHaveLength(0);
    expect(logged[1].sessions).toEqual([session('work', 1500)]);
  });

  it('counts a completed work session and its focus time', () => {
    expect(taskStats(withSessions([session('work', 1500)]))).toEqual({
      workSessions: 1,
      shortBreaks: 0,
      longBreaks: 0,
      focusSeconds: 1500,
    });
  });

  it('counts work sessions, short breaks and long breaks separately', () => {
    const stats = taskStats(
      withSessions([
        session('work', 1500), session('short', 300),
        session('work', 1500), session('short', 300),
        session('work', 1500), session('short', 300),
        session('work', 1500), session('long', 900),
      ]),
    );
    expect(stats).toEqual({
      workSessions: 4,
      shortBreaks: 3,
      longBreaks: 1,
      focusSeconds: 6000,
    });
  });

  it('adds seconds from a partial work session without counting it', () => {
    const stats = taskStats(
      withSessions([session('work', 1500), session('work', 420, false)]),
    );
    expect(stats.workSessions).toBe(1);
    expect(stats.focusSeconds).toBe(1920);
  });

  it('formats durations in plain language', () => {
    expect(formatDuration(30)).toBe('30s');
    expect(formatDuration(2700)).toBe('45m');
    expect(formatDuration(4500)).toBe('1h 15m');
    expect(formatDuration(7200)).toBe('2h');
  });

  it('describes a worked task and stays silent for a fresh one', () => {
    expect(
      describeStats(taskStats(withSessions([
        session('work', 1500), session('work', 1500), session('work', 1500), session('long', 900),
      ]))),
    ).toBe('3 sessions, 1 long break, 1h 15m');
    expect(describeStats(taskStats(withSessions([])))).toBe('');
  });

  it('round-trips tasks and their sessions through an injected Storage', () => {
    const storage = createStorage();
    const tasks = addTask([], 'Write spec');
    writeTasks(logSession(tasks, tasks[0].id, session('work', 1500)), storage);
    const loaded = readTasks(storage);
    expect(loaded.map((task) => task.title)).toEqual(['Write spec']);
    expect(taskStats(loaded[0]).workSessions).toBe(1);
  });

  it('drops malformed entries instead of crashing', () => {
    const storage = createStorage();
    storage.setItem('md-mermaid-viewer-tasks', '[{"id":"a"},"nope"]');
    expect(readTasks(storage)).toEqual([]);
    storage.setItem('md-mermaid-viewer-tasks', 'not json');
    expect(readTasks(storage)).toEqual([]);
  });
});
