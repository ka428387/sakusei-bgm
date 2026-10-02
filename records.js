/* 掘った記録。この端末の中（localStorage）だけに、工法ごとに残す。サーバーには何も送らない。
   肩書きは、その工法で掘った累計メートルで上がる（ロータリーは深い井戸、パーカッションは浅い井戸なので、段の長さを変えてある）。 */
const IdoRec = (() => {
  const KEY = 'idobeat-records-v1';
  const RANKS = ['見習い', '助手', '掘り子', 'キャプテン', '名井戸師'];
  const STEPS = { rotary: [0, 150, 600, 1500, 3000], percussion: [0, 60, 250, 600, 1200] };
  const blank = () => ({ wells: 0, m: 0, deepest: 0, freed: 0, lost: 0, rank: 0 });
  let data = null, last = 0, dirty = false;   // 変えたときだけ保存する（開いただけのページが、ほかのタブの記録を古い値で上書きしないように）
  const load = () => {
    if (data) return data;
    data = { rotary: blank(), percussion: blank() };
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || '{}');
      for (const k of Object.keys(data)) if (j[k]) Object.assign(data[k], j[k]);
    } catch (e) {}
    return data;
  };
  const save = (force) => {
    if (!dirty) return;
    const now = Date.now();
    if (!force && now - last < 2000) return;
    last = now; dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify(load())); } catch (e) {}
  };
  const rankOf = (mode, m) => STEPS[mode].reduce((r, s, i) => (m >= s ? i : r), 0);
  const api = {
    RANKS, STEPS,
    get: mode => Object.assign({}, load()[mode]),
    /* 掘った分（m）と、いまの深さ。毎拍呼んでよい */
    drill(mode, adv, depth) {
      const d = load()[mode];
      if (adv > 0) { d.m += adv; dirty = true; }
      if (depth > d.deepest) { d.deepest = depth; dirty = true; }
      save();
    },
    /* 出水で井戸が完成。肩書きが上がっていたら、その名前を返す */
    well(mode) {
      const d = load()[mode];
      d.wells++; dirty = true;
      const r = rankOf(mode, d.m);
      let up = '';
      if (r > d.rank) { d.rank = r; up = RANKS[r]; }
      save(true);
      return up;
    },
    freed(mode) { load()[mode].freed++; dirty = true; save(true); },
    lost(mode) { load()[mode].lost++; dirty = true; save(true); },
    /* 肩書きと、次の肩書きまでの残り（最高位は null） */
    title(mode) {
      const d = load()[mode], r = rankOf(mode, d.m), s = STEPS[mode];
      return { rank: r, name: RANKS[r], next: r + 1 < RANKS.length ? Math.ceil(s[r + 1] - d.m) : null };
    },
    flush() { save(true); }
  };
  addEventListener('pagehide', () => save(true));
  addEventListener('visibilitychange', () => { if (document.hidden) save(true); });
  return api;
})();
