import { expect, it } from "vitest";
import { mergePerf, perfSnapshot, resetPerf } from "./perf";

it("combines worker timings without losing counts or prior peaks", () => {
  resetPerf();
  mergePerf({ turn: { last: 40, max: 60, total: 100, calls: 2 } });
  mergePerf({ turn: { last: 30, max: 30, total: 30, calls: 1 } });
  expect(perfSnapshot().turn).toEqual({ last: 30, max: 60, total: 130, calls: 3 });
});
