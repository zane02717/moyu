export type User = {
  id: number;
  email: string;
  nickname: string;
  role: 'user' | 'admin';
};

export type Attachment = {
  id: number;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  url: string;
  created_at: string;
};

export type PostStyle = {
  fontFamily?: 'system' | 'hei' | 'song' | 'serif' | 'mono';
  titleSize?: 'compact' | 'normal' | 'large';
  bodySize?: 'compact' | 'normal' | 'large';
  titleColor?: 'green' | 'blue' | 'red' | 'gold' | 'ink';
  bodyColor?: 'green' | 'blue' | 'red' | 'gold' | 'ink';
  accent?: 'green' | 'blue' | 'red' | 'gold' | 'ink';
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

export type Post = {
  id: number;
  title: string;
  body: string;
  style_config: PostStyle;
  category: string;
  status: string;
  is_pinned: boolean;
  is_hidden: boolean;
  like_count: number;
  comment_count: number;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  author: User;
  attachments: Attachment[];
  liked_by_me: boolean;
};

export type Comment = {
  id: number;
  post_id: number;
  reply_to_comment_id: number | null;
  reply_to: {
    id: number;
    author_nickname: string;
    body_preview: string;
  } | null;
  body: string;
  style_config: PostStyle;
  like_count: number;
  liked_by_me: boolean;
  is_deleted: boolean;
  created_at: string;
  author: User;
  attachments: Attachment[];
};

export type SortMode = 'hot' | 'latest';

export type Activity = {
  posts: Post[];
  comments: Array<Comment & { post: { id: number; title: string } }>;
};

export type Notification = {
  id: number;
  type: 'post_liked' | 'post_commented' | 'comment_replied' | 'comment_liked';
  post_id: number | null;
  comment_id: number | null;
  is_read: boolean;
  created_at: string;
  actor: { id: number; nickname: string } | null;
  post_title: string | null;
  comment_preview: string | null;
};

export type RealtimeEvent =
  | { type: 'post_created'; payload: Post }
  | { type: 'post_updated'; payload: Post }
  | { type: 'post_hidden'; payload: Post }
  | { type: 'post_deleted'; payload: { id: number } }
  | { type: 'comment_created'; payload: Comment }
  | { type: 'comment_deleted'; payload: { id: number; post_id: number } }
  | { type: 'comment_like_changed'; payload: Comment }
  | { type: 'notification_created'; payload: { notification: Notification; user_id: number; unread_count: number } }
  | { type: 'like_changed'; payload: Post }
  | { type: 'image_added'; payload: { owner_type: string; owner_id: number; attachments: Attachment[] } };
