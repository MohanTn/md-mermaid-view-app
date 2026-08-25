import React from 'react';
import type { FileDocument, ParquetDocument, CodeGraphDocument } from '../../shared/types';
import { PomodoroTimer } from '../pomodoro';
import type { Theme } from '../hooks/use-theme';

interface ToolbarProps {
  document: FileDocument | ParquetDocument | CodeGraphDocument | null;
  collapsed: boolean;
  theme: Theme;
  onTogglePanel: () => void;
  onChooseFile: () => void;
  onThemeToggle: () => void;
  onOpenWorkspace: () => void;
}

export function Toolbar({
  document,
  collapsed,
  theme,
  onTogglePanel,
  onChooseFile,
  onThemeToggle,
  onOpenWorkspace,
}: ToolbarProps): React.JSX.Element {
  return (
    <header className="toolbar">
      <button
        className={`panel-toggle ${collapsed ? 'is-collapsed' : ''}`}
        onClick={onTogglePanel}
        title={collapsed ? 'Show file list (Ctrl+B)' : 'Hide file list (Ctrl+B)'}
        aria-label={collapsed ? 'Show file list' : 'Hide file list'}
        aria-expanded={!collapsed}
      >
        {collapsed ? '▶' : '◀'}
      </button>
      <button
        className="open-button"
        onClick={onChooseFile}
        title="Open file (Ctrl+O)"
      >
        Open…
      </button>
      <span className="toolbar-file" title={document?.path}>
        {document ? document.name : 'No file open'}
      </span>
      <button
        className="workspace-button"
        onClick={onOpenWorkspace}
        title="Open a project workspace for code graph analysis"
      >
        Code Graph
      </button>
      <PomodoroTimer />
      <button
        className="theme-toggle"
        onClick={onThemeToggle}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label="Toggle dark mode"
      >
        {theme === 'dark' ? '☾' : '☀'}
      </button>

    </header>
  );
}