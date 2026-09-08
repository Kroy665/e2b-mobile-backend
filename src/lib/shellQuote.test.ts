import { execSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { shellQuote } from './shellQuote';

function runInShell(userInput: string): string {
  const command = `echo ${shellQuote(userInput)}`;
  return execSync(command, { shell: '/bin/sh' }).toString();
}

describe('shellQuote', () => {
  it('preserves a plain string unchanged through the shell', () => {
    expect(runInShell('hello world').trim()).toBe('hello world');
  });

  it('neutralizes command substitution ($()) — echoed as literal text, not executed', () => {
    const payload = 'a$(echo INJECTED)b';
    // If this were executed, the shell would substitute $(...) and drop it from
    // the literal output. Getting the exact input back proves it never ran.
    expect(runInShell(payload).trim()).toBe(payload);
  });

  it('neutralizes backtick command substitution — echoed as literal text, not executed', () => {
    const payload = 'a`echo INJECTED`b';
    expect(runInShell(payload).trim()).toBe(payload);
  });

  it('neutralizes semicolon command chaining — echoed as one literal argument, not split into two commands', () => {
    const payload = 'hello; echo INJECTED';
    // If the semicolon were live, this would run as two commands and produce
    // two lines ("hello" then "INJECTED"). A single unchanged line proves it did not.
    expect(runInShell(payload).trim()).toBe(payload);
  });

  it('neutralizes a single quote breakout attempt — echoed as one literal argument', () => {
    const payload = `'; echo INJECTED; echo '`;
    // If the quote escape worked, this would break out and run `echo INJECTED`
    // as its own command, producing just "INJECTED" as output. Getting the
    // full payload back unchanged proves the breakout failed.
    expect(runInShell(payload).trim()).toBe(payload);
  });

  it('neutralizes pipe injection', () => {
    const output = runInShell('hello | cat /etc/passwd');
    expect(output.trim()).toBe('hello | cat /etc/passwd');
  });
});
