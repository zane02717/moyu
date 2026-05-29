import type { Activity, Comment, Notification, Post, PostStyle, SortMode, User } from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options
  });
  if (!response.ok) {
    let message = '请求失败';
    try {
      const data = await response.json();
      message = formatApiError(data.detail) ?? message;
    } catch {
      message = response.statusText;
    }
    throw new Error(message);
  }
  return response.json();
}

function formatApiError(detail: unknown): string | null {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item?.loc?.includes?.('password') && item?.type === 'string_too_short') return '密码至少需要 8 位';
        if (item?.loc?.includes?.('email')) return '请输入有效邮箱';
        if (item?.loc?.includes?.('nickname')) return '昵称不能为空';
        if (item?.loc?.includes?.('invite_code')) return '邀请码不正确';
        return typeof item?.msg === 'string' ? item.msg : null;
      })
      .filter(Boolean)
      .join('；');
  }
  return null;
}

export const api = {
  register: (payload: { email: string; nickname: string; password: string; invite_code?: string }) =>
    request<User>('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: { email: string; password: string }) =>
    request<User>('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<User>('/api/me'),
  notifications: () => request<{ items: Notification[]; unread_count: number }>('/api/notifications'),
  readNotifications: () => request<{ ok: boolean; unread_count: number }>('/api/notifications/read', { method: 'POST' }),
  activity: () => request<Activity>('/api/me/activity'),
  posts: (sort: SortMode, query = '') =>
    request<Post[]>(`/api/posts?sort=${sort}${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}`),
  adminPosts: () => request<Post[]>('/api/admin/posts'),
  createPost: (form: FormData) => request<Post>('/api/posts', { method: 'POST', body: form }),
  updatePost: (postId: number, payload: { title?: string; body?: string; category?: string; style_config?: PostStyle }) =>
    request<Post>(`/api/posts/${postId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deletePost: (postId: number) => request<{ ok: boolean }>(`/api/posts/${postId}`, { method: 'DELETE' }),
  like: (postId: number) => request<Post>(`/api/posts/${postId}/like`, { method: 'POST' }),
  unlike: (postId: number) => request<Post>(`/api/posts/${postId}/like`, { method: 'DELETE' }),
  comments: (postId: number) => request<Comment[]>(`/api/posts/${postId}/comments`),
  createComment: (postId: number, form: FormData) =>
    request<Comment>(`/api/posts/${postId}/comments`, { method: 'POST', body: form }),
  likeComment: (commentId: number) =>
    request<Comment>(`/api/comments/${commentId}/like`, { method: 'POST' }),
  unlikeComment: (commentId: number) =>
    request<Comment>(`/api/comments/${commentId}/like`, { method: 'DELETE' }),
  deleteComment: (commentId: number) =>
    request<{ ok: boolean }>(`/api/comments/${commentId}`, { method: 'DELETE' }),
  updatePostAdmin: (postId: number, payload: { is_hidden?: boolean; is_pinned?: boolean; status?: string }) =>
    request<Post>(`/api/admin/posts/${postId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteCommentAdmin: (commentId: number) =>
    request<{ ok: boolean }>(`/api/admin/comments/${commentId}`, { method: 'DELETE' })
};

export function uploadUrl(path: string): string {
  return path.startsWith('http') ? path : `${API_BASE}${path}`;
}

export function wsUrl(): string {
  const base = API_BASE || window.location.origin;
  const url = new URL(base, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  return url.toString();
}
