import * as readline from 'readline';

// A single, unified keypress-driven input layer - used instead of
// readline.Interface, because mixing an active Interface (which keeps its
// own internal keypress listener attached the whole time raw mode is on,
// for its line-editing display) with a second, separate raw-mode reader on
// the same stream caused real conflicts: both consumed the same keystrokes,
// corrupting whatever line-based prompt came next. Having exactly one
// consumer of stdin for the whole program avoids that entirely.

export type SigintHandler = () => void;

let sigintHandler: SigintHandler | null = null;

export function setSigintHandler(handler: SigintHandler): void {
  sigintHandler = handler;
}

export function initTerminal(): void {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
}

interface KeypressInfo {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
}

function isCtrlC(str: string | undefined, key: KeypressInfo | undefined): boolean {
  return Boolean(key?.ctrl && key.name === 'c') || str === '';
}

function isEnter(key: KeypressInfo | undefined): boolean {
  return key?.name === 'return' || key?.name === 'enter';
}

// Resolves as soon as a keystroke matches one of `choices` - no Enter
// needed. Enter itself is normalized to ''.
export function readKey(promptText: string, choices: string[]): Promise<string> {
  process.stdout.write(promptText);
  return new Promise((resolve) => {
    const cleanup = () => {
      process.stdin.removeListener('keypress', onKeypress);
    };
    const onKeypress = (str: string | undefined, key: KeypressInfo) => {
      if (isCtrlC(str, key)) {
        cleanup();
        sigintHandler?.();
        return;
      }
      const normalized = isEnter(key) ? '' : (str ?? '').toLowerCase();
      if (choices.includes(normalized)) {
        cleanup();
        console.log(normalized);
        resolve(normalized);
      }
    };
    process.stdin.on('keypress', onKeypress);
  });
}

// A minimal hand-rolled line editor (echo + backspace) since raw mode
// doesn't echo or line-buffer anything itself.
export function readLine(promptText: string): Promise<string> {
  process.stdout.write(promptText);
  return new Promise((resolve) => {
    let buffer = '';
    const cleanup = () => {
      process.stdin.removeListener('keypress', onKeypress);
    };
    const onKeypress = (str: string | undefined, key: KeypressInfo) => {
      if (isCtrlC(str, key)) {
        cleanup();
        sigintHandler?.();
        return;
      }
      if (isEnter(key)) {
        cleanup();
        process.stdout.write('\n');
        resolve(buffer);
        return;
      }
      if (key?.name === 'backspace') {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      if (str && !key?.ctrl && !key?.meta) {
        buffer += str;
        process.stdout.write(str);
      }
    };
    process.stdin.on('keypress', onKeypress);
  });
}
