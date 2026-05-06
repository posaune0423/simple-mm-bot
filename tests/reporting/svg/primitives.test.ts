import { describe, expect, test } from "bun:test";

import {
  circle,
  formatNumber,
  g,
  line,
  path,
  polyline,
  rect,
  svgEscape,
  svgRoot,
  text,
} from "../../../src/reporting/svg/primitives.ts";

describe("svg primitives", () => {
  test("svgEscape replaces XML-significant characters", () => {
    expect(svgEscape("a & b <c> \"d\" 'e'")).toBe(
      "a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;",
    );
  });

  test("formatNumber trims trailing zeros and keeps integers", () => {
    expect(formatNumber(1)).toBe("1");
    expect(formatNumber(1.2345)).toBe("1.234");
    expect(formatNumber(Number.NaN)).toBe("0");
  });

  test("svgRoot wraps children with viewBox", () => {
    expect(svgRoot(100, 50, [rect(0, 0, 10, 10)])).toContain('viewBox="0 0 100 50"');
  });

  test("rect/line/text/path/circle/polyline render expected attributes", () => {
    expect(rect(1, 2, 3, 4, { fill: "#fff" })).toBe(
      '<rect x="1" y="2" width="3" height="4" fill="#fff" />',
    );
    expect(line(0, 0, 10, 10, { stroke: "#000" })).toBe(
      '<line x1="0" y1="0" x2="10" y2="10" stroke="#000" />',
    );
    expect(text(5, 6, "<hi>", { "text-anchor": "middle" })).toBe(
      '<text x="5" y="6" text-anchor="middle">&lt;hi&gt;</text>',
    );
    expect(path("M0 0 L10 10", { stroke: "red" })).toBe('<path d="M0 0 L10 10" stroke="red" />');
    expect(circle(1, 2, 3)).toBe('<circle cx="1" cy="2" r="3" />');
    expect(
      polyline(
        [
          [0, 0],
          [1, 2],
        ],
        { stroke: "#000" },
      ),
    ).toBe('<polyline points="0,0 1,2" stroke="#000" />');
  });

  test("g composes children", () => {
    expect(g({ transform: "translate(10,10)" }, [rect(0, 0, 1, 1)])).toBe(
      '<g transform="translate(10,10)"><rect x="0" y="0" width="1" height="1" /></g>',
    );
  });
});
