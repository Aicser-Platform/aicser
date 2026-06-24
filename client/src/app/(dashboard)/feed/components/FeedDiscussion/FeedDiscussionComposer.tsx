import React from 'react';
import { Button, Input } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { COMMENT_CHAR_LIMIT } from '../FeedCard/constants';

interface FeedDiscussionComposerProps {
  commentValue: string;
  onCommentValueChange: (value: string) => void;
  onCommentSubmit: () => void;
  commenting: boolean;
}

/** Always-visible comment composer for the Discussion panel. */
const FeedDiscussionComposer: React.FC<FeedDiscussionComposerProps> = ({
  commentValue,
  onCommentValueChange,
  onCommentSubmit,
  commenting,
}) => {
  const trimmedLength = commentValue.trim().length;
  const canSubmit = trimmedLength > 0 && trimmedLength <= COMMENT_CHAR_LIMIT && !commenting;

  return (
    <div className="rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] p-3">
      <Input.TextArea
        value={commentValue}
        onChange={(event) => onCommentValueChange(event.target.value)}
        placeholder="Write a comment..."
        maxLength={COMMENT_CHAR_LIMIT}
        autoSize={{ minRows: 2, maxRows: 6 }}
        className="rounded-lg border-[var(--ant-color-border)] focus:border-[var(--ant-color-primary)] !shadow-none"
        onPressEnter={(event) => {
          if (event.shiftKey) return;
          event.preventDefault();
          if (canSubmit) onCommentSubmit();
        }}
      />
      <div className="mt-2 flex items-center justify-end gap-3">
        <span className="text-xs font-medium text-[var(--ant-color-text-description)]">
          {commentValue.length}/{COMMENT_CHAR_LIMIT}
        </span>
        <Button
          type="primary"
          size="small"
          icon={<SendOutlined />}
          disabled={!canSubmit}
          loading={commenting}
          onClick={onCommentSubmit}
          className="rounded-md font-medium"
        >
          Send Comment
        </Button>
      </div>
    </div>
  );
};

export default FeedDiscussionComposer;
