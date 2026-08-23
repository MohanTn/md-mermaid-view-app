import { beforeEach, describe, expect, it } from 'vitest';
import mermaid from 'mermaid';

beforeEach(() => {
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 120, height: 80 }),
  });
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
  });
});

describe('Mermaid DOM rendering', () => {
  it('renders a standalone flowchart into an SVG element', async () => {
    const container = document.createElement('div');
    container.className = 'mermaid';
    container.textContent = 'flowchart TD\n  A[Start] --> B[Finish]';
    document.body.appendChild(container);

    await mermaid.run({ nodes: [container] });

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.outerHTML.length).toBeGreaterThan(200);
  });
});
