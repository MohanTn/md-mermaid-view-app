import { useEffect } from "react";
import { resetTransform } from "../zoom-pan";
import type { ViewTransform } from "../zoom-pan";

interface UseKeyboardShortcutsParams {
  chooseFile: () => void;
  zoomAtCenter: (factor: number) => void;
  setTransform: React.Dispatch<React.SetStateAction<ViewTransform>>;
  toggleCollapsed: () => void;
}

export function useKeyboardShortcuts({
  chooseFile,
  zoomAtCenter,
  setTransform,
  toggleCollapsed,
}: UseKeyboardShortcutsParams): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === "o") {
        event.preventDefault();
        void chooseFile();
      }
      if (mod && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        zoomAtCenter(1.25);
      }
      if (mod && event.key === "-") {
        event.preventDefault();
        zoomAtCenter(0.8);
      }
      if (mod && event.key === "0") {
        event.preventDefault();
        setTransform(resetTransform());
      }
      if (mod && key === "b") {
        event.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooseFile, zoomAtCenter, setTransform, toggleCollapsed]);
}
