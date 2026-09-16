import React, { type PointerEvent as ReactPointerEvent } from 'react';
import type { FileDocument, FileEntry, ParquetDocument, CodeGraphDocument } from '../../shared/types';
import { directoryName, groupHistory, type HistoryEntry } from '../history';
import { TodoPanel, type TodoPanelProps } from './todo-panel';

const MIN_PANEL = 140;
const MAX_PANEL = 480;

interface FileListProps {
  files: FileEntry[];
  history: HistoryEntry[];
  document: FileDocument | ParquetDocument | CodeGraphDocument | null;
  directory: string;
  collapsed: boolean;
  panelWidth: number;
  onLoadFile: (filePath: string) => void;
  onPanelWidthChange: (width: number) => void;
  todos: TodoPanelProps;
}

export function FileList({
  files,
  history,
  document,
  directory,
  collapsed,
  panelWidth,
  onLoadFile,
  onPanelWidthChange,
  todos,
}: FileListProps): React.JSX.Element | null {
  if (collapsed) return null;

  return (
    <>
      <aside className="file-list">
        <div className="file-list-header">
          {directory ? directory.split(/[\\/]/).pop() : 'Files'}
        </div>
        <div className="file-list-body">
          {files.map((file) => (
            <button
              key={file.path}
              className={`file-item ${document?.path === file.path ? 'selected' : ''}`}
              onClick={() => onLoadFile(file.path)}
              title={file.path}
            >
              {file.name}
            </button>
          ))}
          {files.length === 0 && (
            <p className="file-list-empty">No .md, .mmd, or .parquet files here.</p>
          )}
        </div>
        <TodoPanel {...todos} />
        <div className="history-section">
          <div className="history-header">Recent</div>
          <div className="history-body">
            {groupHistory(history).map((group) => (
              <div key={group.directory} className="history-group">
                <div className="history-group-header" title={group.directory}>
                  {group.directory ? directoryName(group.directory) : '(no folder)'}
                  <span className="history-group-count">{group.entries.length}</span>
                </div>
                {group.entries.map((entry) => (
                  <button
                    key={entry.path}
                    className={`file-item history-item ${document?.path === entry.path ? 'selected' : ''}`}
                    onClick={() => onLoadFile(entry.path)}
                    title={entry.path}
                  >
                    <span className="history-item-name">{entry.name}</span>
                    <span className="history-item-path">{group.directory}</span>
                  </button>
                ))}
              </div>
            ))}
            {history.length === 0 && (
              <p className="file-list-empty">Opened files will appear here.</p>
            )}
          </div>
        </div>
      </aside>
      <ResizeHandle panelWidth={panelWidth} onPanelWidthChange={onPanelWidthChange} />
    </>
  );
}

function ResizeHandle({
  panelWidth,
  onPanelWidthChange,
}: {
  panelWidth: number;
  onPanelWidthChange: (width: number) => void;
}): React.JSX.Element {
  const draggingRef = React.useRef(false);
  const dragStartX = React.useRef(0);
  const dragStartW = React.useRef(panelWidth);

  // Keep dragStartW in sync so the handler always reads the latest value.
  React.useEffect(() => {
    dragStartW.current = panelWidth;
  }, [panelWidth]);

  function onDown(event: ReactPointerEvent): void {
    event.preventDefault();
    draggingRef.current = true;
    dragStartX.current = event.clientX;
    dragStartW.current = panelWidth;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onMove(event: ReactPointerEvent): void {
    if (!draggingRef.current) return;
    const next = Math.max(
      MIN_PANEL,
      Math.min(MAX_PANEL, dragStartW.current + (event.clientX - dragStartX.current)),
    );
    onPanelWidthChange(next);
  }

  function onUp(event: ReactPointerEvent): void {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
  }

  return (
    <div
      className="resize-handle"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  );
}