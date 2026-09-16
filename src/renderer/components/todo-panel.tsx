import React, { useState } from 'react';
import { MODE_LABELS, type PomodoroMode } from '../pomodoro-logic';
import { type Task, describeStats, taskStats } from '../todo-logic';

export interface TodoPanelProps {
  tasks: Task[];
  activeTaskId: string | null;
  timerRunning: boolean;
  timerMode: PomodoroMode;
  onCreate: (title: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  onStartTask: (id: string) => void;
}

export function TodoPanel({
  tasks,
  activeTaskId,
  timerRunning,
  timerMode,
  onCreate,
  onToggle,
  onDelete,
  onSelect,
  onStartTask,
}: TodoPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const untagged = timerRunning && !activeTaskId;

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    onCreate(draft);
    setDraft('');
  }

  return (
    <div className="todo-section">
      <div className="todo-header">
        Tasks
        <span className="todo-count">{tasks.filter((task) => !task.done).length}</span>
      </div>
      <form className="todo-add" onSubmit={submit}>
        <input
          className="todo-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a task…"
          aria-label="Add a task"
        />
        <button className="todo-add-button" type="submit" title="Add task">
          ＋
        </button>
      </form>
      <div className="todo-body">
        {tasks.map((task) => {
          const stats = describeStats(taskStats(task));
          const active = task.id === activeTaskId;
          return (
            <div
              key={task.id}
              className={`todo-item ${active ? 'active' : ''} ${task.done ? 'done' : ''}`}
            >
              <div className="todo-row">
                <input
                  type="checkbox"
                  className="todo-check"
                  checked={task.done}
                  onChange={() => onToggle(task.id)}
                  aria-label={task.done ? `Reopen ${task.title}` : `Finish ${task.title}`}
                />
                <button
                  className="todo-title"
                  onClick={() => onSelect(task.id)}
                  title={task.title}
                >
                  {task.title}
                </button>
                {active && timerRunning && (
                  <span className="todo-running" title={`${MODE_LABELS[timerMode]} in progress`}>
                    ●
                  </span>
                )}
                {!task.done && !(active && timerRunning) && (
                  <button
                    className="todo-start"
                    onClick={() => onStartTask(task.id)}
                    title={`Start the timer on ${task.title}`}
                    aria-label={`Start the timer on ${task.title}`}
                  >
                    ▶
                  </button>
                )}
                <button
                  className="todo-delete"
                  onClick={() => onDelete(task.id)}
                  title={`Delete ${task.title}`}
                  aria-label={`Delete ${task.title}`}
                >
                  ×
                </button>
              </div>
              {stats && <div className="todo-stats">{stats}</div>}
            </div>
          );
        })}
        {tasks.length === 0 && (
          <p className="file-list-empty">Add a task to track your focus time here.</p>
        )}
        {untagged && tasks.length > 0 && (
          <p className="todo-hint">No task selected — this session is not being recorded.</p>
        )}
      </div>
    </div>
  );
}
