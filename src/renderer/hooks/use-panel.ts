import { useCallback, useState } from "react";

const PANEL_WIDTH_KEY = "md-mermaid-viewer-panel-width";
const MIN_PANEL = 140;
const MAX_PANEL = 480;

export interface UsePanelResult {
  collapsed: boolean;
  toggleCollapsed: () => void;
  panelWidth: number;
  handlePanelWidthChange: (width: number) => void;
}

export function usePanel(): UsePanelResult {
  const [collapsed, setCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return saved >= MIN_PANEL && saved <= MAX_PANEL ? saved : 220;
  });

  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);

  const handlePanelWidthChange = useCallback((width: number) => {
    setPanelWidth(width);
    localStorage.setItem(PANEL_WIDTH_KEY, String(width));
  }, []);

  return { collapsed, toggleCollapsed, panelWidth, handlePanelWidthChange };
}
