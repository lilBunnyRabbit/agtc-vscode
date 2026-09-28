import { describe, expect, test } from "bun:test";
import { parseReport } from "../src/review/findings";

const REPORT = `Looked at the diff.

## Findings
- src/a.ts:12 · bug · off by one in the loop · use <=
- \`src/dir/b.tsx:40-44\` · smell · duplicated block
  continues on the next line · extract it
- The spec asks for a retry and there is none

## Questions
- none

## Verdict
- not ready: the loop bug
`;

describe("parseReport", () => {
  test("referenced findings carry path, line and severity; the rest has no place", () => {
    const { findings, questions } = parseReport(REPORT);
    expect(findings).toEqual([
      { path: "src/a.ts", line: 12, severity: "bug", text: "off by one in the loop · use <=" },
      { path: "src/dir/b.tsx", line: 40, severity: "smell", text: "duplicated block continues on the next line · extract it" },
      { text: "The spec asks for a retry and there is none" },
    ]);
    expect(questions).toEqual([]);
  });

  test("questions are kept, a report without sections has nothing", () => {
    expect(parseReport("## Findings\n- none\n\n## Questions\n- Which locale is the default?\n").questions).toEqual(["Which locale is the default?"]);
    expect(parseReport("all good")).toEqual({ findings: [], questions: [] });
  });
});
