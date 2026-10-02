#!/usr/bin/env python3
"""井戸ビートの書体を作る（art/fonts/ に出力）

  ロゴ      Dela Gothic One       （SIL Open Font License 1.1）
  本文・数字 Noto Sans JP 500〜700  （SIL Open Font License 1.1）

書体をまるごと入れると重い（Noto Sans JP は約 9MB）ので、画面で使う文字だけに絞る。
  noto-sans-jp-core.woff2   画面に出る文字 ＋ かな・記号・ASCII。オフラインのために、Web版でも先に保存する
  noto-sans-jp-extra.woff2  JIS 第一水準の漢字のうち、上に入っていないもの。その文字が出たときだけ読み込む（unicode-range）
  dela-gothic-one.woff2     ロゴ用
どちらも、アプリ（iPhone）には全部同梱する。

使い方（新しい文字を画面に足したとき、公開前チェックが「書体に入っていない文字」と止めるので、そのときに）
  pip3 install fonttools brotli
  python3 tools/make-fonts.py
元の書体ファイル（Google Fonts の公式リポジトリ）は、初回だけ ~/.cache/ido-beat-fonts にダウンロードする。
"""
import importlib.util, os, pathlib, sys, urllib.request

HERE = pathlib.Path(__file__).resolve().parent
SITE = HERE.parent
OUT = SITE / 'art' / 'fonts'
CACHE = pathlib.Path.home() / '.cache' / 'ido-beat-fonts'
BASE = 'https://github.com/google/fonts/raw/main/ofl/'
SOURCES = {
    'DelaGothicOne-Regular.ttf': BASE + 'delagothicone/DelaGothicOne-Regular.ttf',
    'NotoSansJP[wght].ttf': BASE + 'notosansjp/NotoSansJP%5Bwght%5D.ttf',
    'OFL-DelaGothicOne.txt': BASE + 'delagothicone/OFL.txt',
    'OFL-NotoSansJP.txt': BASE + 'notosansjp/OFL.txt',
}

def load_check():
    spec = importlib.util.spec_from_file_location('idobeat_check', HERE / 'check.py')
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

def ranges(chars):
    cps = sorted(ord(c) for c in chars); out = []; s = p = None
    for c in cps:
        if s is None: s = p = c
        elif c == p + 1: p = c
        else: out.append((s, p)); s = p = c
    if s is not None: out.append((s, p))
    return ','.join(f'U+{a:X}' if a == b else f'U+{a:X}-{b:X}' for a, b in out)

def main():
    try:
        from fontTools.ttLib import TTFont
        from fontTools.varLib import instancer
        from fontTools import subset
    except ImportError:
        sys.exit('fonttools と brotli が要ります：pip3 install fonttools brotli')
    chk = load_check()
    CACHE.mkdir(parents=True, exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        if not (CACHE / name).exists():
            print('ダウンロード', name); urllib.request.urlretrieve(url, CACHE / name)

    # 画面に出る文字（HTML と、その中の script の文字列）
    used = set()
    for page in chk.TEXT_FILES:
        used |= chk.displayed_chars((SITE / page).read_text(encoding='utf-8'))
    kana = ''.join(chr(c) for c in range(0x3041, 0x3097)) + ''.join(chr(c) for c in range(0x30A1, 0x30FB))
    marks = 'ー・ヽヾゝゞ、。「」『』（）〜～…―─—−×÷→←↑↓♡♥●○◎▲▼■□★☆※〒！？：；＋－＝／％＆＃＄　'
    fullwidth = ''.join(chr(c) for c in range(0xFF01, 0xFF5F))
    ascii_ = ''.join(chr(c) for c in range(0x20, 0x7F))
    core = used | set(kana) | set(marks) | set(fullwidth) | set(ascii_)
    l1 = []                                                      # JIS 第一水準の漢字（EUC-JP の 0xB0A1〜0xCFFE）
    for hi in range(0xB0, 0xD0):
        for lo in range(0xA1, 0xFF):
            try: l1.append(bytes([hi, lo]).decode('euc_jp'))
            except UnicodeDecodeError: pass
    extra = set(l1) - core

    def sub(font, chars, dst):
        o = subset.Options(); o.flavor = 'woff2'; o.layout_features = ['*']; o.notdef_outline = True
        o.name_IDs = ['*']; o.hinting = False; o.desubroutinize = True
        s = subset.Subsetter(o); s.populate(text=''.join(sorted(chars))); s.subset(font)
        font.flavor = 'woff2'; font.save(dst); print(f'  {dst.name:28s}{dst.stat().st_size / 1024:7.0f} KB  {len(chars)} 文字')

    print('Noto Sans JP（500〜700 に絞る）')
    vf = TTFont(str(CACHE / 'NotoSansJP[wght].ttf'))
    inst = instancer.instantiateVariableFont(vf, {'wght': (500, 700)}, inplace=False)
    tmp = CACHE / 'noto-500-700.ttf'; inst.save(str(tmp))
    sub(TTFont(str(tmp)), core, OUT / 'noto-sans-jp-core.woff2')
    sub(TTFont(str(tmp)), extra, OUT / 'noto-sans-jp-extra.woff2')
    print('Dela Gothic One')
    sub(TTFont(str(CACHE / 'DelaGothicOne-Regular.ttf')), set('井戸ビート') | set(kana) | set(marks) | set(ascii_), OUT / 'dela-gothic-one.woff2')

    for n in ('OFL-DelaGothicOne.txt', 'OFL-NotoSansJP.txt'):
        (OUT / n).write_bytes((CACHE / n).read_bytes())
    (OUT / 'fonts.css').write_text(
        '/* 井戸ビートの書体（どちらも SIL Open Font License 1.1。ライセンス文は同じフォルダ）。tools/make-fonts.py が作る。手で直さない */\n'
        '@font-face{font-family:"Dela Gothic One";font-style:normal;font-weight:400;font-display:swap;'
        'src:url(dela-gothic-one.woff2) format("woff2")}\n'
        '@font-face{font-family:"Noto Sans JP";font-style:normal;font-weight:500 700;font-display:swap;'
        'src:url(noto-sans-jp-core.woff2) format("woff2");unicode-range:' + ranges(core) + '}\n'
        '@font-face{font-family:"Noto Sans JP";font-style:normal;font-weight:500 700;font-display:swap;'
        'src:url(noto-sans-jp-extra.woff2) format("woff2");unicode-range:' + ranges(extra) + '}\n', encoding='utf-8')
    (OUT / 'README.txt').write_text(
        'Dela Gothic One（ロゴ）と Noto Sans JP（本文・数字）を、画面で使う文字だけに絞ったもの。\n'
        '元の書体：https://github.com/google/fonts/tree/main/ofl/delagothicone と .../notosansjp\n'
        'どちらも SIL Open Font License 1.1（OFL-*.txt）。絞り込み（サブセット化）は OFL が認める改変。\n'
        '作り方：tools/make-fonts.py\n', encoding='utf-8')
    (HERE / 'font-core-chars.txt').write_text(''.join(sorted(core)), encoding='utf-8')
    print('fonts.css と font-core-chars.txt を書きました。')

if __name__ == '__main__':
    main()
