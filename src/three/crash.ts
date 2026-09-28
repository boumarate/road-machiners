// Any uncaught error stops the game behind a fullscreen message, so a crash is never silent.
// A save the game cannot load gets a button that deletes it and starts a new game.
// Outside dev, once boot is done, the game keeps running: an error goes to the browser log and the debug console.
// A failed command changes nothing, since commands mutate a clone of the world. Boot and save errors still crash.

import { clearGame, SaveError } from './save';

let shown = false;
let report: ((text: string) => void) | null = null;
const reported = new Set<string>();

export function installCrashScreen(): void {
  window.addEventListener('error', (e) => onError(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => onError(e.reason));
}

// Call once the game runs. Does nothing in dev, where every error crashes.
export function keepRunningOnErrors(to: (text: string) => void): void {
  if (!import.meta.env.DEV) report = to;
}

function onError(err: unknown): void {
  if (!report || err instanceof SaveError) return showCrash(err);
  const text = err instanceof Error ? err.message : String(err);
  // The browser logs every error itself. The debug console gets each message once, so a per-frame error does not flood it.
  if (reported.has(text)) return;
  reported.add(text);
  report(`Error: ${text}`);
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
      clearGame(window.localStorage);
      window.location.reload();
    };
    box.append(reset);
  }
  document.body.appendChild(box);
}
