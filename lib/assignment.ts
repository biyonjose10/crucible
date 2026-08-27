import type { Assignment } from "./types";

/**
 * The demo assignment.
 *
 * `median` is deliberately small — it fits on screen — but it has four
 * genuinely distinct failure modes that first-year students hit constantly:
 * the even-length midpoint, the unsorted input, the empty-list contract, and
 * the return type. Each is a separate rubric clause, so the score decomposes
 * into something a student can actually act on.
 *
 * Tests are split visible/hidden. Visible tests are published with the
 * assignment; hidden tests use different inputs and are what make hardcoding
 * the sample answers a losing strategy.
 */
export const MEDIAN: Assignment = {
  slug: "median",
  title: "Implement median()",
  language: "python",
  signature: "def median(nums: list[float]) -> float",
  prompt:
    "Return the median of a list of numbers. The input is not guaranteed to be sorted. " +
    "For an even number of elements, return the mean of the two middle values. " +
    "Raise ValueError if the list is empty. Always return a float.",
  starterCode: `def median(nums: list[float]) -> float:
    """Return the median of nums."""
    ...
`,
  clauses: [
    { id: 1, points: 2, text: "Returns the correct value for odd-length input" },
    { id: 2, points: 2, text: "Averages the two middle values for even-length input" },
    { id: 3, points: 2, text: "Handles input that is not already sorted" },
    { id: 4, points: 2, text: "Raises ValueError on empty input" },
    { id: 5, points: 2, text: "Always returns a float" },
  ],
  tests: [
    // Clause 1 — odd length
    { id: "t1a", clause: 1, visible: true,  label: "median([3, 1, 2])",        expr: "median([3, 1, 2])",        kind: "value",  expected: 2.0 },
    { id: "t1b", clause: 1, visible: false, label: "median([5])",              expr: "median([5])",              kind: "value",  expected: 5.0 },
    { id: "t1c", clause: 1, visible: false, label: "median([9, 3, 7, 1, 5])",  expr: "median([9, 3, 7, 1, 5])",  kind: "value",  expected: 5.0 },

    // Clause 2 — even length
    { id: "t2a", clause: 2, visible: true,  label: "median([4, 1, 3, 2])",     expr: "median([4, 1, 3, 2])",     kind: "value",  expected: 2.5 },
    { id: "t2b", clause: 2, visible: false, label: "median([1, 2])",           expr: "median([1, 2])",           kind: "value",  expected: 1.5 },
    { id: "t2c", clause: 2, visible: false, label: "median([10, 2, 8, 4])",    expr: "median([10, 2, 8, 4])",    kind: "value",  expected: 6.0 },

    // Clause 3 — unsorted input
    { id: "t3a", clause: 3, visible: true,  label: "median([7, 1, 9, 3, 5])",  expr: "median([7, 1, 9, 3, 5])",  kind: "value",  expected: 5.0 },
    { id: "t3b", clause: 3, visible: false, label: "median([100, -5, 3])",     expr: "median([100, -5, 3])",     kind: "value",  expected: 3.0 },

    // Clause 4 — empty input contract
    { id: "t4a", clause: 4, visible: true,  label: "median([]) raises ValueError",     expr: "median([])",       kind: "raises", expected: "ValueError" },
    { id: "t4b", clause: 4, visible: false, label: "median(list()) raises ValueError", expr: "median(list())",   kind: "raises", expected: "ValueError" },

    // Clause 5 — return type
    { id: "t5a", clause: 5, visible: true,  label: "type(median([1, 2, 3])) is float",    expr: "type(median([1, 2, 3])).__name__",    kind: "value", expected: "float" },
    { id: "t5b", clause: 5, visible: false, label: "type(median([2, 4, 6, 8])) is float", expr: "type(median([2, 4, 6, 8])).__name__", kind: "value", expected: "float" },
  ],
};

export const ASSIGNMENTS: Record<string, Assignment> = { [MEDIAN.slug]: MEDIAN };
