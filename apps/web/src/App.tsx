import { ChangeEvent, CSSProperties, FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Eye,
  EyeOff,
  FileImage,
  Heart,
  Bell,
  LogOut,
  MessageSquare,
  Pin,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  Type,
  Save,
  ZoomIn,
  ZoomOut,
  X
} from 'lucide-react';
import { api, uploadUrl, wsUrl } from './api';
import type { Attachment, Comment, Notification, Post, PostStyle, RealtimeEvent, SortMode, User } from './types';

type AuthMode = 'login' | 'register';
type ForumTab = 'all' | 'hot' | 'hall' | 'gossip' | 'discussion' | 'goods' | 'my-posts' | 'my-comments' | 'admin';
type CommentSort = 'latest' | 'liked';
type StyleColor = NonNullable<PostStyle['accent']>;

const productName = '格间';
const AuthScene = lazy(() => import('./AuthScene').then((module) => ({ default: module.AuthScene })));
const categories = ['摸鱼大厅', '八卦分享厅', '讨论区', '好物推荐区'];
const categoryTabs: Record<'hall' | 'gossip' | 'discussion' | 'goods', string> = {
  hall: '摸鱼大厅',
  gossip: '八卦分享厅',
  discussion: '讨论区',
  goods: '好物推荐区'
};
const legacyCategoryMap: Record<string, string> = {
  讨论: '讨论区',
  分享: '好物推荐区',
  记录: '摸鱼大厅',
  图片: '摸鱼大厅',
  求助: '摸鱼大厅'
};
const styleColors: StyleColor[] = ['green', 'blue', 'red', 'gold', 'ink'];
const colorLabels: Record<StyleColor, string> = {
  green: '绿',
  blue: '蓝',
  red: '红',
  gold: '金',
  ink: '墨'
};
const sheetColumns = Array.from({ length: 22 }, (_, index) => String.fromCharCode(65 + index));
const sheetRowCount = 70;
const sheetColumnCount = 22;
const sheetRows = Array.from({ length: sheetRowCount }, (_, index) => index + 1);
const palette = ['yellow', 'red', 'blue', 'green', 'pink', 'white', 'hatched'];
const maxFiles = 4;
const maxImageBytes = 5 * 1024 * 1024;
const composerMinHeight = 132;
const composerMaxHeight = 360;
const composerDefaultHeight = 176;
const composerHeightStorageKey = 'gejian-composer-height';
const defaultPostStyle: PostStyle = {
  fontFamily: 'system',
  titleSize: 'normal',
  bodySize: 'normal',
  titleColor: 'ink',
  bodyColor: 'ink',
  accent: 'green',
  bold: false,
  italic: false,
  underline: false
};

function tabFromPath(pathname: string): ForumTab {
  if (pathname === '/hot') return 'hot';
  if (pathname === '/hall') return 'hall';
  if (pathname === '/gossip') return 'gossip';
  if (pathname === '/discussion') return 'discussion';
  if (pathname === '/goods') return 'goods';
  if (pathname === '/images' || pathname === '/help' || pathname === '/records') return 'hall';
  if (pathname === '/share') return 'goods';
  if (pathname === '/me/posts') return 'my-posts';
  if (pathname === '/me/comments') return 'my-comments';
  if (pathname === '/admin') return 'admin';
  return 'all';
}

function postIdFromPath(pathname: string): number | null {
  const match = pathname.match(/^\/post\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function pathForTab(tab: ForumTab) {
  if (tab === 'all') return '/';
  if (tab === 'hall') return '/hall';
  if (tab === 'gossip') return '/gossip';
  if (tab === 'discussion') return '/discussion';
  if (tab === 'goods') return '/goods';
  if (tab === 'my-posts') return '/me/posts';
  if (tab === 'my-comments') return '/me/comments';
  return `/${tab}`;
}

function sheetLabel(tab: ForumTab) {
  const labels: Record<ForumTab, string> = {
    all: '全部格点',
    hot: '热点流',
    hall: '摸鱼大厅',
    gossip: '八卦分享厅',
    discussion: '讨论区',
    goods: '好物推荐区',
    'my-posts': '我的发帖',
    'my-comments': '我的评论',
    admin: '治理视图'
  };
  return labels[tab];
}

function heatScore(post: Post) {
  return post.like_count * 10 + post.comment_count * 4 + post.attachments.length * 2 + (post.is_pinned ? 80 : 0);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function avatarText(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || 'G';
}

function displayCategory(category: string) {
  return legacyCategoryMap[category] ?? category;
}

function postMatchesCategory(post: Post, tab: keyof typeof categoryTabs) {
  return displayCategory(post.category) === categoryTabs[tab];
}

function notificationText(notification: Notification) {
  const name = notification.actor?.nickname ?? '有人';
  if (notification.type === 'post_liked') return `${name} 喜欢了你的格点`;
  if (notification.type === 'post_commented') return `${name} 评论了你的格点`;
  if (notification.type === 'comment_replied') return `${name} 回复了你的评论`;
  return `${name} 喜欢了你的评论`;
}

function upsertPost(posts: Post[], post: Post, includeHidden = false) {
  const exists = posts.some((item) => item.id === post.id);
  const next = exists ? posts.map((item) => (item.id === post.id ? post : item)) : [post, ...posts];
  return includeHidden ? next : next.filter((item) => !item.is_hidden);
}

function mergeAttachments(current: Attachment[], incoming: Attachment[]) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}

function sortComments(comments: Comment[], mode: CommentSort) {
  return [...comments].sort((a, b) => {
    if (mode === 'liked') {
      const likeDelta = b.like_count - a.like_count;
      if (likeDelta !== 0) return likeDelta;
    }
    const timeDelta = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (timeDelta !== 0) return timeDelta;
    return b.id - a.id;
  });
}

function ImageStrip({ attachments, onPreview }: { attachments: Attachment[]; onPreview: (item: Attachment) => void }) {
  if (!attachments.length) return <span className="muted">无附件</span>;
  return (
    <div className="image-strip">
      {attachments.map((item) => (
        <button className="thumb" key={item.id} onClick={() => onPreview(item)} title={item.original_name}>
          <img src={uploadUrl(item.url)} alt={item.original_name} />
        </button>
      ))}
    </div>
  );
}

type CardPlacement = {
  col: number;
  row: number;
  width: number;
  height: number;
};

function cardStyle(placement: CardPlacement | undefined): CSSProperties {
  if (!placement) return {};
  const { col, row, width, height } = placement;
  return {
    gridColumn: `${col} / span ${width}`,
    gridRow: `${row} / span ${height}`
  };
}

function cardDimensions(post: Post, index: number) {
  const merged = { ...defaultPostStyle, ...(post.style_config ?? {}) };
  const featured = post.is_pinned || post.like_count >= 5;
  const titleChars = Math.max(4, Array.from(post.title.trim()).length);
  const bodyChars = Array.from(post.body.trim()).length;
  const titleWeight = merged.titleSize === 'large' ? 5 : merged.titleSize === 'compact' ? 9 : 7;
  const baseWidth = Math.ceil(titleChars / titleWeight);
  const width = Math.min(sheetColumnCount, Math.max(featured ? 5 : 3, post.attachments.length ? 4 : 3, baseWidth, index % 6 === 0 ? 4 : 3));
  const titleRows = Math.max(1, Math.ceil(titleChars / (width * titleWeight)));
  const bodyRows = Math.min(3, Math.ceil(bodyChars / Math.max(20, width * 16)));
  const imageRows = post.attachments.length ? 2 : 0;
  const height = Math.min(sheetRowCount, Math.max(featured ? 5 : 3, 2 + titleRows + bodyRows + imageRows));
  return { width, height };
}

function seededOffset(post: Post, index: number, seed: number) {
  const raw = Math.sin(post.id * 12.9898 + index * 78.233 + seed * 37.719) * 43758.5453;
  return raw - Math.floor(raw);
}

function placeCards(posts: Post[], seed: number) {
  const occupied = new Set<string>();
  const placements = new Map<number, CardPlacement>();

  function canPlace(col: number, row: number, width: number, height: number) {
    if (col < 2 || row < 2) return false;
    if (col + width > sheetColumnCount + 2 || row + height > sheetRowCount + 2) return false;
    for (let x = col - 2; x < col - 2 + width; x += 1) {
      for (let y = row - 2; y < row - 2 + height; y += 1) {
        if (occupied.has(`${x}:${y}`)) return false;
      }
    }
    return true;
  }

  function reserve(col: number, row: number, width: number, height: number) {
    for (let x = col - 2; x < col - 2 + width; x += 1) {
      for (let y = row - 2; y < row - 2 + height; y += 1) {
        occupied.add(`${x}:${y}`);
      }
    }
  }

  posts.forEach((post, index) => {
    const { width, height } = cardDimensions(post, index);
    const maxCol = sheetColumnCount - width + 2;
    const maxRow = sheetRowCount - height + 2;
    let best: CardPlacement | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const lane = index % 3;

    for (let row = 2; row <= maxRow; row += 1) {
      for (let col = 2; col <= maxCol; col += 1) {
        if (!canPlace(col, row, width, height)) continue;
        const score =
          (col - 2) * 8 +
          (row - 2) * 1.45 +
          Math.abs((row - 2) % 3 - lane) * 0.32 +
          seededOffset(post, row * 31 + col * 17, seed) * 0.18;
        if (score < bestScore) {
          bestScore = score;
          best = { col, row, width, height };
        }
      }
    }

    if (best) {
      reserve(best.col, best.row, best.width, best.height);
      placements.set(post.id, best);
    }
  });

  return placements;
}

function cellAddress(placement: CardPlacement | undefined) {
  if (!placement) return 'A1';
  const { col, row } = placement;
  return `${sheetColumns[Math.max(col - 2, 0)] ?? 'A'}${row}`;
}

function sheetStyle(zoom: number): CSSProperties {
  return {
    '--cell-w': `${Math.round(76 * zoom)}px`,
    '--cell-h': `${Math.round(36 * zoom)}px`
  } as CSSProperties;
}

function cardTone(post: Post, index: number) {
  const accent = post.style_config?.accent;
  if (accent === 'gold') return 'yellow';
  if (accent === 'red') return 'red';
  if (accent === 'blue') return 'blue';
  if (accent === 'green') return 'green';
  if (accent === 'ink') return 'white';
  if (post.is_pinned) return 'yellow';
  if (post.like_count >= 10) return 'red';
  if (post.attachments.length) return 'blue';
  return palette[(post.id + index) % palette.length];
}

function postStyleClass(style: PostStyle | undefined) {
  const merged = { ...defaultPostStyle, ...(style ?? {}) };
  return [
    `font-${merged.fontFamily}`,
    `title-${merged.titleSize}`,
    `body-${merged.bodySize}`,
    `title-color-${merged.titleColor ?? 'ink'}`,
    `body-color-${merged.bodyColor ?? 'ink'}`,
    merged.bold ? 'is-bold' : '',
    merged.italic ? 'is-italic' : '',
    merged.underline ? 'is-underlined' : ''
  ]
    .filter(Boolean)
    .join(' ');
}

function clampComposerHeight(value: number) {
  if (!Number.isFinite(value)) return composerDefaultHeight;
  return Math.min(composerMaxHeight, Math.max(composerMinHeight, Math.round(value)));
}

function validateAndMergeImageFiles(current: File[], incoming: File[], onError?: (message: string) => void) {
  const valid = incoming.filter((file) => {
    if (!file.type.startsWith('image/')) {
      onError?.('只能上传图片文件');
      return false;
    }
    if (file.size > maxImageBytes) {
      onError?.('单张图片不能超过 5MB');
      return false;
    }
    return true;
  });
  const next = [...current, ...valid].slice(0, maxFiles);
  if (current.length + valid.length > maxFiles) onError?.(`一次最多选择 ${maxFiles} 张图片`);
  return next;
}

function PickedImage({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <span className="picked-image">
      {previewUrl && <img src={previewUrl} alt={file.name} />}
      <span>{file.name}</span>
      <button type="button" onClick={onRemove} aria-label={`移除 ${file.name}`}>
        <X size={12} />
      </button>
    </span>
  );
}

function FilePicker({
  files,
  onChange,
  onError,
  compact = false,
  label = '图片',
  dropzone = false
}: {
  files: File[];
  onChange: (files: File[]) => void;
  onError?: (message: string) => void;
  compact?: boolean;
  label?: string;
  dropzone?: boolean;
}) {
  const [dragActive, setDragActive] = useState(false);

  function appendFiles(selected: File[]) {
    onChange(validateAndMergeImageFiles(files, selected, onError));
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    appendFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  }

  return (
    <div
      className={`file-picker ${compact ? 'compact-file-picker' : ''} ${dropzone ? 'drop-file-picker' : ''} ${dragActive ? 'drag-active' : ''}`}
      onDragEnter={(event) => {
        if (!dropzone) return;
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        if (!dropzone) return;
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!dropzone) return;
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
      }}
      onDrop={(event) => {
        if (!dropzone) return;
        event.preventDefault();
        setDragActive(false);
        appendFiles(Array.from(event.dataTransfer.files ?? []));
      }}
    >
      <label className="file-button">
        <FileImage size={16} />
        {label}
        <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple onChange={handleFiles} />
      </label>
      {dropzone && <span className="drop-hint">拖入图片或点击添加</span>}
      <div className="picked-files">
        {files.map((file) => (
          <PickedImage key={`${file.name}-${file.size}-${file.lastModified}`} file={file} onRemove={() => onChange(files.filter((item) => item !== file))} />
        ))}
      </div>
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authNickname, setAuthNickname] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authInviteCode, setAuthInviteCode] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [sort, setSort] = useState<SortMode>('hot');
  const [selectedId, setSelectedId] = useState<number | null>(() => postIdFromPath(window.location.pathname));
  const [comments, setComments] = useState<Comment[]>([]);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
  const [postTitle, setPostTitle] = useState('');
  const [postBody, setPostBody] = useState('');
  const [postCategory, setPostCategory] = useState(categories[0]);
  const [postStyle, setPostStyle] = useState<PostStyle>(defaultPostStyle);
  const [postFiles, setPostFiles] = useState<File[]>([]);
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [composerStyleOpen, setComposerStyleOpen] = useState(false);
  const [composerDragActive, setComposerDragActive] = useState(false);
  const [composerHeight, setComposerHeight] = useState(() => {
    const stored = window.localStorage.getItem(composerHeightStorageKey);
    return stored ? clampComposerHeight(Number(stored)) : composerDefaultHeight;
  });
  const composerResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentSort, setCommentSort] = useState<CommentSort>('latest');
  const [replyingToId, setReplyingToId] = useState<number | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [activityComments, setActivityComments] = useState<Array<Comment & { post: { id: number; title: string } }>>([]);
  const [adminView, setAdminView] = useState(window.location.pathname === '/admin');
  const [activeTab, setActiveTab] = useState<ForumTab>(() => tabFromPath(window.location.pathname));
  const [drawerOpen, setDrawerOpen] = useState(() => postIdFromPath(window.location.pathname) !== null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sheetSeed, setSheetSeed] = useState(0);
  const [sheetZoom, setSheetZoom] = useState(1);
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(true);
  const [editingPostId, setEditingPostId] = useState<number | null>(null);
  const [pendingEditPostId, setPendingEditPostId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editCategory, setEditCategory] = useState(categories[0]);
  const [editStyle, setEditStyle] = useState<PostStyle>(defaultPostStyle);

  const selectedPost = useMemo(() => {
    const exact = posts.find((item) => item.id === selectedId);
    if (exact) return exact;
    return posts[0] ?? null;
  }, [posts, selectedId]);
  const searchedPosts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return posts;
    return posts.filter((post) =>
      [post.title, post.body, post.category, displayCategory(post.category), post.author.nickname]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [posts, searchQuery]);
  const visiblePosts = useMemo(() => {
    if (activeTab === 'hot') {
      return [...searchedPosts]
        .filter((post) => post.is_pinned || heatScore(post) > 0)
        .sort((a, b) => heatScore(b) - heatScore(a));
    }
    if (activeTab === 'hall' || activeTab === 'gossip' || activeTab === 'discussion' || activeTab === 'goods') {
      return searchedPosts.filter((post) => postMatchesCategory(post, activeTab));
    }
    if (activeTab === 'my-posts') return searchedPosts.filter((post) => post.author.id === user?.id);
    if (activeTab === 'my-comments') {
      const postIds = new Set(activityComments.map((comment) => comment.post_id));
      return searchedPosts.filter((post) => postIds.has(post.id));
    }
    return searchedPosts;
  }, [activeTab, activityComments, searchedPosts, user?.id]);
  const categoryCounts = useMemo(
    () =>
      posts.reduce<Record<string, number>>((acc, post) => {
        const category = displayCategory(post.category);
        acc[category] = (acc[category] ?? 0) + 1;
        return acc;
      }, {}),
    [posts]
  );
  const hotPosts = useMemo(() => [...searchedPosts].sort((a, b) => heatScore(b) - heatScore(a)).slice(0, 10), [searchedPosts]);
  const sortedComments = useMemo(() => sortComments(comments, commentSort), [comments, commentSort]);
  const replyingToComment = useMemo(
    () => comments.find((comment) => comment.id === replyingToId) ?? null,
    [comments, replyingToId]
  );
  const myPostFeed = useMemo(
    () =>
      posts
        .filter((post) => post.author.id === user?.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id - a.id),
    [posts, user?.id]
  );
  const myCommentFeed = useMemo(
    () => [...activityComments].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id - a.id),
    [activityComments]
  );
  const isPersonalTab = activeTab === 'my-posts' || activeTab === 'my-comments';
  const cardPlacements = useMemo(() => placeCards(visiblePosts, sheetSeed), [visiblePosts, sheetSeed]);
  const selectedCell = selectedPost ? cellAddress(cardPlacements.get(selectedPost.id)) : 'A1';
  const canEditSelected = Boolean(selectedPost && user && (selectedPost.author.id === user.id || user.role === 'admin'));
  const selectedIdRef = useRef<number | null>(selectedId);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  function showToast(text: string) {
    setToast(text);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 1800);
  }

  useEffect(() => {
    function syncRoute() {
      const nextPostId = postIdFromPath(window.location.pathname);
      if (nextPostId) {
        setSelectedId(nextPostId);
        setDrawerOpen(true);
        return;
      }
      const nextTab = tabFromPath(window.location.pathname);
      setActiveTab(nextTab);
      setAdminView(nextTab === 'admin');
      setDrawerOpen(false);
    }

    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  async function loadPosts(nextSort = sort, query = searchQuery) {
    const data = await api.posts(nextSort, query);
    setPosts(data);
    if (!selectedId && data[0]) setSelectedId(data[0].id);
  }

  useEffect(() => {
    api.me()
      .then((me) => {
        setUser(me);
        return api.posts(sort, searchQuery);
      })
      .then((data) => {
        setPosts(data);
        if (data[0]) setSelectedId(data[0].id);
      })
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    const socket = new WebSocket(wsUrl());
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data) as RealtimeEvent;
      if (['post_created', 'post_updated', 'like_changed'].includes(data.type)) {
        setPosts((current) => upsertPost(current, data.payload as Post, adminView));
      }
      if (data.type === 'post_hidden') {
        setPosts((current) => (adminView ? upsertPost(current, data.payload as Post, true) : current.filter((item) => item.id !== data.payload.id)));
      }
      if (data.type === 'post_deleted') {
        setPosts((current) => current.filter((item) => item.id !== data.payload.id));
        if (selectedIdRef.current === data.payload.id) {
          setSelectedId(null);
          setDrawerOpen(false);
        }
      }
      if (data.type === 'comment_created') {
        const comment = data.payload;
        if (selectedIdRef.current === comment.post_id) {
          setComments((current) => (current.some((item) => item.id === comment.id) ? current : [comment, ...current]));
        }
        setPosts((current) =>
          current.map((post) =>
            post.id === comment.post_id
              ? { ...post, comment_count: post.comment_count + 1, last_activity_at: comment.created_at }
              : post
          )
        );
      }
      if (data.type === 'comment_deleted') {
        setComments((current) => current.filter((item) => item.id !== data.payload.id));
      }
      if (data.type === 'comment_like_changed') {
        const comment = data.payload;
        if (selectedIdRef.current === comment.post_id) {
          setComments((current) => current.map((item) => (item.id === comment.id ? { ...comment, liked_by_me: item.liked_by_me } : item)));
        }
      }
      if (data.type === 'notification_created') {
        const payload = data.payload;
        if (payload.user_id === user.id) {
          setNotifications((current) => [payload.notification, ...current.filter((item) => item.id !== payload.notification.id)].slice(0, 80));
          setUnreadCount(payload.unread_count);
          showToast(notificationText(payload.notification));
        }
      }
      if (data.type === 'image_added') {
        const payload = data.payload;
        if (payload.owner_type === 'post') {
          setPosts((current) =>
            current.map((post) =>
              post.id === payload.owner_id
                ? { ...post, attachments: mergeAttachments(post.attachments, payload.attachments as Attachment[]) }
                : post
            )
          );
        }
        if (payload.owner_type === 'comment') {
          setComments((current) =>
            current.map((comment) =>
              comment.id === payload.owner_id
                ? { ...comment, attachments: mergeAttachments(comment.attachments, payload.attachments as Attachment[]) }
                : comment
            )
          );
        }
      }
    };
    return () => socket.close();
  }, [user, adminView]);

  useEffect(() => {
    if (!user) return;
    api.notifications()
      .then((payload) => {
        setNotifications(payload.items);
        setUnreadCount(payload.unread_count);
      })
      .catch((error) => setMessage(error.message));
  }, [user]);

  useEffect(() => {
    if (!selectedPost || !user) return;
    api.comments(selectedPost.id).then(setComments).catch((error) => setMessage(error.message));
  }, [selectedPost?.id, user]);

  useEffect(() => {
    if (!user || (activeTab !== 'my-comments' && activeTab !== 'my-posts')) return;
    api.activity()
      .then((activity) => {
        setActivityComments(activity.comments);
        setPosts((current) => {
          const merged = [...current];
          activity.posts.forEach((post) => {
            if (!merged.some((item) => item.id === post.id)) merged.push(post);
          });
          return merged;
        });
      })
      .catch((error) => setMessage(error.message));
  }, [activeTab, user]);

  useEffect(() => {
    if (!selectedPost) return;
    setEditTitle(selectedPost.title);
    setEditBody(selectedPost.body);
    setEditCategory(displayCategory(selectedPost.category));
    setEditStyle({ ...defaultPostStyle, ...(selectedPost.style_config ?? {}) });
    setEditingPostId(pendingEditPostId === selectedPost.id ? selectedPost.id : null);
    if (pendingEditPostId === selectedPost.id) setPendingEditPostId(null);
  }, [pendingEditPostId, selectedPost?.id]);

  async function handleAuth(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setLoading(true);
    try {
      const nextUser =
        authMode === 'register'
          ? await api.register({
              email: authEmail,
              nickname: authNickname,
              password: authPassword,
              invite_code: authInviteCode.trim() || undefined
            })
          : await api.login({ email: authEmail, password: authPassword });
      setUser(nextUser);
      const data = await api.posts(sort, searchQuery);
      setPosts(data);
      if (data[0]) setSelectedId(data[0].id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '登录失败');
    } finally {
      setLoading(false);
    }
  }

  async function submitPost(event: FormEvent) {
    event.preventDefault();
    if (postSubmitting) return;
    setMessage('');
    if (!postBody.trim() && postFiles.length === 0) {
      setMessage('先写点内容，或者发一张图片');
      return;
    }
    const generatedTitle = postTitle.trim() || postBody.trim().split(/\s+/).join(' ').slice(0, 24) || '图片记录';
    const form = new FormData();
    form.append('title', generatedTitle);
    form.append('body', postBody.trim() || '分享了一张图片');
    form.append('category', postCategory);
    form.append('style_config', JSON.stringify(postStyle));
    postFiles.forEach((file) => form.append('files', file));
    setPostSubmitting(true);
    try {
      const created = await api.createPost(form);
      setPosts((current) => upsertPost(current, created, adminView));
      setSelectedId(created.id);
      setPostTitle('');
      setPostBody('');
      setPostFiles([]);
      setComposerExpanded(false);
      setComposerStyleOpen(false);
      openDetail(created.id);
      showToast('已写入格点');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '新增失败');
    } finally {
      setPostSubmitting(false);
    }
  }

  function updatePostFiles(nextFiles: File[]) {
    setPostFiles(nextFiles);
    if (nextFiles.length > 0) setComposerExpanded(true);
  }

  function addPostFiles(files: File[]) {
    setPostFiles((current) => {
      const next = validateAndMergeImageFiles(current, files, setMessage);
      if (next.length > 0) setComposerExpanded(true);
      return next;
    });
  }

  function collapseComposer() {
    if (postTitle.trim() || postBody.trim() || postFiles.length > 0) {
      setComposerExpanded(false);
      setComposerStyleOpen(false);
      return;
    }
    setComposerExpanded(false);
    setComposerStyleOpen(false);
  }

  function startComposerResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    composerResizeRef.current = { startY: event.clientY, startHeight: composerHeight };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveComposerResize(event: React.PointerEvent<HTMLButtonElement>) {
    if (!composerResizeRef.current) return;
    const nextHeight = clampComposerHeight(composerResizeRef.current.startHeight + event.clientY - composerResizeRef.current.startY);
    setComposerHeight(nextHeight);
  }

  function endComposerResize(event: React.PointerEvent<HTMLButtonElement>) {
    if (!composerResizeRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    composerResizeRef.current = null;
    window.localStorage.setItem(composerHeightStorageKey, String(composerHeight));
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (commentSubmitting) return;
    if (!selectedPost) return;
    if (!commentBody.trim() && commentFiles.length === 0) {
      setMessage('先写回复，或者发一张图片');
      return;
    }
    const form = new FormData();
    form.append('body', commentBody.trim() || '分享了一张图片');
    if (replyingToComment) form.append('reply_to_comment_id', String(replyingToComment.id));
    form.append('style_config', JSON.stringify(defaultPostStyle));
    commentFiles.forEach((file) => form.append('files', file));
    setCommentSubmitting(true);
    try {
      const created = await api.createComment(selectedPost.id, form);
      setComments((current) => (current.some((item) => item.id === created.id) ? current : [created, ...current]));
      setCommentBody('');
      setCommentFiles([]);
      setReplyingToId(null);
      await loadPosts(sort, searchQuery);
      showToast(replyingToComment ? '回复已发送' : '评论已发送');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '评论失败');
    } finally {
      setCommentSubmitting(false);
    }
  }

  async function toggleLike(post: Post) {
    const updated = post.liked_by_me ? await api.unlike(post.id) : await api.like(post.id);
    setPosts((current) => upsertPost(current, updated, adminView));
  }

  async function toggleCommentLike(comment: Comment) {
    const updated = comment.liked_by_me ? await api.unlikeComment(comment.id) : await api.likeComment(comment.id);
    setComments((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setActivityComments((current) => current.map((item) => (item.id === updated.id ? { ...updated, post: item.post } : item)));
  }

  async function toggleNotifications() {
    const nextOpen = !notificationOpen;
    setNotificationOpen(nextOpen);
    if (nextOpen && unreadCount > 0) {
      await api.readNotifications();
      setUnreadCount(0);
      setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
    }
  }

  async function savePostEdit(event: FormEvent) {
    event.preventDefault();
    if (!selectedPost) return;
    if (!editTitle.trim() || !editBody.trim()) {
      setMessage('标题和正文都要保留一点内容');
      return;
    }
    try {
      const updated = await api.updatePost(selectedPost.id, {
        title: editTitle.trim(),
        body: editBody.trim(),
        category: editCategory,
        style_config: editStyle
      });
      setPosts((current) => upsertPost(current, updated, adminView));
      setEditingPostId(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    }
  }

  async function updateAdmin(post: Post, payload: { is_hidden?: boolean; is_pinned?: boolean; status?: string }) {
    const updated = await api.updatePostAdmin(post.id, payload);
    setPosts((current) => (updated.is_hidden && !adminView ? current.filter((item) => item.id !== updated.id) : upsertPost(current, updated, adminView)));
    if (adminView) {
      const all = await api.adminPosts();
      setPosts(all);
    }
  }

  async function deleteComment(comment: Comment) {
    if (comment.author.id === user?.id) {
      await api.deleteComment(comment.id);
    } else {
      await api.deleteCommentAdmin(comment.id);
    }
    setComments((current) => current.filter((item) => item.id !== comment.id));
    setActivityComments((current) => current.filter((item) => item.id !== comment.id));
    showToast('评论已删除');
  }

  async function deleteSelectedPost(post: Post) {
    if (!window.confirm('删除后这条格点会从所有人的工作簿里移除，确定删除？')) return;
    await api.deletePost(post.id);
    setPosts((current) => current.filter((item) => item.id !== post.id));
    setActivityComments((current) => current.filter((item) => item.post_id !== post.id));
    setComments([]);
    if (selectedId === post.id) {
      setSelectedId(null);
      setDrawerOpen(false);
    }
    if (postIdFromPath(window.location.pathname)) {
      window.history.pushState(null, '', pathForTab(activeTab));
    }
    showToast('帖子已删除');
  }

  function openDetail(postId: number) {
    setSelectedId(postId);
    setDrawerOpen(true);
    window.history.pushState(null, '', `/post/${postId}`);
  }

  function startReply(comment: Comment) {
    setReplyingToId(comment.id);
    window.requestAnimationFrame(() => commentInputRef.current?.focus());
  }

  async function openPostFromFeed(postId: number) {
    if (!posts.some((post) => post.id === postId)) {
      await loadPosts(sort, searchQuery);
    }
    openDetail(postId);
  }

  async function openNotification(notification: Notification) {
    setNotificationOpen(false);
    if (notification.post_id) {
      await openPostFromFeed(notification.post_id);
    }
  }

  async function editPostFromFeed(post: Post) {
    setPendingEditPostId(post.id);
    await openPostFromFeed(post.id);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setReplyingToId(null);
    if (postIdFromPath(window.location.pathname)) {
      window.history.pushState(null, '', pathForTab(activeTab));
    }
  }

  function clearSearch() {
    setSearchQuery('');
    if (!adminView) void loadPosts(sort, '');
  }

  async function switchTab(tab: ForumTab) {
    setActiveTab(tab);
    setAdminView(tab === 'admin');
    setDrawerOpen(false);
    window.history.pushState(null, '', pathForTab(tab));
    if (tab === 'admin') {
      const data = await api.adminPosts();
      setPosts(data);
      if (data[0]) setSelectedId(data[0].id);
      return;
    }
    if (tab === 'my-posts') {
      const activity = await api.activity();
      setActivityComments(activity.comments);
      setPosts((current) => {
        const byId = new Map(current.map((post) => [post.id, post]));
        activity.posts.forEach((post) => byId.set(post.id, post));
        return Array.from(byId.values());
      });
      return;
    }
    if (tab === 'my-comments') {
      const activity = await api.activity();
      setActivityComments(activity.comments);
      const data = await api.posts(sort, searchQuery);
      setPosts(data);
      return;
    }
    if (tab === 'hot') {
      setSort('hot');
      await loadPosts('hot', searchQuery);
      return;
    }
    await loadPosts(sort, searchQuery);
  }

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    if (adminView) return;
    await loadPosts(sort, searchQuery);
  }

  async function logout() {
    await api.logout();
    setUser(null);
    setPosts([]);
    setComments([]);
    setSelectedId(null);
  }

  if (!user) {
    return (
      <main className="auth-screen">
        <Suspense fallback={<div className="auth-3d-scene auth-3d-fallback" aria-hidden="true" />}>
          <AuthScene />
        </Suspense>
        <div className="auth-ambient" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <section className="auth-shell">
          <div className="auth-hero">
            <div className="auth-kicker">GJ Workspace</div>
            <h1>格间</h1>
            <p>把散点格子、热点讨论和实时互动收进一个漂亮的公共工作簿。</p>
            <div className="auth-hero-grid" aria-hidden="true">
              <span>热点</span>
              <span>评论</span>
              <span>图片</span>
              <span>通知</span>
            </div>
          </div>
          <section className="auth-panel">
            <div className="auth-card-top">
              <div className="ledger-mark auth-brand">
                <MessageSquare size={26} />
                <span>{productName}</span>
              </div>
              <span className="auth-badge">Public Grid</span>
            </div>
            <h2>{authMode === 'login' ? '登录格间' : '创建格间账号'}</h2>
            <p>{authMode === 'login' ? '回到你的公共格点工作簿。' : '输入邀请码后即可加入工作簿。'}</p>
            <form onSubmit={handleAuth}>
              <label className="auth-field">
                <span>邮箱</span>
                <input
                  type="email"
                  placeholder="name@example.com"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  autoComplete="email"
                />
              </label>
              {authMode === 'register' && (
                <label className="auth-field">
                  <span>昵称</span>
                  <input
                    placeholder="用于显示在格点和评论里"
                    value={authNickname}
                    onChange={(event) => setAuthNickname(event.target.value)}
                    autoComplete="nickname"
                  />
                </label>
              )}
              {authMode === 'register' && (
                <label className="auth-field">
                  <span>邀请码</span>
                  <input
                    placeholder="输入团队邀请码"
                    value={authInviteCode}
                    onChange={(event) => setAuthInviteCode(event.target.value)}
                    autoComplete="off"
                  />
                </label>
              )}
              <label className="auth-field">
                <span>密码</span>
                <div className="password-field">
                  <input
                    placeholder="至少 8 位"
                    type={passwordVisible ? 'text' : 'password'}
                    minLength={8}
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setPasswordVisible((value) => !value)}
                    aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
                  >
                    {passwordVisible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>
              <button className="primary auth-submit" disabled={loading}>
                {loading && <span className="button-spinner" />}
                {authMode === 'login' ? '登录' : '创建账号'}
              </button>
            </form>
            <button
              className="link-button auth-switch"
              onClick={() => {
                setMessage('');
                setAuthMode(authMode === 'login' ? 'register' : 'login');
              }}
            >
              {authMode === 'login' ? '申请新账号' : '已有账号登录'}
            </button>
            {message && <div className="notice">{message}</div>}
          </section>
          <div className="auth-slogan">专注于摸鱼</div>
        </section>
      </main>
    );
  }

  return (
    <main className="workbook-page">
      <header className="book-titlebar">
        <div className="book-identity">
          <strong>{productName}</strong>
          <span>公共格点工作簿</span>
        </div>
        <form className="book-search" onSubmit={runSearch}>
          <Search size={16} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索格点、作者、分类"
          />
          {searchQuery && (
            <button type="button" onClick={clearSearch} aria-label="清空搜索">
              <X size={15} />
            </button>
          )}
        </form>
        <div className="book-account">
          <div className="notification-wrap">
            <button className="tool-icon notification-button" onClick={toggleNotifications} title="通知">
              <Bell size={16} />
              {unreadCount > 0 && <em>{unreadCount > 99 ? '99+' : unreadCount}</em>}
            </button>
            {notificationOpen && (
              <div className="notification-popover xhs-notification-popover">
                <div className="notification-head">
                  <div>
                    <strong>互动通知</strong>
                    <span>赞、评论和回复会实时出现在这里</span>
                  </div>
                  <em>{unreadCount > 0 ? `${unreadCount} 未读` : '已读'}</em>
                </div>
                <div className="notification-list">
                  {notifications.map((item) => (
                    <button key={item.id} className={!item.is_read ? 'unread' : ''} onClick={() => openNotification(item)}>
                      <span className={`notification-kind notification-${item.type}`}>
                        {item.type === 'post_liked' || item.type === 'comment_liked' ? <Heart size={15} /> : <MessageSquare size={15} />}
                      </span>
                      <span>{notificationText(item)}</span>
                      <strong>{item.post_title ?? '相关内容'}</strong>
                      {item.comment_preview && <small>{item.comment_preview}</small>}
                      <em>{formatTime(item.created_at)}</em>
                    </button>
                  ))}
                  {!notifications.length && <div className="notification-empty">还没有新的互动。</div>}
                </div>
              </div>
            )}
          </div>
          {user.role === 'admin' && <ShieldCheck size={16} />}
          <span>{user.nickname}</span>
          <button className="tool-icon" onClick={logout} title="退出">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <nav className="sheet-tabs command-bar">
        <div className="current-sheet-pill">
          <span>当前工作表</span>
          <strong>{sheetLabel(activeTab)}</strong>
        </div>
        <div className="command-group" aria-label="排序方式">
          <button className={sort === 'latest' ? 'active' : ''} onClick={() => { setSort('latest'); void loadPosts('latest', searchQuery); }}>
            最新互动
          </button>
          <button className={sort === 'hot' ? 'active' : ''} onClick={() => { setSort('hot'); void loadPosts('hot', searchQuery); }}>
            热度优先
          </button>
        </div>
        <div className="command-stats">
          <span>{visiblePosts.length} 格</span>
          <span>{hotPosts.length} 热点</span>
          <span>{selectedPost ? selectedCell : '未选中'}</span>
        </div>
        <button className="sheet-tab-action" onClick={() => setGroupDrawerOpen((value) => !value)}>
          <SlidersHorizontal size={14} />
          工作簿
        </button>
        <button className="sheet-tab-action" onClick={() => loadPosts(sort)}>
          <RefreshCw size={14} />
          同步
        </button>
        <div className="view-tools" aria-label="视图工具">
          <button type="button" onClick={() => setSheetSeed((value) => value + 1)} title="重新散布">
            <Shuffle size={15} />
            重排
          </button>
          <button type="button" onClick={() => setSheetZoom((value) => Math.max(0.82, Number((value - 0.08).toFixed(2))))} title="缩小">
            <ZoomOut size={15} />
          </button>
          <span>{Math.round(sheetZoom * 100)}%</span>
          <button type="button" onClick={() => setSheetZoom((value) => Math.min(1.24, Number((value + 0.08).toFixed(2))))} title="放大">
            <ZoomIn size={15} />
          </button>
        </div>
      </nav>

      <section className="sheet-ribbon">
        <form
          className={`cell-composer composer-redbook ${composerExpanded ? 'expanded' : 'collapsed'} ${composerDragActive ? 'drag-active' : ''}`}
          onSubmit={submitPost}
          onDragEnter={(event) => {
            event.preventDefault();
            setComposerDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setComposerDragActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setComposerDragActive(false);
            addPostFiles(Array.from(event.dataTransfer.files ?? []));
          }}
        >
          {!composerExpanded ? (
            <div className={`composer-lite composer-accent-${postStyle.accent ?? 'green'}`}>
              <div className="composer-avatar">{avatarText(user.nickname)}</div>
              <button className="composer-lite-input" type="button" onClick={() => setComposerExpanded(true)}>
                <span>{postBody || postTitle || '写点什么，拖入图片也可以直接发布...'}</span>
              </button>
              <button className="composer-pill" type="button" onClick={() => setComposerExpanded(true)}>
                {postCategory}
              </button>
              <FilePicker files={postFiles} onChange={updatePostFiles} onError={setMessage} compact label={postFiles.length ? `${postFiles.length} 张图片` : '图片'} />
              <button className="primary composer-lite-submit" disabled={postSubmitting || (!postBody.trim() && postFiles.length === 0)}>
                {postSubmitting ? <span className="button-spinner" /> : <Send size={15} />}
                发布
              </button>
            </div>
          ) : (
            <div
              className={`composer-fields composer-accent-${postStyle.accent ?? 'green'} ${composerStyleOpen ? 'style-open' : 'style-closed'}`}
              style={{ '--composer-body-height': `${composerHeight}px` } as CSSProperties}
            >
              <div className="composer-avatar">{avatarText(user.nickname)}</div>
              <div className="composer-input-stack">
                <input
                  className={`cell-title-input ${postStyleClass(postStyle)}`}
                  placeholder="写个标题"
                  value={postTitle}
                  onChange={(event) => setPostTitle(event.target.value)}
                  maxLength={80}
                  autoFocus
                />
                <textarea
                  className={postStyleClass(postStyle)}
                  placeholder="分享点什么，图片也可以直接带上..."
                  value={postBody}
                  onChange={(event) => setPostBody(event.target.value)}
                />
                <div className="composer-inline-actions">
                  <select value={postCategory} onChange={(event) => setPostCategory(event.target.value)} aria-label="分类">
                    {categories.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                  <FilePicker files={postFiles} onChange={updatePostFiles} onError={setMessage} compact dropzone label={postFiles.length ? `${postFiles.length} 张图片` : '加图片'} />
                  <div className="composer-submit-row">
                    <button type="button" className="composer-ghost" onClick={() => setComposerStyleOpen((value) => !value)}>
                      <Type size={15} />
                      样式
                    </button>
                    <button type="button" className="composer-ghost" onClick={collapseComposer}>
                      收起
                    </button>
                    <button className="primary" disabled={postSubmitting}>
                      {postSubmitting ? <span className="button-spinner" /> : <Send size={15} />}
                      {postSubmitting ? '写入中' : '写入格点'}
                    </button>
                  </div>
                </div>
              </div>
              {composerStyleOpen && (
                <div className="composer-formatbar">
                  <div className="format-cluster">
                    <Type size={15} />
                    <select
                      value={postStyle.fontFamily}
                      onChange={(event) => setPostStyle((current) => ({ ...current, fontFamily: event.target.value as PostStyle['fontFamily'] }))}
                      aria-label="字体"
                    >
                      <option value="system">默认字体</option>
                      <option value="hei">黑体</option>
                      <option value="song">宋体</option>
                      <option value="serif">衬线</option>
                      <option value="mono">等宽</option>
                    </select>
                    <select
                      value={postStyle.titleSize}
                      onChange={(event) => setPostStyle((current) => ({ ...current, titleSize: event.target.value as PostStyle['titleSize'] }))}
                      aria-label="标题字号"
                    >
                      <option value="compact">标题 S</option>
                      <option value="normal">标题 M</option>
                      <option value="large">标题 L</option>
                    </select>
                    <select
                      value={postStyle.bodySize}
                      onChange={(event) => setPostStyle((current) => ({ ...current, bodySize: event.target.value as PostStyle['bodySize'] }))}
                      aria-label="正文字号"
                    >
                      <option value="compact">正文 S</option>
                      <option value="normal">正文 M</option>
                      <option value="large">正文 L</option>
                    </select>
                  </div>
                  <div className="format-cluster color-cluster">
                    <span className="style-section-label">格点</span>
                    {styleColors.map((accent) => (
                      <button
                        type="button"
                        key={accent}
                        className={`dot-${accent} ${postStyle.accent === accent ? 'active' : ''}`}
                        onClick={() => setPostStyle((current) => ({ ...current, accent }))}
                        aria-label={`选择格点底色 ${colorLabels[accent]}`}
                        title={`格点底色：${colorLabels[accent]}`}
                      />
                    ))}
                    <span className="style-section-label">标题</span>
                    {styleColors.map((titleColor) => (
                      <button
                        type="button"
                        key={`title-${titleColor}`}
                        className={`dot-${titleColor} ${postStyle.titleColor === titleColor ? 'active' : ''}`}
                        onClick={() => setPostStyle((current) => ({ ...current, titleColor }))}
                        aria-label={`选择标题颜色 ${colorLabels[titleColor]}`}
                        title={`标题颜色：${colorLabels[titleColor]}`}
                      />
                    ))}
                    <span className="style-section-label">正文</span>
                    {styleColors.map((bodyColor) => (
                      <button
                        type="button"
                        key={`body-${bodyColor}`}
                        className={`dot-${bodyColor} ${postStyle.bodyColor === bodyColor ? 'active' : ''}`}
                        onClick={() => setPostStyle((current) => ({ ...current, bodyColor }))}
                        aria-label={`选择正文颜色 ${colorLabels[bodyColor]}`}
                        title={`正文颜色：${colorLabels[bodyColor]}`}
                      />
                    ))}
                    <button type="button" className={postStyle.bold ? 'active' : ''} onClick={() => setPostStyle((current) => ({ ...current, bold: !current.bold }))}>B</button>
                    <button type="button" className={postStyle.italic ? 'active' : ''} onClick={() => setPostStyle((current) => ({ ...current, italic: !current.italic }))}>I</button>
                    <button type="button" className={postStyle.underline ? 'active' : ''} onClick={() => setPostStyle((current) => ({ ...current, underline: !current.underline }))}>U</button>
                  </div>
                </div>
              )}
              <button
                className="composer-resize-handle"
                type="button"
                aria-label="拖拽调整发布框高度"
                onPointerDown={startComposerResize}
                onPointerMove={moveComposerResize}
                onPointerUp={endComposerResize}
                onPointerCancel={endComposerResize}
              >
                <span />
              </button>
            </div>
          )}
        </form>
      </section>

      {message && <div className="book-message">{message}</div>}

      <section className={`workbook-shell ${drawerOpen ? 'drawer-open' : ''} ${groupDrawerOpen ? 'groups-open' : 'groups-closed'}`}>
        <aside className="sheet-groups" aria-label="工作簿分组">
          <button className="group-collapse" type="button" onClick={() => setGroupDrawerOpen((value) => !value)}>
            {groupDrawerOpen ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
          </button>
          <div className="group-title">
            <strong>工作簿</strong>
            <span>{posts.length}</span>
          </div>
          {[
            { id: 'all' as ForumTab, label: '全部格点', count: posts.length },
            { id: 'hot' as ForumTab, label: '热点流', count: hotPosts.length },
            { id: 'hall' as ForumTab, label: '摸鱼大厅', count: categoryCounts['摸鱼大厅'] ?? 0 },
            { id: 'gossip' as ForumTab, label: '八卦分享厅', count: categoryCounts['八卦分享厅'] ?? 0 },
            { id: 'discussion' as ForumTab, label: '讨论区', count: categoryCounts['讨论区'] ?? 0 },
            { id: 'goods' as ForumTab, label: '好物推荐区', count: categoryCounts['好物推荐区'] ?? 0 },
            { id: 'my-posts' as ForumTab, label: '我的发帖', count: posts.filter((post) => post.author.id === user.id).length },
            { id: 'my-comments' as ForumTab, label: '我的评论', count: activityComments.length }
          ].map((item) => (
            <button key={item.id} className={activeTab === item.id ? 'active' : ''} onClick={() => switchTab(item.id)}>
              <span>{item.label}</span>
              <em>{item.count}</em>
            </button>
          ))}
          {user.role === 'admin' && (
            <button className={activeTab === 'admin' ? 'active' : ''} onClick={() => switchTab('admin')}>
              <span>治理视图</span>
              <em>{posts.filter((post) => post.is_hidden).length}</em>
            </button>
          )}
        </aside>
        {activeTab !== 'hot' && !isPersonalTab && (
          <>
            <div className="formula-bar workbook-formula">
              <span className="name-box">{selectedCell}</span>
              <span className="fx">fx</span>
              <span>{searchQuery ? `搜索：${searchQuery}` : selectedPost ? selectedPost.title : '选择一个格点查看批注'}</span>
            </div>

            <div className="workbook-metrics">
              <span>{visiblePosts.length} 格</span>
              <span>{hotPosts.length} 热点</span>
              <span>{selectedPost ? `${comments.length} 条批注` : '未选择'}</span>
            </div>
          </>
        )}

        {activeTab === 'hot' ? (
          <section className="hot-feed-page" aria-label="热点流">
            <div className="hot-feed-head">
              <div>
                <span>热点流</span>
                <strong>高互动内容</strong>
              </div>
              <p>按点赞、评论和置顶综合排序，点击任意内容在右侧查看评论。</p>
            </div>
            <div className="hot-feed-list">
              {hotPosts.map((post, index) => (
                <article key={post.id} className={selectedPost?.id === post.id ? 'active' : ''}>
                  <button className="hot-feed-main" type="button" onClick={() => openDetail(post.id)}>
                    <span className="hot-rank">{index + 1}</span>
                    <div className="hot-copy">
                      <div className="hot-meta">
                        <span>{displayCategory(post.category)}</span>
                        <span>{post.author.nickname}</span>
                        <span>{formatTime(post.last_activity_at)}</span>
                      </div>
                      <strong className={postStyleClass(post.style_config)}>{post.title}</strong>
                      <p className={postStyleClass(post.style_config)}>{post.body}</p>
                      <div className="hot-actions">
                        <span><Heart size={14} />{post.like_count}</span>
                        <span><MessageSquare size={14} />{post.comment_count}</span>
                        <em>查看讨论</em>
                      </div>
                    </div>
                    {post.attachments[0] && (
                      <img className="hot-cover" src={uploadUrl(post.attachments[0].url)} alt={post.attachments[0].original_name} />
                    )}
                  </button>
                </article>
              ))}
              {!hotPosts.length && <div className="profile-empty">暂无热点内容。</div>}
            </div>
          </section>
        ) : isPersonalTab ? (
          <section className="profile-feed" aria-label={sheetLabel(activeTab)}>
            <div className="profile-feed-head">
              <div>
                <span>{activeTab === 'my-posts' ? '我的发布' : '我的互动'}</span>
                <strong>{activeTab === 'my-posts' ? `${myPostFeed.length} 条发帖` : `${myCommentFeed.length} 条评论`}</strong>
              </div>
              <button type="button" onClick={() => switchTab(activeTab)}>
                <RefreshCw size={14} />
                刷新
              </button>
            </div>

            {activeTab === 'my-posts' && (
              <div className="profile-feed-list">
                {myPostFeed.map((post) => (
                  <article className="profile-post-card" key={post.id}>
                    <button className="profile-card-main" type="button" onClick={() => openPostFromFeed(post.id)}>
                      <div className="profile-card-meta">
                        <span>{displayCategory(post.category)}</span>
                        <span>{formatTime(post.created_at)}</span>
                      </div>
                      <h3 className={postStyleClass(post.style_config)}>{post.title}</h3>
                      <p className={postStyleClass(post.style_config)}>{post.body}</p>
                      <ImageStrip attachments={post.attachments.slice(0, 4)} onPreview={setPreview} />
                    </button>
                    <div className="profile-card-actions">
                      <button className={post.liked_by_me ? 'liked' : ''} onClick={() => toggleLike(post)}>
                        <Heart size={15} />
                        {post.like_count}
                      </button>
                      <button onClick={() => openPostFromFeed(post.id)}>
                        <MessageSquare size={15} />
                        {post.comment_count}
                      </button>
                      <button onClick={() => editPostFromFeed(post)}>
                        <Edit3 size={14} />
                        编辑
                      </button>
                      <button className="danger-action" onClick={() => deleteSelectedPost(post)}>
                        <Trash2 size={14} />
                        删除
                      </button>
                    </div>
                  </article>
                ))}
                {!myPostFeed.length && <div className="profile-empty">还没有发过内容。</div>}
              </div>
            )}

            {activeTab === 'my-comments' && (
              <div className="profile-feed-list">
                {myCommentFeed.map((comment) => (
                  <article className="profile-comment-card" key={comment.id}>
                    <button className="profile-card-main" type="button" onClick={() => openPostFromFeed(comment.post.id)}>
                      <div className="profile-card-meta">
                        <span>评论于</span>
                        <strong>{comment.post.title}</strong>
                        <span>{formatTime(comment.created_at)}</span>
                      </div>
                      {comment.reply_to && (
                        <div className="reply-quote">回复 {comment.reply_to.author_nickname}：{comment.reply_to.body_preview}</div>
                      )}
                      <p>{comment.body}</p>
                      <ImageStrip attachments={comment.attachments.slice(0, 4)} onPreview={setPreview} />
                    </button>
                    <div className="profile-card-actions">
                      <button className={comment.liked_by_me ? 'liked' : ''} onClick={() => toggleCommentLike(comment)}>
                        <Heart size={15} />
                        {comment.like_count}
                      </button>
                      <button onClick={() => openPostFromFeed(comment.post.id)}>
                        <MessageSquare size={15} />
                        看原帖
                      </button>
                      <button className="danger-action" onClick={() => deleteComment(comment)}>
                        <Trash2 size={14} />
                        删除
                      </button>
                    </div>
                  </article>
                ))}
                {!myCommentFeed.length && <div className="profile-empty">还没有评论记录。</div>}
              </div>
            )}
          </section>
        ) : (
          <div className="spreadsheet workbook-grid" style={sheetStyle(sheetZoom)} aria-label="散点格点工作簿">
            <div className="corner-cell" />
            {sheetColumns.map((column) => (
              <div className="column-head" key={column}>{column}</div>
            ))}
            {sheetRows.map((row) => (
              <div className="row-head" key={row} style={{ gridRow: row + 1 }}>{row}</div>
            ))}
            {visiblePosts.map((post, index) => (
              <button
              className={`sheet-card tone-${cardTone(post, index)} ${selectedPost?.id === post.id ? 'selected' : ''}`}
              key={post.id}
              style={cardStyle(cardPlacements.get(post.id))}
              onClick={() => openDetail(post.id)}
              title={`${post.author.nickname}: ${post.title}`}
            >
                <span className="cell-meta">
                  {post.is_pinned && <Pin size={13} />}
                  {displayCategory(post.category)} · {post.like_count}赞 · {post.comment_count}评
                </span>
                <strong className={postStyleClass(post.style_config)}>{post.title}</strong>
                <span className={`cell-body ${postStyleClass(post.style_config)}`}>{post.body}</span>
                {post.attachments[0] && (
                  <img className="cell-image" src={uploadUrl(post.attachments[0].url)} alt={post.attachments[0].original_name} />
                )}
                <span className="cell-author">
                  <span>{post.author.nickname} · {formatTime(post.last_activity_at)}</span>
                  <em>查看</em>
                </span>
              </button>
            ))}
            {!visiblePosts.length && <div className="empty-canvas">当前筛选没有格点。</div>}
          </div>
        )}

        <aside className={`annotation-drawer ${drawerOpen ? 'open' : ''}`}>
          <button className="drawer-close" onClick={closeDrawer} aria-label="关闭批注">
            <X size={17} />
          </button>
          <section className="annotation-panel redbook-detail-panel">
            {selectedPost ? (
              <>
                {editingPostId === selectedPost.id ? (
                  <form className="post-edit-form" onSubmit={savePostEdit}>
                    <div className="annotation-meta">
                      <strong>{selectedPost.author.nickname}</strong>
                      <span>正在编辑 {selectedCell}</span>
                    </div>
                    <input
                      className={postStyleClass(editStyle)}
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      maxLength={160}
                    />
                    <textarea
                      className={postStyleClass(editStyle)}
                      value={editBody}
                      onChange={(event) => setEditBody(event.target.value)}
                    />
                    <div className="style-toolbar edit-style-toolbar" aria-label="编辑格点格式">
                      <Type size={15} />
                      <select
                        value={editStyle.fontFamily}
                        onChange={(event) => setEditStyle((current) => ({ ...current, fontFamily: event.target.value as PostStyle['fontFamily'] }))}
                      >
                        <option value="system">默认</option>
                        <option value="hei">黑体</option>
                        <option value="song">宋体</option>
                        <option value="serif">衬线</option>
                        <option value="mono">等宽</option>
                      </select>
                      <select
                        value={editStyle.titleSize}
                        onChange={(event) => setEditStyle((current) => ({ ...current, titleSize: event.target.value as PostStyle['titleSize'] }))}
                      >
                        <option value="compact">小标题</option>
                        <option value="normal">标准标题</option>
                        <option value="large">大标题</option>
                      </select>
                      <select
                        value={editStyle.bodySize}
                        onChange={(event) => setEditStyle((current) => ({ ...current, bodySize: event.target.value as PostStyle['bodySize'] }))}
                      >
                        <option value="compact">小正文</option>
                        <option value="normal">标准正文</option>
                        <option value="large">大正文</option>
                      </select>
                      <select
                        value={editStyle.accent}
                        onChange={(event) => setEditStyle((current) => ({ ...current, accent: event.target.value as PostStyle['accent'] }))}
                      >
                        <option value="green">绿</option>
                        <option value="blue">蓝</option>
                        <option value="red">红</option>
                        <option value="gold">黄</option>
                        <option value="ink">白</option>
                      </select>
                      <select
                        value={editStyle.titleColor}
                        onChange={(event) => setEditStyle((current) => ({ ...current, titleColor: event.target.value as PostStyle['titleColor'] }))}
                      >
                        <option value="ink">标题墨</option>
                        <option value="green">标题绿</option>
                        <option value="blue">标题蓝</option>
                        <option value="red">标题红</option>
                        <option value="gold">标题金</option>
                      </select>
                      <select
                        value={editStyle.bodyColor}
                        onChange={(event) => setEditStyle((current) => ({ ...current, bodyColor: event.target.value as PostStyle['bodyColor'] }))}
                      >
                        <option value="ink">正文墨</option>
                        <option value="green">正文绿</option>
                        <option value="blue">正文蓝</option>
                        <option value="red">正文红</option>
                        <option value="gold">正文金</option>
                      </select>
                      <button type="button" className={editStyle.bold ? 'active' : ''} onClick={() => setEditStyle((current) => ({ ...current, bold: !current.bold }))}>B</button>
                      <button type="button" className={editStyle.italic ? 'active' : ''} onClick={() => setEditStyle((current) => ({ ...current, italic: !current.italic }))}>I</button>
                      <button type="button" className={editStyle.underline ? 'active' : ''} onClick={() => setEditStyle((current) => ({ ...current, underline: !current.underline }))}>U</button>
                    </div>
                    <select value={editCategory} onChange={(event) => setEditCategory(event.target.value)}>
                      {categories.map((category) => (
                        <option key={category}>{category}</option>
                      ))}
                    </select>
                    <div className="edit-actions">
                      <button type="button" onClick={() => setEditingPostId(null)}>取消</button>
                      <button className="primary">
                        <Save size={15} />
                        保存
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="note-author-row">
                      <div className="comment-avatar">{avatarText(selectedPost.author.nickname)}</div>
                      <div>
                        <strong>{selectedPost.author.nickname}</strong>
                        <span>{displayCategory(selectedPost.category)} · {formatTime(selectedPost.created_at)}</span>
                      </div>
                      {selectedPost.is_pinned && <span className="pin-chip">置顶</span>}
                      {selectedPost.is_hidden && <span className="pin-chip danger">隐藏</span>}
                    </div>
                    <div className="panel-head note-content-head">
                      <h3 className={postStyleClass(selectedPost.style_config)}>{selectedPost.title}</h3>
                      <p className={`panel-body ${postStyleClass(selectedPost.style_config)}`}>{selectedPost.body}</p>
                    </div>
                  </>
                )}

                <div className="panel-block note-image-block">
                  <ImageStrip attachments={selectedPost.attachments} onPreview={setPreview} />
                </div>

                <div className="panel-actions note-action-bar">
                  <button className={`like-button ${selectedPost.liked_by_me ? 'liked' : ''}`} onClick={() => toggleLike(selectedPost)}>
                    <Heart size={16} />
                    {selectedPost.like_count}
                  </button>
                  <span>
                    <MessageSquare size={15} />
                    {comments.length} 条评论
                  </span>
                  {canEditSelected && editingPostId !== selectedPost.id && (
                    <button onClick={() => setEditingPostId(selectedPost.id)}>
                      <Edit3 size={14} />
                      编辑
                    </button>
                  )}
                  {canEditSelected && (
                    <button className="danger-action" onClick={() => deleteSelectedPost(selectedPost)}>
                      <Trash2 size={14} />
                      删除帖子
                    </button>
                  )}
                  {user.role === 'admin' && (
                    <>
                      <button onClick={() => updateAdmin(selectedPost, { is_pinned: !selectedPost.is_pinned })}>
                        <Pin size={14} />
                        {selectedPost.is_pinned ? '取消置顶' : '置顶'}
                      </button>
                      {selectedPost.is_hidden ? (
                        <button onClick={() => updateAdmin(selectedPost, { is_hidden: false })}>
                          <ArchiveRestore size={14} />
                          恢复
                        </button>
                      ) : (
                        <button onClick={() => updateAdmin(selectedPost, { is_hidden: true })}>
                          <EyeOff size={14} />
                          隐藏
                        </button>
                      )}
                    </>
                  )}
                </div>

                <div className="panel-comments-head redbook-comments-head">
                  <strong>评论</strong>
                  <div className="comment-sort-tabs">
                    <button type="button" className={commentSort === 'latest' ? 'active' : ''} onClick={() => setCommentSort('latest')}>
                      最新
                    </button>
                    <button type="button" className={commentSort === 'liked' ? 'active' : ''} onClick={() => setCommentSort('liked')}>
                      最喜欢
                    </button>
                    <span>{comments.length}</span>
                  </div>
                </div>

                <form className="comment-compose-redbook" onSubmit={submitComment}>
                  <div className="comment-avatar">{avatarText(user.nickname)}</div>
                    <div className="comment-compose-main">
                      {replyingToComment && (
                        <div className="reply-target-bar">
                          <span>回复 {replyingToComment.author.nickname}</span>
                          <button type="button" onClick={() => setReplyingToId(null)}>
                            <X size={13} />
                          </button>
                        </div>
                      )}
                      <textarea
                      ref={commentInputRef}
                      placeholder={replyingToComment ? `回复 ${replyingToComment.author.nickname}...` : '说点什么...'}
                      value={commentBody}
                      onChange={(event) => setCommentBody(event.target.value)}
                    />
                    <div className="comment-compose-tools">
                      <FilePicker files={commentFiles} onChange={setCommentFiles} onError={setMessage} compact label="图片" />
                      <button className="send-chip" disabled={commentSubmitting}>
                        {commentSubmitting ? <span className="button-spinner" /> : <Send size={14} />}
                        {commentSubmitting ? '发送中' : '发送'}
                      </button>
                    </div>
                  </div>
                </form>

                <div className="comments panel-comments">
                  {sortedComments.map((comment) => (
                    <article className="redbook-comment" key={comment.id}>
                      <div className="comment-avatar">{avatarText(comment.author.nickname)}</div>
                      <div className="comment-main">
                        <div className="comment-name">{comment.author.nickname}</div>
                        {comment.reply_to && (
                          <div className="reply-quote">
                            回复 {comment.reply_to.author_nickname}：{comment.reply_to.body_preview}
                          </div>
                        )}
                        <p className={postStyleClass(comment.style_config)}>{comment.body}</p>
                        <ImageStrip attachments={comment.attachments} onPreview={setPreview} />
                        <div className="comment-action-row">
                          <span>{formatTime(comment.created_at)}</span>
                          <button className={comment.liked_by_me ? 'liked' : ''} onClick={() => toggleCommentLike(comment)}>
                            <Heart size={13} />
                            {comment.like_count}
                          </button>
                          <button
                            onClick={() => {
                              if (replyingToId === comment.id) {
                                setReplyingToId(null);
                              } else {
                                startReply(comment);
                              }
                            }}
                          >
                            {replyingToId === comment.id ? '取消回复' : '回复'}
                          </button>
                          {(comment.author.id === user.id || user.role === 'admin') && (
                            <button onClick={() => deleteComment(comment)} title="删除评论">
                              删除
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                  {!comments.length && <div className="empty-comments">还没有评论。</div>}
                </div>
              </>
            ) : (
              <div className="panel-empty">
                <strong>选择一个格点</strong>
                <span>内容、图片和评论会在这里打开。</span>
              </div>
            )}
          </section>
        </aside>
      </section>

      {preview && (
        <div className="preview-modal" onClick={() => setPreview(null)}>
          <div className="preview-frame" onClick={(event) => event.stopPropagation()}>
            <button onClick={() => setPreview(null)}>
              <X size={18} />
            </button>
            <img src={uploadUrl(preview.url)} alt={preview.original_name} />
            <span>{preview.original_name}</span>
          </div>
        </div>
      )}
      {toast && <div className="redbook-toast">{toast}</div>}
    </main>
  );
}
