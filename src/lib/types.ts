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
  contentId: string; // 旧契约为 articleId，2026-07 实测线上已统一为 contentId
  url: string;
  title: string;
  originalTitle: string; // 上游返回的原始标题
  coverImage: string;
  tags: string[];
  summary: string;
  publishedAt: unknown; // schema: integer 时间戳；example: "2025-06-18 11:49:46"
  isRead: boolean;
};

/**
 * contents 的 JSON 输出形态：在原字段上补一个人类/agent 可读的 `publishedAtText`。
 * 原始 `publishedAt`（多为 Unix 秒）保留，便于调用方排序。
 */
export type ArticleJson = Article & { publishedAtText: string };

/** `--brief` 精简形态：批量枚举时只保留定位与判重所需字段，避免 summary 撑爆输出 */
export type ArticleBrief = Pick<
  Article,
  'contentId' | 'title' | 'originalTitle' | 'publishedAt' | 'isRead'
> & {
  publishedAtText: string;
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

/**
 * search 的 JSON 输出形态：CONTENT 结果补 `publishedAtText`（同 contents 的做法）。
 * 不然 agent 拿到的只有 Unix 秒，每次都得额外跑一趟 `date -r` 去转。
 */
export type ContentBasicJson = ContentBasic & { publishedAtText: string };

export type SearchResultItemJson =
  | { type: 'SOURCE'; data: SourceBasic }
  | { type: 'CONTENT'; data: ContentBasicJson };

export type SearchResponseJson = Omit<SearchResponse, 'results'> & {
  results: SearchResultItemJson[];
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
  contentId: string; // 旧契约为 articleId，2026-07 实测线上已统一为 contentId

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

/** focus contents 的 JSON 输出形态（同 ArticleJson，补 `publishedAtText`） */
export type FocusContentJson = FocusContent & { publishedAtText: string };

/** focus contents 的 `--brief` 精简形态：多保留 sourceType / sourceName，因为关注点是跨源聚合的 */
export type FocusContentBrief = Pick<
  FocusContent,
  'contentId' | 'title' | 'publishedAt' | 'isRead' | 'sourceType' | 'sourceName'
> & { publishedAtText: string };

// ─── 订阅分组（group）相关 ────────────────────────────────────
/**
 * 分组。id 宽容为 number|string：api.json 声明列表 id 为 int、创建返回为
 * string(uuid)，2026-07 实测两处均为 int，但为防后端切换 uuid 保留宽容类型；
 * 拼 path 时统一 String()。
 */
export type Group = {
  id: number | string;
  name: string;
};

/** 创建分组结果（POST /api/groups，201） */
export type GroupCreateResult = {
  id: number | string;
};

/** 分组订阅源条目（GET /api/groups/{id}/subscriptions） */
export type GroupSubscription = {
  sourceType: string; // MP / WEBSITE / X / PODCAST / NEWSLETTER（比订阅命令的三值枚举宽）
  sourceId: number;
  name: string;
  img: string;
  description: string;
  inGroup: boolean;
  unreadCount?: number; // 仅 groupOnly=true 时返回（2026-07 实测确认）
};

/** 分组成员写入形态（POST /api/groups/{id}/subscriptions 的 body 元素） */
export type GroupMember = {
  sourceType: string;
  sourceId: number;
};

// ─── 未读概览 ────────────────────────────────────────────────
/** supsub unread 的聚合结果（并发拉取订阅列表 + 关注点列表） */
export type UnreadOverview = {
  subscriptions: Subscription[];
  focuses: Focus[];
};

// ─── 精读（deep read）相关 ────────────────────────────────────
/** 精读任务状态。none = 从未发起过 */
export type DeepReadStatus = 'none' | 'pending' | 'done' | 'failed';

/** 干货成色 / 来源可信度共用的「等级 + 说明」形态 */
export type DeepReadGrade = {
  grade: string; // 高 / 中 / 低
  comment: string;
};

/** 精读正文的一节 */
export type DeepReadSection = {
  title: string;
  markdown: string;
};

/** 编辑批注 */
export type DeepReadAnnotations = {
  background: string;
  stance: string;
  credibility: { grade: string; reason: string };
  weakestLink: string;
};

/**
 * 精读结果主体（prompt_version = v1）。
 *
 * ⚠️ 与 api.json 的两处出入（2026-07-27 实测）：
 * 1. `version` 实际在响应**顶层**，不在 content 里 —— 这里标成可选，别依赖。
 * 2. api.json 把所有字段标为 required，但旧数据 / 未来版本未必齐全，全部按可选防御。
 */
export type DeepReadContent = {
  version?: string;
  essence?: string;
  quality?: DeepReadGrade;
  keyPoints?: string[];
  body?: { sections?: DeepReadSection[] };
  annotations?: DeepReadAnnotations;
};

/** GET /api/deep-reads 的响应 */
export type DeepReadResponse = {
  status: DeepReadStatus;
  version?: string;
  content?: DeepReadContent;
};

/** GET /api/deep-reads/quota 的响应 */
export type DeepReadQuota = {
  limit: number;
  used: number;
  remaining: number;
};

/**
 * GET /api/deep-reads/shared?code= 的响应（公开，无需鉴权）。
 *
 * ⚠️ api.json 用 allOf 把精读结果**平铺**在文章信息旁边，实测不是：
 * 精读结果嵌在 `content` 里，与 GET /api/deep-reads 同构（2026-07-27 实测）。
 */
export type SharedDeepRead = {
  url: string;
  title: string;
  coverImage: string;
  summary: string;
  version?: string;
  content?: DeepReadContent;
};
