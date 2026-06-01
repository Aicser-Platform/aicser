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

export type CollabComment = {
  id: string;
  text: string;
  widget_id?: string | null;
  user?: CollabUser;
  timestamp: string;
};
