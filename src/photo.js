/** Client-side photo downscale. Photos never leave the device uncompressed. */

export const MAX_EDGE = 1280;
export const JPEG_QUALITY = 0.82;
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/** Pure scale calculation, exposed for tests. */
export function fitDimensions(width, height, maxEdge = MAX_EDGE) {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error('图片尺寸无效');
  }
  const edge = Number.isFinite(maxEdge) && maxEdge > 0 ? maxEdge : MAX_EDGE;
  if (w <= edge && h <= edge) return { width: w, height: h, scaled: false };
  const ratio = Math.min(edge / w, edge / h);
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
    scaled: true
  };
}

export function estimateBytes(dataUrl) {
  const base64 = String(dataUrl).split(',')[1] || '';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取图片'));
    };
    image.src = url;
  });
}

/**
 * Compresses a camera/library image to JPEG with the long edge capped at 1280 px.
 * @param {File} file
 * @param {{maxEdge?: number, quality?: number}} [options]
 */
export async function compressImage(file, options = {}) {
  if (!file) throw new Error('请选择照片');
  const type = String(file.type || '').toLowerCase();
  if (type && !ACCEPTED_TYPES.includes(type) && !type.startsWith('image/')) {
    throw new Error('文件不是图片');
  }
  if (file.size > MAX_INPUT_BYTES) throw new Error('照片超过 25 MB，请先裁切');

  let bitmap;
  try {
    bitmap = await loadBitmap(file);
  } catch (error) {
    if (type === 'image/heic' || type === 'image/heif') {
      throw new Error('当前浏览器不能直接解码 HEIC/HEIF，请先在相册中导出为 JPEG');
    }
    throw new Error(`无法读取图片：${error.message || '格式不受支持'}`);
  }
  const srcW = bitmap.width || bitmap.naturalWidth;
  const srcH = bitmap.height || bitmap.naturalHeight;
  const dims = fitDimensions(srcW, srcH, options.maxEdge || MAX_EDGE);
  const quality = Math.min(0.95, Math.max(0.4, options.quality || JPEG_QUALITY));

  const canvas = document.createElement('canvas');
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法创建画布');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, dims.width, dims.height);
  if (typeof bitmap.close === 'function') bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const bytes = estimateBytes(dataUrl);
  return {
    dataUrl,
    width: dims.width,
    height: dims.height,
    bytes,
    originalBytes: file.size,
    scaled: dims.scaled
  };
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
