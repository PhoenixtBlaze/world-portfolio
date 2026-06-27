/**
 * Full-screen boot overlay with staged progress while GLBs and the world initialize.
 */
export class LoadingScreen {
  private readonly _root: HTMLElement;
  private readonly _bar: HTMLElement;
  private readonly _label: HTMLElement;
  private readonly _percent: HTMLElement;
  private readonly _error: HTMLElement;
  private _progress = 0;
  private _shownAt = performance.now();

  constructor() {
    const root = document.getElementById('load-screen');
    const bar = document.getElementById('load-bar');
    const label = document.getElementById('load-label');
    const percent = document.getElementById('load-percent');
    const error = document.getElementById('load-error');
    if (!(root instanceof HTMLElement)) throw new Error('Expected #load-screen.');
    if (!(bar instanceof HTMLElement)) throw new Error('Expected #load-bar.');
    if (!(label instanceof HTMLElement)) throw new Error('Expected #load-label.');
    if (!(percent instanceof HTMLElement)) throw new Error('Expected #load-percent.');
    if (!(error instanceof HTMLElement)) throw new Error('Expected #load-error.');
    this._root = root;
    this._bar = bar;
    this._label = label;
    this._percent = percent;
    this._error = error;
    document.body.classList.add('is-loading');
  }

  /** Update status copy and target progress (0–1). */
  setStage(label: string, progress: number): void {
    this._progress = Math.max(this._progress, Math.min(1, progress));
    this._label.textContent = label;
    this._bar.style.width = `${(this._progress * 100).toFixed(1)}%`;
    this._percent.textContent = `${Math.round(this._progress * 100)}%`;
    const track = this._bar.parentElement;
    if (track instanceof HTMLElement) {
      track.setAttribute('aria-valuenow', String(Math.round(this._progress * 100)));
    }
  }

  setError(message: string): void {
    this._error.hidden = false;
    this._error.textContent = message;
    this._root.classList.add('load-screen--error');
  }

  /** Fade out after a short minimum display time so the bar does not flash. */
  async complete(minVisibleMs = 700): Promise<void> {
    this.setStage('Entering world…', 1);
    const elapsed = performance.now() - this._shownAt;
    if (elapsed < minVisibleMs) {
      await new Promise((r) => setTimeout(r, minVisibleMs - elapsed));
    }
    this._root.classList.add('load-screen--hide');
    this._root.setAttribute('aria-busy', 'false');
    document.body.classList.remove('is-loading');
    document.body.classList.add('is-ready');
    await new Promise((r) => setTimeout(r, 520));
    this._root.remove();
  }
}
