import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attach, withAttachments } from "../src/spawn/attachments";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "agtc-attach-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("files are copied into the checkout and named in the task", async () => {
  const source = join(dir, "shot.png");
  writeFileSync(source, "x");
  const checkout = join(dir, "checkout");
  const attached = await attach(checkout, [source], 7);
  expect(attached).toEqual([".agtc/attachments/7-1-shot.png"]);
  expect(existsSync(join(checkout, attached[0]))).toBe(true);
  expect(readFileSync(join(checkout, attached[0]), "utf8")).toBe("x");
  expect(withAttachments("do it", attached)).toBe("do it\n\nAttached files, relative to the checkout:\n- .agtc/attachments/7-1-shot.png\n");
  expect(withAttachments("do it", [])).toBe("do it");
});
