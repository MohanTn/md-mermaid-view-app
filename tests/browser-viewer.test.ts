import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserViewerApi, installBrowserViewer } from '../src/renderer/browser-viewer';

describe('browser viewer adapter', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('installs a safe viewer bridge when Electron preload is absent', async () => {
    (window as unknown as { viewer?: unknown }).viewer = undefined;
    installBrowserViewer();
    expect(window.viewer).toBeDefined();
    expect(await window.viewer.listDirectory()).toEqual([]);
    expect(window.viewer.onOpenPath(() => undefined)).toBeTypeOf('function');
  });

  it('opens a selected Markdown file and keeps it in the browser file list', async () => {
    const api = createBrowserViewerApi();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      const file = {
        name: 'preview.md',
        lastModified: 1,
        text: async () => '# Browser preview',
      } as unknown as File;
      Object.defineProperty(this, 'files', { configurable: true, value: [file] });
      this.onchange?.(new Event('change'));
    });

    try {
      const document = await api.chooseFile();
      expect(document).toMatchObject({ name: 'preview.md', kind: 'markdown', content: '# Browser preview' });
      expect(await api.listDirectory()).toMatchObject([{ name: 'preview.md', kind: 'markdown' }]);
    } finally {
      click.mockRestore();
    }
  });

  it('round-trips browser comments through localStorage', async () => {
    const api = createBrowserViewerApi();
    await api.writeSidecar('browser://one', 'review', 'comment');
    expect(await api.readSidecar('browser://one', 'review')).toBe('comment');
  });
});
