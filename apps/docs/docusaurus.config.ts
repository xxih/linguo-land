import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  // --- 1. 核心网站信息 ---
  title: 'LinguoLand', // 网站主标题
  tagline: '你的个性化网页英语学习助手', // 网站副标题
  favicon: 'img/logo.png', // 浏览器标签页图标

  // 部署的最终域名
  url: 'https://www.linguoland.com',
  // 网站的根路径
  baseUrl: '/',

  // GitHub Pages 部署配置
  organizationName: 'your-github-username', // 替换为你的 GitHub 用户名
  projectName: 'LinguoLand', // 你的仓库名

  onBrokenLinks: 'throw', // 遇到无效链接时中断构建
  onBrokenMarkdownLinks: 'warn', // 遇到无效 Markdown 链接时发出警告

  // --- 2. 国际化 (i18n) ---
  i18n: {
    defaultLocale: 'zh-Hans', // 默认语言为中文简体
    locales: ['zh-Hans'], // 目前支持的语言列表
  },

  // --- 3. Docusaurus 预设 ---
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts', // 侧边栏配置文件路径
          // "在 GitHub 上编辑此页" 的链接模板
          editUrl: 'https://github.com/your-github-username/LinguoLand/tree/main/apps/docs/',
          // 设置侧边栏默认展开
          sidebarCollapsible: false,
        },
        blog: false, // 我们暂时不需要博客功能
        theme: {
          customCss: './src/css/custom.css', // 自定义全局样式
        },
      } satisfies Preset.Options,
    ],
  ],

  // --- 4. 主题配置 (控制网站外观) ---
  themeConfig: {
    // 替换为你的项目 Logo
    image: 'img/docusaurus-social-card.jpg', // 用于社交媒体分享时的预览图
    navbar: {
      title: 'LinguoLand',
      logo: {
        alt: 'LinguoLand Logo',
        src: 'img/logo.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar', // 对应 sidebars.ts 中的 ID
          position: 'left',
          label: '使用文档',
        },
        // 未来可以添加博客链接
        // { to: '/blog', label: '博客', position: 'left' },
        // {
        //   href: 'https://github.com/your-github-username/LinguoLand',
        //   label: 'GitHub',
        //   position: 'right',
        // },
      ],
    },
    docs: {
      sidebar: {
        hideable: false,
        autoCollapseCategories: false,
      },
    },
    footer: {
      style: 'light',
      // links: [
      //   {
      //     title: '文档',
      //     items: [
      //       {
      //         label: '快速上手',
      //         to: '/',
      //       },
      //       {
      //         label: '核心功能',
      //         to: '/docs/category/核心功能详解',
      //       },
      //     ],
      //   },
      //   {
      //     title: '社区与支持',
      //     items: [
      //       {
      //         label: '问题反馈 (GitHub Issues)',
      //         href: 'https://github.com/your-github-username/LinguoLand/issues',
      //       },
      //       // 如果你有其他社区链接，可以在此添加
      //     ],
      //   },
      //   {
      //     title: '更多',
      //     items: [
      //       {
      //         label: 'GitHub',
      //         href: 'https://github.com/your-github-username/LinguoLand',
      //       },
      //     ],
      //   },
      // ],
      copyright: `Copyright © ${new Date().getFullYear()} LinguoLand. 使用 Docusaurus 构建。<br/>粤ICP备2025463824号`,
    },
    // 代码高亮主题
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
