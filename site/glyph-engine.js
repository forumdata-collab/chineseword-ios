// ===== SHARED GLYPH ENGINE =====
// Extracted from index.html (2026-09-24) so the picture-worksheet feature can reuse the
// exact same HK glyph / stroke-order / stroke-number code instead of duplicating it.
// Classic script (not a module): every function stays a global, so index.html and
// picture/ call them unchanged. Source of truth = this file.
//
//   hkGlyph(ch)        → glyphs/<hex>.json  {s:[path…], m:[median…]}  (stored y-UP)
//   hkGlyphSvg(rec,ch) → display SVG (y-down via translate(0,C) scale(1,-1))
//   addGlyphNumbers(svg) → stroke numbers  — MUST run after the SVG is in the document
//                          (isPointInFill() is false for detached nodes)
//   appendStrokeArrows()  → dotted centrelines + direction arrows
//   measureInkFrame / partialGlyphSvg / addStepNumber → progressive stroke sheets
//   strokeCountOf(ch)     → authoritative count (EDB/twpen glyph, not Unihan)
//   applyHKOrder / hkCharDataLoader → HK stroke order for HanziWriter
//
// Deps: window.HK_ORDER (hk_order.js), window.STROKE_SEQ (stroke_seq.js),
//       window.CHAR_DB (data.js), HanziWriter (for non-EDB fallback + animations),
//       const NS = 'http://www.w3.org/2000/svg' — declare NS before loading if absent.

function applyHKOrder(ch, data) {
  const perm = (window.HK_ORDER || {})[ch];
  if (!perm || !data || !data.strokes || perm.length !== data.strokes.length) return data;
  return {
    strokes: perm.map(i => data.strokes[i]),
    medians: perm.map(i => data.medians[i]),
  };
}

// Custom loader so HanziWriter's own animation/quiz也跟香港次序
function hkCharDataLoader(ch, onComplete, onError) {
  hkGlyph(ch).then(rec => {
    if (rec && rec.s && rec.s.length && rec.m && rec.m.length === rec.s.length) {
      // 教育局標準字形（香港寫法）+ 香港筆順次序
      onComplete({ strokes: rec.s, medians: rec.m });
      return null;
    }
    return HanziWriter.loadCharacterData(ch).then(d => onComplete(applyHKOrder(ch, d)));
  }).catch(e => onError && onError(e));
}

// ===== 教育局標準字形 (香港小學學習字詞表 字形) =====
// glyphs/<hex>.json = {s:[stroke path…], m:[[[x,y]…]…]} — official EDB animation
// outlines (1080-space) plus skeleton centrelines, IN STORED Y-UP SPACE.
// Displayed via a flipped <g> so SVG (y-down) shows the character the right way up.
const _hkGlyphCache = new Map();
const _hkGlyphData = new Map();   // 已載入 glyph 嘅資料（同步讀筆數用）
function glyphDir() { return window.GLYPH_DIR || 'glyphs/'; }

// 「直出異體字」模式：window.CW_VARIANT_GLYPH = true 時，以下字改用 glyphs/variants/ 嘅字形
// （即跟着輸入字嘅寫法出，唔歸一成香港正字）。目前只有 峰（山在左，HanziWriter 通用字形）。
const VARIANT_GLYPHS = { '514c': 1, '56ea': 1, '5cf0': 1, '6085': 1, '6236': 1, '6558': 1, '7a05': 1, '7fa4': 1, '812b': 1, '81e5': 1, '8aaa': 1, '92b3': 1, '95b1': 1 };
function variantMode(ch) {
  return !!(window.CW_VARIANT_GLYPH && VARIANT_GLYPHS[ch.codePointAt(0).toString(16)]);
}

// ===== 主線程讓出（freeze fix 2026-11-17）=====
// installHKGlyphs 以前係一個同步迴圈做晒所有字：48 字 ≈ 5.5s 單一 long task，
// 輸入多字撳「生成」後成頁假死。依家按字分段，每段之間讓出主線程，等輸入／繪製可以插入。
// （實測瓶頸：strokeThickness 每筆 65 次 getPointAtLength ≈ 7–12ms；
// getBBox/isPointInFill 只係 ~0.002ms，唔係瓶頸。）
function yieldUI() { return new Promise(r => setTimeout(r, 0)); }
// Time-sliced yield：自上次讓出起計未夠 budgetMs 就唔讓，避免每格都 setTimeout 嘅開銷。
let _yieldLastT = 0;
async function yieldIfNeeded(budgetMs) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (now - _yieldLastT >= (budgetMs || 24)) {
    _yieldLastT = now;
    await yieldUI();
  }
}

// ===== 生成代號（freeze fix 2026-11-17，Part A pile-up）=====
// 每一次 renderWorksheet 都係新一代；上一代未跑完嘅 async 安裝迴圈
// （installHKGlyphs / overlay / markNoStrokeData / installStrokePage）
// 一偵測到代號過期就停 —— 唔再喺已 detach 嘅舊 DOM 上量度／起 SVG，
// 亦唔再 hold 住舊樹，等 GC 收得返。否則連撳幾次「生成」／連改幾次選項，
// 舊迴圈會同新迴圈一齊跑，愈積愈多，最後成個 renderer 塞死。
// gen == null（舊調用，未傳代號）視為有效，唔會誤殺。
let _cwGlyphGen = 0;
function cwGlyphGenBegin() { return ++_cwGlyphGen; }
function cwGlyphGenAlive(gen) { return gen == null || gen === _cwGlyphGen; }

// 每字筆順數字排位快取：排位結果只取決於（字，artScale，字級），同一字喺多格／
// 多次生成重用，唔使每次重跑 strokeThickness + placeNumberLabels。
// 值 = { labels }（純數據；圓圈／數字 DOM 每次照舊逐格建立，顏色永遠跟當下模式）。
const _numPlacementCache = new Map();
// HanziWriter 後備路徑嘅幾何快取：每字量度一次（bbox + medians + 筆粗），多格重用。
const _hwGeomCache = new Map();
function clearGlyphCache() {
  _hkGlyphCache.clear(); _hkGlyphData.clear();
  _numPlacementCache.clear(); _hwGeomCache.clear();
}

function hkGlyph(ch) {
  if (!ch) return Promise.resolve(null);
  if (_hkGlyphCache.has(ch)) return _hkGlyphCache.get(ch);
  const hex = ch.codePointAt(0).toString(16);
  // 預設（未勾「顯示我輸入的寫法」）示範香港教育標準寫法：輸入字若有另一寫法而標準不同，
  // 字形取標準字（秘→祕、羣→群），與「字形：」標示一致（跟 web 版）。
  const stdForm = !window.CW_VARIANT_GLYPH && window.CW_STD_FORM ? window.CW_STD_FORM[hex] : null;
  const fetchGlyph = (c) => fetch(`${glyphDir()}${c.codePointAt(0).toString(16)}.json?v=49`).then(r => (r.ok ? r.json() : null));
  const std = () => (stdForm && stdForm !== ch
    ? fetchGlyph(stdForm).then(rec => rec || fetchGlyph(ch))
    : fetchGlyph(ch));
  const load = variantMode(ch)
    ? () => fetch(`${glyphDir()}variants/${hex}.json?v=1`).then(r => (r.ok ? r.json() : std()))
    : std;
  const p = load()
    .catch(() => null)
    .then(rec => { if (rec) _hkGlyphData.set(ch, rec); return rec; });
  _hkGlyphCache.set(ch, p);
  return p;
}

// arc-length point at fraction f (0..1) along a polyline [[x,y]…]
function medianPtAt(m, f) {
  if (!m || !m.length) return null;
  if (m.length === 1) return { x: m[0][0], y: m[0][1] };
  let total = 0;
  const segs = [];
  for (let k = 1; k < m.length; k++) {
    const L = Math.hypot(m[k][0] - m[k - 1][0], m[k][1] - m[k - 1][1]);
    segs.push(L); total += L;
  }
  if (!total) return { x: m[0][0], y: m[0][1] };
  const want = total * f;
  let acc = 0;
  for (let k = 0; k < segs.length; k++) {
    if (acc + segs[k] >= want) {
      const t = (want - acc) / (segs[k] || 1);
      return { x: m[k][0] + (m[k + 1][0] - m[k][0]) * t, y: m[k][1] + (m[k + 1][1] - m[k][1]) * t };
    }
    acc += segs[k];
  }
  return { x: m[m.length - 1][0], y: m[m.length - 1][1] };
}

// Stroke numbers, placed ON their own stroke but kept apart from each other.
// Each number tries several arc-length positions of its own median — so it can never
// drift off the stroke it labels — and takes the first slot that does not overlap an
// already-placed number; if every slot collides, the least-overlapping one wins.
// Without this, characters whose strokes cross at their midpoints (十-shaped parts,
// 噠 strokes 4/5 and 11/12 …) print two numbers on top of each other.
// flipC mirrors stored y-up data into the SVG's y-down space: y_display = flipC - y.
// inkPointFn(i) is the optional last resort: it returns a median-space point known to be
// inside stroke i's ink, used when no centreline candidate qualifies (see below).
// insideFn(i, cx, cy) is optional: it must report whether the display-space point
// actually lies in stroke i's ink.  A plain arc-length midpoint can fall OUTSIDE a
// short/thin stroke (兒's first stroke is only ~25 units wide, so its number floated
// in blank space), and candidates that miss their own stroke are penalised hard.
// 統一數字字級（2026-09-18）：筆畫多嘅字全部數字用同一個基準級數，唔會一大一小。
// DIGIT_SCALE = 用戶要求「所有數字再縮一個單位」（= SIZE_SCALES 一級 0.85）。
const DIGIT_SCALE = 0.85;
// 密字數字位置 override（0-based stroke index → 弧長 fraction）。
// 呢啲字嘅相鄰/共線筆畫，避撞算法（側移+縮字）搵唔到 clean spot，人手指定更遠弧長位置。
// （由 tools 搜尋腳本搵出最優 fraction；籌/鬱 嘅 49% 重疊係密字極限，fraction 都救唔到）
const NUMBER_OVERRIDES = {
  '繭': {8: 0.6},    // 第 9 筆（9/10 重疊 24%→0%）
  '輛': {8: 0.32},   // 第 9 筆（9/13 重疊 52%→0%）
  '騷': {11: 0.14},  // 第 12 筆（12/13 重疊 60%→0%）
  '髒': {16: 0.8},   // 第 17 筆（17/18 重疊 65%→0%）
  '齷': {6: 0.05},   // 第 7 筆（7/8 重疊 31%→11%）
};
function numberBaseScale(n) {
  return DIGIT_SCALE * (n > 8 ? Math.max(0.45, 1 - 0.028 * (n - 8)) : 1);
}

// 文章版面（稀疏欄數）嘅筆順數字：固定為格闊 8%，唔跟筆畫粗幼／筆數縮放。
// 密欄（>8 欄）唔出數字（articlePagesHtml 把 data-num 設 0），呢度只處理出數字嗰陣。
// 數字喺 SVG 入面，SVG 以 1em = 格闊 x artScale 顯示，viewBox 闊 = box，
// 所以文字 sz（glyph 單位）= 0.08 x box / artScale，先會喺螢幕上等於格闊 8%（唔理 artScale）。
// placeNumberLabels 嘅文字 sz = p.fs x 0.75，所以 p.fs = 0.08 x box / (artScale x 0.75)。
// box = EDB viewBox 闊（900）或 HW viewBox 闊（hwW + 2*pad），兩邊各自傳入；artScale 來自 data-art-scale。
function articleNumFs(box, artScale) {
  const a = (artScale > 0 ? artScale : 1);
  return box * 0.08 / (a * 0.75);
}

function placeNumberLabels(medians, frame, hooks) {
  const { fs: globalFs, C: flipC } = frame;  // glyph geometry travels as one frame
  const nStrokes = medians.length || 1;
  const fontSize = globalFs * numberBaseScale(nStrokes);  // 全字統一基準
  const wideLen = String(nStrokes).length;                // 10 筆以上：全部當兩位寬
  hooks = hooks || {};
  const insideFn = hooks.inside;              // is this point in MY stroke's ink?
  const inkPointFn = hooks.inkPoint;          // a point certainly in MY stroke's ink
  const otherFn = hooks.others;               // is this point in ANOTHER stroke's ink?
  const placed = [];
  // Dense characters (鬱, 鸚, 鹽 … 15+ crossing strokes) can leave no clean spot at full
  // size, so the search walks 23 positions along the stroke at decreasing sizes and stops
  // at the first size that fits without a pile-up. Shrinking beats both overlapping and
  // leaving the labelled stroke.
  // 2026-11-16 用戶要求：數字放喺**起筆處**（1:1 復刻 hanziwu：圓圈喺每筆嘅起點）。
  // 由 0（中線起點）開始，逐步向後搵位；後面位置保留做避撞 fallback（起點撞到鄰筆
  // 先向後移少少）。舊 2026-09-18「起筆後 1/5」規則由呢個取代。
  const FRACTIONS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.46, 0.52, 0.6, 0.7, 0.8, 0.9];
  const SIZE_SCALES = [1, 0.85, 0.72, 0.6, 0.5, 0.42, 0.36, 0.3];
  // 側移距離（× 字級）：0 = 中線本身，之後左右交替
  const LATERAL = [0, 0.45, -0.45, 0.8, -0.8, 1.2, -1.2];
  // Box ≈ the DIGIT INK, not the em box: a digit is ~0.55em wide and rises ~0.72em
  // above its baseline, plus a small breathing gap. Using the full em box made the
  // solver think two labels 90 units apart still collided and settle for a needless
  // overlap (個 strokes 5/6).
  const gap = fontSize * 0.05;
  // Penalties are FRACTIONS OF ONE DIGIT'S AREA, matching how a collision actually shows
  // (two small digits stacked are as unreadable as two big ones, but an absolute-area
  // objective rated them as an improvement and shrank its way into the problem).
  const OFF_STROKE_PENALTY = 4;      // leaving the labelled stroke loses to any overlap
  // Where strokes cross, a digit can sit exactly on the crossing point — on its own
  // stroke, but also on a neighbour's ink (喻 8/10, 勤 9/10). Prefer elsewhere on the
  // stroke: this penalty is far below OFF_STROKE_PENALTY, so leaving the stroke still
  // loses, but a quieter spot on it wins.
  const CROSS_PENALTY = 0.5;
  // NOTE: relaxing the penalty for sidestepping off the stroke was tried and reverted —
  // it clears the pile-ups but leaves digits floating beside their stroke (暗/靜/髏/璽),
  // which is the defect the numbers layer exists to avoid. Dense characters instead shrink
  // further (SIZE_SCALES) so a clean on-stroke spot is more likely to exist.
  medians.forEach((m, i) => {
    const label = String(i + 1);
    // Per-char per-stroke fraction override（密字共線筆畫嘅數字，指定一個更遠嘅弧長位置）
    const ovFrac = (hooks && hooks.override) ? hooks.override(i) : null;
    const fracs = ovFrac != null ? [ovFrac, ...FRACTIONS.filter(f => f !== ovFrac)] : FRACTIONS;
    // A digit must not dwarf the stroke it labels: on a thin/short stroke the global size
    // looks like a misplaced number (兒 #1 sits on a 25x40 stroke, 離 #8 on 55x40) rather
    // than a label. hooks.size(i) caps it to the stroke's own thickness; the floor keeps
    // it legible.
    let size = fontSize;
    if (hooks.size) {
      try {
        const s = hooks.size(i, wideLen);
        if (s && s > 0) size = s;
      } catch (e) { /* keep the global size */ }
    }
    // A stroke can have a degenerate centreline — 孿's stroke 17 is a single point — and
    // then no candidate exists and the stroke ends up with NO number at all. Anchor such
    // strokes on a point taken from their own ink instead.
    if (!m || m.length < 2) {
      let p = null;
      try { p = inkPointFn ? inkPointFn(i) : (m && m[0] ? { x: m[0][0], y: m[0][1] } : null); } catch (e) { p = null; }
      if (p) {
        const cx = p.x, cy = flipC - p.y;
        const bw = size * 0.55 * wideLen;
        placed.push({ label, cx, cy,
                      bx0: cx - bw / 2 - gap, bx1: cx + bw / 2 + gap,
                      by0: cy - size * 0.90 - gap, by1: cy - size * 0.18 + gap,
                      fs: size });
      }
      return;
    }
    let best = null, bestOv = Infinity, bestOff = false;
    // 候選點 = 中線上嘅位置 ＋ 沿中線法線嘅側移（側移只准留喺自己筆畫嘅墨跡內）。
    // 側移排喺縮字之前：同一字嘅數字級數先保持一致，唔使靠越縮越細去避撞。
    const aN = medianPtAt(m, 0.42), bN = medianPtAt(m, 0.58);
    let nX = 0, nY = 0;
    if (aN && bN) {
      const dxN = bN.x - aN.x, dyN = -(bN.y - aN.y);
      const LN = Math.hypot(dxN, dyN);
      if (LN) { nX = -dyN / LN; nY = dxN / LN; }
    }
    scales: for (const scale of SIZE_SCALES) {
    const sizeS = Math.max(size * scale, fontSize * 0.3);
    for (const f of fracs) {
      const pt = medianPtAt(m, f);
      if (!pt) continue;
      const bx = pt.x, by = flipC - pt.y;
      for (let li = 0; li < LATERAL.length; li++) {
      const off = sizeS * LATERAL[li];
      const cx = bx + nX * off, cy = by + nY * off;
      const bw = sizeS * 0.55 * wideLen;
      const bx0 = cx - bw / 2 - gap, bx1 = cx + bw / 2 + gap;
      // Digits sit ON the text baseline, which the renderer lifts 0.18em above cy,
      // and their ink reaches ~0.72em above that baseline — so the box is NOT centred
      // on cy. Modelling it as centred left 進's 6/7 overlapping by 68x16 units.
      const by0 = cy - sizeS * 0.90 - gap, by1 = cy - sizeS * 0.18 + gap;
      const area = Math.max((bx1 - bx0) * (by1 - by0), 1e-6);
      let ov = 0;
      for (const p of placed) {
        const ox = Math.min(bx1, p.bx1) - Math.max(bx0, p.bx0);
        const oy = Math.min(by1, p.by1) - Math.max(by0, p.by0);
        if (ox > 0 && oy > 0) ov += (ox * oy) / area;
      }
      if (insideFn) {
        let onStroke = true;
        try { onStroke = insideFn(i, cx, cy); } catch (e) { onStroke = true; }
        if (!onStroke) ov += OFF_STROKE_PENALTY;
      }
      if (otherFn) {
        let onOther = false;
        try { onOther = otherFn(i, cx, cy); } catch (e) { onOther = false; }
        if (onOther) ov += CROSS_PENALTY;
      }
      if (ov < bestOv) {
        bestOv = ov;
        bestOff = !!(insideFn && ov >= OFF_STROKE_PENALTY);
        best = { label, cx, cy, bx0, bx1, by0, by1, fs: sizeS };
      }
      if (ov === 0) break scales;      // clean spot at this size — keep the largest
      }
    }
    if (bestOv === 0) break;           // nothing smaller will beat a clean fit
    }
    // Last resort: a stroke can be too short to hold all its own labels apart (進's
    // stroke 7 shares one vertical line with 5 and 6). Step SIDEWAYS off the stroke —
    // perpendicular to its local direction — keeping the number beside its own stroke.
    if (best && bestOv > 0) {
      const a = medianPtAt(m, 0.46), b = medianPtAt(m, 0.54);
      let nx = 1, ny = 0;
      if (a && b) {
        const dx = b.x - a.x, dy = -(b.y - a.y);      // display space (y flipped)
        const L = Math.hypot(dx, dy);
        if (L) { nx = -dy / L; ny = dx / L; }
      }
      for (const k of [0.6, 0.9, 1.2, 1.5, 1.8, -0.6, -0.9, -1.2, -1.5, -1.8]) {
        const cx2 = best.cx + nx * size * k, cy2 = best.cy + ny * size * k;
        const bw2 = size * 0.55 * wideLen;
        const bx2 = [cx2 - bw2 / 2 - gap, cx2 + bw2 / 2 + gap];
        const by2 = [cy2 - size * 0.90 - gap, cy2 - size * 0.18 + gap];
        const area2 = Math.max((bx2[1] - bx2[0]) * (by2[1] - by2[0]), 1e-6);
        let ov2 = 0;
        for (const p of placed) {
          const ox = Math.min(bx2[1], p.bx1) - Math.max(bx2[0], p.bx0);
          const oy = Math.min(by2[1], p.by1) - Math.max(by2[0], p.by0);
          if (ox > 0 && oy > 0) ov2 += (ox * oy) / area2;
        }
        if (insideFn) {
          let onStroke = true;
          try { onStroke = insideFn(i, cx2, cy2); } catch (e) { onStroke = true; }
          if (!onStroke) ov2 += OFF_STROKE_PENALTY;  // staying on the stroke wins
        }
        if (ov2 < bestOv) {
          bestOv = ov2;
          bestOff = !!(insideFn && ov2 >= OFF_STROKE_PENALTY);
          best = { label, cx: cx2, cy: cy2, bx0: bx2[0], bx1: bx2[1], by0: by2[0], by1: by2[1], fs: size };
        }
        if (ov2 === 0) break;
      }
    }
    // Final resort: some strokes have a centreline that never enters their own ink (thin
    // or sharply curved). Then EVERY candidate is penalised, so the solver settles for the
    // least-bad one and the digit ends up on a neighbouring stroke or in blank space
    // (靜 #14 landed on stroke 13, 暗 #13 on no stroke at all). inkPointFn(i) supplies a
    // point that is definitely inside stroke i's own fill — put the digit there.
    if (best && bestOff && inkPointFn) {
      let p = null;
      try { p = inkPointFn(i); } catch (e) { p = null; }
      if (p) {
        const cx3 = p.x, cy3 = flipC - p.y;
        const bw3 = size * 0.55 * wideLen;
        const bx3 = [cx3 - bw3 / 2 - gap, cx3 + bw3 / 2 + gap];
        const by3 = [cy3 - size * 0.90 - gap, cy3 - size * 0.18 + gap];
        const area3 = Math.max((bx3[1] - bx3[0]) * (by3[1] - by3[0]), 1e-6);
        let ov3 = 0;
        for (const q of placed) {
          const ox = Math.min(bx3[1], q.bx1) - Math.max(bx3[0], q.bx0);
          const oy = Math.min(by3[1], q.by1) - Math.max(by3[0], q.by0);
          if (ox > 0 && oy > 0) ov3 += (ox * oy) / area3;
        }
        // staying on the labelled stroke always beats floating off it
        best = { label, cx: cx3, cy: cy3, bx0: bx3[0], bx1: bx3[1], by0: by3[0], by1: by3[1], fs: size };
      }
    }
    if (best) placed.push(best);
  });
  return placed;
}

// Off-screen probe SVG for measuring path geometry (getBBox only works on
// attached nodes). Shared by glyphInkBBox / overlayStrokeNum — the three
// copies of this setup used to drift apart. Caller must remove() it.
function probeSvg() {
  const probe = document.createElementNS(NS, 'svg');
  probe.setAttribute('width', '0');
  probe.setAttribute('height', '0');
  probe.style.cssText = 'position:absolute;left:-9999px;overflow:hidden';
  document.body.appendChild(probe);
  return probe;
}

// Per-cell trace flags: a cell's own data-arrow / data-num win; otherwise fall
// back to the page-wide currentOptions (index.html). Single place for the
// rule — installHKGlyphs and overlayStrokeNum used to duplicate it, so a
// flag-semantics change needed two edits. The typeof guard also keeps the
// HanziWriter-fallback path safe on pages without currentOptions (picture/).
function cellTraceFlags(cell) {
  const opts = (typeof currentOptions !== 'undefined' && currentOptions) || {};
  return {
    arrow: cell && cell.dataset.arrow != null ? cell.dataset.arrow === '1' : !!opts.arrow,
    num: cell && cell.dataset.num != null ? cell.dataset.num === '1' : opts.strokeNum !== false,
  };
}

// Median of an array of numbers (0 when empty). Shared by the EDB and
// HanziWriter number-sizing paths — both used to inline the same sort +
// middle-element logic.
function medianOf(values) {
  const a = (values || []).slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
}

/**
 * Ink bounding box of a glyph's stroke paths. getBBox() only works on rendered
 * geometry, so the paths are measured inside an off-screen probe SVG that is removed
 * again straight away. Returns null for a degenerate (empty) record.
 */
function glyphInkBBox(paths) {
  const probe = probeSvg();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  try {
    for (const d of paths) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d); probe.appendChild(p);
      const b = p.getBBox();
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
    }
  } finally {
    probe.remove();
  }
  if (!isFinite(x0) || x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

/**
 * Display frame of one glyph record — everything downstream needs, in one object.
 * Stored space is y-UP, so `C` is the flip axis that turns the display y-down again.
 * The stroke-number font size is 14% of the ink box (unchanged ratio).
 */
const _glyphFrameCache = new WeakMap();   // frame 只取決於 rec，同一字多格重用
function glyphFrame(rec) {
  const cached = _glyphFrameCache.get(rec);
  if (cached) return cached;
  const b = glyphInkBBox(rec.s);
  if (!b) return null;
  // 字身框（em）固定：以前用「自身墨跡框」做 box，等於每個字都放大到填滿格子，
  // 結果少筆劃而方正的字（白、西、口、日）視覺上撐爆格，同筆劃多的字唔協調。
  // 900 ≈ 全字庫墨跡中位數（856）同 1024 字身之間，令密字大小不變、疏字自然收細。
  const EM = 900;
  const box = EM;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const frame = {
    ...b, box, cx, cy,
    C: b.y0 + b.y1,
    fs: box * 0.14,
    viewBox: `${(cx - box / 2).toFixed(1)} ${(cy - box / 2).toFixed(1)} `
           + `${box.toFixed(1)} ${box.toFixed(1)}`,
  };
  _glyphFrameCache.set(rec, frame);
  return frame;
}

// Build the display SVG for one glyph record. Ink is ~62% of the box (matches the old
// font glyph look). Stroke numbers are added afterwards by addGlyphNumbers().
function hkGlyphSvg(rec, ch) {
  const frame = glyphFrame(rec);
  if (!frame) return null;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'hk-glyph-svg');
  svg.setAttribute('viewBox', frame.viewBox);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');

  const g = document.createElementNS(NS, 'g');
  g.setAttribute('transform', `translate(0,${frame.C.toFixed(1)}) scale(1,-1)`);
  const strokeEls = [];
  for (const d of rec.s) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    g.appendChild(p);
    strokeEls.push(p);
  }
  svg.appendChild(g);

  // numbers are placed later, once this SVG is in the document — see addGlyphNumbers
  svg._glyphMeta = { ...frame, strokeEls, medians: rec.m, ch };
  return svg;
}


// True stroke thickness via 2*Area/Perimeter (robust for long/diagonal strokes).
// min(bbox) measures a diagonal stroke's LENGTH, not its thickness (e.g. 笑 #1:
// min-bbox 179 but true ink only ~37), so it must not size the number circle.
// Samples the closed outline; falls back to 0 (caller falls back to min-bbox).
function strokeThickness(el) {
  let len = 0;
  try { len = el.getTotalLength(); } catch (e) { return 0; }
  if (!(len > 0)) return 0;
  const N = 64;
  let a2 = 0, px = 0, py = 0;
  try {
    for (let k = 0; k <= N; k++) {
      const pt = el.getPointAtLength(len * k / N);
      if (k === 0) { px = pt.x; py = pt.y; }
      else { a2 += px * pt.y - pt.x * py; px = pt.x; py = pt.y; }
    }
  } catch (e) { return 0; }
  const area = Math.abs(a2) / 2;
  return area > 0 ? (2 * area / len) : 0;
}

// 數字置中：dominant-baseline:central 唔能夠保證數字墨跡中心對準圓圈中心
// （實測數字偏高 ~5.7 glyph units，個別字如 7 甚至出圈）。用 getBBox 量出墨跡
// 實際中心，再移返去圓圈中心。一定要喺 text 已經 append 落 DOM 之後先叫。
function centerNumText(t, cx, cy) {
  try {
    const b = t.getBBox();
    if (!b || !b.height) return;
    const inkCy = b.y + b.height / 2;
    const dy = cy - inkCy;
    if (Math.abs(dy) < 0.5) return;   // 已經置中，唔郁
    const y0 = parseFloat(t.getAttribute('y')) || 0;
    t.setAttribute('y', (y0 + dy).toFixed(1));
    // 橫向都用墨跡中心對準（text-anchor:middle 已經接近，但 7 等字形闊度唔對稱時會有偏差）
    const inkCx = b.x + b.width / 2;
    const dx = cx - inkCx;
    if (Math.abs(dx) >= 0.5) {
      const x0 = parseFloat(t.getAttribute('x')) || 0;
      t.setAttribute('x', (x0 + dx).toFixed(1));
    }
  } catch (e) { /* getBBox 失敗就保持原位 */ }
}

// One stroke-number label: white circle + coloured rim, number in the same
// colour, ink-centred on its stroke. Shared by the EDB path (addGlyphNumbers)
// and the HanziWriter fallback path (overlayStrokeNum) — both used to inline
// this identical ~25-line block, so a rendering tweak needed two edits.
// p = one entry from placeNumberLabels(); baseFs = that path's fallback size.
function appendNumberLabel(svg, p, baseFs) {
  const sz = (p.fs || baseFs) * 0.75;   // 數字縮細（用戶 2026-11-16：數字過大）
  const i = (parseInt(p.label, 10) || 1) - 1;
  const cy = p.cy - sz * 0.18;   // 數字視覺中心（同 text y 一致）
  // 數字圓圈：白底＋彩色邊（單色模式紅，彩虹模式按筆序循環），數字同色。
  // r = 0.8·sz（貼住數字，唔好成個大圓碟）、邊粗 ≈ 0.13·sz。
  const circle = document.createElementNS(NS, 'circle');
  circle.setAttribute('class', 'stroke-num-circle');
  circle.setAttribute('cx', p.cx.toFixed(1));
  circle.setAttribute('cy', cy.toFixed(1));
  circle.setAttribute('r', (sz * 0.8).toFixed(1));
  circle.setAttribute('fill', '#fff');
  circle.setAttribute('stroke-width', Math.max(2, sz * 0.13).toFixed(1));
  circle.setAttribute('data-stroke-i', i);
  paintStrokeEl(circle, i);
  svg.appendChild(circle);
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', p.cx.toFixed(1));
  t.setAttribute('y', cy.toFixed(1));
  t.setAttribute('font-size', sz.toFixed(1));
  t.setAttribute('data-stroke-i', i);
  paintStrokeEl(t, i);
  t.textContent = p.label;
  svg.appendChild(t);
  centerNumText(t, p.cx, cy);   // 數字墨跡置中（2026-11-16：7 字出圈）
}

// Number-placement hooks for one glyph SVG (shared by the sync and chunked paths).
// Pure function of (meta, medianThick, artScale) — see addGlyphNumbers for the rules.
function buildNumberHooks(meta, medianThick, artScale) {
  const { fs, C, strokeEls, medians } = meta;
  const insideFn = (i, cx, cy) => {
    const el = strokeEls[i];
    if (!el) return true;
    try { return el.isPointInFill(new DOMPoint(cx, C - cy)); } catch (e) { return true; }
  };
  // A point guaranteed to be inside stroke i's own fill: sample a grid over the stroke's
  // box until isPointInFill() agrees. Used when the centreline misses the ink entirely.
  const inkPointFn = (i) => {
    const el = strokeEls[i];
    if (!el) return null;
    let b;
    try { b = el.getBBox(); } catch (e) { return null; }
    for (let k = 1; k <= 6; k++) {
      for (let j = 1; j <= 6; j++) {
        const sx = b.x + b.width * (k / 7), sy = b.y + b.height * (j / 7);
        try {
          if (el.isPointInFill(new DOMPoint(sx, sy))) return { x: sx, y: sy };
        } catch (e) { /* ignore, try the next sample */ }
      }
    }
    return null;
  };
  return {
    inside: insideFn,
    inkPoint: inkPointFn,
    // Cap a digit to the character's MEDIAN true thickness (hanziwu reference:
    // the number circle is ~1.1x the stroke width, a discreet label, not a disc).
    // Uniform per character: one median thickness sizes ALL digits, so they are
    // the same size within the character (2026-11-17: 匝 #4 was 2–3x the others).
    // Rendering: font = p.fs x 0.75, circle D = 1.2 x p.fs, so cap p.fs at
    // 0.92x thick -> D = 1.1x thick, digit ink ~0.5x thick, fits inside.
    // thick is 2*Area/Perimeter (min-bbox over-reads diagonal strokes).
    size: (i, digitCount) => {
      // 文章稀疏版面：數字固定為格闊 8%，唔跟筆畫粗幼 cap（否則幼筆數字縮到睇唔到）。
      if (artScale > 0) return articleNumFs(meta.box, artScale);
      if (!(medianThick > 0)) return fs;
      const thick = medianThick;
      const fsEff = fs * numberBaseScale(medians.length);
      const byHeight = 0.92 * thick;
      const byWidth = 2.27 * thick / Math.max(digitCount, 1);   // ~0.55 em per digit
      return Math.max(26, Math.min(fsEff, byHeight, byWidth));
    },
    // digits must not sit on a crossing neighbour's ink either
    others: (i, cx, cy) => {
      for (let k = 0; k < strokeEls.length; k++) {
        if (k === i) continue;
        try { if (strokeEls[k].isPointInFill(new DOMPoint(cx, C - cy))) return true; } catch (e) { /* skip */ }
      }
      return false;
    },
    // 密字數字位置 override（NUMBER_OVERRIDES）：指定某筆嘅優先弧長位置
    override: (i) => {
      const ov = meta.ch && NUMBER_OVERRIDES[meta.ch];
      return ov && ov[i] != null ? ov[i] : null;
    },
  };
}

// Uniform number size per character (2026-11-17): one MEDIAN stroke thickness
// for the whole character, so all number circles in it are the same size
// (hanziwu look kept, but no per-stroke variation — 匝 #4 was 2–3x the others).
// Same thickness measure as before: 2*Area/Perimeter, min-bbox fallback.
function medianStrokeThickness(strokeEls) {
  const th = [];
  for (const el of strokeEls) {
    if (!el) continue;
    let t = strokeThickness(el);
    if (!(t > 0)) {
      try { const b = el.getBBox(); t = Math.min(b.width, b.height); } catch (e) { /* skip */ }
    }
    if (t > 0) th.push(t);
  }
  return medianOf(th);
}

// Chunked version: same numbers, but yields to the event loop roughly every
// 40ms of measuring (≈50ms max block — strokeThickness is ~7–12ms per stroke).
// Used by the worksheet path so a long input never freezes the page.
// Time-based (not every-N-strokes): stroke cost varies with outline complexity.
async function medianStrokeThicknessChunked(strokeEls, gen) {
  const th = [];
  let t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  for (let s = 0; s < strokeEls.length; s++) {
    const el = strokeEls[s];
    if (!el) continue;
    let t = strokeThickness(el);
    if (!(t > 0)) {
      try { const b = el.getBBox(); t = Math.min(b.width, b.height); } catch (e) { /* skip */ }
    }
    if (t > 0) th.push(t);
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now - t0 >= 40) {
      await yieldUI(); t0 = now;
      if (!cwGlyphGenAlive(gen)) return null;   // 已被新一代取代：停，唔好再量度
    }
  }
  return medianOf(th);
}

// Pure number-placement computation for one glyph (no DOM writes).
function computeGlyphNumbers(meta, artScale) {
  const { fs, C, medians } = meta;
  const medianThick = medianStrokeThickness(meta.strokeEls);
  const labels = placeNumberLabels(medians, { fs, C }, buildNumberHooks(meta, medianThick, artScale));
  return { labels };
}
async function computeGlyphNumbersChunked(meta, artScale, gen) {
  const { fs, C, medians } = meta;
  const medianThick = await medianStrokeThicknessChunked(meta.strokeEls, gen);
  if (medianThick == null) return null;   // 已被新一代取代
  const labels = placeNumberLabels(medians, { fs, C }, buildNumberHooks(meta, medianThick, artScale));
  return { labels };
}

// Render already-placed labels into an SVG (cheap DOM writes only).
function renderGlyphNumbers(svg, meta, computed) {
  computed.labels.forEach(p => appendNumberLabel(svg, p, meta.fs));
}

// Placement cache key: placement depends only on (char, artScale, font size);
// the geometry itself comes from the glyph record, which clearGlyphCache()
// invalidates whenever the variant/std-form mapping changes.
function numPlacementKey(meta, artScale) {
  return meta.ch + '|' + (artScale || 0) + '|' + meta.fs;
}

// Place the stroke numbers. MUST run after the SVG is attached to the document:
// isPointInFill() returns false for detached nodes (verified), which would silently
// disable the "stay inside your own stroke" test and let labels float in blank space.
function addGlyphNumbers(svg, artScale) {
  const meta = svg && svg._glyphMeta;
  if (!meta || !meta.medians || !meta.medians.length) return;
  const key = numPlacementKey(meta, artScale);
  let computed = _numPlacementCache.get(key);
  if (!computed) {
    computed = computeGlyphNumbers(meta, artScale);
    _numPlacementCache.set(key, computed);
  }
  renderGlyphNumbers(svg, meta, computed);
}

// Chunked async twin of addGlyphNumbers (same output, yields while measuring).
// Used by installHKGlyphs; the sync version stays for picture/ and other callers.
// Returns false when aborted (superseded generation), true otherwise.
async function addGlyphNumbersAsync(svg, artScale, gen) {
  const meta = svg && svg._glyphMeta;
  if (!meta || !meta.medians || !meta.medians.length) return true;
  const key = numPlacementKey(meta, artScale);
  let computed = _numPlacementCache.get(key);
  if (!computed) {
    computed = await computeGlyphNumbersChunked(meta, artScale, gen);
    if (!computed) return false;   // 已被新一代取代：唔畫數字，唔入快取
    _numPlacementCache.set(key, computed);
  }
  renderGlyphNumbers(svg, meta, computed);
  return true;
}

// Install HK glyphs into .char-glyph / .guide-glyph spans (font glyph = fallback).
// Numbers go on the first tracing cell only.
// gen = generation token from renderWorksheet: stale generations stop early
// instead of grinding through detached DOM.
async function installHKGlyphs(root, gen) {
  const els = [...root.querySelectorAll('.char-glyph[data-ch], .guide-glyph[data-ch]')];
  if (!els.length) return new Set();
  const chars = [...new Set(els.map(e => e.dataset.ch))]
    // 標點冇字形資料（EDB/HW 都冇），唔應該浪費一個 404 請求
    .filter(ch => !(typeof isPunct === 'function' && isPunct(ch)));
  const recs = new Map();
  await Promise.all(chars.map(async ch => {
    const rec = await hkGlyph(ch);
    if (rec && rec.s && rec.s.length) recs.set(ch, rec);
  }));
  if (!cwGlyphGenAlive(gen)) return new Set();   // 等字形嗰陣已經被新一代取代
  const handled = new Set();
  // 逐格安裝，中間讓出主線程：以前呢個迴圈係同步一次過做晒所有字，
  // 筆順數字量度（strokeThickness）令 48 字卡住主線程 ~5.5s，成頁假死。
  // 依家每格之後按需讓出，數字逐字浮現，輸入／捲動全程可用；最終 DOM 完全一樣。
  for (const el of els) {
    const rec = recs.get(el.dataset.ch);
    if (!rec) continue;
    const withNum = el.classList.contains('guide-glyph') && !!el.closest('.stroke-num-cell');
    const svg = hkGlyphSvg(rec, el.dataset.ch);
    if (!svg) continue;
    el.textContent = '';
    el.style.transform = '';           // font-based optical normalisation not needed
    el.appendChild(svg);
    if (withNum) {
      paintGlyphInk(svg);   // 示範格：墨跡按筆序上色（彩虹模式）／淡粉紅（單色）
      // per-cell flags：第一示範格跟示範格格式，其餘格跟練習格格式（唔可以讀全局 currentOptions）
      const cellEl = el.closest('.stroke-num-cell');
      const { arrow: wantArrow, num: wantNum } = cellTraceFlags(cellEl);
      if (wantArrow) {
        appendStrokeArrows(svg, rec.m, svg._glyphMeta.C, svg._glyphMeta.box);
      }
      if (wantNum) {
        const okNum = await addGlyphNumbersAsync(svg, (cellEl && cellEl.classList.contains('article-cell')) ? (parseFloat(cellEl.dataset.artScale) || 0.82) : 0, gen);   // 數字最上層
        if (!okNum) return handled;   // 已被新一代取代：停
      }
    }
    handled.add(el.dataset.ch);
    await yieldIfNeeded(100);
    if (!cwGlyphGenAlive(gen)) return handled;   // 已被新一代取代：停
  }
  return handled;
}

function _hwCharData(ch) {
  if (_hwCharCache.has(ch)) return _hwCharCache.get(ch);
  const p = HanziWriter.loadCharacterData(ch)
    .then(d => applyHKOrder(ch, d))
    .catch(() => null);
  _hwCharCache.set(ch, p);
  return p;
}

// Measure one HanziWriter character's geometry (bbox + medians + per-stroke
// thickness). Pure function of `data`; cached per char so repeated cells reuse
// it. Yields every 4 strokes — strokeThickness is ~7–12ms per stroke.
async function measureHwGeom(data, gen) {
  const probe = probeSvg();
  let hwX0 = Infinity, hwY0 = Infinity, hwX1 = -Infinity, hwY1 = -Infinity;
  const medPolys = [];
  const hwThick = [];   // per-stroke true thickness (2*Area/Perimeter), HW 1024-space
  let t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  // Number anchor = a point on the stroke's MEDIAN (true centreline). HW `strokes` are
  // closed ink contours — their geometric midpoint can land on a stroke tip, so the
  // centreline (medians, already reordered to HK order) is used instead.
  try {
    for (let si = 0; si < data.strokes.length; si++) {
      const d = data.strokes[si];
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d); probe.appendChild(p);
      const b = p.getBBox();
      let th = strokeThickness(p);
      if (!(th > 0)) th = Math.min(b.width, b.height);
      hwThick.push(th);
      hwX0 = Math.min(hwX0, b.x); hwY0 = Math.min(hwY0, b.y);
      hwX1 = Math.max(hwX1, b.x + b.width); hwY1 = Math.max(hwY1, b.y + b.height);
      const med = data.medians && data.medians[si];
      if (med && med.length > 1) {
        medPolys.push(med);
      } else {
        let pt;
        try {
          const len = p.getTotalLength();
          pt = p.getPointAtLength(len * 0.5);
        } catch (e) {
          pt = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }
        medPolys.push([[pt.x, pt.y], [pt.x, pt.y]]);
      }
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (now - t0 >= 40) {
        await yieldUI(); t0 = now;
        if (!cwGlyphGenAlive(gen)) return null;   // 已被新一代取代：停
      }
    }
  } finally {
    probe.remove();
  }
  return { hwX0, hwY0, hwX1, hwY1, medPolys, hwThick };
}

// Inject numbered SVG strokes into a .stroke-num-cell.
// The SVG lives INSIDE the .guide-glyph span, so it tracks the glyph's own box
// (font-size driven) in EVERY media — screen px map, print cm, any size — with
// no pixel measurement. Numbers are placed in HanziWriter's 1024-space via the
// viewBox; preserveAspectRatio=meet fits them to the (square, CJK) glyph box.
async function overlayStrokeNum(cell, gen) {
  const ch = cell.dataset.ch;
  if (!ch) return;
  const data = await _hwCharData(ch);
  if (!data || !data.strokes || !data.strokes.length) return;
  if (!cwGlyphGenAlive(gen)) return;   // 等資料嗰陣已經被新一代取代

  const glyph = cell.querySelector('.guide-glyph');
  if (!glyph) return;

  // --- 1. measure HanziWriter stroke bbox + number anchors (in HW 1024-space) ---
  // （每字量度一次，多格／多次生成重用；量度本身按筆分段讓出。）
  let geom = _hwGeomCache.get(ch);
  if (!geom) {
    geom = await measureHwGeom(data, gen);
    if (!geom) return;   // 已被新一代取代：唔入快取，唔畫 overlay
    _hwGeomCache.set(ch, geom);
  }
  const { hwX0, hwY0, hwX1, hwY1, medPolys, hwThick } = geom;

  // --- 2. build overlay SVG (viewBox = HW bbox + padding) ---
  const hwW = hwX1 - hwX0, hwH = hwY1 - hwY0;
  if (!hwW || !hwH) return;  // degenerate stroke data
  // HW fallback 墨跡：下面會用 HW 逐筆路徑做可見墨跡，呢度先隱藏字型底字，免得雙重墨跡。
  // 用 color:transparent 而唔係清走 textContent——.stroke-num-svg 係 absolute 100%，唔似
  // .hk-glyph-svg 咁係 in-flow 1em；清走文字會令 span 縮到 0，成個 overlay 一齊消失。
  // 文字留喺度（透明）繼續撐起 span 尺寸，overlay 對位同之前完全一樣。淨係呢個示範格受影響。
  glyph.style.color = 'transparent';
  const pad = 0.06 * Math.max(hwW, hwH);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'stroke-num-svg');
  svg.setAttribute('viewBox', `${hwX0 - pad} ${hwY0 - pad} ${hwW + 2 * pad} ${hwH + 2 * pad}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');

  const numFontSize = Math.max(40, Math.min(80, hwH * 0.13));
  // HanziWriter ships y-UP data while this overlay draws into the SVG's y-down space,
  // so the whole number layer used to come out vertically MIRRORED against the font
  // glyph (measured: row-profile correlation 0.357 aligned vs 0.622 flipped, 噠) —
  // numbers landed on the wrong strokes. Mirror about the ink bbox, exactly like the
  // HK-glyph path does with C = y0 + y1.
  const flipC = hwY0 + hwY1;
  // --- 2a. HW 逐筆墨跡（2026-11-16 彩虹 fallback）：HW 每筆本身係獨立路徑，呢度畫出嚟做可見墨跡，
  // 每筆按筆序上色（paintStrokeEl：彩虹→6 色循環，單色→清除 inline fill，回復 CSS 嘅 guide-tint）。
  // HW 係 y-UP 數據，包喺 <g transform> 入面用同一 flipC 鏡像（同 hkGlyphSvg 嘅 translate(0,C) scale(1,-1) 同款，
  // 亦係數字／箭咀用嘅鏡像），墨跡同數字對齊。畫喺最底層（箭咀／數字之前），等數字喺最上層。
  // data-stroke-i 令 rainbow toggle（applyRainbowColors）即時重上色，唔使改 toggle。
  const inkG = document.createElementNS(NS, 'g');
  inkG.setAttribute('transform', `translate(0, ${flipC}) scale(1, -1)`);
  for (let si = 0; si < data.strokes.length; si++) {
    const ip = document.createElementNS(NS, 'path');
    ip.setAttribute('d', data.strokes[si]);
    ip.setAttribute('class', 'hk-glyph-stroke');
    ip.setAttribute('data-stroke-i', si);
    paintStrokeEl(ip, si);
    inkG.appendChild(ip);
  }
  svg.appendChild(inkG);
  // per-cell flags（同 installHKGlyphs 一致）：唔可以讀全局 currentOptions
  const { arrow: wantArrow, num: wantNum } = cellTraceFlags(cell);
  // 方向箭咀（同一 flip 修正）先畫，數字後畫 = 數字喺最上層
  if (wantArrow) {
    appendStrokeArrows(svg, medPolys, flipC, Math.max(hwW, hwH));
  }
  if (!wantNum) { glyph.appendChild(svg); return; }
  // Uniform number size per character (2026-11-17): one MEDIAN HW thickness
  // for the whole character — same rule as the EDB path (no per-stroke variation).
  const hwMedianThick = medianOf(hwThick.filter(t => t > 0));
  placeNumberLabels(medPolys, { fs: numFontSize, C: flipC }, {
    // Same rule as the EDB path: circle D ~1.1x the character's MEDIAN true
    // thickness — uniform within the character (2026-11-17).
    size: (i, digitCount) => {
      // 文章稀疏版面：數字固定為格闊 8%，唔跟筆畫粗幼 cap。
      if (cell.classList.contains('article-cell')) return articleNumFs(hwW + 2 * pad, parseFloat(cell.dataset.artScale) || 0.82);
      if (!(hwMedianThick > 0)) return numFontSize;
      const thick = hwMedianThick;
      const fsEff = numFontSize * numberBaseScale(medPolys.length);
      const byHeight = 0.92 * thick;
      const byWidth = 2.27 * thick / Math.max(digitCount, 1);
      return Math.max(26, Math.min(fsEff, byHeight, byWidth));
    },
  }).forEach(p => {
    appendNumberLabel(svg, p, numFontSize);
  });

  glyph.appendChild(svg);
}
// ===== 筆順數字／箭咀顏色（2026-11-16 彩虹筆順） =====
// 單色模式（預設）：全部用紅 #C0392B。彩虹模式：按筆序循環 6 色。
// 圓圈白底＋彩色邊、數字同色、筆尾實色三角箭咀同色；虛線中線保留，彩虹模式用嗰筆嘅色。
// 開關存在 localStorage "cw.rainbow"（"1" = 彩虹，"0" / 無 = 單色），見 index.html 嘅 rainbowToggle。
const STROKE_NUM_RED = '#C0392B';
const RAINBOW_COLORS = ['#E91E63', '#43A047', '#F9A825', '#1E88E5', '#8E24AA', '#00897B'];
function cwRainbowOn() {
  try { return localStorage.getItem('cw.rainbow') === '1'; } catch (e) { return false; }
}
function strokeNumColor(i) {
  return cwRainbowOn() ? RAINBOW_COLORS[((i % RAINBOW_COLORS.length) + RAINBOW_COLORS.length) % RAINBOW_COLORS.length] : STROKE_NUM_RED;
}
// 按元素種類上色（inline style，贏過 CSS 嘅預設紅色）：
// circle → 邊色，text → 字色，.stroke-arrow（虛線）→ 線色，.stroke-arrow-head → 實色，
// .hk-glyph-stroke（字形墨跡）→ 填色。
// 2026-11-16 1:1 復刻 hanziwu：彩虹模式之下，中線圓點同筆尾三角箭咀變白（白點／白三角
// 喺彩色筆畫上），字形墨跡本身按筆序上色（紅底變彩色）；單色模式全部維持原樣
// （紅數字／紅箭咀／紅虛線／淡粉紅底字）。
function paintStrokeEl(el, i) {
  if (!el) return;
  const c = strokeNumColor(i);
  const rainbow = cwRainbowOn();
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'circle') el.style.stroke = c;
  else if (tag === 'text') el.style.fill = c;
  else if (el.classList && el.classList.contains('stroke-arrow')) {
    el.style.stroke = rainbow ? '#fff' : c;
    el.style.strokeOpacity = rainbow ? '1' : '';
  } else if (el.classList && el.classList.contains('stroke-arrow-head')) {
    el.style.fill = rainbow ? '#fff' : c;
  } else if (tag === 'path' && el.classList && el.classList.contains('hk-glyph-stroke')) {
    el.style.fill = rainbow ? c : '';
  }
}
// 示範格嘅字形墨跡按筆序上色（hanziwu 1:1：筆畫本身就係彩色）。
// 淨係示範格（.stroke-num-cell）先有 data-stroke-i 嘅墨跡路徑；練習格／句子格
// 保持淡粉紅描紅底字。單色模式：清除 inline fill，回復 CSS currentColor。
function paintGlyphInk(svg) {
  const meta = svg && svg._glyphMeta;
  if (!meta || !meta.strokeEls) return;
  meta.strokeEls.forEach((p, i) => {
    p.setAttribute('class', 'hk-glyph-stroke');
    p.setAttribute('data-stroke-i', i);
    paintStrokeEl(p, i);
  });
}
// Toggle 之後即時更新畫面上所有已畫好嘅數字圓圈／數字／箭咀／示範格墨跡顏色（唔使重新生成工作紙）。
// 元素創建時會寫 data-stroke-i（0-based 筆序），呢度照返佢上色。
function applyRainbowColors(root) {
  const scope = root || document;
  if (!scope || !scope.querySelectorAll) return;
  scope.querySelectorAll('.hk-glyph-svg [data-stroke-i], .stroke-num-svg [data-stroke-i]').forEach(el => {
    const i = parseInt(el.getAttribute('data-stroke-i'), 10);
    paintStrokeEl(el, isNaN(i) ? 0 : i);
  });
}
// 每筆中線 + 筆尾箭咀（顯示書寫方向），同筆順數字共用一個 SVG / 座標系。
// medians 係 stored y-UP 空間（EDB rec.m ／ HanziWriter medians），display y = C - y。
// 尺寸全部按墨跡 box 比例計 → 螢幕/列印/任何字級自動跟住縮放。
function appendStrokeArrows(svg, medians, C, box) {
  if (!svg || !medians || !medians.length || !(box > 0)) return;
  const w = box * 0.014;                                   // 線粗（亦係圓點直徑）2026-11-16：白點縮細
  const dots = `0 ${(box * 0.05).toFixed(1)}`;            // 密點線：0 長度 dash + round cap = 圓點（2026-11-16：白點再疏啲）
  const headL = box * 0.028, headW = box * 0.013;          // 箭頭長 / 半闊（2026-11-16：箭咀再縮細）
  medians.forEach((med, i) => {
    if (!med || med.length < 2) return;
    const pts = med.map(p => [p[0], C - p[1]]);
    const pl = document.createElementNS(NS, 'polyline');
    pl.setAttribute('class', 'stroke-arrow');
    pl.setAttribute('points', pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '));
    pl.setAttribute('stroke-width', w.toFixed(1));
    pl.setAttribute('stroke-dasharray', dots);
    pl.setAttribute('data-stroke-i', i);
    paintStrokeEl(pl, i);
    svg.appendChild(pl);
    const [ax, ay] = pts[pts.length - 1];
    const [bx, by] = pts[pts.length - 2];
    let dx = ax - bx, dy = ay - by;
    const len = Math.hypot(dx, dy);
    if (!len || !isFinite(len)) return;
    dx /= len; dy /= len;
    const nx = -dy, ny = dx;
    const d = `M${(ax - dx * headL + nx * headW).toFixed(1)},${(ay - dy * headL + ny * headW).toFixed(1)}`
            + ` L${ax.toFixed(1)},${ay.toFixed(1)}`
            + ` L${(ax - dx * headL - nx * headW).toFixed(1)},${(ay - dy * headL - ny * headW).toFixed(1)} Z`;
    const head = document.createElementNS(NS, 'path');
    head.setAttribute('class', 'stroke-arrow-head');
    head.setAttribute('d', d);
    head.setAttribute('data-stroke-i', i);
    head.style.fillOpacity = '1';   // 實色箭咀（唔再半透明）
    paintStrokeEl(head, i);
    svg.appendChild(head);
  });
}

function strokeCountOf(ch) {
  const seq = strokeSeqInfo(ch);
  // 教育局字形已載入時，一律以字形真實筆數為準（CHAR_DB.s 曾用 Unihan 大陸標準，
  // 對 EDB 字可以差 1–6 筆：辶 3/4、艹 3/4、阝 2/3、糹 3/6、麵 20/15 …）。
  const rec = _hkGlyphData.get(ch);
  if (rec && rec.s && rec.s.length) return { count: rec.s.length, seq };
  const db = (window.CHAR_DB || {})[ch];
  const n = db && db.s ? db.s : (seq ? seq.count : 0);
  if (!n) return null;
  return { count: n, seq };
}

function strokePageHtml(o) {
  if (!o.strokePage || o.layout === 'sentence' || !currentChars.length) return '';
  let rows = '';
  let total = 0;
  currentChars.forEach(ch => {
    if (isPunct(ch)) return;
    const info = strokeCountOf(ch);
    if (!info) return;
    total++;
    const db = (window.CHAR_DB || {})[ch] || {};
    const meta = [];
    if (o.canto && db.jy) meta.push(db.jy);
    if (o.pinyin && db.py) meta.push(db.py);
    let cells = '';
    for (let k = 1; k <= info.count; k++) {
      cells += `<div class="practice-cell stroke-step-cell" data-step-ch="${esc(ch)}" data-step-k="${k}">`
        + guideSvg((k - 1) % 3)
        + `<span class="guide-char"><span class="step-glyph">${esc(ch)}</span></span>`
        + `</div>`;
    }
    rows += `<div class="stroke-page-block">`
      + `<div class="stroke-caption">✍️ ${esc(ch)}`
      + `<span class="stroke-meta">（共 ${info.count} 筆${meta.length ? ' · ' + esc(meta.join(' / ')) : ''}）</span>`
      + (info.seq ? `<span class="seq-names-inline">${esc(info.seq.names)}</span><span class="seq-src">次序來源：漢典 zdic.net</span>` : '')
      + `</div><div class="practice-row stroke-page-row">${cells}</div></div>`;
  });
  if (!total) return '';
  return `<div class="stroke-page"><div class="stroke-page-title">🖊️ 筆順工作紙</div>${rows}</div>`;
}

/** 墨跡框（用離屏 probe 量 paths 嘅 union bbox）+ 翻轉軸 C + 方形 viewBox。
 * 框本身由 glyphInkBBox 量（唔好再複製一次量 bbox 嘅迴圈）。 */
function measureInkFrame(paths) {
  let b;
  try {
    b = glyphInkBBox(paths);
  } catch (e) { return null; }
  if (!b) return null;
  const { x0, y0, x1, y1 } = b;
  const box = Math.max(x1 - x0, y1 - y0);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return {
    box, C: y0 + y1,
    viewBox: `${(cx - box / 2).toFixed(1)} ${(cy - box / 2).toFixed(1)} ${box.toFixed(1)} ${box.toFixed(1)}`,
  };
}

/** 只畫前 k 筆嘅 SVG（geometry 同 hkGlyphSvg 一致：g 內 translate(0,C) scale(1,-1)）。 */
function partialGlyphSvg(paths, frame, k) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'hk-glyph-svg step-svg');
  svg.setAttribute('viewBox', frame.viewBox);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('transform', `translate(0,${frame.C.toFixed(1)}) scale(1,-1)`);
  const els = [];
  for (let i = 0; i < Math.min(k, paths.length); i++) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', paths[i]);
    g.appendChild(p);
    els.push(p);
  }
  svg.appendChild(g);
  return { svg, lastEl: els[els.length - 1] || null };
}

// 新增嗰筆嘅編號。⚠️ 一定要喺 SVG append 落 DOM 之後才做 —— isPointInFill() 對
// detached 節點永遠回 false（skill 有記錄），會令「貼住自己筆畫」嘅判斷静默失效。
// 參數由 6 個收成一個物件（原 svg/lastEl/frame/k/med/totalStrokes = Long Parameter List）
function addStepNumber(svg, { lastEl, frame, k, med, totalStrokes }) {
  if (!lastEl || !med) return;
  const fs = frame.box * 0.14 * numberBaseScale(totalStrokes || k);
  let chosen = null, onInkFound = false;
  for (const f of [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8]) {   // 2026-11-16：由起筆處開始
    const pt = medianPtAt(med, f);
    if (!pt) continue;
    const cx = pt.x, cy = frame.C - pt.y;
    if (!chosen) chosen = { cx, cy };
    let onInk = false;
    try { onInk = lastEl.isPointInFill(new DOMPoint(cx, frame.C - cy)); } catch (e) { onInk = true; }
    if (onInk) { chosen = { cx, cy }; onInkFound = true; break; }
  }
  if (!onInkFound) {
    // 中線全部落唔到墨跡（幼點/短筆）→ 喺最後一筆嘅 bbox 掃一個保證喺墨跡內嘅點
    try {
      const b = lastEl.getBBox();
      for (let i = 1; i <= 6 && !onInkFound; i++) {
        for (let j = 1; j <= 6; j++) {
          const sx = b.x + b.width * (i / 7), sy = b.y + b.height * (j / 7);
          let ok = false;
          try { ok = lastEl.isPointInFill(new DOMPoint(sx, sy)); } catch (e) { ok = true; }
          if (ok) { chosen = { cx: sx, cy: frame.C - sy }; onInkFound = true; break; }
        }
      }
    } catch (e) { /* 用中線嘅第一個候選 */ }
  }
  if (!chosen) return;
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', chosen.cx.toFixed(1));
  t.setAttribute('y', (chosen.cy - fs * 0.18).toFixed(1));
  t.setAttribute('font-size', fs.toFixed(1));
  t.textContent = String(k);
  svg.appendChild(t);
  centerNumText(t, chosen.cx, chosen.cy - fs * 0.18);   // 數字墨跡置中
}
