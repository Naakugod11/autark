import { test, expect, type Page } from "@playwright/test";
import { waitForGraph } from "./helpers";

// web/e2e/mobile-viewport.spec.ts — proof that the dashboard holds at a
// 390px mobile viewport (no horizontal overflow) and that touch interaction
// on /network follows the documented "first tap = select, second tap =
// through to profile" pattern (see NetworkGraph.tsx's handlePointerUp).
// Runs under playwright.config.ts's "mobile-390" project (390x844, touch).

async function noHorizontalOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test.describe("390px viewport", () => {
  for (const path of ["/", "/network", "/terminal"]) {
    test(`${path} has no horizontal overflow at 390px`, async ({ page }) => {
      await page.goto(path);
      // Not "networkidle": /network and /terminal hold an open live
      // RPC/WebSocket subscription (EconomyProvider) that never goes idle,
      // so that wait would just stall until it times out. Layout/overflow is
      // a CSS concern settled well before data streams in — "load" plus a
      // short settle beats waiting on a network state this page never reaches.
      await page.waitForTimeout(2_000);
      const { scrollWidth, clientWidth } = await noHorizontalOverflow(page);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // +1px rounding tolerance
    });
  }

  test("network graph tap targets: first tap selects, second tap on same node navigates to profile", async ({ page }) => {
    const state = await waitForGraph(page);
    const node = state.nodes[0];
    const canvas = page.locator("canvas");
    const box = (await canvas.boundingBox())!;
    const x = box.x + node.x;
    const y = box.y + node.y;

    await page.touchscreen.tap(x, y);
    await expect(page.getByText("AGENT RECORD")).toBeVisible({ timeout: 10_000 });

    await page.touchscreen.tap(x, y);
    await page.waitForURL(/\/agent\//, { timeout: 10_000 });
    expect(page.url()).toContain(`/agent/${node.owner}`);
  });
});
