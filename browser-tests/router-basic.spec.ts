/**
 * The router-basic example, end to end in a real browser: `WithLayer`
 * provides the browser router, `Route.Switch` renders the page that matches
 * the URL most specifically, and navigation swaps pages.
 */
import { expect, test } from "@playwright/test";

const baseUrl = "http://127.0.0.1:4180";

test("renders the page that matches the URL and follows navigation", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto(`${baseUrl}/`);
  await expect(page.locator("h2")).toHaveText("Home");

  await page.getByRole("link", { name: "Users", exact: true }).click();
  await expect(page.locator("h2")).toHaveText("Users");

  await page.getByRole("link", { name: "Alice" }).first().click();
  await expect(page.locator("h2")).toHaveText("User Profile");
  await expect(page.getByText("Current user: alice")).toBeVisible();

  await page.goto(`${baseUrl}/users/bob`);
  await expect(page.getByText("Current user: bob")).toBeVisible();

  await page.goBack();
  await expect(page.getByText("Current user: alice")).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("a client app that never resumes does not ship the resume-session collector", async ({ page }) => {
  const scripts: string[] = [];
  page.on("response", async (response) => {
    if (response.url().endsWith(".js")) scripts.push(await response.text());
  });
  await page.goto(`${baseUrl}/`);
  await expect(page.locator("h2")).toHaveText("Home");
  expect(scripts.length).toBeGreaterThan(0);
  // Diagnostic codes that only resume-session.ts contains.
  for (const script of scripts) {
    expect(script).not.toContain("opaque-component-setup");
    expect(script).not.toContain("missing-expression-boundary");
  }
});

