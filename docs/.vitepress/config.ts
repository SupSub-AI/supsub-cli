import { defineConfig } from 'vitepress'

const REPO = 'https://github.com/SupSub-AI/supsub-cli'

export default defineConfig({
  lang: 'zh-CN',
  title: 'SupSub CLI',
  description: '在终端里管理订阅源、关注点与全站搜索的命令行工具',

  // 部署在 GitHub Pages 项目路径下：https://supsub-ai.github.io/supsub-cli/
  base: '/supsub-cli/',

  cleanUrls: true,
  lastUpdated: true,

  // 两篇面向维护者的内部设计文档（大量 mermaid 时序图）不进站点，
  // 仍留在仓库里供 GitHub 上直接阅读。
  srcExclude: ['cli-auth-flow.md', 'self-update-flow.md'],

  // 浏览器 UI 配色跟随 supsub.net（官网自身声明的 theme-color 为 #F7F3EA）
  head: [
    [
      'meta',
      {
        name: 'theme-color',
        media: '(prefers-color-scheme: light)',
        content: '#f7f3ea',
      },
    ],
    [
      'meta',
      {
        name: 'theme-color',
        media: '(prefers-color-scheme: dark)',
        content: '#191411',
      },
    ],
  ],

  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: '命令参考', link: '/reference/', activeMatch: '/reference/' },
      { text: 'AI 助手', link: '/agents/', activeMatch: '/agents/' },
      {
        text: 'npm',
        link: 'https://www.npmjs.com/package/@supsub/cli',
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '开始',
          items: [
            { text: '快速上手', link: '/guide/getting-started' },
            { text: '安装', link: '/guide/installation' },
            { text: '登录与凭证', link: '/guide/auth' },
          ],
        },
        {
          text: '进阶',
          items: [
            { text: '核心概念', link: '/guide/concepts' },
            { text: '升级与 Skills 同步', link: '/guide/updating' },
          ],
        },
      ],

      '/reference/': [
        {
          text: '命令参考',
          items: [
            { text: '总览与全局选项', link: '/reference/' },
            { text: 'auth 认证', link: '/reference/auth' },
            { text: 'sub 订阅源', link: '/reference/sub' },
            { text: 'focus 关注点', link: '/reference/focus' },
            { text: 'group 订阅分组', link: '/reference/group' },
            { text: 'unread 未读概览', link: '/reference/unread' },
            { text: 'search 搜索', link: '/reference/search' },
            { text: 'deepread 精读', link: '/reference/deepread' },
            { text: 'mp 公众号', link: '/reference/mp' },
            { text: 'update / skills', link: '/reference/update' },
          ],
        },
        {
          text: '终端约定',
          items: [
            { text: '输出格式', link: '/reference/output' },
            { text: '退出码', link: '/reference/exit-codes' },
            { text: '环境变量', link: '/reference/env' },
          ],
        },
      ],

      '/agents/': [
        {
          text: 'AI 助手',
          items: [
            { text: '让 AI 助手帮你用', link: '/agents/' },
            { text: '我可以这么说', link: '/agents/scenarios' },
            { text: '怎么说更准', link: '/agents/phrasing' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: REPO }],

    editLink: {
      pattern: `${REPO}/edit/master/docs/:path`,
      text: '在 GitHub 上编辑此页',
    },

    footer: {
      message: '基于 MIT 许可发布',
      copyright: `Copyright © 2025-present SupSub`,
    },

    search: {
      provider: 'local',
      options: {
        // 默认分词器按空格切分，对中文几乎不生效；这里额外在相邻汉字之间切开，
        // 让「订阅」「关注点」这类词能被检索到。
        miniSearch: {
          options: {
            tokenize: (text: string) =>
              text
                .split(/[\n\r\p{Z}\p{P}]+|(?<=\p{sc=Han})(?=\p{sc=Han})/u)
                .filter(Boolean),
          },
        },
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            displayDetails: '显示详细列表',
            resetButtonTitle: '清除查询条件',
            noResultsText: '无法找到相关结果',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭',
            },
          },
        },
      },
    },

    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    darkModeSwitchLabel: '外观',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',
    lastUpdated: { text: '最后更新于' },
  },
})
