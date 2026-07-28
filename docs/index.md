---
layout: home

hero:
  name: SupSub CLI
  text: 在终端里追你的订阅
  tagline: 管理公众号 / 网站 / 推特订阅源，浏览关注点与分组，全站搜索内容——并让 AI agent 用自然语言直接驱动。
  actions:
    - theme: brand
      text: 快速上手
      link: /guide/getting-started
    - theme: alt
      text: 命令参考
      link: /reference/
    - theme: alt
      text: GitHub
      link: https://github.com/SupSub-AI/supsub-cli

features:
  - title: 订阅、关注点、分组
    details: 一套命令管好三类对象——具体的号、AI 聚合的主题方向、以及收纳订阅源的文件夹，并随时查看各自的未读数。
    link: /guide/concepts
    linkText: 先搞清三者区别
  - title: 全站搜索
    details: 按关键词搜文章正文与信息源，支持只搜公众号、只搜网站或只搜内容正文。
    link: /reference/search
    linkText: search 命令
  - title: 脚本友好
    details: 所有命令支持 -o json 输出到 stdout，配合语义化退出码（未登录 2 / 套餐过期 3 / 网络 10），可直接接 jq 做自动化。
    link: /reference/exit-codes
    linkText: 退出码约定
  - title: 交给 AI 助手
    details: 设置一次，之后用平常说话的方式提要求就行——它不只是代你操作，还能帮你总结、筛选、把一堆未读整理成简报。
    link: /agents/
    linkText: 让 AI 助手帮你用
  - title: 免运行时依赖
    details: 预编译单文件可执行程序，覆盖 macOS / Linux / Windows 的 x64 与 arm64。装完即用，运行时不需要 Node。
    link: /guide/installation
    linkText: 安装说明
  - title: 自更新
    details: supsub update 查最新版并原地替换二进制，同时把本地 Agent Skills 同步到同一版本，避免版本漂移。
    link: /guide/updating
    linkText: 升级流程
---
