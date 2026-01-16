/**
 * File Reader Utility
 *
 * Provides a safe file-to-base64 conversion with proper cleanup and abort support.
 * Prevents memory leaks by properly cleaning up FileReader event handlers.
 */

/**
 * Convert a file to base64 string with abort support
 *
 * @param file - The file to convert
 * @param signal - Optional AbortSignal to cancel the operation
 * @returns Promise resolving to base64 string (without data URL prefix)
 */
export function fileToBase64(file: File, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    // Check if already aborted
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const reader = new FileReader();

    // Cleanup function to remove all handlers
    const cleanup = () => {
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
    };

    // Handle abort signal
    const handleAbort = () => {
      reader.abort();
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    // Add abort listener if signal provided
    signal?.addEventListener('abort', handleAbort, { once: true });

    reader.onload = () => {
      signal?.removeEventListener('abort', handleAbort);
      cleanup();
      const result = reader.result as string;
      // Extract base64 data from data URL (remove "data:*/*;base64," prefix)
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };

    reader.onerror = () => {
      signal?.removeEventListener('abort', handleAbort);
      cleanup();
      reject(reader.error || new Error('Failed to read file'));
    };

    reader.onabort = () => {
      signal?.removeEventListener('abort', handleAbort);
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Convert a file to ArrayBuffer with abort support
 *
 * @param file - The file to convert
 * @param signal - Optional AbortSignal to cancel the operation
 * @returns Promise resolving to ArrayBuffer
 */
export function fileToArrayBuffer(file: File, signal?: AbortSignal): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const reader = new FileReader();

    const cleanup = () => {
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
    };

    const handleAbort = () => {
      reader.abort();
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', handleAbort, { once: true });

    reader.onload = () => {
      signal?.removeEventListener('abort', handleAbort);
      cleanup();
      resolve(reader.result as ArrayBuffer);
    };

    reader.onerror = () => {
      signal?.removeEventListener('abort', handleAbort);
      cleanup();
      reject(reader.error || new Error('Failed to read file'));
    };

    reader.onabort = () => {
      signal?.removeEventListener('abort', handleAbort);
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    reader.readAsArrayBuffer(file);
  });
}
