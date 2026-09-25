/**
 * Every example, in a real browser, served by `examples/serve.mjs` the way
 * `npm run examples` runs it (Vite + `@doeixd/affe/vite`). Each spec loads
 * the page, does what a visitor would, and fails on any page error — the
 * `WithLayer`, `Route.Switch`, control-flow and `Route.Link` bugs fixed in
 * 0.6.0 all broke examples that no test ran.
 */
import { expect, test, type Page } from "@playwright/test";
import { examples, portOf } from "../examples/examples-list.mjs";

const urlOf = (name: string, path = "/") => `http://127.0.0.1:${portOf(name)}${path}`;

/** Collects page errors; the favicon 404 and blocked third-party fetches are noise. */
function watchErrors(page: Page): Array<string> {
  const errors: Array<string> = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.startsWith("Failed to load resource")) return;
    errors.push(text);
  });
  return errors;
}

test.describe("examples", () => {
  test("every served example is covered here", () => {
    expect(examples).toEqual([
      "counter",
      "ooo-async",
      "projection",
      "router-basic",
      "router-golden-path",
      "router-single-flight",
      "router-single-flight-fetch",
      "router-typed-links",
      "rpc-httpapi",
      "schema-form",
      "ssr",
      "styled-card",
      "styled-combobox",
      "todomvc",
    ]);
  });

  test("counter: local and shared atoms update", async ({ page }) => {
    const errors = watchErrors(page);
    // The async card fetches a public API; answer it locally.
    await page.route("https://jsonplaceholder.typicode.com/**", (route) =>
      route.fulfill({ json: { id: 1, name: "Leanne Graham", email: "leanne@example.com", phone: "1" } }));
    await page.goto(urlOf("counter"));
    const local = page.locator(".counter").first();
    await local.getByRole("button", { name: "+" }).click();
    await local.getByRole("button", { name: "+" }).click();
    await expect(local).toContainText("Count: 2 - doubled: 4 - even");
    await local.getByRole("button", { name: "Batch → 15" }).click();
    await expect(local).toContainText("Count: 15 - doubled: 30 - odd");
    const shared = page.locator(".counter").nth(1);
    await shared.getByRole("button", { name: "+" }).click();
    await expect(page.locator(".counter").nth(2)).toContainText("Count: 1");
    await expect(page.getByText("Leanne Graham")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("ooo-async: pulled chunks render in order; forced error toggles", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(urlOf("ooo-async"));
    await page.getByRole("button", { name: "Pull next chunk" }).click();
    await expect(page.getByText(/Items:/)).toBeVisible();
    await page.getByRole("button", { name: "Toggle forced error" }).click();
    await expect(page.getByText("Error: Manually forced stream error")).toBeVisible();
    await page.getByRole("button", { name: "Toggle forced error" }).click();
    await expect(page.getByText("Error: Manually forced stream error")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("projection: renders all three projections", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(urlOf("projection"));
    await expect(page.getByText(/Selected map:/)).toBeVisible();
    await page.getByRole("button", { name: "Select B" }).click();
    await expect(page.getByText(/"b":true/)).toBeVisible();
    await page.getByRole("button", { name: "Bump multiplier" }).click();
    await expect(page.getByText(/value=\d+/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("router-basic: links switch pages", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(urlOf("router-basic"));
    await expect(page.locator("h2")).toHaveText("Home");
    await page.getByRole("link", { name: "Users", exact: true }).click();
    await expect(page.locator("h2")).toHaveText("Users");
    await page.goto(urlOf("router-basic", "/users/bob"));
    await expect(page.getByText("Current user: bob")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("router-golden-path: Route.Link navigation and loaders", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(urlOf("router-golden-path"));
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
    await page.getByRole("link", { name: "Users", exact: true }).click();
    await expect(page).toHaveURL(/\/users$/);
    await expect(page.getByText("Alice — alice@example.com")).toBeVisible();
    await expect(page.getByRole("link", { name: "Users", exact: true })).toHaveClass(/active/);
    await page.getByRole("link", { name: "Teams", exact: true }).click();
    await expect(page.getByRole("link", { name: "Teams", exact: true })).toHaveClass(/active/);
    await expect(page.getByText("404 — Page not found")).toHaveCount(0);
    await page.goBack();
    await expect(page.getByText("Alice — alice@example.com")).toBeVisible();
    expect(errors).toEqual([]);
  });

  for (const name of ["router-single-flight", "router-single-flight-fetch"]) {
    test(`${name}: list, detail and a single-flight mutation`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto(urlOf(name));
      await page.getByRole("link", { name: "Users", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
      await page.goto(urlOf(name, "/users/alice"));
      const heading = page.locator("section h2");
      await expect(heading).not.toHaveText("");
      const before = (await heading.textContent()) ?? "";
      await page.getByRole("button", { name: "Toggle Exclamation" }).click();
      await expect(heading).not.toHaveText(before);
      expect(errors).toEqual([]);
    });
  }

  test("router-typed-links: typed links navigate and mark the active one", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(urlOf("router-typed-links"));
    await page.getByRole("link", { name: "Alice Profile" }).click();
    await expect(page).toHaveURL(/\/users\/alice$/);
    await expect(page.locator("body")).not.toContainText("Pick a link above");
    await page.getByRole("link", { name: "Search Alice" }).click();
    await expect(page).toHaveURL(/\/search\?/);
    await expect(page.getByRole("link", { name: "Search Alice" })).toHaveClass("active");
    expect(errors).toEqual([]);
  });

  test("rpc-httpapi: queries resolve and a mutation refreshes", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(urlOf("rpc-httpapi"));
    await expect(page.getByText("Current Name: User 42")).toBeVisible();
    await expect(page.getByText("Todo 3")).toBeVisible();
    await page.getByPlaceholder("New Name").fill("Ada");
    await page.getByRole("button", { name: "Update & Refresh" }).click();
    await expect(page.getByText("Current Name: User 42")).toBeVisible();
    await page.getByRole("button", { name: "Refresh List" }).click();
    await expect(page.getByText("Todo 3")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("schema-form: typing validates and updates the summary", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(urlOf("schema-form"));
    const name = page.locator("input").first();
    await name.fill("Grace");
    await expect(page.getByText("Summary: Grace (age: 30)")).toBeVisible();
    await expect(page.getByText("dirty: yes").first()).toBeVisible();
    await page.getByRole("button", { name: "Reset All" }).click();
    await expect(page.getByText("Summary: Alice (age: 30)")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("ssr: renders to a string and runs the live component", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(urlOf("ssr"));
    await page.getByRole("button", { name: /renderToString/ }).click();
    await expect(page.locator("pre, code").filter({ hasText: "<" }).first()).toBeVisible();
    const live = page.getByRole("heading", { name: /^Counter: \d+$/ });
    await expect(live).toContainText("Counter: 0");
    await page.getByRole("button", { name: "+" }).first().click();
    await expect(live).toContainText("Counter: 1");
    expect(errors).toEqual([]);
  });

  test("styled-card: slot styles reach the elements", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(urlOf("styled-card"));
    const title = page.locator("[data-af-slot=title]").first();
    await expect(title).toHaveText("Users");
    const padding = await page.locator("[data-af-slot=root]").first().evaluate((el) => getComputedStyle(el).padding);
    expect(padding).not.toBe("0px");
    expect(errors).toEqual([]);
  });

  test("styled-combobox: open, filter and select", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(urlOf("styled-combobox"));
    await page.getByRole("button", { name: "Toggle" }).click();
    await expect(page.getByRole("button", { name: "Ada Lovelace" })).toBeVisible();
    await page.getByPlaceholder("Search users").fill("gra");
    await expect(page.getByRole("button", { name: "Grace Hopper" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ada Lovelace" })).toHaveCount(0);
    await page.getByRole("button", { name: "Grace Hopper" }).click();
    await expect(page.getByText("Selected: Grace Hopper")).toBeVisible();
    await page.getByRole("button", { name: "Clear Selection" }).click();
    await expect(page.getByText("Selected: (none)")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("todomvc: add, complete, filter, remove", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(urlOf("todomvc"));
    await expect(page.getByText("Load state: Success")).toBeVisible();
    const items = page.locator(".todo-item");
    const initial = await items.count();
    const input = page.getByPlaceholder("What needs to be done?");
    await input.fill("Write the launch post");
    await input.press("Enter");
    await expect(items).toHaveCount(initial + 1);
    const added = items.filter({ hasText: "Write the launch post" });
    await added.getByRole("checkbox").check();
    await expect(added).toHaveClass(/done/);
    await page.getByRole("button", { name: "Active", exact: true }).click();
    await expect(items.filter({ hasText: "Write the launch post" })).toHaveCount(0);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await items.filter({ hasText: "Write the launch post" }).getByRole("button", { name: "x" }).click();
    await expect(items).toHaveCount(initial);
    expect(errors).toEqual([]);
  });
});
