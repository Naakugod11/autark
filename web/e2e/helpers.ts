import { expect, type Page } from "@playwright/test";

// web/e2e/helpers.ts — shared between network-interaction.spec.ts and
// mobile-viewport.spec.ts: both need the same "wait for the graph to load,
// then wait for d3-force to actually settle" sequence before trusting a
// node's screen coordinates (see settledGraph's own comment for why).

export type DebugState = {
  view: { x: number; y: number; k: number };
  nodes: { owner: string; x: number; y: number }[];
  edges: { id: string; midX: number; midY: number }[];
};

async function readDebug(page: Page): Promise<DebugState> {
  return page.evaluate(() => (window as unknown as { __networkGraphDebug: DebugState }).__networkGraphDebug);
}

export async function settledGraph(page: Page): Promise<DebugState> {
  let prev = await readDebug(page);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(400);
    const next = await readDebug(page);
    const maxDelta = Math.max(
      0,
      ...next.nodes.map((n) => {
        const p = prev.nodes.find((x) => x.owner === n.owner);
        return p ? Math.hypot(n.x - p.x, n.y - p.y) : 0;
      })
    );
    prev = next;
    if (maxDelta < 1.5) break;
  }
  return prev;
}

export async function waitForGraph(page: Page): Promise<DebugState> {
  await page.goto("/network?e2e=1");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(
    () => {
      const dbg = (window as unknown as { __networkGraphDebug?: DebugState }).__networkGraphDebug;
      return !!dbg && dbg.nodes.length > 0;
    },
    { timeout: 30_000 }
  );
  return settledGraph(page);
}
