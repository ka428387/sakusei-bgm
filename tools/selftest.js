/* さく井業BGM生成器 動作テスト
   tools/check.py が画面を出さないChromeで各ページを開き、このスクリプトを差し込んで動かす。
   本番のページには入らない。結果は /__result に送る。

   ここで確かめるのは、これまでに決めた動きと、絵とシステムのつなぎ目：
   - ビットが喰われても、時間では井戸を失わない（気づいた時点でジャーリングで抜く）
   - 叩きすぎてワイヤーが切れたときだけ、孔をその場に残して横で0mから掘り直す
   - 水が出たらそこで止まる
   - 絵（やぐら・リグ）が実際のワイヤー・ロッド・孔と重なっている
   - トップはスマホでスクロールせずに両方の工法が選べる
   掘削の処理はページの本物を使うが、時計だけはテスト用に差し替えて10倍速で回す。
   画面なしのChromeは、Macの音声出力が使えないと音の時計（AudioContext）が止まり、
   そのままだと公開が止まってしまうため。トラブルやベーラーの段階送りも、テストから直接進める */
(async () => {
  const R = [];
  const $q = s => document.querySelector(s);
  const PAGE = $q('#bail') ? 'パーカッション編' : $q('#pump') ? 'ロータリー編' : 'トップ';
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

  try {
    if (PAGE === 'トップ') await testTop(); else await testDrill();
  } catch (e) {
    check('テストの途中で止まった', false, (e && e.stack) || e);
  }
  check('JavaScript のエラーが出ていない', !window.__errs.length, window.__errs.join(' / '));
  await fetch('/__result', { method: 'POST', body: JSON.stringify({ page: PAGE, results: R }) });

  async function testTop() {
    const cards = [...document.querySelectorAll('a.card')];
    const hrefs = cards.map(a => a.getAttribute('href'));
    check('工法のカードが2枚ある', hrefs.includes('rotary/') && hrefs.includes('percussion/'), hrefs.join(', '));
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

  async function testDrill() {
    const ROT = PAGE === 'ロータリー編';
    const home = $q('a.home');
    check('「← ホーム」でトップへ戻れる', home && home.getAttribute('href') === '../', home && home.getAttribute('href'));
    check('地層が描かれている', $q('#strata').children.length > 3, $q('#strata').children.length);

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

    // ── つなぎ目：絵とシステムが重なっているか（移ったあとの位置で測る） ──
    paint();
    if (ROT) {
      const rig = box('.rotary-rig'), rod = box('.bitline .rod');
      check('つなぎ目：リグの絵の配管が、実際のロッドと重なる', near(rig.left + 80, cx(rod)),
        `絵の配管 ${(rig.left + 80).toFixed(1)} / ロッド ${cx(rod).toFixed(1)}（絵の x=80 が配管。絵を変えたら .rotary-rig の left を測り直す）`);
      check('つなぎ目：ロッドの上端が、絵のスイベルの下端で止まる', near(rod.top, rig.top + 74),
        `ロッド上端 ${rod.top.toFixed(1)} / スイベル下端 ${(rig.top + 74).toFixed(1)}（絵の y=74。絵を変えたら RIG_SWIVEL を測り直す）`);
    } else {
      const sheave = box('#derrick').left + 88, cable = cx(box('#cable')), hole = cx(box('.hole'));
      check('つなぎ目：やぐらの滑車・ワイヤー・孔の中心がそろう', near(sheave, cable, 1.5) && near(cable, hole, 1.5),
        `滑車 ${sheave.toFixed(1)} / ワイヤー ${cable.toFixed(1)} / 孔 ${hole.toFixed(1)}（絵の x=88 が滑車）`);
    }

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
