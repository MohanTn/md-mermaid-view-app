import { describe, expect, it } from 'vitest';
import { readDiagramNavigatorNodes } from '../src/renderer/diagram-navigator';

describe('diagram navigator', () => {
  it('reads rendered Mermaid node labels and bounds', () => {
    const container = document.createElement('div');
    container.innerHTML = '<svg><g class="node" id="flowchart-A-0"><rect width="80" height="30"></rect><text>Start</text></g></svg>';
    const node = container.querySelector('g')!;
    (node as unknown as { getBBox: () => DOMRect }).getBBox = () => ({ x: 1, y: 2, width: 80, height: 30 } as DOMRect);
    expect(readDiagramNavigatorNodes(container)).toMatchObject([{ id: 'flowchart-A-0', label: 'Start', x: 1, y: 2, width: 80, height: 30 }]);
  });
});
