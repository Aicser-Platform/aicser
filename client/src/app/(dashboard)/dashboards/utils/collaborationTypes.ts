export type CollabUser = {
  user_id?: string;
  id?: string;
  username?: string;
  name?: string;
  email?: string;
  color?: string;
};

export type PeerCursor = {
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  widgetId?: string | null;
  updatedAt: number;
};

/** A saved dashboard comment (server: /api/dashboards/{id}/comments). */
export type DashboardComment = {
  id: string;
  dashboard_id: string;
  widget_id: string | null;
  parent_id: string | null;
  author: { id: string; name: string };
  body: string;
  deleted: boolean;
  edited_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string | null;
};

/** A top-level comment with its replies (one level deep). */
export type DashboardCommentThread = DashboardComment & { replies: DashboardComment[] };

export type DashboardCommentEvent = {
  dashboardId: string;
  event: 'comment:created' | 'comment:updated' | 'comment:deleted';
  comment: Partial<DashboardComment> & { id: string };
};

/** Window event useCollaboration dispatches when the live socket reports a comment change. */
export const DASHBOARD_COMMENT_EVENT = 'aicser:dashboard-comment';
