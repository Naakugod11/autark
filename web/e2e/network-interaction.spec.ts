import { test, expect, type Page } from "@playwright/test";
import { waitForGraph, settledGraph, type DebugState } from "./helpers";

// web/e2e/network-interaction.spec.ts — Task 2 proof: pan/zoom/drag actually
// wire up on /network's canvas. Routed to only the "desktop" project (see
// playwright.config.ts) — mobile tap/touch/no-overflow is covered separately
// in e2e/mobile-viewport.spec.ts.
//
// The canvas draws with 2D context, so there's no DOM to query per-node.
// `?e2e=1` opts into NetworkGraph.tsx's debug hook (window.__networkGraphDebug),
// which is otherwise inert in production — see that file's comment — giving
// these tests real node screen coordinates instead of guessing pixels.
// waitForGraph (e2e/helpers.ts) also waits for d3-force to settle before
// handing back coordinates — see that file's comment for why that matters.
//
// All tests here share ONE page/navigation (test.describe.configure serial +
// beforeAll), not one each: /network's backfill is a real ~150-event RPC
// read against a rate-limited devnet key, done client-side per browser
// context — six independent navigations would mean six independent
// backfills against the same shared key for what a single real visitor's
// tab only ever pays for once. beforeEach resets the view/selection between
// tests so they stay independent despite the shared page.
test.describe.configure({ mode: "serial" });

test.describe("network graph interaction", () => {
  let page: Page;
  // Refreshed every beforeEach, NOT captured once — the sim keeps running
  // between tests (the drag test deliberately displaces a node), so a node's
  // screen position from test 1 is stale by test 5. Every test reads
  // `current`, settled fresh right before it runs, instead of a shared
  // snapshot from beforeAll.
  let current: DebugState;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await waitForGraph(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test.beforeEach(async () => {
    // Deselect FIRST, before touching RESET VIEW: an open side panel
    // (NetworkSidePanel/NetworkEdgePanel) is `absolute right-0`, overlapping
    // the also-top-right RESET VIEW button, so clicking the button first
    // while a panel from the previous test is still open gets intercepted
    // by the panel instead. A plain click (no movement) on empty canvas is
    // exactly what NetworkGraph.tsx's own handlePointerUp treats as
    // "deselect" when it misses every node/edge, closing either panel.
    const canvas = page.locator("canvas");
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + 8, box.y + 8);
    const resetBtn = page.getByRole("button", { name: "RESET VIEW" });
    if (await resetBtn.count()) await resetBtn.click();
    current = await settledGraph(page);
  });

  test("wheel zoom changes the view scale", async () => {
    const canvas = page.locator("canvas");
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400); // negative deltaY == zoom in, matches NetworkGraph.tsx's onWheel
    await page.waitForFunction(
      () => (window as unknown as { __networkGraphDebug: DebugState }).__networkGraphDebug.view.k !== 1,
      { timeout: 5_000 }
    );
    const after = await page.evaluate(() => (window as unknown as { __networkGraphDebug: DebugState }).__networkGraphDebug);
    expect(after.view.k).not.toBeCloseTo(1, 5);
  });

  test("dragging empty canvas pans the view", async () => {
    const canvas = page.locator("canvas");
    const box = (await canvas.boundingBox())!;
    // Top-left corner of the canvas — far from the force-centered node
    // cluster, so this reliably misses every node and hits pan, not drag.
    const startX = box.x + 8;
    const startY = box.y + 8;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 60, startY + 40, { steps: 8 });
    await page.mouse.up();
    const after = await page.evaluate(() => (window as unknown as { __networkGraphDebug: DebugState }).__networkGraphDebug);
    expect(after.view.x).not.toBeCloseTo(0, 3);
    expect(after.view.y).not.toBeCloseTo(0, 3);
  });

  test("dragging a node moves it independently of the view (pins fx/fy)", async () => {
    const node = current.nodes[0];
    const canvas = page.locator("canvas");
    const box = (await canvas.boundingBox())!;
    // beforeEach just reset the view to identity, so world == screen here.
    const screenX = box.x + node.x;
    const screenY = box.y + node.y;

    await page.mouse.move(screenX, screenY);
    await page.mouse.down();
    await page.mouse.move(screenX + 70, screenY - 50, { steps: 10 });
    await page.waitForFunction(
      ({ owner, x, y }) => {
        const dbg = (window as unknown as { __networkGraphDebug: DebugState }).__networkGraphDebug;
        const n = dbg.nodes.find((n) => n.owner === owner);
        return !!n && (Math.abs(n.x - x) > 20 || Math.abs(n.y - y) > 20);
      },
      { owner: node.owner, x: node.x, y: node.y },
      { timeout: 5_000 }
    );
    await page.mouse.up();

    const after = await page.evaluate(() => (window as unknown as { __networkGraphDebug: DebugState }).__networkGraphDebug);
    // The view itself must NOT have panned — only the dragged node moved,
    // proving this pointerdown was routed to node-drag, not canvas-pan.
    expect(after.view.x).toBeCloseTo(0, 3);
    expect(after.view.y).toBeCloseTo(0, 3);
    const moved = after.nodes.find((n) => n.owner === node.owner)!;
    expect(Math.hypot(moved.x - node.x, moved.y - node.y)).toBeGreaterThan(20);
  });

  test("reset view returns scale/pan to identity after zoom+pan", async () => {
    const canvas = page.locator("canvas");
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await page.mouse.move(box.x + 8, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 60, { steps: 6 });
    await page.mouse.up();

    const disturbed = await page.evaluate(() => (window as unknown as { __networkGraphDebug: DebugState }).__networkGraphDebug.view);
    expect(disturbed.k).not.toBeCloseTo(1, 5);

    await page.getByRole("button", { name: "RESET VIEW" }).click();
    const reset = await page.evaluate(() => (window as unknown as { __networkGraphDebug: DebugState }).__networkGraphDebug.view);
    expect(reset).toEqual({ x: 0, y: 0, k: 1 });
  });

  test("clicking a node opens the agent side panel", async () => {
    const node = current.nodes[0];
    const canvas = page.locator("canvas");
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + node.x, box.y + node.y);
    await expect(page.getByText("AGENT RECORD")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("VIEW FULL PROFILE")).toBeVisible();
  });

  test("clicking an edge opens the relationship history panel", async () => {
    test.skip(current.edges.length === 0, "no aggregated relationships in this snapshot to click");
    const edge = current.edges[0];
    const canvas = page.locator("canvas");
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + edge.midX, box.y + edge.midY);
    await expect(page.getByText("RELATIONSHIP")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("ECONOMIC LOG")).toBeVisible();
  });
});
