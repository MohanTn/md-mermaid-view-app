import React from 'react';
import type { DiagramComment } from '../diagram-comments';
import { sidecarFileName } from '../diagram-comments';
import type { FileDocument } from '../../shared/types';

interface CommentsPanelProps {
  document: FileDocument;
  comments: DiagramComment[];
  commentTag: string;
  copied: boolean;
  onCommentTagChange: (tag: string) => void;
  onRemoveComment: (id: string, line: number) => void;
  onCopyComments: () => void;
  onClose: () => void;
}

export function CommentsPanel({
  document,
  comments,
  commentTag,
  copied,
  onCommentTagChange,
  onRemoveComment,
  onCopyComments,
  onClose,
}: CommentsPanelProps): React.JSX.Element {
  return (
    <aside className="comments-panel">
      <div className="comments-panel-header">
        <span>Comments</span>
        <button
          className="comments-close"
          onClick={onClose}
          aria-label="Close comments panel"
        >
          ×
        </button>
      </div>
      <label className="comments-tag">
        <span>Tag</span>
        <input
          value={commentTag}
          onChange={(event) => onCommentTagChange(event.target.value)}
          spellCheck={false}
        />
      </label>
      <div className="comments-file" title={`${document.name}_${commentTag}.txt`}>
        ↗ {sidecarFileName(document.name, commentTag)}
      </div>
      <div className="comments-list">
        {comments.map((comment, index) => (
          <div
            key={`${comment.id}-${comment.line}-${index}`}
            className="comment-item"
          >
            <div className="comment-item-head">
              <span className="comment-id">{comment.id}</span>
              <span className="comment-line">line {comment.line}</span>
              <button
                className="comment-remove"
                onClick={() => onRemoveComment(comment.id, comment.line)}
                title="Remove comment"
              >
                ×
              </button>
            </div>
            <div className="comment-text">{comment.text}</div>
          </div>
        ))}
        {comments.length === 0 && (
          <p className="comments-empty">
            Click a module in the diagram to attach a comment.
          </p>
        )}
      </div>
      <button
        className="comments-copy"
        onClick={onCopyComments}
        disabled={comments.length === 0}
      >
        {copied ? 'Copied ✓' : 'Copy comments'}
      </button>
    </aside>
  );
}