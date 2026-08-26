import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  panBy,
  resetTransform,
  wheelDeltaToPixels,
  zoomAtOrigin,
  type ViewTransform,
} from "../zoom-pan";

export interface UsePanZoomResult {
  transform: ViewTransform;
  setTransform: React.Dispatch<React.SetStateAction<ViewTransform>>;
  isPanning: boolean;
  zoomAtCenter: (factor: number) => void;
  beginPan: (event: ReactPointerEvent<HTMLDivElement>) => void;
  movePan: (event: ReactPointerEvent<HTMLDivElement>) => void;
  endPan: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Shared ref: set to true when the pointer has moved during a drag (used to
   *  suppress node click handlers after panning). */
  panMovedRef: React.MutableRefObject<boolean>;
}

export function usePanZoom(
  isMermaidView: boolean,
  viewportRef: React.RefObject<HTMLDivElement | null>,
): UsePanZoomResult {
  const [transform, setTransform] = useState<ViewTransform>(() =>
    resetTransform(),
  );
  const [isPanning, setIsPanning] = useState(false);
  const panMovedRef = useRef(false);
  const panOrigin = useRef({ x: 0, y: 0 });
  const panStart = useRef<ViewTransform>(resetTransform());
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number } | null>(null);

  // ────────────────────────────────────────────────────────────
  // Wheel: plain scroll → pan; Ctrl/Cmd + scroll → pinch zoom
  // ────────────────────────────────────────────────────────────
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!isMermaidView) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      if (event.ctrlKey || event.metaKey) {
        const pixels = wheelDeltaToPixels(
          event.deltaY,
          event.deltaMode,
          rect.height,
        );
        setTransform((cur) =>
          zoomAtOrigin(
            cur,
            px,
            py,
            Math.exp(-pixels * 0.002),
            rect.width / 2,
            rect.height / 2,
          ),
        );
      } else {
        const dx = wheelDeltaToPixels(
          event.deltaX,
          event.deltaMode,
          rect.width,
        );
        const dy = wheelDeltaToPixels(
          event.deltaY,
          event.deltaMode,
          rect.height,
        );
        setTransform((cur) => panBy(cur, -dx, -dy));
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [isMermaidView]);

  // ────────────────────────────────────────────────────────────
  // Zoom-to-center helper (used by toolbar buttons + shortcuts)
  // ────────────────────────────────────────────────────────────
  function zoomAtCenter(factor: number): void {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    setTransform((cur) =>
      zoomAtOrigin(
        cur,
        rect.width / 2,
        rect.height / 2,
        factor,
        rect.width / 2,
        rect.height / 2,
      ),
    );
  }

  // ────────────────────────────────────────────────────────────
  // Pointer-based drag-to-pan and two-finger pinch-to-zoom
  // ────────────────────────────────────────────────────────────
  function beginPan(event: React.PointerEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, select, textarea")) return;
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointersRef.current.size === 2) {
      const points = [...pointersRef.current.values()];
      pinchRef.current = {
        distance: Math.hypot(
          points[0].x - points[1].x,
          points[0].y - points[1].y,
        ),
      };
      setIsPanning(true);
    } else if (pointersRef.current.size === 1) {
      event.currentTarget.setPointerCapture(event.pointerId);
      panOrigin.current = { x: event.clientX, y: event.clientY };
      panStart.current = transform;
      panMovedRef.current = false;
      setIsPanning(true);
    }
  }

  function movePan(event: React.PointerEvent<HTMLDivElement>): void {
    const point = pointersRef.current.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const points = [...pointersRef.current.values()];
      const rect = event.currentTarget.getBoundingClientRect();
      const newDistance = Math.hypot(
        points[0].x - points[1].x,
        points[0].y - points[1].y,
      );
      const midX = (points[0].x + points[1].x) / 2 - rect.left;
      const midY = (points[0].y + points[1].y) / 2 - rect.top;
      const factor = newDistance / pinchRef.current.distance;
      pinchRef.current.distance = newDistance;
      setTransform((cur) =>
        zoomAtOrigin(cur, midX, midY, factor, rect.width / 2, rect.height / 2),
      );
      panMovedRef.current = true;
    } else if (pointersRef.current.size === 1 && isPanning) {
      if (
        Math.abs(event.clientX - panOrigin.current.x) +
          Math.abs(event.clientY - panOrigin.current.y) >
        4
      ) {
        panMovedRef.current = true;
      }
      setTransform({
        ...panStart.current,
        x: panStart.current.x + (event.clientX - panOrigin.current.x),
        y: panStart.current.y + (event.clientY - panOrigin.current.y),
      });
    }
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>): void {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return {
    transform,
    setTransform,
    isPanning,
    zoomAtCenter,
    beginPan,
    movePan,
    endPan,
    panMovedRef,
  };
}
