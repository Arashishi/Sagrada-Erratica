/* ==========================================================
   Sagrada Erratica — Self-Healing Patches
   ----------------------------------------------------------
   ・image01.jpg と最後の imageXX.jpg は「静止スライド」（パッチなし）
   ・中間の画像だけ、ランダムなパッチ欠損 → 徐々に修復
   ・PC: ← / → で前後移動
   ・スマホ/PC: 画面タップでも前後移動
   ・モバイル判定は一切なし（PC／スマホで同じ動作）
   ========================================================== */


/* ===============================
   ▼ 調整エリア（ここだけいじればOK）
   =============================== */

// ●読み込む画像の枚数
//   image01.jpg 〜 imageXX.jpg を置いた枚数に合わせる
const IMG_COUNT = 13;

// ●フレームレート
//   数字を上げると動きがなめらかになるが重くなる
let FPS = 30;          // 目安：20〜40くらい

// ●背景色（0=黒, 255=白）
const BG_COLOR = 0;

// ●パッチが出現する「間隔」と「数」
//   ・PATCH_INTERVAL_FRAMES … 大きいほどゆっくり出てくる
//   ・PATCHES_MAX_PER_TICK   … 一度に出てくる最大個数
let PATCH_INTERVAL_FRAMES = 120;  // 例：50なら1〜2秒に1回くらい
let PATCHES_MIN_PER_TICK  = 1;
let PATCHES_MAX_PER_TICK  = 3;   // 2にすると少しにぎやかになる

// ●パッチの大きさ（元画像のピクセル単位）
//   ・大きいとダイナミック、小さいと「細胞っぽい」感じ
let PATCH_MIN = 30;   // 最小サイズ
let PATCH_MAX = 60;   // 最大サイズ

// ●壊れる／戻るスピード（フレーム数）
//   ・数字が大きいほどゆっくり変化する
const DECAY_FRAMES   = 1250;   // 壊れていくのにかける時間
const RESTORE_FRAMES = 1450;   // 修復にかける時間

// ●欠損表現（どれくらい暗く／どれくらいザラザラさせるか）
const DECAY_DARKEN_MAX = 25;   // 暗くする量（0〜50くらいが目安）
const DECAY_NOISE_MAX  = 5;    // ノイズの強さ（0でノイズなし）

// ●修復時の「Photoshop パッチツールっぽさ」
//   ・REPAIR_NEIGHBOR_WEIGHT … 周囲の情報の寄り具合
//   ・REPAIR_ORIGINAL_WEIGHT … 元の画素の寄り具合
//   合計がだいたい1になるようにする
const REPAIR_NEIGHBOR_WEIGHT = 0.1;  // 上げると「周囲から持ってきた」感じが強くなる
const REPAIR_ORIGINAL_WEIGHT = 0.9;  // 上げるとオリジナル寄りで安定する

// ●修復時の色のズレ（違和感の微調整）
//   ・0に近いほどオリジナルに忠実
const REPAIR_CHROMA_DRIFT  = 0.004;   // 0.0〜0.01くらいを目安

// ●縫い目（パッチのフチ）の残し具合
//   ・0 にすると縫い目なし（自然）
//   ・大きくすると「貼り合わせ」感が出る
const REPAIR_SEAM_STRENGTH = 0.05;    // 0〜0.1くらい

// ●アルファブレンドのちょっとしたバイアス
//   ・基本 0 でOK。変な滲みが欲しい時だけいじる
const REPAIR_BLEND_BIAS = 0.0;

// ●自動で次のスライドに進めるかどうか
const AUTO_ADVANCE = false;           // true にすると自動再生
const AUTO_SECONDS = 60;              // 1枚あたりの表示秒数



/* ===============================
   ▼ 内部変数（基本いじらない）
   =============================== */

let originals = new Array(IMG_COUNT); // 元画像
let workImg   = null;                 // パッチをかける作業用画像
let curr      = 0;                    // 現在インデックス（0〜IMG_COUNT-1）
let frameLocal= 0;                    // その画像での経過フレーム
let patches   = [];                   // アクティブなパッチたち
let fitCache  = null;                 // 画面フィット用の計算結果
let isLoading = false;                // 読み込み中フラグ


// =========================
// ▶ index からファイル名を作る
// =========================
function filenameForIndex(idx){
  return `image${String(idx+1).padStart(2,'0')}.jpg`;
}


// =========================
// ▶ setup：最初に1回だけ呼ばれる
// =========================
function setup(){
  createCanvas(windowWidth, windowHeight);
  frameRate(FPS);
  pixelDensity(1);
  background(BG_COLOR);

  // 最初の1枚だけ読み込む
  loadCurrentIfNeeded();
}


// =========================
// ▶ 必要になった画像だけ読み込む（遅延読み込み）
// =========================
function loadCurrentIfNeeded(){
  if (originals[curr]) {
    prepareFromCurrent();
    return;
  }

  isLoading = true;
  workImg   = null;

  const name = filenameForIndex(curr);
  console.log("loading:", name);

  loadImage(
    name,
    img => {
      originals[curr] = img;
      isLoading = false;
      prepareFromCurrent();
    },
    () => {
      console.error("FAILED:", name);
      isLoading = false;
      workImg = null;
    }
  );
}


// =========================
/* ▶ 現在の画像をパッチ用に準備する  */
// =========================
function prepareFromCurrent(){
  const src = originals[curr];
  if (!src) return;

  src.loadPixels();

  // 作業用画像（ここに欠損／修復をかける）
  workImg = createImage(src.width, src.height);
  workImg.loadPixels();
  for (let i=0; i<src.pixels.length; i++){
    workImg.pixels[i] = src.pixels[i];
  }
  workImg.updatePixels();

  patches    = [];
  frameLocal = 0;

  // 画面フィットの計算
  computeFit(src.width, src.height, width, height);
}


// =========================
// ▶ メインループ
// =========================
function draw(){
  background(BG_COLOR);

  if (isLoading || !workImg){
    // 読み込み中は「Loading...」だけ表示
    fill(200);
    textAlign(CENTER, CENTER);
    textSize(16);
    text("Loading...", width/2, height/2);
    return;
  }

  // 1枚目・最後の1枚は静止
  const staticSlide = (curr === 0 || curr === IMG_COUNT - 1);

  // workImg に対してパッチ更新
  if (!staticSlide){
    // 一定フレームごとに新しいパッチを生む
    if (frameCount % PATCH_INTERVAL_FRAMES === 0){
      const num = int(random(PATCHES_MIN_PER_TICK, PATCHES_MAX_PER_TICK + 1));
      for(let i=0; i<num; i++) spawnPatch();
    }
    updatePatches();
  } else {
    // タイトル／コンセプトなどの静止スライドではパッチなし
    patches = [];
  }

  // パッチが適用された workImg を画面に描画
  drawFit(workImg);

  // 自動遷移オプション
  frameLocal++;
  if (AUTO_ADVANCE && frameLocal >= AUTO_SECONDS * FPS){
    gotoNext();
  }
}


// =========================
// ▶ スライド切り替え
// =========================
function gotoNext(){
  curr = (curr + 1) % IMG_COUNT;
  loadCurrentIfNeeded();
}
function gotoPrev(){
  curr = (curr - 1 + IMG_COUNT) % IMG_COUNT;
  loadCurrentIfNeeded();
}


// =========================
// ▶ パッチ生成（位置・サイズだけ決める）
// =========================
function spawnPatch(){
  if (!workImg) return;

  const w = workImg.width;
  const h = workImg.height;

  const pw = int(random(PATCH_MIN, PATCH_MAX));
  const ph = int(random(PATCH_MIN, PATCH_MAX));
  const x  = int(random(0, w - pw));
  const y  = int(random(0, h - ph));

  patches.push({
    x, y,
    w: pw,
    h: ph,
    t: 0,
    phase: "decay"   // "decay" → "restore"
  });
}


// =========================
// ▶ パッチ更新（壊れる→戻る）
// =========================
function updatePatches(){
  if (!workImg) return;

  for (let i = patches.length - 1; i >= 0; i--){
    const p = patches[i];

    if (p.phase === "decay"){
      const k = constrain(p.t / DECAY_FRAMES, 0, 1);
      decayPatch(workImg, p.x, p.y, p.w, p.h, k);
      p.t++;
      if (p.t >= DECAY_FRAMES){
        p.phase = "restore";
        p.t = 0;
      }
    } else {
      const k = constrain((p.t / RESTORE_FRAMES) + REPAIR_BLEND_BIAS, 0, 1);
      restorePatchFromOriginal(workImg, originals[curr], p.x, p.y, p.w, p.h, k);
      p.t++;
      if (p.t >= RESTORE_FRAMES){
        patches.splice(i, 1);
      }
    }
  }
}


// =========================
// ▶ 欠損処理（暗くして少しノイズ）
// =========================
function decayPatch(img, x, y, w, h, k){
  img.loadPixels();

  const W = img.width;
  const H = img.height;

  const dark     = DECAY_DARKEN_MAX * k;
  const noiseAmp = DECAY_NOISE_MAX * k;

  for(let yy = y; yy < y + h; yy++){
    if (yy < 0 || yy >= H) continue;
    for(let xx = x; xx < x + w; xx++){
      if (xx < 0 || xx >= W) continue;

      const i = 4 * (yy * W + xx);

      // 暗くする
      img.pixels[i  ] = max(0, img.pixels[i  ] - dark);
      img.pixels[i+1] = max(0, img.pixels[i+1] - dark);
      img.pixels[i+2] = max(0, img.pixels[i+2] - dark);

      // うっすらノイズ
      if (noiseAmp > 0){
        const n = (Math.random()*2 - 1) * noiseAmp;
        img.pixels[i  ] = constrain(img.pixels[i  ] + n, 0, 255);
        img.pixels[i+1] = constrain(img.pixels[i+1] + n, 0, 255);
        img.pixels[i+2] = constrain(img.pixels[i+2] + n, 0, 255);
      }
    }
  }

  img.updatePixels();
}


// =========================
// ▶ 修復処理（周囲＋元画素ブレンド）
// =========================
function restorePatchFromOriginal(dest, src, x, y, w, h, alpha){
  dest.loadPixels();
  src.loadPixels();

  const Wd = dest.width;
  const Hd = dest.height;
  const Ws = src.width;
  const Hs = src.height;

  // 「周囲から持ってくる」ためのランダムなオフセット
  const offX = int(random(-w * 0.5, w * 0.5));
  const offY = int(random(-h * 0.5, h * 0.5));

  for (let yy = 0; yy < h; yy++){
    const dy = y + yy;
    if (dy < 0 || dy >= Hd) continue;

    for (let xx = 0; xx < w; xx++){
      const dx = x + xx;
      if (dx < 0 || dx >= Wd) continue;

      const di = 4 * (dy * Wd + dx);   // dest 用インデックス

      // 周囲（neighbor）からサンプリングする座標（src の座標）
      let nx = dx + offX;
      let ny = dy + offY;
      nx = constrain(nx, 0, Ws - 1);
      ny = constrain(ny, 0, Hs - 1);
      const ni = 4 * (ny * Ws + nx);

      let nr = src.pixels[ni  ];
      let ng = src.pixels[ni+1];
      let nb = src.pixels[ni+2];

      // ごくわずかに色ズレ（違和感）
      if (REPAIR_CHROMA_DRIFT > 0){
        nr = constrain(nr * (1 + REPAIR_CHROMA_DRIFT*0.6), 0, 255);
        ng = constrain(ng * (1 - REPAIR_CHROMA_DRIFT*0.3), 0, 255);
        nb = constrain(nb * (1 - REPAIR_CHROMA_DRIFT*0.6), 0, 255);
      }

      // その場所の本来の画素（original）
      const oi = 4 * (dy * Ws + dx);
      const or = src.pixels[oi  ];
      const og = src.pixels[oi+1];
      const ob = src.pixels[oi+2];

      // 周囲とオリジナルをブレンド
      const br = nr * REPAIR_NEIGHBOR_WEIGHT + or * REPAIR_ORIGINAL_WEIGHT;
      const bg = ng * REPAIR_NEIGHBOR_WEIGHT + og * REPAIR_ORIGINAL_WEIGHT;
      const bb = nb * REPAIR_NEIGHBOR_WEIGHT + ob * REPAIR_ORIGINAL_WEIGHT;

      // 元の壊れた画素とアルファでブレンドして戻す
      const a = constrain(alpha, 0, 1);
      dest.pixels[di  ] = dest.pixels[di  ] * (1 - a) + br * a;
      dest.pixels[di+1] = dest.pixels[di+1] * (1 - a) + bg * a;
      dest.pixels[di+2] = dest.pixels[di+2] * (1 - a) + bb * a;
    }
  }

  dest.updatePixels();
}


// =========================
// ▶ 画面にフィットさせて画像を描画
// =========================
function computeFit(iw, ih, cw, ch){
  const s = Math.min(cw/iw, ch/ih);
  fitCache = {
    dw: iw * s,
    dh: ih * s,
    ox: (cw - iw * s) * 0.5,
    oy: (ch - ih * s) * 0.5
  };
}

function drawFit(img){
  if (!fitCache) computeFit(img.width, img.height, width, height);
  const {dw, dh, ox, oy} = fitCache;
  image(img, ox, oy, dw, dh);
}


// =========================
// ▶ 入力（キー・クリック・タップ）
// =========================
function keyPressed(){
  if (keyCode === RIGHT_ARROW) gotoNext();
  if (keyCode === LEFT_ARROW)  gotoPrev();
}

function mousePressed(){
  if (mouseX > width / 2) gotoNext();
  else gotoPrev();
}

function touchStarted(){
  if (touches.length > 0){
    if (touches[0].x > width / 2) gotoNext();
    else gotoPrev();
  }
}

function windowResized(){
  resizeCanvas(windowWidth, windowHeight);
  if (workImg){
    computeFit(workImg.width, workImg.height, width, height);
  }
}
