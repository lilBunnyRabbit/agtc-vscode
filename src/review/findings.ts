export interface Finding {
  /** As the reviewer wrote it, relative to the checkout. */
  path?: string;
  /** 1-based. */
  line?: number;
  severity?: string;
  text: string;
}

export interface ParsedReport {
  findings: Finding[];
  questions: string[];
}

const REFERENCE = /^`?([^\s`:]+\.[\w-]+|[^\s`:]*\/[^\s`:]+):(\d+)(?:[-–]\d+)?`?$/;
const SEPARATOR = /\s+[·|]\s+|\s+[-–—]\s+/;
const NOTHING = /^(none|n\/a|nothing)\.?$/i;

function bullets(report: string, heading: string): string[] {
  const section = report.split(new RegExp(`^##\\s+${heading}\\s*$`, "im"))[1]?.split(/^##\s+/m)[0] ?? "";
  const items: string[] = [];
  for (const line of section.split("\n")) {
    const bullet = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.*)$/);
    if (bullet) items.push(bullet[1].trim());
    else if (line.trim() && items.length) items[items.length - 1] += ` ${line.trim()}`;
  }
  return items.filter((item) => item && !NOTHING.test(item));
}

/** `path:line · severity · what is wrong · suggested fix`, the shape the review prompt asks for; anything else stays a finding without a place. */
export function parseReport(report: string): ParsedReport {
  const findings = bullets(report, "Findings").map((item): Finding => {
    const [first, ...rest] = item.split(SEPARATOR);
    const reference = first.trim().match(REFERENCE);
    if (!reference || !rest.length) return { text: item };
    const severity = /^(bug|risk|smell)$/i.test(rest[0].trim()) ? rest[0].trim().toLowerCase() : undefined;
    return { path: reference[1], line: Number(reference[2]), severity, text: (severity ? rest.slice(1) : rest).join(" · ") };
  });
  return { findings, questions: bullets(report, "Questions") };
}

export function findingMessage(finding: Finding, reviewer: string): string {
  const where = finding.path ? `${finding.path}:${finding.line}` : "no file reference";
  return `One finding from a ${reviewer} reviewer that saw only the spec and the diff, not this conversation:\n\n${where}${finding.severity ? ` (${finding.severity})` : ""}: ${finding.text}\n`;
}
