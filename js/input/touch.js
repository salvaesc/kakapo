// Fallback control when there is no microphone: press & hold anywhere on the game.
// The level jumps to a soft value on press and rises while held, so the analog
// feel (soft vs loud) can still be tested. Space / ArrowUp work on desktop.
export class TouchControl {
  constructor(config, target) {
    this.cfg = config.touch;
    this.target = target;
    this.pointers = 0;
    this.keys = 0;
    this.level = 0;
    this.heldFor = 0;
    this._down = (e) => {
      if (e.target.closest && e.target.closest('button, a, .panel')) return;
      this.pointers++;
      e.preventDefault();
    };
    this._up = () => { this.pointers = Math.max(0, this.pointers - 1); };
    this._kd = (e) => {
      if ((e.code === 'Space' || e.code === 'ArrowUp') && !e.repeat) {
        if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
        this.keys = 1;
        e.preventDefault();
      }
    };
    this._ku = (e) => { if (e.code === 'Space' || e.code === 'ArrowUp') this.keys = 0; };
    this._blur = () => { this.pointers = 0; this.keys = 0; };
    target.addEventListener('pointerdown', this._down);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointercancel', this._up);
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    window.addEventListener('blur', this._blur);
  }

  get held() { return this.pointers > 0 || this.keys > 0; }

  sample(dt) {
    if (this.held) {
      this.heldFor += dt;
      this.level = Math.min(1, this.cfg.pressLevel + this.heldFor * this.cfg.rampPerSec);
    } else {
      this.heldFor = 0;
      this.level = Math.max(0, this.level - this.cfg.releasePerSec * dt);
    }
    return this.level;
  }

  reset() { this.pointers = 0; this.keys = 0; this.level = 0; this.heldFor = 0; }

  destroy() {
    this.target.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('pointercancel', this._up);
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    window.removeEventListener('blur', this._blur);
  }
}
