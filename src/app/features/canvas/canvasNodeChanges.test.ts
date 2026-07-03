import assert from "node:assert/strict";
import test from "node:test";
import { type NodeChange } from "@xyflow/react";
import { canvasNodeChangesForStore } from "./canvasUtils";

test("canvasNodeChangesForStore ignores ReactFlow automatic dimension and position changes", () => {
  const result = canvasNodeChangesForStore([
    {
      id: "node-1",
      type: "dimensions",
      dimensions: { width: 520, height: 360 },
      setAttributes: true,
      resizing: false,
    },
    {
      id: "node-1",
      type: "position",
      position: { x: 120, y: 240 },
      dragging: false,
    },
    {
      id: "node-1",
      type: "select",
      selected: true,
    },
  ] satisfies NodeChange[]);

  assert.deepEqual(result, { durableChanges: [], persist: false });
});

test("canvasNodeChangesForStore keeps user resize and remove changes durable", () => {
  const result = canvasNodeChangesForStore([
    {
      id: "node-1",
      type: "dimensions",
      dimensions: { width: 600, height: 420 },
      setAttributes: true,
      resizing: true,
    },
    {
      id: "node-2",
      type: "remove",
    },
  ] satisfies NodeChange[]);

  assert.equal(result.persist, true);
  assert.equal(result.durableChanges.length, 2);
});

test("canvasNodeChangesForStore keeps finished user drag positions durable", () => {
  const result = canvasNodeChangesForStore([
    {
      id: "node-1",
      type: "position",
      position: { x: 320, y: 180 },
      dragging: false,
    },
  ] satisfies NodeChange[]);

  assert.equal(result.persist, true);
  assert.equal(result.durableChanges.length, 1);
  assert.equal(result.durableChanges[0]?.type, "position");
});

test("canvasNodeChangesForStore treats ReactFlow replace changes as durable without sync guard", () => {
  const result = canvasNodeChangesForStore([
    {
      id: "node-1",
      type: "replace",
      item: {
        id: "node-1",
        type: "scene",
        position: { x: 10, y: 20 },
        data: { title: "Scene" },
      },
    },
  ] satisfies NodeChange[]);

  assert.equal(result.persist, true);
  assert.equal(result.durableChanges.length, 1);
  assert.equal(result.durableChanges[0]?.type, "replace");
});
