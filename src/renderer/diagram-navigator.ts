export interface DiagramNavigatorNode {
  id: string;
  label: string;
  element: SVGGElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

function labelForNode(element: SVGGElement): string {
  return (element.querySelector('foreignObject, .nodeLabel, text')?.textContent ?? element.id).trim().replace(/\s+/g, ' ');
}

export function readDiagramNavigatorNodes(container: HTMLElement): DiagramNavigatorNode[] {
  const svg = container.querySelector<SVGSVGElement>('svg');
  if (!svg) return [];
  return Array.from(svg.querySelectorAll<SVGGElement>('g.node')).flatMap((element) => {
    const box = element.getBBox();
    if (!Number.isFinite(box.x + box.y + box.width + box.height) || box.width <= 0 || box.height <= 0) return [];
    return [{ id: element.id, label: labelForNode(element), element, x: box.x, y: box.y, width: box.width, height: box.height }];
  });
}

export function focusDiagramNode(node: DiagramNavigatorNode, viewport: HTMLElement, scale = 1): void {
  const rect = viewport.getBoundingClientRect();
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;
  const svg = node.element.ownerSVGElement;
  if (!svg) return;
  const svgRect = svg.getBoundingClientRect();
  const ratioX = svg.viewBox.baseVal.width > 0 ? svg.viewBox.baseVal.width / svgRect.width : 1;
  const ratioY = svg.viewBox.baseVal.height > 0 ? svg.viewBox.baseVal.height / svgRect.height : 1;
  const renderedX = (centerX - svg.viewBox.baseVal.x) / ratioX + svgRect.left - viewport.getBoundingClientRect().left;
  const renderedY = (centerY - svg.viewBox.baseVal.y) / ratioY + svgRect.top - viewport.getBoundingClientRect().top;
  const targetX = rect.width / 2;
  const targetY = rect.height / 2;
  const current = scale;
  const transform = `translate(${targetX - renderedX * current}px, ${targetY - renderedY * current}px) scale(${current})`;
  const document = node.element.closest<HTMLElement>('.document');
  if (document) document.style.transform = transform;
}
