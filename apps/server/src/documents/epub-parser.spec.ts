import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import JSZip from 'jszip';
import { parseEpubMeta } from './epub-parser';

/**
 * 用 jszip 现造一份"最小但完整"的 EPUB（container.xml + OPF + nav.xhtml + 一节 xhtml 占位），
 * 走 parseEpubMeta 验证。EPUB3 nav 路径与 EPUB2 NCX 路径分开测，因为 fallback 链路
 * 历史上最容易翻车（spine[toc] 引用、namespace 剥离行为差异等）。
 */
describe('parseEpubMeta', () => {
  let tmpFile: string | null = null;

  afterEach(async () => {
    if (tmpFile) {
      await fs.unlink(tmpFile).catch(() => {});
      tmpFile = null;
    }
  });

  async function writeEpub(zip: JSZip): Promise<string> {
    const out = join(tmpdir(), `epub-test-${Date.now()}-${Math.random()}.epub`);
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    await fs.writeFile(out, buf);
    tmpFile = out;
    return out;
  }

  function buildContainerXml(opfPath: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  }

  it('解析 EPUB3：title / author / nav.xhtml 目录', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file('META-INF/container.xml', buildContainerXml('OPS/content.opf'));
    zip.file(
      'OPS/content.opf',
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Sample EPUB Book</dc:title>
    <dc:creator>Jane Doe</dc:creator>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chap01.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chap02.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`,
    );
    zip.file(
      'OPS/nav.xhtml',
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="chap01.xhtml">Chapter 1</a></li>
        <li><a href="chap02.xhtml">Chapter 2: Plot</a></li>
      </ol>
    </nav>
  </body>
</html>`,
    );
    zip.file('OPS/chap01.xhtml', '<html><body><p>Hello.</p></body></html>');
    zip.file('OPS/chap02.xhtml', '<html><body><p>World.</p></body></html>');

    const path = await writeEpub(zip);
    const meta = await parseEpubMeta(path);
    expect(meta.title).toBe('Sample EPUB Book');
    expect(meta.author).toBe('Jane Doe');
    expect(meta.toc).toEqual([
      { label: 'Chapter 1', href: 'chap01.xhtml' },
      { label: 'Chapter 2: Plot', href: 'chap02.xhtml' },
    ]);
  });

  it('解析 EPUB3：嵌套 nav.xhtml 子目录保留 children', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file('META-INF/container.xml', buildContainerXml('content.opf'));
    zip.file(
      'content.opf',
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Nested</dc:title>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine/>
</package>`,
    );
    zip.file(
      'nav.xhtml',
      `<html xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li>
          <a href="part1.xhtml">Part I</a>
          <ol>
            <li><a href="part1.xhtml#c1">Chapter 1</a></li>
            <li><a href="part1.xhtml#c2">Chapter 2</a></li>
          </ol>
        </li>
        <li><a href="part2.xhtml">Part II</a></li>
      </ol>
    </nav>
  </body>
</html>`,
    );
    const path = await writeEpub(zip);
    const meta = await parseEpubMeta(path);
    expect(meta.toc).toEqual([
      {
        label: 'Part I',
        href: 'part1.xhtml',
        children: [
          { label: 'Chapter 1', href: 'part1.xhtml#c1' },
          { label: 'Chapter 2', href: 'part1.xhtml#c2' },
        ],
      },
      { label: 'Part II', href: 'part2.xhtml' },
    ]);
  });

  it('解析 EPUB2：spine[toc] 指向 NCX，无 nav.xhtml', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file('META-INF/container.xml', buildContainerXml('OEBPS/content.opf'));
    zip.file(
      'OEBPS/content.opf',
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Old Book</dc:title>
    <dc:creator>Anonymous</dc:creator>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="chap01.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
  </spine>
</package>`,
    );
    zip.file(
      'OEBPS/toc.ncx',
      `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <navMap>
    <navPoint id="np1" playOrder="1">
      <navLabel><text>Foreword</text></navLabel>
      <content src="chap01.xhtml#fwd"/>
    </navPoint>
    <navPoint id="np2" playOrder="2">
      <navLabel><text>Chapter 1</text></navLabel>
      <content src="chap01.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`,
    );
    zip.file('OEBPS/chap01.xhtml', '<html><body/></html>');

    const path = await writeEpub(zip);
    const meta = await parseEpubMeta(path);
    expect(meta.title).toBe('Old Book');
    expect(meta.author).toBe('Anonymous');
    expect(meta.toc).toEqual([
      { label: 'Foreword', href: 'chap01.xhtml#fwd' },
      { label: 'Chapter 1', href: 'chap01.xhtml' },
    ]);
  });

  it('container.xml 缺失抛错', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    const path = await writeEpub(zip);
    await expect(parseEpubMeta(path)).rejects.toThrow(/container\.xml/);
  });
});
