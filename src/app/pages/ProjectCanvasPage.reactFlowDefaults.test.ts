import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ProjectCanvasPage.tsx", import.meta.url), "utf8");

test("ProjectCanvasPage keeps ReactFlow default nodes and edges stable", () => {
  assert.match(source, /const EMPTY_REACT_FLOW_NODES: Node\[\] = \[\];/);
  assert.match(source, /const EMPTY_REACT_FLOW_EDGES: Edge\[\] = \[\];/);
  assert.match(source, /defaultNodes=\{EMPTY_REACT_FLOW_NODES\}/);
  assert.match(source, /defaultEdges=\{EMPTY_REACT_FLOW_EDGES\}/);
  assert.doesNotMatch(source, /defaultNodes=\{flowNodes\}/);
  assert.doesNotMatch(source, /defaultEdges=\{styledEdges\}/);
});
