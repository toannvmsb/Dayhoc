import type { Browser, Page } from '@playwright/test';
import { expect } from '@playwright/test';

let seq = 0;
export function uniqueEmail(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}@dayzi.test`;
}

/** Register a fresh PARENT via the welcome form; ends on /onboarding or /be/*. */
export async function registerParent(page: Page, email: string): Promise<void> {
  await page.goto('/welcome');
  await page.getByLabel('Tên bố / mẹ').fill('E2E Phụ huynh');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu (tối thiểu 8 ký tự)').fill('password1234');
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
  await page.waitForURL(/\/(onboarding|be)/);
}

/** Register a fresh TEACHER via the welcome form. */
export async function registerTeacher(page: Page, email: string): Promise<void> {
  await page.goto('/welcome?mode=teacher');
  await page.getByLabel('Tên giáo viên').fill('E2E Giáo viên');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu (tối thiểu 8 ký tự)').fill('password1234');
  await page.getByRole('button', { name: 'Tạo tài khoản giáo viên' }).click();
  await page.waitForURL(/\/giao-vien/);
}

/** Log in an existing account by email (dev auth = email only). */
export async function loginAs(page: Page, email: string): Promise<void> {
  await page.goto('/welcome?mode=login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/welcome'));
}

/** Create the first child through onboarding; returns the childId from the URL. */
export async function createChildViaOnboarding(page: Page, name: string, grade: 4 | 7): Promise<string> {
  await page.goto('/onboarding');
  await page.getByLabel('Tên con').fill(name);
  await page.getByText(`Lớp ${grade}`, { exact: true }).click();
  await page.getByRole('button', { name: /Tạo hồ sơ/ }).click();
  await page.waitForURL(/\/be\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const m = page.url().match(/\/be\/([0-9a-f-]{36})/);
  if (!m) throw new Error(`no childId in ${page.url()}`);
  return m[1]!;
}

export async function seedEvidence(
  page: Page,
  childId: string,
  evidence: Array<{ skillId: string; correct: boolean; daysAgo?: number; reasoningQuality?: 'weak' | 'adequate' | 'strong' }>,
): Promise<void> {
  const res = await page.request.post('/api/test/seed', { data: { childId, evidence } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Walk the practice runner to completion (answers every question). */
export async function runAssignment(page: Page): Promise<void> {
  for (let i = 0; i < 15; i += 1) {
    const input = page.locator('input[placeholder="Câu trả lời của con…"]');
    const choice = page.locator('button.child-task');
    if (await input.count()) await input.fill('1');
    else if (await choice.count()) await choice.first().click();
    const next = page.getByRole('button', { name: /Câu tiếp theo|Nộp bài/ });
    await expect(next).toBeEnabled();
    const label = await next.textContent();
    await next.click();
    if (label?.includes('Nộp bài')) return;
  }
}

export async function newContext(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  return ctx.newPage();
}
