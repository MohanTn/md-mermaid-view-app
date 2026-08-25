import type { ViewerApi } from "../shared/types";

declare global {
  interface Window {
    viewer: ViewerApi;
  }
}

export {};
