import React from 'react';
import type { FileDocument, ParquetDocument, CodeGraphDocument } from '../../shared/types';
import { PomodoroTimer } from '../pomodoro';
import type { ViewTransform } from '../zoom-pan';
import type { Theme } from '../hooks/use-theme';

interface ToolbarProps {
  document: FileDocument | ParquetDocument | CodeGraphDocument | null;
  collapsed: boolean;
  theme: Theme;
  transform: ViewTransform;
  isMermaid: boolean;
  commentsOpen: boolean;
  commentsCount: number;
  onTogglePanel: () => void;
  onChooseFile: () => void;
  onThemeToggle: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onToggleComments: () => void;
  onOpenWorkspace: () => void;
}

export function Toolbar({
  document,
  collapsed,
  theme,
  transform,
  isMermaid,
  commentsOpen,
  commentsCount,
  onTogglePanel,
  onChooseFile,
  onThemeToggle,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onToggleComments,
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
      {isMermaid && (
        <div className="zoom-controls" role="group" aria-label="Zoom controls">
          <button className="zoom-button" onClick={onZoomIn} title="Zoom in (Ctrl++)">
            ＋
          </button>
          <span className="zoom-level">{Math.round(transform.scale * 100)}%</span>
          <button className="zoom-button" onClick={onZoomOut} title="Zoom out (Ctrl+-)">
            −
          </button>
          <button
            className="zoom-button"
            onClick={onZoomReset}
            title="Reset zoom (Ctrl+0)"
          >
            1:1
          </button>
        </div>
      )}
      {isMermaid && (
        <button
          className={`comments-button ${commentsOpen ? 'active' : ''}`}
          onClick={onToggleComments}
          title="Add comments to the diagram (sidecar file)"
        >
          Comments{commentsCount > 0 ? ` (${commentsCount})` : ''}
        </button>
      )}
    </header>
  );
}