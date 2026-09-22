#!/usr/bin/env python3
"""さく井業BGM生成器 公開前チェック

使い方:
  python3 tools/check.py                 いまのフォルダの中身をチェック
  python3 tools/check.py --commit HEAD   コミット済みの版を取り出してチェック
  python3 tools/check.py --quick         ファイルの点検だけ（Chromeで動かすテストを省く）

git の pre-push フックから --commit <公開する版> --base <公開中の版> で呼ばれ、
1つでも失敗したら公開（push）を止める。ひな形は Izayoi（虫の音の庭）の tools/check.py。

このアプリは見た目とシステムが同じ HTML に同居しているので、Izayoi のような
「見た目のファイルがシステムに触れていないか」の点検はできない。代わりに 2段目で、
これまで決めた動き（井戸を時間で失わない・出水で止まる など）と、絵のつなぎ目を
実際に動かして確かめる（tools/selftest.js）。
"""
import argparse, http.server, json, os, re, shutil, subprocess, sys, tempfile, threading, time

JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ['index.html', 'rotary/index.html', 'percussion/index.html']
MANIFESTS = ['manifest.webmanifest', 'rotary/manifest.webmanifest', 'percussion/manifest.webmanifest']
# キャッシュ番号を上げなくてよいファイル（アプリの表示に関係しない・オフライン用の一覧に入っていない）
NO_CACHE_BUMP = re.compile(r'^(tools/|README\.md$|LICENSE$|\.gitignore$|og[\w-]*\.png$)')

failures = []

def ok(msg): print(f'  ✓ {msg}')
def ng(msg, detail=''):
    failures.append(msg)
    print(f'  ✗ {msg}' + (f'\n      {detail}' if detail else ''))

def git(*a, cwd=REPO):
    return subprocess.run(['git', *a], cwd=cwd, capture_output=True, text=True).stdout

def read(root, rel):
    return open(os.path.join(root, rel), encoding='utf-8').read()

def norm(page_dir, ref):
    """ページから見た参照を、リポジトリの根からの場所に直す。フォルダを指すなら index.html"""
    p = os.path.normpath(os.path.join(page_dir, ref.split('#')[0].split('?')[0]))
    if ref.endswith('/') or p == '.': p = os.path.join(p, 'index.html')
    return os.path.normpath(p)

# ───────── 1段目：ファイルの点検 ─────────
def check_syntax(root):
    tmp = tempfile.mkdtemp()
    targets = []
    for page in PAGES:
        for i, js in enumerate(re.findall(r'<script>(.*?)</script>', read(root, page), re.S)):
            p = os.path.join(tmp, f'{page.replace("/", "_")}-script{i+1}.js')
            open(p, 'w', encoding='utf-8').write(js)
            targets.append((f'{page} の{i+1}つ目のスクリプト', p))
    targets.append(('sw.js', os.path.join(root, 'sw.js')))
    for label, p in targets:
        r = subprocess.run([JSC, '-e', f'checkSyntax({json.dumps(p)})'], capture_output=True, text=True)
        if r.returncode:
            out = (r.stdout + r.stderr).strip().splitlines()
            ng(f'構文エラー：{label}', out[0] if out else '')
        else:
            ok(f'構文OK：{label}')
    shutil.rmtree(tmp, ignore_errors=True)
    print('    （iPhoneのSafariと同じJavaScriptCoreで確認）')

def check_files(root):
    need, offline = set(), set()
    # オフライン用の一覧（sw.js）
    sw = read(root, 'sw.js')
    listed = {norm('.', p) for p in re.findall(r"'(\./[^']*)'", sw)}
    need |= listed
    # ホーム画面用の設定（manifest）のアイコン
    for m in MANIFESTS:
        d = os.path.dirname(m)
        man = json.loads(read(root, m))
        icons = [i['src'] for i in man.get('icons', [])]
        icons += [i['src'] for s in man.get('shortcuts', []) for i in s.get('icons', [])]
        for s in icons:
            need.add(norm(d, s)); offline.add(norm(d, s))
    # 各ページが読むファイル（src・href・CSS の url()・Service Worker の登録先）
    for page in PAGES:
        d = os.path.dirname(page)
        html = read(root, page)
        refs = re.findall(r'''(?:src|href)=["']([^"']+)["']''', html)
        refs += re.findall(r"url\(['\"]?([^'\")]+)['\"]?\)", html)
        refs += re.findall(r"serviceWorker\.register\('([^']+)'\)", html)
        for r in refs:
            if r.startswith(('http:', 'https:', 'data:', 'mailto:', '#')): continue
            p = norm(d, r)
            need.add(p)
            if p != 'sw.js': offline.add(p)
    missing = sorted(p for p in need if not os.path.exists(os.path.join(root, p)))
    if missing: ng('読み込むファイルが見つからない', ', '.join(missing))
    else: ok(f'読み込むファイルがすべてそろっている（{len(need)}個）')
    unlisted = sorted(p for p in offline if p not in listed)
    if unlisted: ng('オフライン用の一覧（sw.js）に入っていないファイルがある', ', '.join(unlisted))
    else: ok('オフライン用の一覧（sw.js）に、ページ・画像・アイコンがすべて入っている')

def check_markers(root):
    bad = []
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d != '.git']
        for f in fn:
            if not f.endswith(('.html', '.js', '.json', '.webmanifest', '.md', '.css', '.py')): continue
            p = os.path.join(dp, f)
            for n, line in enumerate(open(p, encoding='utf-8', errors='ignore'), 1):
                if re.match(r'^(<{7}|>{7}|={7})( |$)', line): bad.append(f'{os.path.relpath(p, root)}:{n}')
    if bad: ng('取り込みでぶつかった跡（<<<<<<< など）が残っている', ', '.join(bad[:8]))
    else: ok('取り込みでぶつかった跡は残っていない')

def check_authors(base, commit):
    """公開する変更記録の作者・コミッターが、匿名（GitHub の noreply）になっているか。
    ほかの環境（Codex の作業用クローンなど）で作ったコミットを取り込むと、本名が入ることがある"""
    if not base: print('  - 作者欄：比べる版がないので省略'); return
    me = git('config', 'user.name').strip()
    rows = [r for r in git('log', '--format=%h|%an|%ae|%cn|%ce', f'{base}..{commit or "HEAD"}').split('\n') if r]
    bad = []
    for r in rows:
        h, an, ae, cn, ce = r.split('|')
        for who, name, mail in (('作者', an, ae), ('コミッター', cn, ce)):
            if not mail.endswith('@users.noreply.github.com') or (me and name != me):
                bad.append(f'{h} の{who}')
    if bad:
        ng('公開する変更記録に、匿名（noreply）でない作者・コミッターがいる',
           ', '.join(bad[:6]) + f'。git log --format=\'%h %an <%ae>\' で確かめ、'
           'git commit --amend --reset-author（古いものは git rebase -i）で付け直してから公開する')
    else:
        ok(f'作者欄：公開する{len(rows)}件はすべて匿名（{me or "noreply"}）')

def check_cache_bump(root, base, commit):
    if not base: print('  - キャッシュ番号：比べる版がないので省略'); return
    changed = [f for f in git('diff', '--name-only', base, *([commit] if commit else [])).split('\n') if f and not NO_CACHE_BUMP.match(f)]
    if not changed: ok('キャッシュ番号：アプリの中身は変わっていない'); return
    old = re.search(r"const CACHE = '([^']+)'", git('show', f'{base}:sw.js') or '')
    new = re.search(r"const CACHE = '([^']+)'", read(root, 'sw.js'))
    if old and new and old.group(1) == new.group(1):
        ng('中身を変えたのに、キャッシュ番号（sw.js の CACHE）を上げていない',
           f"{new.group(1)} のまま。ホーム画面から開いたiPhoneで古い版が出続ける。変更: {', '.join(changed[:6])}")
    else:
        ok(f"キャッシュ番号：{old.group(1) if old else '?'} → {new.group(1) if new else '?'}")

# ───────── 2段目：画面を出さないChromeで実際に動かす ─────────
# テストのときだけ、ページにエラーの記録と tools/selftest.js を差し込む（本番のページは変えない）
CATCH = ("<script>window.__errs=[];"
         "addEventListener('error',e=>__errs.push((e.message||'error')+' @'+String(e.filename||'').split('/').pop()+':'+e.lineno));"
         "addEventListener('unhandledrejection',e=>__errs.push('promise: '+e.reason))</script>")

def run_selftest(root, timeout=180):
    if not os.path.exists(CHROME):
        ng('Chrome が見つからないので動作テストができない'); return
    res = {}
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(s, *a, **k): super().__init__(*a, directory=root, **k)
        def log_message(s, *a): pass
        def do_GET(s):
            path = s.path.split('?')[0]
            if 'selftest' in s.path and (path.endswith('.html') or path.endswith('/')):
                f = os.path.join(root, path.lstrip('/'), *(['index.html'] if path.endswith('/') else []))
                html = open(f, encoding='utf-8').read()
                html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + CATCH, 1)
                html = html.replace('</body>', '<script src="/tools/selftest.js"></script></body>', 1)
                b = html.encode('utf-8')
                s.send_response(200); s.send_header('Content-Type', 'text/html; charset=utf-8')
                s.send_header('Content-Length', str(len(b))); s.end_headers(); s.wfile.write(b)
            else:
                super().do_GET()
        def do_POST(s):
            n = int(s.headers.get('Content-Length', 0)); r = json.loads(s.rfile.read(n) or b'{}')
            res[r.get('page', '?')] = r
            s.send_response(204); s.end_headers()
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    # トップの画面サイズは selftest.js の中で iframe を使って測る（画面なしの Chrome は幅500px未満にできない）
    runs = [('トップ', 'index.html', (500, 900)),
            ('ロータリー編', 'rotary/index.html', (390, 844)),
            ('パーカッション編', 'percussion/index.html', (390, 844))]
    for name, page, (w, h) in runs:
        t0 = time.time()
        ud = tempfile.mkdtemp()
        p = subprocess.Popen([CHROME, '--headless=new', '--autoplay-policy=no-user-gesture-required', '--no-first-run',
                              '--no-default-browser-check', f'--window-size={w},{h}', f'--user-data-dir={ud}',
                              f'http://127.0.0.1:{port}/{page}?selftest'],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        while name not in res and time.time() - t0 < timeout and p.poll() is None: time.sleep(.3)
        p.kill(); p.wait(); shutil.rmtree(ud, ignore_errors=True)
        if name not in res:
            ng(f'{name}：動作テストが最後まで終わらなかった', f'{timeout}秒以内に結果が返ってこない（途中で止まった可能性）'); continue
        for r in res[name].get('results', []):
            if r.get('note'): print(f"  - {r['name']}"); continue
            (ok if r['ok'] else ng)(r['name'], *([r['detail']] if not r['ok'] and r.get('detail') else []))
        print(f'    （{name} {time.time() - t0:.0f}秒）')
    srv.shutdown()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--commit', help='この版を取り出してチェック（省略時はいまのフォルダ）')
    ap.add_argument('--base', help='比べる版（キャッシュ番号の確認用。省略時は origin/main）')
    ap.add_argument('--quick', action='store_true', help='Chromeでの動作テストを省く')
    a = ap.parse_args()
    root, tmp = REPO, None
    if a.commit:
        tmp = tempfile.mkdtemp()
        subprocess.run(f'git archive {a.commit} | tar -x -C "{tmp}"', shell=True, cwd=REPO, check=True)
        root = tmp
    base = a.base or (git('rev-parse', '--verify', '-q', 'origin/main').strip() or None)
    label = a.commit or 'いまのフォルダ'
    print(f'\n■ さく井業BGM生成器 公開前チェック（{label}）\n\n1段目：ファイルの点検')
    check_syntax(root)
    check_files(root); check_markers(root); check_authors(base, a.commit); check_cache_bump(root, base, a.commit)
    if not a.quick:
        if any(f.startswith('構文エラー') for f in failures):
            print('\n2段目：構文エラーがあるので動作テストは省略')
        else:
            print('\n2段目：画面を出さないChromeで動かす')
            run_selftest(root)
    if tmp: shutil.rmtree(tmp, ignore_errors=True)
    if failures:
        print(f'\n✗ {len(failures)}件の問題があります。直してから公開してください。\n'); sys.exit(1)
    print('\n✓ すべて問題なし\n')

if __name__ == '__main__':
    main()
