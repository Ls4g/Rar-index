declare module "page-flip/dist/js/page-flip.module.js" {
  export class PageFlip {
    constructor(element: HTMLElement, settings: {
      width: number;
      height: number;
      size: "fixed" | "stretch";
      minWidth?: number;
      maxWidth?: number;
      minHeight?: number;
      maxHeight?: number;
      usePortrait?: boolean;
      showCover?: boolean;
      drawShadow?: boolean;
      maxShadowOpacity?: number;
      flippingTime?: number;
      showPageCorners?: boolean;
      disableFlipByClick?: boolean;
      mobileScrollSupport?: boolean;
      useMouseEvents?: boolean;
    });
    loadFromHTML(pages: HTMLElement[]): void;
    on(event: "flip", callback: (event: { data: number }) => void): this;
    flipNext(corner?: "top" | "bottom"): void;
    flipPrev(corner?: "top" | "bottom"): void;
    startUserTouch(point: { x: number; y: number }): void;
    userMove(point: { x: number; y: number }, isTouch: boolean): void;
    userStop(point: { x: number; y: number }, cancelled?: boolean): void;
    getUI(): { onResize: () => void };
    destroy(): void;
  }
}
