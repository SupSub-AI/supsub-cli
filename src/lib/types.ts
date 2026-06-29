// packages/cli/src/lib/types.ts
// 所有 CLI 类型定义集中维护，禁止散落 inline

// ─── 用户相关 ───────────────────────────────────────────────
export type UserInfo = {
  id: number;
  email: string;
  name: string;
  avatar: string;
  google: boolean;
  expired: boolean;
  endAt: number;
  opml: string;
  onboardingCompleted: boolean;
  referralSourceSubmitted: boolean;
};

// ─── 订阅相关 ────────────────────────────────────────────────
export type Subscription = {
  sourceType: 'MP' | 'WEBSITE' | 'X';
  sourceId: number;
  name: string;
  img: string;
  description: string;
  unreadCount: number;
};

export type Article = {
  articleId: string;
  url: string;
  title: string;
  coverImage: string;
  tags: string[];
  summary: string;
  publishedAt: unknown; // schema: integer 时间戳；example: "2025-06-18 11:49:46"
  isRead: boolean;
};

// ─── 搜索相关 ────────────────────────────────────────────────
export type SourceBasic = {
  sourceType: string;
  sourceId: number;
  isSubscribed: boolean;
  img: string;
  name: string;
  description: string;
  introduction: string;
  url: string;
};

export type ContentBasic = {
  contentId: string;
  coverImage: string;
  isSubscribed: boolean;
  keywords: string[];
  publishedAt: number;
  sourceId: number;
  sourceName: string;
  sourceType: string;
  summary: string;
  tags: string[];
  title: string;
  url: string;
};

export type SearchResultItem =
  | { type: 'SOURCE'; data: SourceBasic }
  | { type: 'CONTENT'; data: ContentBasic };

export type SearchResponse = {
  results: SearchResultItem[];
  recommendations: SourceBasic[];
  prompts: string[];
};

// ─── MP 搜索任务 ─────────────────────────────────────────────
export type MpSearchTaskResult = {
  finished: boolean;
  message: string;
  mp: {
    mpId: string;
    name: string;
    img: string;
    description: string;
  } | null;
};

// ─── 关注点（focus）相关 ──────────────────────────────────────
/** 关注点列表项（GET /api/focuses） */
export type Focus = {
  id: number;
  icon: string; // emoji
  title: string;
  unreadCount: number;
};

/** 关注点内容条目（GET /api/focuses/{id}/contents），聚合多来源 */
export type FocusContent = {
  articleId: string;
  url: string;
  title: string;
  coverImage: string;
  keywords: string[];
  tags: string[];
  summary: string;
  sourceType: string; // MP / WEBSITE / X …
  sourceName: string;
  publishedAt: unknown; // 整数秒级时间戳或字符串，渲染时兼容
  isRead: boolean;
};
