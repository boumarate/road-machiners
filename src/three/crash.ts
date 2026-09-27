// Any uncaught error stops the game behind a fullscreen message, so a crash is never silent.
// A save the game cannot load gets a button that deletes it and starts a new game.

import { clearSave, SaveError } from './save';

let shown = false;

export function installCrashScreen(): void {
  window.addEventListener('error', (e) => showCrash(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => showCrash(e.reason));
}

function showCrash(err: unknown): void {
  if (shown) return;
  shown = true;
  const text = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;inset:0;z-index:100000;background:rgba(40,8,6,0.96);color:#ffd8c8;padding:40px;overflow:auto;' +
    'font:14px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:28px;color:#ff7058;margin-bottom:20px;';
  title.textContent = 'The game crashed';
  const body = document.createElement('div');
  body.textContent = text;
  const hint = document.createElement('div');
  hint.style.cssText = 'margin-top:24px;color:#c8a898;';
  hint.textContent = 'Reload the page to start again.';
  box.append(title, body, hint);
  if (err instanceof SaveError) {
    const reset = document.createElement('button');
    reset.style.cssText = 'margin-top:16px;padding:10px 18px;font:inherit;font-size:16px;cursor:pointer;';
    reset.textContent = 'Yeah, fuck it, start a new game';
    reset.onclick = () => {
      clearSave(window.localStorage);
      window.location.reload();
    };
    box.append(reset);
  }
  document.body.appendChild(box);
}
