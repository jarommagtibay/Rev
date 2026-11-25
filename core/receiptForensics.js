// Receipt Forensics: Tampered / Edited Receipt Detection
// Uses binary metadata/software signature scanning + Error Level Analysis (ELA) via @napi-rs/canvas.
const { AttachmentBuilder } = require('discord.js');

let createCanvas = null;
let loadImage = null;
try {
  const canvasPkg = require('@napi-rs/canvas');
  createCanvas = canvasPkg.createCanvas;
  loadImage = canvasPkg.loadImage;
} catch {
  // @napi-rs/canvas not available; metadata checks still run
}

// Software signatures that strongly indicate manual image editing rather than a native phone screenshot
const EDITOR_SIGNATURES = [
  { pattern: /adobe\s*photoshop/i, name: 'Adobe Photoshop', weight: 65 },
  { pattern: /\bphotoshop\b/i, name: 'Photoshop', weight: 65 },
  { pattern: /\bcanva\b/i, name: 'Canva', weight: 60 },
  { pattern: /\bphotopea\b/i, name: 'Photopea', weight: 60 },
  { pattern: /\bpicsart\b/i, name: 'PicsArt', weight: 55 },
  { pattern: /\bpixellab\b/i, name: 'PixelLab', weight: 55 },
  { pattern: /\bgimp\b/i, name: 'GIMP', weight: 55 },
  { pattern: /\baffinity\s*(?:photo|designer)?\b/i, name: 'Affinity', weight: 55 },
  { pattern: /\bfigma\b/i, name: 'Figma', weight: 50 },
  { pattern: /\bibispaint\b/i, name: 'ibisPaint', weight: 50 },
  { pattern: /\bsnapseed\b/i, name: 'Snapseed', weight: 45 },
  { pattern: /\badobe\s*illustrator\b/i, name: 'Adobe Illustrator', weight: 55 },
  { pattern: /\blightroom\b/i, name: 'Lightroom', weight: 40 },
  { pattern: /\bpaint\.net\b/i, name: 'Paint.NET', weight: 50 },
  { pattern: /\bcapcut\b/i, name: 'CapCut', weight: 45 },
  { pattern: /\bphonto\b/i, name: 'Phonto', weight: 55 },
];

/**
 * Scans raw image bytes (EXIF, XMP, PNG tEXt/iTXt/zTXt chunks) for editing software signatures.
 * @param {Buffer} buffer
 * @returns {{ detectedEditors: string[], score: number, isPng: boolean, isJpeg: boolean }}
 */
function scanImageMetadata(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return { detectedEditors: [], score: 0, isPng: false, isJpeg: false };
  }

  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

  // Read header/metadata region (first 96KB + last 32KB covers EXIF, XMP, and PNG text chunks)
  const head = buffer.subarray(0, Math.min(buffer.length, 98304)).toString('latin1');
  const tail =
    buffer.length > 98304
      ? buffer.subarray(Math.max(98304, buffer.length - 32768)).toString('latin1')
      : '';
  const searchable = `${head}\n${tail}`.replace(/[^\x20-\x7E\n]/g, ' ');

  const detectedEditors = [];
  let maxWeight = 0;

  for (const sig of EDITOR_SIGNATURES) {
    if (sig.pattern.test(searchable)) {
      if (!detectedEditors.includes(sig.name)) {
        detectedEditors.push(sig.name);
      }
      if (sig.weight > maxWeight) maxWeight = sig.weight;
    }
  }

  return {
    detectedEditors,
    score: maxWeight,
    isPng,
    isJpeg,
  };
}

/**
 * Computes Error Level Analysis (ELA) on an image buffer to spot localized pasted/edited regions.
 * Re-saves the image at JPEG quality 90 and compares 16x16 block error variance.
 * @param {Buffer} buffer
 * @returns {Promise<{ spikeRatio: number, hotBlockPct: number, maxBlockErr: number, medianBlockErr: number, heatmapBuffer: Buffer|null }|null>}
 */
async function computeELA(buffer) {
  if (!createCanvas || !loadImage || !buffer) return null;

  try {
    const img = await loadImage(buffer);
    if (!img || !img.width || !img.height) return null;

    // Scale down to max 560px wide for fast block analysis
    const scale = Math.min(1, 560 / img.width);
    const w = Math.max(32, Math.round(img.width * scale));
    const h = Math.max(32, Math.round(img.height * scale));

    const origCanvas = createCanvas(w, h);
    const origCtx = origCanvas.getContext('2d');
    origCtx.drawImage(img, 0, 0, w, h);
    const origData = origCtx.getImageData(0, 0, w, h).data;

    // Re-encode at JPEG Q=90 and decode back
    const jpegBuf = origCanvas.toBuffer('image/jpeg', 90);
    const recompImg = await loadImage(jpegBuf);
    const recompCanvas = createCanvas(w, h);
    const recompCtx = recompCanvas.getContext('2d');
    recompCtx.drawImage(recompImg, 0, 0, w, h);
    const recompData = recompCtx.getImageData(0, 0, w, h).data;

    // Compute per-pixel difference + 16x16 block averages
    const blockSize = 16;
    const cols = Math.floor(w / blockSize);
    const rows = Math.floor(h / blockSize);
    if (cols < 2 || rows < 2) return null;

    const heatCanvas = createCanvas(w, h);
    const heatCtx = heatCanvas.getContext('2d');
    const heatImg = heatCtx.createImageData(w, h);
    const heatOut = heatImg.data;

    const blockErrors = [];
    for (let by = 0; by < rows; by++) {
      for (let bx = 0; bx < cols; bx++) {
        let sumErr = 0;
        let count = 0;
        for (let py = by * blockSize; py < (by + 1) * blockSize; py++) {
          for (let px = bx * blockSize; px < (bx + 1) * blockSize; px++) {
            const idx = (py * w + px) * 4;
            const dr = Math.abs(origData[idx] - recompData[idx]);
            const dg = Math.abs(origData[idx + 1] - recompData[idx + 1]);
            const db = Math.abs(origData[idx + 2] - recompData[idx + 2]);
            const err = (dr + dg + db) / 3;
            sumErr += err;
            count++;

            // Amplify difference x12 for human-readable heatmap
            const amp = Math.min(255, Math.round(err * 12));
            heatOut[idx] = amp;
            heatOut[idx + 1] = Math.round(amp * 0.25);
            heatOut[idx + 2] = Math.max(0, 80 - amp);
            heatOut[idx + 3] = 255;
          }
        }
        blockErrors.push(sumErr / count);
      }
    }

    heatCtx.putImageData(heatImg, 0, 0);

    const sorted = [...blockErrors].sort((a, b) => a - b);
    const medianBlockErr = sorted[Math.floor(sorted.length * 0.5)] || 0.01;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || medianBlockErr;
    const maxBlockErr = sorted[sorted.length - 1] || 0;

    // Spike ratio: how much hotter the top 5% / max blocks are vs median background
    const spikeRatio = Number((p95 / Math.max(medianBlockErr, 0.35)).toFixed(2));
    const hotThreshold = Math.max(medianBlockErr * 3.2, 4.5);
    const hotBlocks = blockErrors.filter((e) => e >= hotThreshold).length;
    const hotBlockPct = Number(((hotBlocks / blockErrors.length) * 100).toFixed(1));

    const heatmapBuffer = heatCanvas.toBuffer('image/png');

    return {
      spikeRatio,
      hotBlockPct,
      maxBlockErr: Number(maxBlockErr.toFixed(2)),
      medianBlockErr: Number(medianBlockErr.toFixed(2)),
      heatmapBuffer,
    };
  } catch (err) {
    console.warn('[receiptForensics] ELA computation failed:', err.message || err);
    return null;
  }
}

/**
 * Runs full tampering analysis on a receipt image buffer.
 * @param {Buffer} buffer
 * @param {string} [filename]
 * @param {string[]} [visualTamperFlags] Optional flags reported by AI Vision
 * @returns {Promise<{
 *   riskScore: number,
 *   riskLevel: 'low'|'medium'|'high',
 *   badge: string,
 *   reasons: string[],
 *   detectedEditors: string[],
 *   ela: object|null,
 *   heatmapAttachment: AttachmentBuilder|null
 * }>}
 */
async function analyzeReceiptForensics(buffer, filename = 'receipt.png', visualTamperFlags = []) {
  const reasons = [];
  let riskScore = 0;

  // 1. Metadata / Editor software signature check
  const meta = scanImageMetadata(buffer);
  if (meta.detectedEditors.length > 0) {
    riskScore += meta.score;
    reasons.push(`Editing software signature in file metadata: **${meta.detectedEditors.join(', ')}**`);
  }

  // 2. Error Level Analysis (ELA)
  const ela = await computeELA(buffer);
  if (ela) {
    // Only flag localized hotspots (very small % of blocks having a sharp compression spike),
    // because normal full-screen text compression spreads evenly across many blocks.
    if (ela.spikeRatio >= 5.5 && ela.hotBlockPct > 0 && ela.hotBlockPct <= 18 && ela.maxBlockErr >= 6) {
      riskScore += 45;
      reasons.push(
        `Strong localized compression anomaly (ELA ${ela.spikeRatio}x spike across ${ela.hotBlockPct}% of image)`
      );
    } else if (ela.spikeRatio >= 4.0 && ela.hotBlockPct > 0 && ela.hotBlockPct <= 22 && ela.maxBlockErr >= 4.5) {
      riskScore += 25;
      reasons.push(
        `Moderate compression anomaly (ELA ${ela.spikeRatio}x spike across ${ela.hotBlockPct}% of image)`
      );
    }
  }

  // 3. AI Vision visual tamper cues (e.g. mismatched font/alignment on amount/ref no)
  if (Array.isArray(visualTamperFlags) && visualTamperFlags.length > 0) {
    riskScore += Math.min(50, visualTamperFlags.length * 25);
    for (const flag of visualTamperFlags.slice(0, 3)) {
      reasons.push(`AI visual check: ${flag}`);
    }
  }

  riskScore = Math.min(100, riskScore);

  let riskLevel = 'low';
  let badge = '✅ Clean (No tampering signals)';
  if (riskScore >= 60) {
    riskLevel = 'high';
    badge = `🚨 HIGH TAMPERING RISK (${riskScore}/100)`;
  } else if (riskScore >= 30) {
    riskLevel = 'medium';
    badge = `⚠️ Suspicious Signals (${riskScore}/100)`;
  }

  let heatmapAttachment = null;
  if (riskLevel !== 'low' && ela && ela.heatmapBuffer) {
    const base = String(filename || 'receipt').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'receipt';
    heatmapAttachment = new AttachmentBuilder(ela.heatmapBuffer, { name: `ela-${base}.png` });
  }

  return {
    riskScore,
    riskLevel,
    badge,
    reasons,
    detectedEditors: meta.detectedEditors,
    ela: ela
      ? {
          spikeRatio: ela.spikeRatio,
          hotBlockPct: ela.hotBlockPct,
          maxBlockErr: ela.maxBlockErr,
          medianBlockErr: ela.medianBlockErr,
        }
      : null,
    heatmapAttachment,
  };
}

/**
 * Computes a 64-bit DCT Perceptual Hash (pHash) for an image buffer.
 * Robust to cropping, resizing, minor edits, and Discord JPEG re-compression.
 * @param {Buffer} buffer
 * @returns {Promise<string|null>} 16-char hex string (64 bits) or null
 */
async function computePerceptualHash(buffer) {
  if (!createCanvas || !loadImage || !buffer) return null;
  try {
    const img = await loadImage(buffer);
    if (!img || !img.width || !img.height) return null;

    const N = 32;
    const canvas = createCanvas(N, N);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, N, N);
    const pixels = ctx.getImageData(0, 0, N, N).data;

    // Convert to 32x32 luminance matrix
    const gray = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const idx = i * 4;
      gray[i] = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
    }

    // 2D DCT-II for top-left 8x8 low frequencies (u, v in 0..7)
    const dct = [];
    const cosTable = new Float64Array(N * 8);
    for (let x = 0; x < N; x++) {
      for (let u = 0; u < 8; u++) {
        cosTable[x * 8 + u] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
      }
    }

    for (let u = 0; u < 8; u++) {
      for (let v = 0; v < 8; v++) {
        let sum = 0;
        for (let y = 0; y < N; y++) {
          const cy = cosTable[y * 8 + v];
          const rowOffset = y * N;
          for (let x = 0; x < N; x++) {
            sum += gray[rowOffset + x] * cosTable[x * 8 + u] * cy;
          }
        }
        dct.push(sum);
      }
    }

    // Use 64 coefficients compared against median of the 63 AC coefficients
    const ac = dct.slice(1).sort((a, b) => a - b);
    const median = ac[Math.floor(ac.length / 2)] || 0;

    let hex = '';
    for (let i = 0; i < 64; i += 4) {
      let nibble = 0;
      for (let b = 0; b < 4; b++) {
        if (dct[i + b] > median) nibble |= 1 << (3 - b);
      }
      hex += nibble.toString(16);
    }
    return hex;
  } catch (err) {
    console.warn('[receiptForensics] pHash computation failed:', err.message || err);
    return null;
  }
}

/**
 * Computes Hamming distance between two 16-char hex pHashes (0 = identical, 64 = opposite).
 * @param {string} hashA
 * @param {string} hashB
 * @returns {number}
 */
function hammingDistance(hashA, hashB) {
  if (!hashA || !hashB || hashA.length !== hashB.length) return 64;
  let dist = 0;
  for (let i = 0; i < hashA.length; i++) {
    let x = parseInt(hashA[i], 16) ^ parseInt(hashB[i], 16);
    while (x > 0) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}

module.exports = {
  scanImageMetadata,
  computeELA,
  analyzeReceiptForensics,
  computePerceptualHash,
  hammingDistance,
};
