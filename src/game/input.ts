export class InputManager {
  private steerLeft = false;
  private steerRight = false;

  private leftTouches: Set<number> = new Set();
  private rightTouches: Set<number> = new Set();

  private leftButtonEl: HTMLElement | null = null;
  private rightButtonEl: HTMLElement | null = null;

  private onKeyDownHandler: ((e: KeyboardEvent) => void) | null = null;
  private onKeyUpHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    this.setupKeyboard();
  }

  private setupKeyboard(): void {
    this.onKeyDownHandler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.code === 'KeyA' || e.key === 'a' || e.key === 'A') {
        this.steerLeft = true;
      }
      if (e.key === 'ArrowRight' || e.code === 'KeyD' || e.key === 'd' || e.key === 'D') {
        this.steerRight = true;
      }
    };

    this.onKeyUpHandler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.code === 'KeyA' || e.key === 'a' || e.key === 'A') {
        this.steerLeft = false;
      }
      if (e.key === 'ArrowRight' || e.code === 'KeyD' || e.key === 'd' || e.key === 'D') {
        this.steerRight = false;
      }
    };

    window.addEventListener('keydown', this.onKeyDownHandler);
    window.addEventListener('keyup', this.onKeyUpHandler);
  }

  /**
   * Bind touch input handlers to on-screen steering buttons
   */
  public bindTouchButtons(leftEl: HTMLElement, rightEl: HTMLElement): void {
    this.leftButtonEl = leftEl;
    this.rightButtonEl = rightEl;

    // Multi-touch handling on Left Button
    leftEl.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          this.leftTouches.add(e.changedTouches[i].identifier);
        }
        this.updateTouchState();
      },
      { passive: false }
    );

    const handleLeftEnd = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        this.leftTouches.delete(e.changedTouches[i].identifier);
      }
      this.updateTouchState();
    };
    leftEl.addEventListener('touchend', handleLeftEnd, { passive: false });
    leftEl.addEventListener('touchcancel', handleLeftEnd, { passive: false });

    // Multi-touch handling on Right Button
    rightEl.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          this.rightTouches.add(e.changedTouches[i].identifier);
        }
        this.updateTouchState();
      },
      { passive: false }
    );

    const handleRightEnd = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        this.rightTouches.delete(e.changedTouches[i].identifier);
      }
      this.updateTouchState();
    };
    rightEl.addEventListener('touchend', handleRightEnd, { passive: false });
    rightEl.addEventListener('touchcancel', handleRightEnd, { passive: false });

    // Pointer support for mouse testing
    leftEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.leftTouches.add(e.pointerId);
      this.updateTouchState();
    });
    const handleLeftPointerEnd = (e: PointerEvent) => {
      this.leftTouches.delete(e.pointerId);
      this.updateTouchState();
    };
    leftEl.addEventListener('pointerup', handleLeftPointerEnd);
    leftEl.addEventListener('pointerleave', handleLeftPointerEnd);
    leftEl.addEventListener('pointercancel', handleLeftPointerEnd);

    rightEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.rightTouches.add(e.pointerId);
      this.updateTouchState();
    });
    const handleRightPointerEnd = (e: PointerEvent) => {
      this.rightTouches.delete(e.pointerId);
      this.updateTouchState();
    };
    rightEl.addEventListener('pointerup', handleRightPointerEnd);
    rightEl.addEventListener('pointerleave', handleRightPointerEnd);
    rightEl.addEventListener('pointercancel', handleRightPointerEnd);
  }

  private updateTouchState(): void {
    const isLeft = this.leftTouches.size > 0;
    const isRight = this.rightTouches.size > 0;

    if (this.leftButtonEl) {
      if (isLeft) this.leftButtonEl.classList.add('steer-btn-active');
      else this.leftButtonEl.classList.remove('steer-btn-active');
    }
    if (this.rightButtonEl) {
      if (isRight) this.rightButtonEl.classList.add('steer-btn-active');
      else this.rightButtonEl.classList.remove('steer-btn-active');
    }
  }

  /**
   * Returns -1 for steer left, +1 for steer right, 0 for neutral
   */
  public getSteerInput(): number {
    const leftActive = this.steerLeft || this.leftTouches.size > 0;
    const rightActive = this.steerRight || this.rightTouches.size > 0;

    if (leftActive && !rightActive) return -1;
    if (rightActive && !leftActive) return 1;
    return 0;
  }

  public isLeftActive(): boolean {
    return this.steerLeft || this.leftTouches.size > 0;
  }

  public isRightActive(): boolean {
    return this.steerRight || this.rightTouches.size > 0;
  }

  public destroy(): void {
    if (this.onKeyDownHandler) {
      window.removeEventListener('keydown', this.onKeyDownHandler);
    }
    if (this.onKeyUpHandler) {
      window.removeEventListener('keyup', this.onKeyUpHandler);
    }
    this.leftTouches.clear();
    this.rightTouches.clear();
  }
}
