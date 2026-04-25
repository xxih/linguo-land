/**
 * EPUB 元信息抽取：仅解析 OPF + 目录（nav.xhtml 或 NCX），不解压正文。
 *
 * EPUB 是一个 zip 包：
 *   META-INF/container.xml  → 指向 .opf 的位置
 *   *.opf                   → 元数据 (dc:title / dc:creator) + manifest + spine
 *   nav.xhtml 或 toc.ncx    → 目录树
 *
 * 服务端只读这三处，正文保留在原 .epub 文件里，由移动端 epub.js 直渲（见 ADR 0018）。
 */
import { Open, type CentralDirectory } from 'unzipper';
import { XMLParser } from 'fast-xml-parser';
import { posix } from 'path';
import type { DocumentTocEntry } from 'shared-types';

export interface EpubMeta {
  title?: string;
  author?: string;
  toc?: DocumentTocEntry[];
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true,
});

export async function parseEpubMeta(filePath: string): Promise<EpubMeta> {
  const directory = await Open.file(filePath);
  const fileMap = buildFileMap(directory);

  const containerXml = await readEntry(fileMap, 'META-INF/container.xml');
  if (!containerXml) {
    throw new Error('META-INF/container.xml 缺失，不是合法 EPUB');
  }
  const containerDoc = xml.parse(containerXml);
  const rootfileNode = containerDoc?.container?.rootfiles?.rootfile;
  const rootfile = Array.isArray(rootfileNode) ? rootfileNode[0] : rootfileNode;
  const opfPath: string | undefined = rootfile?.['@_full-path'];
  if (!opfPath) {
    throw new Error('container.xml 没有 rootfile full-path');
  }

  const opfText = await readEntry(fileMap, opfPath);
  if (!opfText) {
    throw new Error(`OPF 文件缺失：${opfPath}`);
  }
  const opfDir = posix.dirname(opfPath);
  const opfDoc = xml.parse(opfText);
  const pkg = opfDoc?.package;
  if (!pkg) {
    throw new Error('OPF 根节点不是 <package>');
  }

  const title = extractText(pickMeta(pkg.metadata, 'title'));
  const author = extractText(pickMeta(pkg.metadata, 'creator'));

  const itemList = toArray<any>(pkg.manifest?.item);
  const toc = await extractToc(fileMap, opfDir, pkg, itemList);

  return { title, author, toc };
}

function buildFileMap(directory: CentralDirectory): Map<string, CentralDirectory['files'][number]> {
  const map = new Map<string, CentralDirectory['files'][number]>();
  for (const f of directory.files) {
    map.set(f.path.replace(/\\/g, '/'), f);
  }
  return map;
}

async function readEntry(
  map: Map<string, CentralDirectory['files'][number]>,
  path: string,
): Promise<string | null> {
  const entry = map.get(path);
  if (!entry) return null;
  const buf = await entry.buffer();
  return buf.toString('utf-8');
}

/**
 * OPF metadata 元素同时支持 dc:title / title（取决于 namespace 是否被 parser 剥离），
 * 这里两种都试一下。
 */
function pickMeta(metadata: any, dcName: string): any {
  if (!metadata) return undefined;
  return metadata[`dc:${dcName}`] ?? metadata[dcName];
}

function extractText(node: any): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'string') return node.trim() || undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const t = extractText(item);
      if (t) return t;
    }
    return undefined;
  }
  if (typeof node === 'object') {
    const text = (node['#text'] ?? '').toString().trim();
    return text || undefined;
  }
  return undefined;
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

async function extractToc(
  fileMap: Map<string, CentralDirectory['files'][number]>,
  opfDir: string,
  pkg: any,
  items: any[],
): Promise<DocumentTocEntry[] | undefined> {
  // EPUB3：manifest 中带 properties="nav"
  const navItem = items.find((i) =>
    String(i?.['@_properties'] ?? '')
      .split(/\s+/)
      .includes('nav'),
  );
  if (navItem?.['@_href']) {
    const navPath = posix.join(opfDir, navItem['@_href']);
    const navText = await readEntry(fileMap, navPath);
    if (navText) {
      const result = parseNavXhtml(navText);
      if (result?.length) return result;
    }
  }

  // EPUB2 NCX：spine[toc] 引用 manifest 中的 ncx item
  const ncxId: string | undefined = pkg.spine?.['@_toc'];
  const ncxItem =
    (ncxId && items.find((i) => i?.['@_id'] === ncxId)) ||
    items.find((i) => i?.['@_media-type'] === 'application/x-dtbncx+xml');
  if (ncxItem?.['@_href']) {
    const ncxPath = posix.join(opfDir, ncxItem['@_href']);
    const ncxText = await readEntry(fileMap, ncxPath);
    if (ncxText) {
      const result = parseNcx(ncxText);
      if (result?.length) return result;
    }
  }

  return undefined;
}

/**
 * 取 nav.xhtml 中 epub:type="toc" 的最外层 <ol> 段。EPUB3 规范保证 nav.xhtml
 * 是 well-formed XHTML，所以平衡扫描在实践中够用；遇到边角 case 再升级到完整 DOM 解析。
 */
function parseNavXhtml(content: string): DocumentTocEntry[] | undefined {
  const navMatch = content.match(
    /<nav\b[^>]*epub:type=["']toc["'][^>]*>([\s\S]*?)<\/nav>/i,
  );
  const scope = navMatch ? navMatch[1] : content;
  const olBody = sliceFirstBalanced(scope, 'ol');
  if (olBody === null) return undefined;
  return parseOlBody(olBody);
}

/**
 * 找到字符串中"第一个 <tag> 与之配对的 </tag>"之间的内容（不含两端标签本身）。
 * 用于处理嵌套同名标签的场景，比正则非贪婪 / 贪婪都更可靠。
 */
function sliceFirstBalanced(html: string, tag: string): string | null {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'i');
  const m = openRe.exec(html);
  if (!m) return null;
  const startInner = m.index + m[0].length;
  let depth = 1;
  const len = html.length;
  let i = startInner;
  const openLower = `<${tag.toLowerCase()}`;
  const closeLower = `</${tag.toLowerCase()}>`;
  while (i < len) {
    const lower = html.slice(i, i + Math.max(closeLower.length, openLower.length + 1)).toLowerCase();
    if (lower.startsWith(closeLower)) {
      depth--;
      if (depth === 0) {
        return html.slice(startInner, i);
      }
      i += closeLower.length;
      continue;
    }
    if (lower.startsWith(openLower) && /[\s>]/.test(html[i + openLower.length] ?? '')) {
      depth++;
      // 跳过 open 标签整段
      const closeBracket = html.indexOf('>', i);
      if (closeBracket === -1) return null;
      i = closeBracket + 1;
      continue;
    }
    i++;
  }
  return null;
}

function parseOlBody(html: string): DocumentTocEntry[] {
  const entries: DocumentTocEntry[] = [];
  // 取顶层 <li>...</li>。简单平衡扫描：碰到嵌套 <li> 进栈，</li> 出栈，深度 0 时切片。
  let depth = 0;
  let start = -1;
  for (let i = 0; i < html.length; i++) {
    if (html.startsWith('<li', i) && /[\s>]/.test(html[i + 3] ?? '')) {
      if (depth === 0) start = i;
      depth++;
      i += 2;
      continue;
    }
    if (html.startsWith('</li>', i)) {
      depth--;
      if (depth === 0 && start >= 0) {
        const liInner = html.slice(start, i + 5);
        const entry = parseLi(liInner);
        if (entry) entries.push(entry);
        start = -1;
      }
      i += 4;
    }
  }
  return entries;
}

function parseLi(li: string): DocumentTocEntry | null {
  const aMatch = li.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  if (!aMatch) return null;
  const href = aMatch[1];
  const label = stripHtml(aMatch[2]).trim();
  if (!label) return null;
  // 嵌套 <ol>：用平衡扫描，避免多层嵌套时被内层 </ol> 截断
  const childOlBody = sliceFirstBalanced(li, 'ol');
  const children = childOlBody ? parseOlBody(childOlBody) : undefined;
  return children?.length ? { label, href, children } : { label, href };
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNcx(content: string): DocumentTocEntry[] | undefined {
  const doc = xml.parse(content);
  const navMap = doc?.ncx?.navMap?.navPoint;
  if (!navMap) return undefined;
  return walkNcx(toArray(navMap));
}

function walkNcx(points: any[]): DocumentTocEntry[] {
  return points
    .map((p) => {
      const label = extractText(p?.navLabel?.text) ?? '';
      const href: string = p?.content?.['@_src'] ?? '';
      const childPoints = toArray(p?.navPoint);
      const children = childPoints.length ? walkNcx(childPoints) : undefined;
      if (!label || !href) return null;
      const node: DocumentTocEntry = { label, href };
      if (children?.length) node.children = children;
      return node;
    })
    .filter((x): x is DocumentTocEntry => x !== null);
}
