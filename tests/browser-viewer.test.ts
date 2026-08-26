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

  it('uses the hosted API for workspace files', async () => {
    const previousWebMode = window.__ORBIT_WEB__;
    window.__ORBIT_WEB__ = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/files')) {
        return { ok: true, json: async () => [{ path: 'web://workspace/readme.md', name: 'readme.md', kind: 'markdown' }] };
      }
      return { ok: true, json: async () => ({ path: 'web://workspace/readme.md', name: 'readme.md', kind: 'markdown', content: '# Hosted', updatedAt: 1 }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const api = createBrowserViewerApi();
      expect(await api.listDirectory('web://workspace')).toMatchObject([{ name: 'readme.md' }]);
      expect(await api.openPath('web://workspace/readme.md')).toMatchObject({ content: '# Hosted' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      window.__ORBIT_WEB__ = previousWebMode;
      vi.unstubAllGlobals();
    }
  });

  it('does not ask the hosted API to list a picked file\'s directory', async () => {
    const previousWebMode = window.__ORBIT_WEB__;
    window.__ORBIT_WEB__ = true;
    // The server rejects anything outside the workspace root, so a
    // `browser://` directory must never reach it.
    const fetchMock = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'Invalid workspace path.' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const api = createBrowserViewerApi();
      expect(await api.listDirectory('browser:/')).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      window.__ORBIT_WEB__ = previousWebMode;
      vi.unstubAllGlobals();
    }
  });
});
