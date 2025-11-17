/* ==========================================================
   Sagrada Erratica — Self-Healing Patches
   ----------------------------------------------------------
   ・image01.jpg と最後の imageXX.jpg は「静止スライド」（パッチ処理なし）
   ・中間の画像だけ、ランダムなパッチ欠損 ＋ 自己修復
   ・PC: ← / → で前後移動
   ・スマホ/PC: 画面タップでも前後移動
   ========================================================== */

// =========================
// ▶ 環境判定（モバイル判定）
// =========================
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobi/i.test(
  navigator.userAgent || ""
);

// =========================
// ▶ 調整パネル（ここだけ触ればOK）
// =========================

// 読み込む画像（ゼロ埋めで配置：image01.jpg, image02.jpg, ...）
const IMG_COUNT = 20;            // 実際に置く枚数に合わせて変更

// 表示や時間まわり
let FPS        = IS_MOBILE ? 30 : 60; // モバイルは負荷軽減
const BG_COLOR = 0;                    // 背景（0=黒, 255=白）

// パッチ生成テンポ（※1枚目・最終枚には適用されない）
let PATCH_INTERVAL_FRAMES = IS_MOBILE ? 24 : 12; // モバイルは半分の頻度
let PATCHES_MIN_PER_TICK  = 1;                   // 1回のタイミングで生成するパッチ数の最小
let PATCHES_MAX_PER_TICK  = IS_MOBILE ? 2 : 4;   // モバイルは最大2個

// パッチのサイズ（画像ピクセル単位）
let PATCH_MIN = IS_MOBILE ? 20  : 30;   // 最小辺（モバイルは少し小さく）
let PATCH_MAX = IS_MOBILE ? 200 : 450;  // 最大辺（モバイルは大きくしすぎない）

// 欠損と修復の所要フレーム
const DECAY_FRAMES   = IS_MOBILE ? 24 : 30; // モバイルは少し早く壊して
const RESTORE_FRAMES = IS_MOBILE ? 12 : 15; // 少し早く戻す

// 欠損表現の強さ
const DECAY_DARKEN_MAX = 25;     // 最大暗化量（0〜255の加算的黒）
const DECAY_NOISE_MAX  = 5;      // ノイズの振れ幅（±）…全体にザラっとした感じを出す

// 不完全修復の“違和感”コントロール（少し Photoshop 寄り）
const REPAIR_CHROMA_DRIFT  = 0.004; // RGBのわずかな係数ズレ
const REPAIR_SEAM_STRENGTH = 0.05;  // パッチ縫い目の残り具合（0〜0.3）
const REPAIR_BLEND_BIAS    = 0.0;   // アルファに加える微小バイアス

// パッチ修復用：近傍 vs 元画像 の重み
const REPAIR_NEIGHBOR_WEIGHT = 0.33; // 周りの情報：これを上げるとよりPhotoshop寄り
const REPAIR_ORIGINAL_WEIGHT = 0.67; // 元の画素：これを上げるとオリジナル重視

// 自動遷移（不要なら false）
const AUTO_ADVANCE = false;
const AUTO_SECONDS = 60;         // 1枚あたりの目安秒数（AUTO_ADVANCE=true時のみ有効）

// =========================
// ▶ 内部変数（触らない）
// =========================
let originals = [];              // 元画像（読み取り専用）
let workImg   = null;            // 表示用（ここだけ欠損/修復をかける）
let curr      = 0;               // 現在インデックス（0〜IMG_COUNT-1）
let frameLocal= 0;               // その画像での経過フレーム
let patches   = [];              // アクティブなパッチ配列
let fitCache  = null;            // 描画フィット用キャッシュ

// 1枚目・最終枚を「静止スライド」にするための判定
function isStaticIndex(i){
  return i === 0 || i === (IMG_COUNT - 1);
}

// =========================
// ▶ 画像のプリロード（ゼロ埋め固定）
// =========================
function preload(){
  originals = [];
  for(let i=1; i<=IMG_COUNT; i++){
    const name = `image${String(i).padStart(2,'0')}.jpg`; // image01.jpg, image02.jpg, ...
    const img = loadImage(
      name,
      () => console.log('loaded:', name),
      () => console.error('FAILED to load:', name)
    );
    originals.push(img);
  }
}

// =========================
// ▶ セットアップ
// =========================
function setup(){
  createCanvas(windowWidth, windowHeight);
  frameRate(FPS);
  pixelDensity(1);
  background(BG_COLOR);

  if (originals.length === 0){
    console.error('画像がありません。image01.jpg〜を同フォルダに置いてください。');
    noLoop();
    return;
  }
  prepareFromCurrent();
}

// =========================
// ▶ メインループ
// =========================
function draw(){
  // workImg がまだ準備できていないときは何もしない（真っ黒防止）
  if (!workImg){
    background(BG_COLOR);
    return;
  }

  background(BG_COLOR);

  const staticSlide = isStaticIndex(curr);

  if (!staticSlide){
    // 中間の写真だけ、パッチ生成＆更新を行う
    if (frameCount % PATCH_INTERVAL_FRAMES === 0){
      const numPatches = int(random(
        PATCHES_MIN_PER_TICK,
        PATCHES_MAX_PER_TICK + 1
      ));
      for(let n=0; n<numPatches; n++){
        spawnPatch();
      }
    }

    updatePatches();
  } else {
    // タイトル／コンセプトのスライドではパッチをクリアして完全静止
    patches = [];
  }

  // 表示
  drawFit(workImg);

  // 自動遷移（オプション）
  frameLocal++;
  if (AUTO_ADVANCE && frameLocal >= AUTO_SECONDS*FPS){
    gotoNext();
  }
}

// =========================
// ▶ 現在画像を準備（元画像→作業用コピー）
// =========================
function prepareFromCurrent(){
  const src = originals[curr];
  if (!src) return;

  src.loadPixels();

  // 表示用ワーク（ソースのコピー；ここだけ壊す）
  workImg = createImage(src.width, src.height);
  workImg.loadPixels();
  for (let i=0; i<src.pixels.length; i++){
    workImg.pixels[i] = src.pixels[i];
  }
  workImg.updatePixels();

  // パッチ初期化
  patches = [];
  frameLocal = 0;

  // フィット係数を計算
  computeFit(src.width, src.height, width, height);
}

// =========================
// ▶ 画像切り替え（前後）
// =========================
function gotoNext(){
  curr = (curr + 1) % originals.length;
  prepareFromCurrent();
}
function gotoPrev(){
  curr = (curr - 1 + originals.length) % originals.length;
  prepareFromCurrent();
}

// =========================
// ▶ パッチ生成（画像座標系で）
// =========================
function spawnPatch(){
  if (!workImg) return;
  const w = workImg.width;
  const h = workImg.height;
  const pw = int(random(PATCH_MIN, PATCH_MAX));
  const ph = int(random(PATCH_MIN, PATCH_MAX));
  const x  = int(random(0, max(1, w - pw)));
  const y  = int(random(0, max(1, h - ph)));

  patches.push({
    x, y, w: pw, h: ph,
    t: 0,            // 経過フレーム
    phase: 'decay'   // 'decay' → 'restore'
  });
}

// =========================
// ▶ パッチ更新
// =========================
function updatePatches(){
  for (let i = patches.length - 1; i >= 0; i--){
    const p = patches[i];
    if (p.phase === 'decay'){
      const k = constrain(p.t / DECAY_FRAMES, 0, 1); // 0→1
      decayPatch(workImg, p.x, p.y, p.w, p.h, k);
      p.t++;
      if (p.t >= DECAY_FRAMES){
        p.phase = 'restore';
        p.t = 0;
      }
    } else {
      const k = constrain((p.t / RESTORE_FRAMES) + REPAIR_BLEND_BIAS, 0, 1);
      restorePatchFromOriginal(workImg, originals[curr], p.x, p.y, p.w, p.h, k);
      p.t++;
      if (p.t >= RESTORE_FRAMES){
        patches.splice(i,1);
      }
    }
  }
}

// =========================
// ▶ 欠損処理：少し暗く＋ノイズ＋なじませブラー
// =========================
function decayPatch(img, x, y, w, h, k){
  if (!img) return;
  img.loadPixels();
  const W = img.width, H = img.height;

  const dark      = DECAY_DARKEN_MAX * k;
  const noiseAmp  = DECAY_NOISE_MAX * k;

  for(let yy=y; yy<y+h; yy++){
    if(yy<0||yy>=H) continue;
    for(let xx=x; xx<x+w; xx++){
      if(xx<0||xx>=W) continue;
      const i = 4*(yy*W + xx);
      // 暗化
      img.pixels[i  ] = max(0, img.pixels[i  ] - dark);
      img.pixels[i+1] = max(0, img.pixels[i+1] - dark);
      img.pixels[i+2] = max(0, img.pixels[i+2] - dark);
      // ノイズ
      if (noiseAmp > 0){
        const n = (Math.random()*2-1) * noiseAmp;
        img.pixels[i  ] = constrain(img.pixels[i  ] + n, 0, 255);
        img.pixels[i+1] = constrain(img.pixels[i+1] + n, 0, 255);
        img.pixels[i+2] = constrain(img.pixels[i+2] + n, 0, 255);
      }
    }
  }
  img.updatePixels();

  // 極薄の“なじませ”ブラー（1px横方向）
  boxBlurRect(img, x, y, w, h, 1);
}

// =========================
// ▶ 修復処理：周囲の情報をベースに、元の画素もブレンドする準・パッチツール
// =========================
function restorePatchFromOriginal(dest, src, x, y, w, h, alpha){
  if (!dest || !src) return;

  alpha = constrain(alpha, 0, 1);

  dest.loadPixels();
  src.loadPixels();

  const W = dest.width;
  const H = dest.height;

  // 「周囲から持ってくる」ためのオフセット
  const offRatioMax = 0.5;
  const offX = int(random(-w * offRatioMax, w * offRatioMax));
  const offY = int(random(-h * offRatioMax, h * offRatioMax));

  for (let yy = 0; yy < h; yy++){
    const dy = y + yy;
    if (dy < 0 || dy >= H) continue;

    for (let xx = 0; xx < w; xx++){
      const dx = x + xx;
      if (dx < 0 || dx >= W) continue;

      const di = 4 * (dy * W + dx);

      // --- 近傍（neighbor）をサンプリング ---
      const nx = constrain(dx + offX, 0, W - 1);
      const ny = constrain(dy + offY, 0, H - 1);
      const ni = 4 * (ny * W + nx);

      let nr = src.pixels[ni    ];
      let ng = src.pixels[ni + 1];
      let nb = src.pixels[ni + 2];

      // ごくわずかな色ドリフト
      if (REPAIR_CHROMA_DRIFT > 0){
        nr = constrain(nr * (1 + REPAIR_CHROMA_DRIFT*0.6), 0, 255);
        ng = constrain(ng * (1 - REPAIR_CHROMA_DRIFT*0.3), 0, 255);
        nb = constrain(nb * (1 - REPAIR_CHROMA_DRIFT*0.6), 0, 255);
      }

      // --- 本来その場所にあるべき元画素（original） ---
      const or = src.pixels[di    ];
      const og = src.pixels[di + 1];
      const ob = src.pixels[di + 2];

      // 周囲とオリジナルをブレンド（Photoshop寄り/元画像寄りの中間）
      const br =
        nr * REPAIR_NEIGHBOR_WEIGHT + or * REPAIR_ORIGINAL_WEIGHT;
      const bg =
        ng * REPAIR_NEIGHBOR_WEIGHT + og * REPAIR_ORIGINAL_WEIGHT;
      const bb =
        nb * REPAIR_NEIGHBOR_WEIGHT + ob * REPAIR_ORIGINAL_WEIGHT;

      // --- 劣化済み dest とアルファでブレンドして戻す ---
      dest.pixels[di    ] =
        dest.pixels[di    ] * (1 - alpha) + br * alpha;
      dest.pixels[di + 1] =
        dest.pixels[di + 1] * (1 - alpha) + bg * alpha;
      dest.pixels[di + 2] =
        dest.pixels[di + 2] * (1 - alpha) + bb * alpha;
      // alpha チャンネルはそのまま
    }
  }

  dest.updatePixels();

  // ほんの少しだけ縫い目の痕跡を残す
  if (REPAIR_SEAM_STRENGTH > 0){
    seamFrame(dest, x, y, w, h, REPAIR_SEAM_STRENGTH);
  }

  // 軽くなじませ（横方向の薄いブラー）
  boxBlurRect(dest, x, y, w, h, 1);
}

// =========================
// ▶ フィット描画（アスペクト維持）
// =========================
function computeFit(iw, ih, cw, ch){
  const s  = Math.min(cw/iw, ch/ih);
  const dw = iw * s;
  const dh = ih * s;
  const ox = (cw - dw)*0.5;
  const oy = (ch - dh)*0.5;
  fitCache = {dw, dh, ox, oy};
}
function drawFit(img){
  if (!img) return;
  if (!fitCache) computeFit(img.width, img.height, width, height);
  const {dw, dh, ox, oy} = fitCache;
  image(img, ox, oy, dw, dh);
}

// =========================
// ▶ ユーティリティ（縫い目・簡易ブラー）
// =========================
function seamFrame(g, x, y, w, h, k=0.05){
  if (!g) return;
  g.loadPixels();
  const W=g.width, H=g.height;
  const dark=v=>constrain(v*(1-k),0,255);
  const lite=v=>constrain(v*(1+k*0.5),0,255);
  // 上下ライン
  for(let xx=x; xx<x+w; xx++){
    const iTop = 4*(y*W + xx);
    const iBot = 4*((y+h-1)*W + xx);
    if(y>=0 && y<H){
      g.pixels[iTop]   = dark(g.pixels[iTop]);
      g.pixels[iTop+1] = dark(g.pixels[iTop+1]);
      g.pixels[iTop+2] = dark(g.pixels[iTop+2]);
    }
    if(y+h-1>=0 && y+h-1<H){
      g.pixels[iBot]   = lite(g.pixels[iBot]);
      g.pixels[iBot+1] = lite(g.pixels[iBot+1]);
      g.pixels[iBot+2] = lite(g.pixels[iBot+2]);
    }
  }
  // 左右ライン
  for(let yy=y; yy<y+h; yy++){
    const iL = 4*(yy*W + x);
    const iR = 4*(yy*W + (x+w-1));
    if(x>=0 && x<W){
      g.pixels[iL]   = dark(g.pixels[iL]);
      g.pixels[iL+1] = dark(g.pixels[iL+1]);
      g.pixels[iL+2] = dark(g.pixels[iL+2]);
    }
    if(x+w-1>=0 && x+w-1<W){
      g.pixels[iR]   = lite(g.pixels[iR]);
      g.pixels[iR+1] = lite(g.pixels[iR+1]);
      g.pixels[iR+2] = lite(g.pixels[iR+2]);
    }
  }
  g.updatePixels();
}

function boxBlurRect(g, x, y, w, h, r=1){
  if (!g || r<=0) return;
  g.loadPixels();
  const W=g.width, H=g.height;
  const src = g.pixels.slice();
  for(let yy=y; yy<y+h; yy++){
    if(yy<0||yy>=H) continue;
    for(let xx=x; xx<x+w; xx++){
      if(xx<0||xx>=W) continue;
      let rr=0,gg=0,bb=0,c=0;
      for(let k=-r;k<=r;k++){
        const xxx = constrain(xx+k,0,W-1);
        const ii  = 4*(yy*W + xxx);
        rr+=src[ii]; gg+=src[ii+1]; bb+=src[ii+2]; c++;
      }
      const o = 4*(yy*W + xx);
      g.pixels[o  ] = rr/c;
      g.pixels[o+1] = gg/c;
      g.pixels[o+2] = bb/c;
    }
  }
  g.updatePixels();
}

// =========================
// ▶ 入力（←/→・タップ）＆リサイズ
// =========================
function keyPressed(){
  if (keyCode === RIGHT_ARROW) gotoNext();
  else if (keyCode === LEFT_ARROW) gotoPrev();
}

// PCクリック & スマホタップ両方対応
function mousePressed(){
  // 画面の右半分タップ → 次へ
  // 左半分タップ → 前へ
  if (mouseX > width / 2){
    gotoNext();
  } else {
    gotoPrev();
  }
}

function touchStarted(){
  if (touches.length > 0){
    const t = touches[0];
    if (t.x > width / 2){
      gotoNext();
    } else {
      gotoPrev();
    }
  }
}

function windowResized(){
  resizeCanvas(windowWidth, windowHeight);
  if (workImg){
    computeFit(workImg.width, workImg.height, width, height);
  }
}
