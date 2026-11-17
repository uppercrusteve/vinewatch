import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_INPUT_BYTES,
  compressImage,
  estimateBytes,
  fitDimensions,
  formatBytes
} from '../src/photo.js';

const DATA_URL = `data:image/jpeg;base64,${'A'.repeat(4000)}`;

function fakeCanvas() {
  const ctx = { drawImage: vi.fn(), imageSmoothingQuality: 'low' };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => DATA_URL)
  };
  return { canvas, ctx };
}

function installCanvas() {
  const { canvas, ctx } = fakeCanvas();
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) =>
    String(tag).toLowerCase() === 'canvas' ? canvas : original(tag)
  );
  return { canvas, ctx };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fitDimensions', () => {
  it('横图缩到长边 1280 并保持比例', () => {
    expect(fitDimensions(4000, 3000)).toEqual({ width: 1280, height: 960, scaled: true });
  });

  it('竖图同样以长边为上限', () => {
    expect(fitDimensions(3000, 4000)).toEqual({ width: 960, height: 1280, scaled: true });
  });

  it('小图不放大', () => {
    expect(fitDimensions(800, 600)).toEqual({ width: 800, height: 600, scaled: false });
    expect(fitDimensions(1280, 1280).scaled).toBe(false);
  });

  it('极端比例仍保留至少 1 px', () => {
    const result = fitDimensions(9000, 10);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(1);
  });

  it('支持自定义上限并拒绝非法尺寸', () => {
    expect(fitDimensions(1000, 500, 640)).toEqual({ width: 640, height: 320, scaled: true });
    expect(() => fitDimensions(0, 100)).toThrow('尺寸');
    expect(() => fitDimensions(Number.NaN, 100)).toThrow('尺寸');
  });
});

describe('压缩流程', () => {
  it('用 canvas 重绘并输出 JPEG 数据 URL', async () => {
    const { ctx, canvas } = installCanvas();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })));
    const file = { type: 'image/jpeg', size: 3_000_000 };
    const result = await compressImage(file);
    expect(result).toMatchObject({ width: 1280, height: 960, scaled: true });
    expect(result.dataUrl.startsWith('data:image/jpeg')).toBe(true);
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.82);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1280, 960);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.originalBytes).toBe(3_000_000);
  });

  it('尊重自定义尺寸与质量上限', async () => {
    installCanvas();
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2000, height: 1000, close })));
    const result = await compressImage({ type: 'image/png', size: 1000 }, { maxEdge: 640, quality: 1 });
    expect(result.width).toBe(640);
    expect(close).toHaveBeenCalled();
  });

  it('拒绝非图片、超大文件与空文件', async () => {
    await expect(compressImage(null)).rejects.toThrow('选择照片');
    await expect(compressImage({ type: 'application/pdf', size: 100 })).rejects.toThrow('不是图片');
    await expect(compressImage({ type: 'image/jpeg', size: MAX_INPUT_BYTES + 1 })).rejects.toThrow('25 MB');
  });
});

describe('字节工具', () => {
  it('从 base64 估算字节并格式化', () => {
    expect(estimateBytes('data:image/jpeg;base64,AAAA')).toBe(3);
    expect(estimateBytes('data:image/jpeg;base64,AAA=')).toBe(2);
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2 KB');
  });
});
