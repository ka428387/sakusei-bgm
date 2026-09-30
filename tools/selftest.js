/* 井戸ビート 動作テスト
   tools/check.py が画面を出さないChromeで各ページを開き、このスクリプトを差し込んで動かす。
   本番のページには入らない。結果は /__result に送る。

   ここで確かめるのは、これまでに決めた動きと、絵とシステムのつなぎ目：
   - ビットが喰われても、時間では井戸を失わない（気づいた時点でジャーリングで抜く）
   - 叩きすぎてワイヤーが切れたときだけ、孔をその場に残して横で0mから掘り直す
   - 水が出たらそこで止まる
   - 絵（やぐら・リグ）が実際のワイヤー・ロッド・孔と重なっている
   - トップはスマホでスクロールせずに両方の工法が選べる
   - 応援（投げ銭）：Web版には出ない。アプリの中（購入の部品の代役を差し込んだ「（アプリ）」の実行）では、
     金額が並び、キャンセルしても何も変わらず、応援すると手紙が開き、応援した人のやぐらに祝い旗が掛かる
   掘削の処理はページの本物を使うが、時計だけはテスト用に差し替えて10倍速で回す。
   画面なしのChromeは、Macの音声出力が使えないと音の時計（AudioContext）が止まり、
   そのままだと公開が止まってしまうため。トラブルやベーラーの段階送りも、テストから直接進める */
(async () => {
  const R = [];
  const $q = s => document.querySelector(s);
  const NATIVE = /[?&]native\b/.test(location.search);        // アプリの中と同じ状態（購入の部品の代役あり）
  const PAGE = ($q('#bail') ? 'パーカッション編' : $q('#pump') ? 'ロータリー編' : 'トップ') + (NATIVE ? '（アプリ）' : '');
  const check = (name, ok, detail) =>
    R.push({ name: PAGE + '：' + name, ok: !!ok, detail: ok ? '' : String(detail ?? '') });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); }
    return false;
  };
  const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
  const withRandom = (v, fn) => { const r = Math.random; Math.random = () => v; try { return fn(); } finally { Math.random = r; } };
  const box = s => $q(s).getBoundingClientRect();
  const cx = r => r.left + r.width / 2;
  const shown = el => !!el && getComputedStyle(el).display !== 'none';   // hidden の値ではなく、実際に見えているか

  try {
    if (PAGE === 'トップ') await testTop();
    else if (PAGE === 'トップ（アプリ）') await testNativeTop();
    else if (NATIVE) await testNativeDrill();
    else await testDrill();
    if (!NATIVE) await testType();
  } catch (e) {
    check('テストの途中で止まった', false, (e && e.stack) || e);
  }
  check('JavaScript のエラーが出ていない', !window.__errs.length, window.__errs.join(' / '));
  await fetch('/__result', { method: 'POST', body: JSON.stringify({ page: PAGE, results: R }) });

  // 書体と文字の収まり：ページを新しい枠で開き直し、書体が読み込まれ、スマホの幅で文字が切れたり折り返したりしないか
  async function testType() {
    for (const w of [375, 390, 430]) {
      const h = w === 430 ? 739 : 664;
      const f = document.createElement('iframe');
      f.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;border:0;z-index:99`; f.src = 'index.html?frame';
      document.body.appendChild(f);
      await new Promise(r => f.onload = r);
      const d = f.contentDocument, tag = `${w}px幅の画面で`;
      await d.fonts.ready; await wait(300);
      const loaded = fam => [...d.fonts].some(ff => ff.family.replace(/"/g, '') === fam && ff.status === 'loaded');
      if (w === 375) {
        check('書体が読み込まれている（Dela Gothic One・Noto Sans JP）', loaded('Dela Gothic One') && loaded('Noto Sans JP'),
          [...d.fonts].map(ff => ff.family + ':' + ff.status).join(' '));
        check('ロゴは Dela Gothic One、本文は Noto Sans JP を指定している',
          /^"?Dela Gothic One/.test(f.contentWindow.getComputedStyle(d.querySelector('h1')).fontFamily) &&
            /^"?Noto Sans JP/.test(f.contentWindow.getComputedStyle(d.body).fontFamily),
          `h1 ${f.contentWindow.getComputedStyle(d.querySelector('h1')).fontFamily} / body ${f.contentWindow.getComputedStyle(d.body).fontFamily}`);
        check('明朝体の指定が残っていない', ![...d.querySelectorAll('*')].some(e => /Mincho|serif/i.test(f.contentWindow.getComputedStyle(e).fontFamily.replace(/sans-serif/g, ''))),
          'serif / Mincho の指定が残っている');
      }
      const vis = e => e.getClientRects().length > 0 && f.contentWindow.getComputedStyle(e).visibility !== 'hidden';
      check(tag + '横にはみ出さない', d.documentElement.scrollWidth <= w, `幅 ${d.documentElement.scrollWidth}px`);
      const sideOut = [], clipped = [], wrapped = [];
      for (const e of d.querySelectorAll('h1,h2,button,a.card,.home,.sub,.tick span,.layer .nm,.readout,.status,.knob label,.hint,.tipbtn,.foot')) {
        if (!vis(e)) continue;
        const r = e.getBoundingClientRect(), cs = f.contentWindow.getComputedStyle(e), name = (e.id || e.className || e.tagName) + '「' + e.textContent.trim().slice(0, 10) + '」';
        if (r.left < -0.5 || r.right > w + 0.5) sideOut.push(name);
        if (cs.overflow !== 'visible' && e.scrollWidth > e.clientWidth + 1 && !/^(ellipsis)$/.test(cs.textOverflow)) clipped.push(name);
        if (e.matches('h1,button,.home,.tipbtn,.layer .nm,.tick span')) {          // 1行で収めたいもの
          const rg = d.createRange(); rg.selectNodeContents(e);
          const tops = [...new Set([...rg.getClientRects()].filter(q => q.width > 0).map(q => Math.round(q.top / 4)))];
          if (tops.length > 1) wrapped.push(name);
        }
      }
      check(tag + '画面の外へ出る部品がない', !sideOut.length, sideOut.join(' / '));
      check(tag + '文字が枠で切れていない', !clipped.length, clipped.join(' / '));
      check(tag + 'ロゴ・ボタン・地層名が折り返さない', !wrapped.length, wrapped.join(' / '));
      f.remove();
    }
  }

  async function testTop() {
    const cards = [...document.querySelectorAll('a.card')];
    const hrefs = cards.map(a => a.getAttribute('href'));
    check('工法のカードが2枚ある', hrefs.includes('rotary/') && hrefs.includes('percussion/'), hrefs.join(', '));
    check('Web版には応援ボタンが出ない（実際に見えていない）', !shown($q('#tipBtn')), '購入の部品がないのにボタンが出ている');
    // スマホの表示域の大きさで開き、スクロールせずに両方の工法が見えるか。
    // 必須：画面の大きさ（iPhone SE 375×667）と、Safari の表示域（iPhone 14 など 390×664）。参考：SE を Safari で開いたとき
    const sizes = [[375, 667, true], [390, 664, true], [430, 739, true], [375, 548, false]];
    for (const [w, h, must] of sizes) {
      const f = document.createElement('iframe');
      f.width = w; f.height = h; f.style.border = '0'; f.src = 'index.html?frame';
      document.body.appendChild(f);
      await new Promise(r => f.onload = r);
      await wait(200);
      const d = f.contentDocument, sh = d.documentElement.scrollHeight;
      const fits = sh <= h + 1 && [...d.querySelectorAll('a.card')].every(a => a.getBoundingClientRect().bottom <= h + 1);
      const name = `スマホ ${w}×${h} でスクロールせずに両方の工法が見える`;
      if (must) check(name, fits, `ページの高さ ${sh}px`);
      else R.push({ name: `トップ：参考 ${w}×${h}（iPhone SE を Safari で開いたとき）は ` + (fits ? '収まる' : `${sh - h}px はみ出す`), ok: true, note: true });
      f.remove();
    }
  }

  // 応援の画面：ボタン→金額→キャンセル→応援→手紙。アプリの画面の大きさでもスクロールなしに収まる
  async function testNativeTop() {
    const btn = $q('#tipBtn');
    check('アプリの中では応援ボタンが出る（実際に見えている）', shown(btn), '応援ボタンが隠れたまま');
    btn.click();
    check('ボタンを押すと応援の画面が開く', await until(() => $q('#tipM').classList.contains('on'), 2000));
    check('金額のボタンが3つ、名前と値段つきで並ぶ',
      await until(() => $q('#tipActs').querySelectorAll('button').length === 3, 3000) &&
        [...$q('#tipActs').querySelectorAll('button')].map(b => b.textContent).join('|') === 'ちょっと応援　¥160|応援　¥480|たっぷり応援　¥980',
      [...$q('#tipActs').querySelectorAll('button')].map(b => b.textContent).join('|'));
    check('応援する前は「手紙を読む」が見えていない', !shown($q('#thanksActs')), '応援していないのに手紙のボタンが見えている');
    __store.next = 'cancelled';
    $q('#tipActs button').click(); await wait(400);
    check('キャンセルしても、何も変わらず、手紙も開かない', __store.tips === 0 && !$q('#letterM').classList.contains('on') && !$q('#tipActs button').disabled,
      `回数 ${__store.tips}`);
    __store.next = 'success';
    $q('#tipActs button').click();
    check('応援すると、初めてのときだけ手紙が開く', await until(() => $q('#letterM').classList.contains('on'), 3000) && __store.tips === 1,
      `回数 ${__store.tips}`);
    check('手紙は、ビットから届いた文面', /ビットより/.test($q('#letterM').textContent), $q('#letterM').textContent.slice(0, 40));
    $q('#letterClose').click();
    check('手紙を閉じると、応援の画面は閉じている（もう一度は勝手に開かない）', !$q('#letterM').classList.contains('on') && !$q('#tipM').classList.contains('on'));
    $q('#tipBtn').click(); await until(() => $q('#tipActs').querySelectorAll('button').length === 3, 3000);
    check('応援したあとは「手紙を読む」が見えて、回数が書かれる', shown($q('#thanksActs')) && /1 回/.test($q('#tipP').textContent), $q('#tipP').textContent.slice(-40));
    $q('#tipActs button').click(); await wait(500);
    check('2回目の応援では、手紙が自動では開かない', __store.tips === 2 && !$q('#letterM').classList.contains('on'), `回数 ${__store.tips}`);
    // 応援ボタンが出ている状態でも、スマホでスクロールせずに両方の工法が見える
    for (const [w, h] of [[375, 667], [390, 664], [430, 739]]) {
      const f = document.createElement('iframe');
      f.width = w; f.height = h; f.style.border = '0'; f.src = 'index.html?stub&frame';
      document.body.appendChild(f);
      await new Promise(r => f.onload = r); await wait(250);
      const d = f.contentDocument, sh = d.documentElement.scrollHeight;
      const fits = sh <= h + 1 && [...d.querySelectorAll('a.card')].every(a => a.getBoundingClientRect().bottom <= h + 1) &&
        d.getElementById('tipBtn').getBoundingClientRect().bottom <= h + 1 && d.defaultView.getComputedStyle(d.getElementById('tipBtn')).display !== 'none';
      const tb = d.getElementById('tipBtn').getBoundingClientRect();
      check(`応援ボタンが出ていても、スマホ ${w}×${h} でスクロールせずに収まる`, fits,
        `ページの高さ ${sh}px / カードの下端 ${[...d.querySelectorAll('a.card')].map(a => Math.round(a.getBoundingClientRect().bottom)).join(',')} / 応援ボタン 隠れている=${d.getElementById('tipBtn').hidden} 下端 ${Math.round(tb.bottom)} / 代役 ${!!d.defaultView.Capacitor} / エラー ${(d.defaultView.__errs || []).join(' | ')} / URL ${f.contentWindow.location.search}`);
      f.remove();
    }
  }

  // 応援した人のやぐら（リグ）に、祝い旗が掛かる。井戸が横へ移っても、やぐらと一緒に動く
  async function testNativeDrill() {
    const ROT = PAGE.startsWith('ロータリー');
    check('応援した人には、やぐらに祝い旗が掛かる', await until(() => $q('.bunting'), 3000), '祝い旗がない');
    check('祝い旗が、赤と白の旗をたくさん持っている', document.querySelectorAll('.bunting .flag').length >= 10,
      document.querySelectorAll('.bunting .flag').length);
    const anchor = ROT ? RIG.w * RIG.axis : DERRICK.w * DERRICK.axis;   // 旗の絵の中で、掘削軸にあたる x（機械の絵と同じ）
    const at = () => box('.bunting').left + anchor;
    check('つなぎ目：祝い旗が、機械の絵と同じ場所にある（掘削軸が孔の中心とそろう）', near(at(), cx(box('.hole')), 1.5), `旗 ${at().toFixed(1)} / 孔 ${cx(box('.hole')).toFixed(1)}`);
    holeX += 30; applyHoleX(); await wait(1200);       // 井戸が横へ移るとき
    check('井戸が横へ移っても、祝い旗はやぐらと一緒に動く', near(at(), cx(box('.hole')), 1.5), `旗 ${at().toFixed(1)} / 孔 ${cx(box('.hole')).toFixed(1)}`);
    check('祝い旗をかけても、掘る処理は止まらない（ページのエラーなし）', !window.__errs.length, window.__errs.join(' / '));
  }

  async function testDrill() {
    const ROT = PAGE === 'ロータリー編';
    const home = $q('a.home');
    check('「← ホーム」でトップへ戻れる', home && home.getAttribute('href') === '../', home && home.getAttribute('href'));
    check('地層が描かれている', $q('#strata').children.length > 3, $q('#strata').children.length);
    check('Web版には祝い旗が出ない', !$q('.bunting'), '購入の部品がないのに祝い旗がある');

    // ── 通りがかりの人：「温泉掘ってるんけ？」→「いや、井戸っす」。1本で1回、止まっているあいだは出ず、掘る処理には触れない ──
    const talkOn = id => getComputedStyle($q(id)).opacity === '1';
    check('通りがかりの吹き出しは、最初は見えていない', !talkOn('#talkA') && !talkOn('#talkB'));
    check('吹き出しの文言', $q('#talkA').textContent === '温泉掘ってるんけ？' && $q('#talkB').textContent === 'いや、井戸っす', $q('#talkA').textContent + ' / ' + $q('#talkB').textContent);
    passerWill = true; passerFire(); await wait(700);
    check('止まっているあいだは出ない', !talkOn('#talkA'), '掘っていないのに吹き出しが出た');
    running = true; passerWill = true; passerFire(); await wait(700);
    check('掘っていると、先に通りがかりの人が話しかける', talkOn('#talkA') && !talkOn('#talkB'), `A ${talkOn('#talkA')} B ${talkOn('#talkB')}`);
    await wait(2300);
    check('すこし間をおいて、現場が「いや、井戸っす」と返す', talkOn('#talkA') && talkOn('#talkB'), `A ${talkOn('#talkA')} B ${talkOn('#talkB')}`);
    await wait(4400);
    check('数秒で消える', !talkOn('#talkA') && !talkOn('#talkB'), `A ${talkOn('#talkA')} B ${talkOn('#talkB')}`);
    passerArm();
    check('1本の井戸で1回だけ（次は待たない）', passerTO === 0 && !passerWill, `timer ${passerTO}`);
    running = false; passerReset();

    // ── 絵：読み込み・質感・二重表示なし ──
    const artSel = ROT ? '#rig' : '#derrick', art = $q(artSel);
    check('機械の絵が読み込まれている', await until(() => art.complete && art.naturalWidth > 0, 4000), art.currentSrc);
    const bgs = [...$q('#strata').children].map(el => getComputedStyle(el).backgroundImage).join(' ');
    check('地層に質感（土・砂礫・岩）が敷かれている', /soil\.jpg/.test(bgs) && /gravel\.jpg|rock\.jpg/.test(bgs), bgs.slice(0, 120));
    check('地層名に下地がつき、質感の上でも読める', getComputedStyle($q('.layer .nm')).backgroundColor !== 'rgba(0, 0, 0, 0)');
    check('空の絵が敷かれている', /sky-morning\.jpg/.test(getComputedStyle($q('.sky')).backgroundImage));
    if (ROT) check('泥水タンクの飾りが二重になっていない（絵の中のタンクだけ）', !$q('.mud-pit'), '古い .mud-pit が残っている');
    // 小さい画面でも、機械の頭が切れない（地表は画面の上から固定の割合なので、絵の高さを画面に合わせている）
    for (const [w, h] of [[375, 548], [375, 667], [390, 844], [430, 932]]) {
      // 対象のページは画面いっぱいの縦並びなので、枠は画面に固定する（並びの中に入れると縮められる）
      const f = document.createElement('iframe');
      f.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;border:0;z-index:99`; f.src = 'index.html?frame';
      document.body.appendChild(f);
      await new Promise(r => f.onload = r); await wait(400);
      const d = f.contentDocument, s = d.querySelector(artSel).getBoundingClientRect(), lg = d.getElementById('log').getBoundingClientRect();
      check(`画面 ${w}×${h} でも、機械の頭が切れない`, f.contentWindow.innerHeight === h && s.top >= lg.top - 0.5 && s.height >= 60,
        `画面の高さ ${f.contentWindow.innerHeight}px / 機械の上端 ${Math.round(s.top - lg.top)}px（画面の上から）、高さ ${Math.round(s.height)}px`);
      f.remove();
    }

    // 掘削開始（ロータリーは泥水ポンプも入れる）。テスト中は偶発のトラブルを起こさない
    $q('#run').click();
    if (ROT) $q('#pump').click();
    lastTroubleT = Infinity;
    const real = ctx, t1 = real.currentTime;
    await wait(600);
    const moved = real.currentTime - t1;
    R.push({ name: `${PAGE}：参考 音の時計（AudioContext）は` + (moved > 0.3 ? '動いている'
      : '止まっていた（このMacの音声出力が使えない状態）。テスト用の時計で確かめる'), ok: true, note: true });
    // テスト用の時計：ctx.currentTime だけ差し替え、20ミリ秒ごとに0.2秒ぶん進めながら本物の schedule() を回す
    let fakeT = real.currentTime;
    ctx = new Proxy(real, { get(t, k) {
      if (k === 'currentTime') return fakeT;
      const v = Reflect.get(t, k, t); return typeof v === 'function' ? v.bind(t) : v;
    } });
    nextT = fakeT + 0.05;
    const drive = setInterval(() => { for (let i = 0; i < 8; i++) { fakeT += 0.025; if (running) schedule(); } }, 20);
    const d0 = depth;
    check('掘り進む', await until(() => depth > d0 + 0.3, 20000), `掘進長 ${depth.toFixed(2)}m`);

    // ── ビットが喰われる：時間制限なしで待つ ──
    const stick = async () => {
      depth = 20;
      if (!ROT) slime = 0;
      withRandom(0.99, () => enterTrouble(ctx.currentTime, layerAt(depth)));
      lastTroubleT = Infinity;
      if (trouble && trouble.phase === 'seize') advanceTrouble(ctx.currentTime);   // 喰われた瞬間の唸りを飛ばす
      return trouble && trouble.phase === 'jar';
    };
    check('ビットが喰われると、ジャーリング待ちになる', await stick(), trouble && trouble.phase);
    check('喰われている間はジャーリングのボタンが押せて、案内が出る',
      !$q('#jar').disabled && $q('#jarui').classList.contains('on'));
    const dStuck = depth;
    advanceTrouble(ctx.currentTime + 3600);      // 1時間たったことにしても
    await wait(1500);
    check('時間がたっても井戸を失わない（時間制限なし）',
      trouble && trouble.phase === 'jar' && trouble.untilT === Infinity && depth === dStuck &&
        document.querySelectorAll('.scar').length === 0,
      trouble ? `${trouble.phase} / untilT=${trouble.untilT} / 掘進長 ${depth}` : '勝手に抜けた');

    // ── ジャーリングで抜ける ──
    const need = trouble.need;
    withRandom(0.99, () => { for (let i = 0; i < need; i++) $q('#jar').click(); });
    check(`ジャーリング${need}回で抜けて、同じ孔で掘進を再開する`,
      trouble === null && depth === dStuck, trouble && `${trouble.phase} ${trouble.prog}/${trouble.need}`);
    check('抜けたら案内が消え、ボタンも押せなくなる', !$q('#jarui').classList.contains('on') && $q('#jar').disabled);

    // ── 叩きすぎてワイヤーが切れる：孔をその場に残して、横へ移って0mから ──
    await wait(300);
    await stick();
    const hx0 = holeX, before = box('.hole'), lost = depth;
    withRandom(0.01, () => { for (let i = 0; i < JAR_SAFE + 1; i++) $q('#jar').click(); });
    check(`最初の${JAR_SAFE}回はワイヤーが切れず、そのあと切れうる`,
      trouble && trouble.phase === 'abandon' && trouble.prog === JAR_SAFE + 1, trouble && `${trouble.phase} ${trouble.prog}`);
    if (trouble && trouble.phase === 'abandon') advanceTrouble(ctx.currentTime);  // 埋め戻しの間を飛ばす
    check('ワイヤーが切れたら孔を放棄する', trouble === null, trouble && trouble.phase);
    const dNew = depth;                           // 掘り直した直後の深さ（待つとテスト用の時計で掘り進む）
    lastTroubleT = Infinity;
    await wait(1500);                             // やぐらが横へ移り終わるまで（0.9秒のアニメーション）
    const scar = $q('.scar');
    check('放棄した孔とビットは、掘っていた位置に残る',
      scar && near(cx(scar.getBoundingClientRect()), cx(before)),
      scar ? `残った孔 ${cx(scar.getBoundingClientRect()).toFixed(1)} / 元の孔 ${cx(before).toFixed(1)}` : '残っていない');
    check('横へ移って、新しい井戸を0mから掘る', holeX > hx0 && dNew === 0 && lost > 0,
      `横位置 ${hx0}→${holeX}px / 掘り直した直後の掘進長 ${dNew.toFixed(1)}m`);

    // ── つなぎ目：絵とシステムが重なっているか（井戸が横へ移ったあとの位置で測る） ──
    paint();
    const sel = ROT ? '#rig' : '#derrick', spr = $q(sel), S = ROT ? RIG : DERRICK;
    if (ROT) {
      const rig = box(sel), rod = box('.bitline .rod');
      const axis = rig.left + RIG.w * RIG.axis, headBottom = rig.top + RIG.h * RIG.headY;
      check('つなぎ目：リグの掘削軸（レールのあいだ）が、実際のロッドの中心と重なる', near(axis, cx(rod), 1.5),
        `絵の掘削軸 ${axis.toFixed(1)} / ロッド ${cx(rod).toFixed(1)}（RIG.axis は画像から測った割合。絵を変えたら測り直す）`);
      check('つなぎ目：ロッドの上端が、ヘッドの下端で止まる', near(rod.top, headBottom, 1.5),
        `ロッド上端 ${rod.top.toFixed(1)} / ヘッド下端 ${headBottom.toFixed(1)}（RIG.headY。絵を変えたら測り直す）`);
    } else {
      const sheave = box(sel).left + DERRICK.w * DERRICK.axis, cable = cx(box('#cable')), hole = cx(box('.hole'));
      check('つなぎ目：櫓の滑車・ワイヤー・孔の中心がそろう', near(sheave, cable, 1.5) && near(cable, hole, 1.5),
        `滑車 ${sheave.toFixed(1)} / ワイヤー ${cable.toFixed(1)} / 孔 ${hole.toFixed(1)}（DERRICK.axis は画像から測った割合）`);
      const cableTop = box('#cable').top, sheaveY = box(sel).top + DERRICK.sheaveY * DERRICK.h;
      check('つなぎ目：ワイヤーの始点が、冠部の滑車の高さにある', near(cableTop, sheaveY, 1.5), `ワイヤー始点 ${cableTop.toFixed(1)} / 滑車 ${sheaveY.toFixed(1)}`);
    }
    // ── 実測の突き合わせ：ページの定数（DERRICK / RIG）が、実際に配信する画像のピクセルと合っているか ──
    //    （上の「重なる」は、ページの定数から位置を決めているので、定数が間違っていても通ってしまう。ここで画像そのものを測る）
    {
      const c = document.createElement('canvas'); c.width = spr.naturalWidth; c.height = spr.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(spr, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height;
      const solid = (x, y) => px[(y * W + x) * 4 + 3] > 128;
      let bottom = H - 1; while (bottom > 0 && ![...Array(W).keys()].some(x => solid(x, bottom))) bottom--;
      check('実測：機械の足の接地線が、画像の最も下の不透明な行と合う（定数 groundY）', near(S.groundY, bottom / H, 0.006),
        `定数 ${S.groundY} / 画像 ${(bottom / H).toFixed(3)}`);
      if (ROT) {
        // ヘッドの少し下の行で、2本のレールのあいだの隙間（ロッドの通る道）を探す。定数は使わず、固定の範囲（画像の 0.775〜0.835）だけを見る
        const yr = Math.round(0.66 * H); let gap = [0, 0], s = -1;
        for (let x = Math.round(0.775 * W); x <= Math.round(0.835 * W); x++) {
          const empty = !solid(x, yr);
          if (empty && s < 0) s = x;
          if ((!empty || x === Math.round(0.835 * W)) && s >= 0) { if (x - s > gap[1] - gap[0]) gap = [s, x - 1]; s = -1; }
        }
        const gapMid = (gap[0] + gap[1]) / 2 / W;
        check('実測：リグの掘削軸が、ロッドの通る隙間（レールのあいだ）の中心と合う（定数 axis）', gap[1] > gap[0] && near(RIG.axis, gapMid, 0.006),
          `定数 ${RIG.axis} / 画像の隙間の中心 ${gapMid.toFixed(3)}（隙間 ${(gap[0] / W).toFixed(3)}〜${(gap[1] / W).toFixed(3)}）`);
        let y = Math.round(0.5 * H); const ax = Math.round(gapMid * W); while (y < H && solid(ax, y)) y++;   // 測った軸の上を下へたどって、ヘッドの下端（不透明が途切れる行）
        check('実測：ヘッドの下端（ロッドの始点）が、画像と合う（定数 headY）', near(RIG.headY, y / H, 0.006),
          `定数 ${RIG.headY} / 画像 ${(y / H).toFixed(3)}`);
      } else {
        const yr = Math.round(DERRICK.sheaveY * H); let l = 0, rr = W - 1;    // 冠部の滑車の高さで、機械の左右の端の中心
        while (l < W && !solid(l, yr)) l++; while (rr > 0 && !solid(rr, yr)) rr--;
        check('実測：櫓の掘削軸が、冠部の中心と合う（定数 axis）', near(DERRICK.axis, (l + rr) / 2 / W, 0.006),
          `定数 ${DERRICK.axis} / 画像の冠部の中心 ${((l + rr) / 2 / W).toFixed(3)}`);
        const footY = Math.round((DERRICK.groundY - 0.02) * H), runs = []; let s = -1;
        for (let x = 0; x <= W; x++) { const v = x < W && solid(x, footY); if (v && s < 0) s = x; if (!v && s >= 0) { runs.push([s, x - 1]); s = -1; } }
        const mid = runs.filter(([a, b]) => a / W > 0.3 && b / W < 0.7);      // 足元の中央の台座（左右の脚とウインチは除く）
        check('実測：櫓の足元の中央の台座が、掘削軸を挟んでいる', mid.length > 0 && mid[0][0] / W < DERRICK.axis && mid[mid.length - 1][1] / W > DERRICK.axis,
          `台座 ${mid.map(([a, b]) => (a / W).toFixed(3) + '〜' + (b / W).toFixed(3)).join(' ')} / 軸 ${DERRICK.axis}`);
      }
    }
    const r = box(sel);
    check('絵を伸ばしていない（縦横比が画像のまま）', near(r.width / r.height, spr.naturalWidth / spr.naturalHeight, 0.01),
      `表示 ${(r.width / r.height).toFixed(3)} / 画像 ${(spr.naturalWidth / spr.naturalHeight).toFixed(3)}`);
    check('絵の足が地表に立つ（浮いても、埋まってもいない）', near(r.top + S.groundY * S.h, box('.strata').top, 1.5),
      `足 ${(r.top + S.groundY * S.h).toFixed(1)} / 地表 ${box('.strata').top.toFixed(1)}`);

    // ── 出水したらそこで止まる ──
    if (ROT) {
      depth = G.aq - 0.3;
      await until(() => struck, 45000);
      if (struck && !done) depth = finishAt - 0.01;  // ストレーナー区間の掘り下げを縮める
      check('水が出たら、ストレーナーぶん掘って井戸が完成する', await until(() => done, 45000),
        `掘進長 ${depth.toFixed(1)}m / 帯水層 ${G.aq}m`);
      check('出水のあとは掘り続けない', struck && !running && depth < G.aq + 5,
        `掘進長 ${depth.toFixed(2)}m（帯水層 ${G.aq}m）`);
    } else {
      depth = G.aq + 1.4;
      slime = 0;
      await until(() => cycle, 45000);               // 帯水層に入るとベーラーでさらいに行く
      for (let i = 0; i < 10 && cycle && !done; i++) advanceCycle(ctx.currentTime);   // さらいの段階を順に進める
      check('水が出たら、そこで井戸が完成する', await until(() => done, 15000),
        `掘進長 ${depth.toFixed(1)}m / 帯水層 ${G.aq.toFixed(1)}m / 工程 ${cycle ? cycle.phase : 'なし'}`);
      check('出水のあとは掘り続けない', struck && !running && depth < G.aq + 2.2,
        `掘進長 ${depth.toFixed(2)}m（帯水層 ${G.aq.toFixed(1)}m）`);
    }
    check('完成したら掘削開始は押せない', $q('#run').disabled);
    check('完成したあとも環境音が鳴り続ける（無音にならない）', !!ambientId, 'ambientId がない');
    let ambErr = ''; try { for (let i = 0; i < 6; i++) ambientTick(); } catch (e) { ambErr = String(e); }
    check('環境音の処理が最後まで動く', !ambErr, ambErr);
    check('ジャーリングを連打しても文字や画像が選択されない（青くならない）',
      getComputedStyle(document.body).userSelect === 'none' && getComputedStyle($q('#jar')).userSelect === 'none' &&
        getComputedStyle($q('#jar')).touchAction === 'manipulation',
      `body ${getComputedStyle(document.body).userSelect} / ボタン ${getComputedStyle($q('#jar')).userSelect} ${getComputedStyle($q('#jar')).touchAction}`);
    $q('#reset').click();
    check('「新しい井戸」で環境音が止まる', ambientId === null, 'ambientId が残っている');
    clearInterval(drive);
  }
})();
