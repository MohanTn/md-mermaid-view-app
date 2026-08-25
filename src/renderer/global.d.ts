import type { ViewerApi } from "../shared/types";

declare global {
  interface Window {
    viewer: ViewerApi;
    __ORBIT_WEB__?: boolean;
  }
}

export {};
