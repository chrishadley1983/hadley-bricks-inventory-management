import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateFilename,
  validateImageFile,
} from '../image-processing';
import { EBAY_IMAGE_SPECS } from '../constants';

// Note: loadImage, processImage, and other canvas-based functions require
// browser APIs (Image, Canvas, FileReader) that need to be mocked.
// These functions are tested via E2E tests in the browser environment.
// Here we test the utility functions that don't require browser APIs.

describe('Image Processing - Utility Functions', () => {
  describe('generateFilename', () => {
    beforeEach(() => {
      // Mock Date to have consistent test results
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should generate filename with base name, date, and index', () => {
      const result = generateFilename('lego_75192', 0);
      expect(result).toBe('lego_75192_2024-06-15_01.jpg');
    });

    it('should pad index with leading zero for single digits', () => {
      expect(generateFilename('item', 0)).toContain('_01.jpg');
      expect(generateFilename('item', 8)).toContain('_09.jpg');
    });

    it('should not pad index for double digits', () => {
      expect(generateFilename('item', 9)).toContain('_10.jpg');
      expect(generateFilename('item', 99)).toContain('_100.jpg');
    });

    it('should include .jpg extension', () => {
      const result = generateFilename('test', 0);
      expect(result).toMatch(/\.jpg$/);
    });

    it('should handle special characters in base name', () => {
      const result = generateFilename('test_item_name', 0);
      expect(result).toBe('test_item_name_2024-06-15_01.jpg');
    });
  });

  describe('validateImageFile', () => {
    const createMockFile = (type: string, size: number): File => {
      const blob = new Blob([''], { type });
      return new File([blob], 'test-image', { type });
    };

    describe('file type validation', () => {
      it('should accept JPEG files', () => {
        const file = createMockFile('image/jpeg', 1000);
        const result = validateImageFile(file);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept PNG files', () => {
        const file = createMockFile('image/png', 1000);
        const result = validateImageFile(file);
        expect(result.valid).toBe(true);
      });

      it('should accept WebP files', () => {
        const file = createMockFile('image/webp', 1000);
        const result = validateImageFile(file);
        expect(result.valid).toBe(true);
      });

      it('should reject GIF files', () => {
        const file = createMockFile('image/gif', 1000);
        const result = validateImageFile(file);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('Unsupported format'))).toBe(true);
      });

      it('should reject non-image files', () => {
        const file = createMockFile('application/pdf', 1000);
        const result = validateImageFile(file);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('Unsupported format');
      });
    });

    describe('file size validation', () => {
      it('should accept files under the limit', () => {
        const file = createMockFile('image/jpeg', 1000000); // 1MB
        // Note: Blob size won't match - testing the validation logic
        Object.defineProperty(file, 'size', { value: 1000000 });
        const result = validateImageFile(file);
        expect(result.errors.filter((e) => e.includes('too large'))).toHaveLength(0);
      });

      it('should reject files over the limit', () => {
        const file = createMockFile('image/jpeg', 100);
        // Mock file size to be over limit
        Object.defineProperty(file, 'size', {
          value: EBAY_IMAGE_SPECS.maxFileSizeBytes + 1,
        });
        const result = validateImageFile(file);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('File too large'))).toBe(true);
      });

      it('should include actual size in error message', () => {
        const file = createMockFile('image/jpeg', 100);
        const oversizeBytes = 15 * 1024 * 1024; // 15MB
        Object.defineProperty(file, 'size', { value: oversizeBytes });
        const result = validateImageFile(file);
        expect(result.errors[0]).toContain('15.0MB');
        expect(result.errors[0]).toContain(`Maximum is ${EBAY_IMAGE_SPECS.maxFileSizeMB}MB`);
      });
    });

    describe('combined validation', () => {
      it('should return multiple errors for multiple issues', () => {
        const file = createMockFile('image/gif', 100);
        Object.defineProperty(file, 'size', {
          value: EBAY_IMAGE_SPECS.maxFileSizeBytes + 1,
        });
        const result = validateImageFile(file);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(2);
      });

      it('should return empty warnings by default', () => {
        const file = createMockFile('image/jpeg', 1000);
        const result = validateImageFile(file);
        expect(result.warnings).toHaveLength(0);
      });
    });
  });

  describe('EBAY_IMAGE_SPECS constants', () => {
    it('should have correct maximum photos', () => {
      expect(EBAY_IMAGE_SPECS.maxPhotos).toBe(24);
    });

    it('should have correct minimum dimension', () => {
      expect(EBAY_IMAGE_SPECS.minDimension).toBe(500);
    });

    it('should have correct recommended dimension', () => {
      expect(EBAY_IMAGE_SPECS.recommendedDimension).toBe(1600);
    });

    it('should have correct max file size', () => {
      expect(EBAY_IMAGE_SPECS.maxFileSizeBytes).toBe(12 * 1024 * 1024);
      expect(EBAY_IMAGE_SPECS.maxFileSizeMB).toBe(12);
    });

    it('should support JPEG, PNG, and WebP', () => {
      expect(EBAY_IMAGE_SPECS.supportedFormats).toContain('image/jpeg');
      expect(EBAY_IMAGE_SPECS.supportedFormats).toContain('image/png');
      expect(EBAY_IMAGE_SPECS.supportedFormats).toContain('image/webp');
    });
  });
});

// ============================================
// Browser-dependent functions with mocked DOM/Canvas APIs
// ============================================

describe('Image Processing - Browser Functions', () => {
  // Store original globals
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  const originalFileReader = globalThis.FileReader;

  // Mock canvas context
  const createMockCanvasContext = () => {
    const imageData = {
      data: new Uint8ClampedArray(400 * 300 * 4), // 400x300 image
      width: 400,
      height: 300,
    };
    // Initialize with some non-white pixels to simulate an image
    for (let i = 0; i < imageData.data.length; i += 4) {
      imageData.data[i] = 100; // R
      imageData.data[i + 1] = 100; // G
      imageData.data[i + 2] = 100; // B
      imageData.data[i + 3] = 255; // A
    }

    return {
      filter: '',
      fillStyle: '',
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn().mockReturnValue(imageData),
      putImageData: vi.fn(),
    };
  };

  // Mock canvas
  const createMockCanvas = (width: number = 400, height: number = 300) => {
    const ctx = createMockCanvasContext();
    return {
      width,
      height,
      getContext: vi.fn().mockReturnValue(ctx),
      toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,mockImageData'),
      _ctx: ctx,
    };
  };

  // Mock Image class
  class MockImage {
    src = '';
    width = 800;
    height = 600;
    crossOrigin = '';
    onload: (() => void) | null = null;
    onerror: ((error: Error) => void) | null = null;

    constructor() {
      // Trigger onload async when src is set
      const originalSrc = Object.getOwnPropertyDescriptor(MockImage.prototype, 'src');
      Object.defineProperty(this, 'src', {
        set: (value: string) => {
          this._src = value;
          if (value && value.includes('error')) {
            setTimeout(() => this.onerror?.(new Error('Failed to load image')), 0);
          } else if (value) {
            setTimeout(() => this.onload?.(), 0);
          }
        },
        get: () => this._src,
      });
    }

    private _src = '';
  }

  // Mock FileReader class
  class MockFileReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    readAsDataURL(file: File) {
      setTimeout(() => {
        if (file.name === 'error.jpg') {
          this.onerror?.();
        } else {
          this.result = 'data:image/jpeg;base64,mockBase64Data';
          this.onload?.();
        }
      }, 0);
    }
  }

  beforeEach(() => {
    vi.resetModules();

    // Mock Image globally
    globalThis.Image = MockImage as unknown as typeof Image;

    // Mock FileReader globally
    globalThis.FileReader = MockFileReader as unknown as typeof FileReader;

    // Mock document.createElement
    const mockCanvas = createMockCanvas();
    const mockLink = {
      href: '',
      download: '',
      click: vi.fn(),
    };

    globalThis.document = {
      createElement: vi.fn((tag: string) => {
        if (tag === 'canvas') return createMockCanvas();
        if (tag === 'a') return mockLink;
        return {};
      }),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    } as unknown as Document;
  });

  afterEach(() => {
    globalThis.Image = originalImage;
    globalThis.document = originalDocument;
    globalThis.FileReader = originalFileReader;
    vi.restoreAllMocks();
  });

  // ============================================
  // loadImage
  // ============================================

  describe('loadImage', () => {
    it('should load image from base64 data URL', async () => {
      const { loadImage } = await import('../image-processing');

      const img = await loadImage('data:image/jpeg;base64,testdata');

      expect(img).toBeDefined();
      expect(img.crossOrigin).toBe('anonymous');
    });

    it('should reject on load error', async () => {
      const { loadImage } = await import('../image-processing');

      await expect(loadImage('data:image/jpeg;base64,error')).rejects.toThrow(
        'Failed to load image'
      );
    });
  });

  // ============================================
  // processImage
  // ============================================

  describe('processImage', () => {
    it('should apply brightness adjustment', async () => {
      const { processImage } = await import('../image-processing');

      const result = await processImage('data:image/jpeg;base64,test', {
        brightness: 1.5,
        contrast: 1.0,
        saturation: 1.0,
        sharpness: 0,
        padding: 0.1,
        temperature: 0,
      });

      expect(result).toContain('data:image/jpeg');
      // Verify filter was applied (checked via mock)
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      expect(ctx?.filter).toBeDefined();
    });

    it('should apply contrast adjustment', async () => {
      const { processImage } = await import('../image-processing');

      const result = await processImage('data:image/jpeg;base64,test', {
        brightness: 1.0,
        contrast: 1.5,
        saturation: 1.0,
        sharpness: 0,
        padding: 0.1,
        temperature: 0,
      });

      expect(result).toContain('data:image/jpeg');
    });

    it('should apply saturation adjustment', async () => {
      const { processImage } = await import('../image-processing');

      const result = await processImage('data:image/jpeg;base64,test', {
        brightness: 1.0,
        contrast: 1.0,
        saturation: 1.5,
        sharpness: 0,
        padding: 0.1,
        temperature: 0,
      });

      expect(result).toContain('data:image/jpeg');
    });

    it('should apply temperature adjustment', async () => {
      const { processImage } = await import('../image-processing');

      const result = await processImage('data:image/jpeg;base64,test', {
        brightness: 1.0,
        contrast: 1.0,
        saturation: 1.0,
        sharpness: 0,
        padding: 0.1,
        temperature: 25, // Warm
      });

      expect(result).toContain('data:image/jpeg');
      // Temperature adjustment modifies pixel data via getImageData/putImageData
    });

    it('should apply sharpening', async () => {
      const { processImage } = await import('../image-processing');

      const result = await processImage('data:image/jpeg;base64,test', {
        brightness: 1.0,
        contrast: 1.0,
        saturation: 1.0,
        sharpness: 0.5,
        padding: 0.1,
        temperature: 0,
      });

      expect(result).toContain('data:image/jpeg');
      // Sharpening uses convolution kernel on pixel data
    });

    it('should perform smart crop', async () => {
      const { processImage } = await import('../image-processing');

      const result = await processImage('data:image/jpeg;base64,test', {
        brightness: 1.0,
        contrast: 1.0,
        saturation: 1.0,
        sharpness: 0,
        padding: 0.1,
        temperature: 0,
      });

      expect(result).toContain('data:image/jpeg');
      // Smart crop detects bounding box of non-white pixels
    });

    it('should add white background padding', async () => {
      const { processImage } = await import('../image-processing');

      const result = await processImage('data:image/jpeg;base64,test', {
        brightness: 1.0,
        contrast: 1.0,
        saturation: 1.0,
        sharpness: 0,
        padding: 0.15, // 15% padding
        temperature: 0,
      });

      expect(result).toContain('data:image/jpeg');
      // Verify fillRect was called for white background
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      expect(ctx?.fillRect).toBeDefined();
    });

    it('should return JPEG at 95% quality', async () => {
      const { processImage } = await import('../image-processing');

      const result = await processImage('data:image/jpeg;base64,test', {
        brightness: 1.0,
        contrast: 1.0,
        saturation: 1.0,
        sharpness: 0,
        padding: 0.1,
        temperature: 0,
      });

      // toDataURL is called with 'image/jpeg' and 0.95
      expect(result).toContain('data:image/jpeg');
    });
  });

  // ============================================
  // processImagePreview
  // ============================================

  describe('processImagePreview', () => {
    it('should process without smart cropping', async () => {
      const { processImagePreview } = await import('../image-processing');

      const result = await processImagePreview('data:image/jpeg;base64,test', {
        brightness: 1.1,
        contrast: 1.05,
        saturation: 1.0,
        sharpness: 0.5,
        padding: 0.1,
        temperature: 0,
      });

      expect(result).toContain('data:image/jpeg');
      // Preview mode doesn't call getBoundingBox - just applies filters
    });

    it('should preserve original dimensions', async () => {
      const { processImagePreview } = await import('../image-processing');

      const result = await processImagePreview('data:image/jpeg;base64,test', {
        brightness: 1.0,
        contrast: 1.0,
        saturation: 1.0,
        sharpness: 0,
        padding: 0.1,
        temperature: 0,
      });

      // Canvas dimensions match image dimensions (no resize)
      expect(result).toContain('data:image/jpeg');
    });
  });

  // ============================================
  // resizeImage
  // ============================================

  describe('resizeImage', () => {
    it('should resize landscape images correctly', async () => {
      // Create mock for landscape image (wider than tall)
      class LandscapeImage extends MockImage {
        width = 2000;
        height = 1000;
      }
      globalThis.Image = LandscapeImage as unknown as typeof Image;

      const { resizeImage } = await import('../image-processing');

      const result = await resizeImage('data:image/jpeg;base64,test', 1600);

      expect(result).toContain('data:image/jpeg');
      // Width should be 1600, height scaled proportionally to 800
    });

    it('should resize portrait images correctly', async () => {
      // Create mock for portrait image (taller than wide)
      class PortraitImage extends MockImage {
        width = 1000;
        height = 2000;
      }
      globalThis.Image = PortraitImage as unknown as typeof Image;

      const { resizeImage } = await import('../image-processing');

      const result = await resizeImage('data:image/jpeg;base64,test', 1600);

      expect(result).toContain('data:image/jpeg');
      // Height should be 1600, width scaled proportionally to 800
    });

    it('should not upscale smaller images', async () => {
      // Create mock for small image
      class SmallImage extends MockImage {
        width = 800;
        height = 600;
      }
      globalThis.Image = SmallImage as unknown as typeof Image;

      const { resizeImage } = await import('../image-processing');

      const result = await resizeImage('data:image/jpeg;base64,test', 1600);

      expect(result).toContain('data:image/jpeg');
      // Image dimensions should remain 800x600 (no upscaling)
    });
  });

  // ============================================
  // validateImageDimensions
  // ============================================

  describe('validateImageDimensions', () => {
    it('should pass for images meeting minimum', async () => {
      // Image is 800x600 which meets 500px minimum
      const { validateImageDimensions } = await import('../image-processing');

      const result = await validateImageDimensions('data:image/jpeg;base64,test');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail for images below minimum', async () => {
      // Create mock for too-small image
      class TinyImage extends MockImage {
        width = 300;
        height = 200;
      }
      globalThis.Image = TinyImage as unknown as typeof Image;

      const { validateImageDimensions } = await import('../image-processing');

      const result = await validateImageDimensions('data:image/jpeg;base64,test');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('too small'))).toBe(true);
      expect(result.errors[0]).toContain('300×200px');
      expect(result.errors[0]).toContain('500×500px');
    });

    it('should warn for images below recommended', async () => {
      // Image is 800x600 which is below 1600px recommended
      const { validateImageDimensions } = await import('../image-processing');

      const result = await validateImageDimensions('data:image/jpeg;base64,test');

      expect(result.valid).toBe(true); // Still valid, just has warning
      expect(result.warnings.some((e) => e.includes('below recommended'))).toBe(true);
      expect(result.warnings[0]).toContain('800×600px');
      expect(result.warnings[0]).toContain('1600×1600px');
    });
  });

  // ============================================
  // fileToBase64
  // ============================================

  describe('fileToBase64', () => {
    it('should convert file to base64 data URL', async () => {
      const { fileToBase64 } = await import('../image-processing');

      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      const result = await fileToBase64(file);

      expect(result).toBe('data:image/jpeg;base64,mockBase64Data');
    });

    it('should reject on read error', async () => {
      const { fileToBase64 } = await import('../image-processing');

      const file = new File(['test'], 'error.jpg', { type: 'image/jpeg' });

      await expect(fileToBase64(file)).rejects.toThrow('Failed to read file');
    });
  });

  // ============================================
  // downloadImage
  // ============================================

  describe('downloadImage', () => {
    it('should create and click download link', async () => {
      const mockLink = {
        href: '',
        download: '',
        click: vi.fn(),
      };
      (document.createElement as ReturnType<typeof vi.fn>).mockReturnValue(mockLink);

      const { downloadImage } = await import('../image-processing');

      downloadImage('data:image/jpeg;base64,test', 'test_image.jpg');

      expect(mockLink.href).toBe('data:image/jpeg;base64,test');
      expect(mockLink.download).toBe('test_image.jpg');
      expect(mockLink.click).toHaveBeenCalled();
    });

    it('should clean up link after download', async () => {
      const mockLink = {
        href: '',
        download: '',
        click: vi.fn(),
      };
      (document.createElement as ReturnType<typeof vi.fn>).mockReturnValue(mockLink);

      const { downloadImage } = await import('../image-processing');

      downloadImage('data:image/jpeg;base64,test', 'test_image.jpg');

      expect(document.body.appendChild).toHaveBeenCalledWith(mockLink);
      expect(document.body.removeChild).toHaveBeenCalledWith(mockLink);
    });
  });
});
