import { test } from "node:test";
import { strict as assert } from "node:assert";
import { newShot, type Shot } from "../src/lib/drama";
import {
  attachNewShot,
  dramaBranchCount,
  layoutShotTree,
  linkShot,
  migrateLinearShotTree,
  moveShotAmongSiblings,
  promoteOrphans,
  remapShotParents,
  shotChildren,
  shotEdges,
  unlinkShot,
  validateShotLink,
  walkShotTree,
} from "../src/lib/drama-tree";

function shot(id: string, parentId?: string): Shot {
  return { ...newShot(0, id), id, parentId, position: { x: 0, y: 0 } };
}

test("rejects self links, cycles, and a second parent", () => {
  const a = shot("a");
  const b = shot("b", "a");
  const c = shot("c", "b");
  const shots = [a, b, c];
  assert.equal(validateShotLink(shots, "a", "a"), "镜头不能连回自己。");
  assert.match(validateShotLink(shots, "c", "a") || "", /环/);
  assert.match(validateShotLink(shots, "c", "b") || "", /一个上一镜/);
  assert.equal(validateShotLink(shots, "a", "b"), "这条后续已经存在。");
});

test("link and unlink rewrite parentId", () => {
  const shots = [shot("a"), shot("b")];
  const linked = linkShot(shots, "a", "b");
  assert.ok(Array.isArray(linked));
  assert.equal((linked as Shot[])[1].parentId, "a");
  assert.deepEqual(
    shotEdges(linked as Shot[]).map((edge) => [edge.source, edge.target]),
    [["a", "b"]],
  );
  const free = unlinkShot(linked as Shot[], "b");
  assert.equal(free[1].parentId, undefined);
});

test("old linear sequences migrate only when no parentId was declared", () => {
  const linear = [shot("a"), shot("b"), shot("c")];
  const migrated = migrateLinearShotTree(linear, false);
  assert.equal(migrated[0].parentId, undefined);
  assert.equal(migrated[1].parentId, "a");
  assert.equal(migrated[2].parentId, "b");
  const declared = migrateLinearShotTree(
    [shot("a"), shot("b"), shot("c")],
    true,
  );
  assert.equal(declared[1].parentId, undefined);
  assert.equal(declared[2].parentId, undefined);
});

test("layout places children to the right of their parent", () => {
  const shots = layoutShotTree([
    shot("root"),
    shot("left", "root"),
    shot("right", "root"),
  ]);
  const root = shots.find((item) => item.id === "root")!;
  const left = shots.find((item) => item.id === "left")!;
  const right = shots.find((item) => item.id === "right")!;
  assert.ok(left.position.x > root.position.x);
  assert.ok(right.position.x > root.position.x);
  assert.equal(left.position.x, right.position.x);
  assert.ok(left.position.y < right.position.y);
});

test("deleting a parent promotes children onto the grandparent", () => {
  const shots = promoteOrphans(
    [shot("a"), shot("b", "a"), shot("c", "b")],
    ["b"],
  );
  assert.equal(shots.length, 2);
  assert.equal(shots.find((item) => item.id === "c")?.parentId, "a");
});

test("siblings can swap order without changing parents", () => {
  const shots = [shot("a"), shot("b", "a"), shot("c", "a")];
  const moved = moveShotAmongSiblings(shots, "c", -1);
  assert.deepEqual(
    shotChildren(moved, "a").map((item) => item.id),
    ["c", "b"],
  );
  assert.equal(moved.find((item) => item.id === "c")?.parentId, "a");
});

test("attachNewShot hangs off the selected parent and walkShotTree stays depth-first", () => {
  const root = shot("a");
  const child = attachNewShot([root], shot("b"), "a");
  const ordered = walkShotTree([root, child]);
  assert.equal(child.parentId, "a");
  assert.deepEqual(
    ordered.map((item) => item.id),
    ["a", "b"],
  );
  assert.equal(dramaBranchCount([root, child, shot("c", "a")]), 1);
});

test("copied parent maps rewrite internal links", () => {
  const mapping = new Map([
    ["a", "a2"],
    ["b", "b2"],
  ]);
  const copies = remapShotParents(
    [
      { ...shot("a2") },
      { ...shot("b2", "a") },
    ],
    mapping,
  );
  assert.equal(copies[1].parentId, "a2");
});
