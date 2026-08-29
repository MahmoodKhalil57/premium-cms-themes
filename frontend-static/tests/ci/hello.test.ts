// The smallest possible `test:cf` — proves the test runner works in CI.
// Add real tests next to it; `bun test tests/ci` picks up every *.test.ts.
import { expect, test } from "bun:test";

test("hello world", () => {
	expect("hello".toUpperCase()).toBe("HELLO");
});
