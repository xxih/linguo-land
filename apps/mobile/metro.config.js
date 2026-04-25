/**
 * Metro 在 pnpm monorepo + nativewind 双重特殊配置下的入口。
 *
 * - watchFolders 指向 monorepo 根，让 packages/shared-types 的修改能被热重载捕获
 * - nodeModulesPaths 同时包含 mobile 自己的 node_modules 和 root node_modules，
 *   pnpm 把 hoisted 的依赖放在后者
 * - disableHierarchicalLookup 关掉默认的"逐级向上找 node_modules"行为，避免 Metro
 *   把 node_modules 之外的同名文件解析进来（pnpm 的 .pnpm/ 结构会把它搞乱）
 * - withNativeWind 把 Tailwind 编译流接入 Metro，input 指 global.css
 */
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 保留 Expo 默认 watchFolders（asset 等），再追加 monorepo 根
config.watchFolders = Array.from(
  new Set([...(config.watchFolders ?? []), workspaceRoot]),
);
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// pnpm 的 .pnpm 平铺布局下，Metro 默认 hierarchical lookup 会把同名包解析进
// 错误的拷贝。关掉它 + 上面显式 nodeModulesPaths 是 pnpm monorepo 的标配。
config.resolver.disableHierarchicalLookup = true;

module.exports = withNativeWind(config, { input: './global.css' });
