import clsx from 'clsx';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import styles from './index.module.css';
import { Highlighter, NotepadText, CloudUpload } from 'lucide-react';
// 特性列表 - 在这里定义你的核心功能
const iconStyle = { color: '#C89C68', size: 65 };
const FeatureList = [
  {
    title: '智能单词高亮',
    Svg: require('@site/static/img/feature-highlight.svg').default,
    icon: <Highlighter {...iconStyle} />,
    description: <>自动识别并高亮页面上的生词和学习中的词汇，让你在阅读时自然地聚焦于学习重点。</>,
  },
  {
    title: '情境感知交互',
    Svg: require('@site/static/img/feature-context.svg').default,
    description: (
      <>
        通过 <code>Alt + Click</code> 唤出单词卡片，获取基于当前上下文的 AI
        释义，让理解更深入、更精准。
      </>
    ),
    icon: <NotepadText {...iconStyle} />,
  },
  {
    title: '个人词库云同步',
    Svg: require('@site/static/img/feature-cloud.svg').default,
    description: (
      <>
        你的所有学习进度和词汇状态都将安全地保存在云端，随时随地在任何设备上无缝衔接你的学习旅程。
      </>
    ),
    icon: <CloudUpload {...iconStyle} />,
  },
] satisfies FeatureItem[];
interface FeatureItem {
  title: string;
  Svg: React.ComponentType<React.ComponentProps<'svg'>>;
  description: any;
  icon?: any;
}

// 单个特性卡片的组件
function Feature({ Svg, title, description, icon }: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        {icon ? icon : <Svg className={styles.featureSvg} role="img" />}
      </div>
      <div className="text--center padding-horiz--md">
        <h3 style={{ color: '#333333' }}>{title}</h3>
        <p style={{ color: '#4f4f4f' }}>{description}</p>
      </div>
    </div>
  );
}

// 首页的 "英雄区域"
function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <h1
          className="hero__title"
          style={{ color: 'white', textShadow: '2px 2px 4px rgba(0, 0, 0, 0.5)' }}
        >
          {siteConfig.title}
        </h1>
        <p
          className="hero__subtitle"
          style={{ color: 'white', textShadow: '1px 1px 2px rgba(0, 0, 0, 0.5)' }}
        >
          {siteConfig.tagline}
        </p>
        <div className={styles.buttons}>
          <Link className="button button--secondary button--lg" to="/docs/quick-start">
            快速上手指南 →
          </Link>
        </div>
      </div>
    </header>
  );
}

// 首页的特性区域
function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}

// 最终导出的首页组件
export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`欢迎来到 ${siteConfig.title}`}
      description="LinguoLand - 你的个性化网页英语学习助手"
    >
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
