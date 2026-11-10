#!/usr/bin/env python3
"""손글씨 글꼴(Gaegu, SIL OFL 1.1)을 화면에 쓰는 글자만 남겨 줄인다.

  python3 -m pip install fonttools brotli
  python3 scripts/subset_fonts.py <Gaegu-Regular.ttf>

원본은 https://github.com/google/fonts/tree/main/ofl/gaegu 에 있다.
- gaegu-core.woff2: index.html·src 의 화면 문구에 나오는 글자만. 처음에 받는다.
- gaegu-ext.woff2: 나머지 한글(닉네임처럼 미리 알 수 없는 글자). 그 글자가 화면에 나올 때만 받는다.
화면 문구를 바꿨으면 다시 돌린다. 돌리지 않아도 새 글자는 ext 에서 받아 오므로 깨지지는 않는다.
"""
import pathlib
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
# 화면 문구가 들어 있는 파일(어드민은 시스템 글꼴이라 뺀다)
SOURCES = ['index.html'] + sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'src').glob('*.ts') if p.name != 'admin.ts')


def ranges(cps):
    cps = sorted(cps)
    out, start, prev = [], cps[0], cps[0]
    for c in cps[1:] + [None]:
        if c is not None and c == prev + 1:
            prev = c
            continue
        out.append(f'U+{start:X}' if start == prev else f'U+{start:X}-{prev:X}')
        if c is not None:
            start = prev = c
    return ', '.join(out)


def build(src, dest, cps):
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.hinting = False  # 손글씨라 힌팅이 없어도 차이가 없고 용량이 준다
    opts.name_IDs = [0, 1, 2, 13, 14]  # 저작권·라이선스 표기는 남긴다
    font = subset.load_font(str(src), opts)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=cps)
    sub.subset(font)
    subset.save_font(font, str(dest), opts)
    return dest.stat().st_size


def main():
    regular = pathlib.Path(sys.argv[1])
    have = set(TTFont(str(regular)).getBestCmap())
    text = ''.join((ROOT / p).read_text(encoding='utf-8') for p in SOURCES)
    # 주석의 글자는 화면에 나오지 않는다
    text = re.sub(r'/\*.*?\*/|<!--.*?-->|(?<![:\'"])//[^\n]*', '', text, flags=re.S)
    core = sorted(({ord(c) for c in text if ord(c) > 0x7F} | set(range(0x20, 0x7F))) & have)
    ext = sorted(c for c in have if c not in core and (0xAC00 <= c <= 0xD7A3 or 0x3131 <= c <= 0x318E))
    fonts = ROOT / 'public' / 'fonts'
    sizes = {
        'gaegu-core.woff2': build(regular, fonts / 'gaegu-core.woff2', core),
        'gaegu-ext.woff2': build(regular, fonts / 'gaegu-ext.woff2', ext),
    }
    css = f'''/* scripts/subset_fonts.py 가 만든 파일. 손으로 고치지 않는다. Gaegu © The Gaegu Project Authors, SIL OFL 1.1 (public/fonts/OFL.txt) */
/* 뒤에 선언한 것이 먼저 쓰인다: 화면 문구는 core 만으로 끝나고, 그 밖의 한글이 나올 때만 ext 를 받는다 */
@font-face {{
  font-family: "Gaegu";
  font-weight: 400;
  font-display: swap;
  src: url("/fonts/gaegu-ext.woff2") format("woff2");
  unicode-range: U+3131-318E, U+AC00-D7A3;
}}
@font-face {{
  font-family: "Gaegu";
  font-weight: 400;
  font-display: swap;
  src: url("/fonts/gaegu-core.woff2") format("woff2");
  unicode-range: {ranges(core)};
}}
'''
    (ROOT / 'src' / 'fonts.css').write_text(css, encoding='utf-8')
    print(f'core {len(core)}자, ext {len(ext)}자')
    for name, size in sizes.items():
        print(f'{name}: {size / 1024:.1f}KB')


main()
