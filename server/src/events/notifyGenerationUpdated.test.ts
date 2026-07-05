import test from "node:test";
import assert from "node:assert/strict";
import { notifyGenerationUpdated } from "./notifyGenerationUpdated.js";

function fakeApp(realtime: unknown) {
  return { get: (key: string) => (key === "realtime" ? realtime : undefined) } as never;
}

test("emit 到 project 与 user 房间", () => {
  const emits: Array<[string, string, unknown]> = [];
  const realtime = {
    io: { to: (room: string) => ({ emit: (ev: string, p: unknown) => emits.push([room, ev, p]) }) },
  };
  notifyGenerationUpdated(fakeApp(realtime), {
    projectId: "p1", userId: "u1", generationId: "g1", status: "SUCCEEDED",
  });
  assert.equal(emits.length, 2);
  assert.deepEqual(emits[0], ["project:p1", "generation:updated", { projectId: "p1", generationId: "g1", status: "SUCCEEDED" }]);
  assert.equal(emits[1][0], "user:u1");
});

test("realtime 缺失时不抛错", () => {
  assert.doesNotThrow(() => {
    notifyGenerationUpdated(fakeApp(undefined), { projectId: "p1" });
  });
});

test("无 projectId/userId 时零 emit", () => {
  const emits: unknown[] = [];
  const realtime = { io: { to: () => ({ emit: (..._a: unknown[]) => emits.push(1) }) } };
  notifyGenerationUpdated(fakeApp(realtime), { generationId: "g1" });
  assert.equal(emits.length, 0);
});
