// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function render(creatorReady: boolean) {
  vi.resetModules();
  document.body.innerHTML = '<main id="content"></main><p id="status"></p><p id="page"></p><p id="source-label"></p><button id="close"></button>';
  const sendMessage = vi.fn(async () => ({ ok: true, data: { url: 'https://example.test/demo.html', creatorReady } }));
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  await import('./secure-collaboration');
  await vi.waitFor(() => expect(document.querySelector('button[value="create"]')).not.toBeNull());
  return sendMessage;
}

describe('creation login ordering', () => {
  it('offers data-minimized help without an identity reset for uncertain registration', async () => {
    vi.resetModules();
    document.body.innerHTML = '<main id="content"></main><p id="status"></p><p id="page"></p><p id="source-label"></p><button id="close"></button>';
    const sendMessage = vi.fn(async () => ({ ok: false, error: 'guest-registration-uncertain' }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    await import('./secure-collaboration');
    await vi.waitFor(() => expect(document.querySelector('#guest-support')).not.toBeNull());
    expect(document.querySelector('#status')?.textContent).toContain('不能保证自动恢复');
    const link = document.querySelector<HTMLAnchorElement>('#guest-support a')!;
    expect(link.href).toBe('https://github.com/ningsiii/ClickDeck/issues');
    expect(link.rel).toBe('noopener noreferrer');
    expect(document.querySelector('#guest-support')?.textContent).toContain('不要公开邀请码');
    expect(document.querySelector('#recover-identity')).toBeNull();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
  it('requires login before creation and keeps invitation joining available', async () => {
    const send = await render(false);
    expect(document.querySelector<HTMLButtonElement>('button[value="create"]')!.disabled).toBe(true);
    const login = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('使用 Google'))!;
    expect(login.hidden).toBe(false);
    document.querySelector<HTMLButtonElement>('[data-mode="join"]')!.click();
    expect(login.hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('button[value="join"]')!.disabled).toBe(false);
    document.querySelector<HTMLButtonElement>('[data-mode="create"]')!.click();
    expect(document.querySelector<HTMLButtonElement>('button[value="create"]')!.disabled).toBe(true);
    expect(send.mock.calls).toHaveLength(1); // viewing creates no identity or project
  });
  it('restores a verified existing login without asking for login again', async () => {
    await render(true);
    expect(document.querySelector<HTMLButtonElement>('button[value="create"]')!.disabled).toBe(false);
    expect([...document.querySelectorAll('button')].find(button => button.textContent?.includes('使用 Google'))!.hidden).toBe(true);
  });
});
