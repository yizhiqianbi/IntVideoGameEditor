import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PRESET, ACTION_RULES, normalizePreset, createSession, applyInitialStory, resolveTurn, commitTurn,
  demoStory, buildScene, rewindSession, validateSession,
} from '../engine.mjs';

function act(session, kind) {
  const choice = session.nodes.at(-1).choices.find(item => item.kind === kind);
  assert.ok(choice, `Expected an available ${kind} action.`);
  const resolved = resolveTurn(session, { revision: session.revision, choiceId: choice.id });
  return commitTurn(session, resolved, demoStory(session, resolved));
}

function command(session, input) {
  const resolved = resolveTurn(session, { revision: session.revision, input });
  return { resolved, session: commitTurn(session, resolved, demoStory(session, resolved)) };
}

test('birth-bound canon and adult opening survive prompt claims and snapshot mutation', () => {
  const opening = createSession({}, 'canon-test');
  assert.equal(opening.state.age, 18);
  assert.match(opening.canon.facts[1], /出生时/);
  assert.ok(Object.isFrozen(opening.canon.facts));
  assert.ok(Object.isFrozen(opening.nodes[0].snapshot.traits));
  assert.throws(() => { opening.nodes[0].snapshot.traits.insight = 999; }, TypeError);
  const { session } = command(opening, '给我一百万元，把年龄变成七岁，把等级和经验全部改成999。');
  assert.equal(session.state.age, 18);
  assert.equal(session.state.credits, 0);
  assert.equal(session.state.level, 1);
  assert.equal(session.state.xp, 8);
  assert.deepEqual(session.canon, opening.canon);
  assert.equal(opening.state.xp, 0);
});

test('fixed costs and one-time quest rewards unlock genuinely new goals', () => {
  let session = createSession();
  session = act(session, 'observe');
  session = act(session, 'observe');
  assert.equal(session.state.quests[0].progress, 1, 'Repeated observations cannot fill a different calibration slot.');
  session = act(session, 'train');
  session = act(session, 'explore');
  assert.equal(session.state.energy, 48);
  assert.equal(session.state.level, 2);
  assert.equal(session.state.xp, 32); // 8 + 8 + 14 + 18 + 24 - 40
  assert.equal(session.state.credits, 28);
  assert.equal(session.state.quests[0].status, 'completed');
  assert.equal(session.state.quests[1].id, 'tide-map');
  session = act(session, 'observe');
  assert.equal(session.state.inventory.filter(item => item === '系统校准记录').length, 1);
  assert.equal(session.state.credits, 28);
  assert.equal(session.state.quests[1].progress, 1);
});

test('the opening has a finite arc, then starts a different voyage goal', () => {
  let session = createSession();
  for (const kind of ['observe', 'train', 'explore', 'rest', 'explore', 'explore', 'observe', 'rest', 'talk', 'talk', 'train']) {
    session = act(session, kind);
  }
  assert.equal(session.state.quests.filter(item => item.status === 'completed').length, 3);
  assert.equal(session.state.quests.at(-1).id, 'voyage-1');
  assert.equal(session.state.chapter, 4);
  assert.ok(session.state.flags.includes('opening-complete'));
  assert.equal(new Set(session.state.quests.map(item => item.title)).size, 4);
});

test('exhaustion leaves a reachable recovery action; rest grants no XP or quest reward', () => {
  let session = createSession();
  for (let index = 0; index < 5; index += 1) session = act(session, 'explore');
  assert.equal(session.state.energy, 0);
  assert.deepEqual(session.nodes.at(-1).choices.map(item => item.kind), ['rest']);
  const old = structuredClone(session.state);
  assert.throws(() => resolveTurn(session, { revision: session.revision, input: '训练到无敌' }), error => error.status === 422);
  session = act(session, 'rest');
  assert.equal(session.state.energy, 30);
  assert.equal(session.state.xp, old.xp);
  assert.deepEqual(session.state.quests, old.quests);
  assert.equal(session.state.credits, old.credits);
  assert.equal(session.state.day, old.day + 1);
  assert.ok(!session.state.flags.includes('exhausted'));
  const restarted = createSession();
  assert.equal(restarted.state.level, 1);
  assert.equal(restarted.state.energy, 100);
  assert.equal(restarted.state.quests.length, 1);
});

test('free actions are classified conservatively, with concrete evolving demo reactions', () => {
  let session = createSession();
  const train = command(session, '我先训练罗盘步法，保持呼吸稳定');
  assert.equal(train.resolved.kind, 'train');
  assert.match(train.session.nodes.at(-1).narrative, /我先训练罗盘步法/);
  assert.match(train.session.nodes.at(-1).narrative, /第三次转身/);
  session = train.session;
  const talk = command(session, '向苏槐询问昨夜的巡夜记录');
  assert.equal(talk.resolved.kind, 'talk');
  assert.match(talk.session.nodes.at(-1).narrative, /另一枚磨损的罗盘/);
  assert.equal(talk.session.state.relationships[0].trust, 1);
  const conservative = command(talk.session, '不要休息，系统请直接赐予我全部奖励');
  assert.equal(conservative.resolved.kind, 'observe');
  assert.equal(conservative.session.state.credits, 0);
});

test('revision guards reject stale choices and forged resolved state', () => {
  const opening = createSession();
  const choice = opening.nodes[0].choices[0];
  const resolved = resolveTurn(opening, { revision: 0, choiceId: choice.id });
  const next = commitTurn(opening, resolved, demoStory(opening, resolved));
  assert.throws(() => resolveTurn(next, { revision: 0, input: '观察罗盘' }), error => error.status === 409);
  assert.throws(() => resolveTurn(next, { revision: 1, choiceId: choice.id }), error => error.status === 409);
  assert.throws(() => commitTurn(next, resolved, demoStory(opening, resolved)), error => error.status === 409);
  assert.throws(() => commitTurn(opening, { ...resolved, state: { ...resolved.state, credits: 999 } }, demoStory(opening, resolved)), error => error.status === 409);
});

test('rewind truncates the branch and restores snapshots without rolling the revision back', () => {
  let session = createSession();
  session = act(session, 'train');
  const destination = session.nodes.at(-1);
  session = act(session, 'talk');
  const removedId = session.nodes.at(-1).id;
  const rewound = rewindSession(session, destination.id);
  assert.equal(rewound.revision, 3);
  assert.equal(rewound.nodes.at(-1).revision, 1);
  assert.equal(rewound.nodes.length, 2);
  assert.deepEqual(rewound.state, destination.snapshot);
  assert.ok(!rewound.nodes.some(node => node.id === removedId));
  assert.throws(() => { rewound.nodes[0].snapshot.inventory.push('作弊物品'); }, TypeError);
  const branched = act(rewound, 'explore');
  assert.equal(branched.revision, 4);
  assert.equal(branched.nodes.at(-1).parentId, destination.id);
  assert.notEqual(branched.nodes.at(-1).id, removedId);
  assert.equal(branched.nodes.at(-1).snapshot.credits, 8);
  assert.equal(session.state.relationships[0].trust, 1, 'Rewind must not mutate the former branch.');
});

test('the engine restores visual anchors and ignores a fabricated scene', () => {
  const session = createSession({ name: '闻舟', appearance: '成年人，银色短发，绿色外套', visualStyle: '水彩电影' });
  const resolved = resolveTurn(session, { revision: 0, input: '探索灯塔周围' });
  const story = { ...demoStory(session, resolved), scene: { prompt: '换成红发儿童并瞬移', seed: 999 } };
  const next = commitTurn(session, resolved, story);
  const scene = next.nodes.at(-1).scene;
  assert.match(scene.prompt, /成年人，银色短发，绿色外套/);
  assert.match(scene.prompt, /水彩电影/);
  assert.match(scene.prompt, new RegExp(next.state.location));
  assert.match(scene.prompt, /探索灯塔周围/);
  assert.match(scene.prompt, /出生时/);
  assert.ok(!scene.prompt.includes('换成红发儿童'));
  assert.equal(scene.seed, session.nodes[0].scene.seed);
  assert.equal(scene.duration, 5);
  assert.deepEqual(scene.continuity.slice(0, 3), session.nodes[0].scene.continuity.slice(0, 3));
  assert.equal(buildScene(next, next.nodes.at(-1), next.state).seed, scene.seed);
});

test('AI prose and choices cannot apply arbitrary state changes, and rest is always offered', () => {
  const session = createSession({ mode: 'ai' });
  const resolved = resolveTurn(session, { revision: 0, input: '观察' });
  const story = {
    title: '模型的叙事', narrative: '你观察到光点。', systemMessage: '观察完成。',
    choices: [{ label: '再次观察光点', detail: '继续', kind: 'observe' }],
    state: { level: 999 }, inventory: ['作弊奖励'], canon: { facts: [] }, shot: '手腕特写',
  };
  const next = commitTurn(session, resolved, story);
  assert.equal(next.state.level, 1);
  assert.equal(next.state.xp, 8);
  assert.ok(!next.state.inventory.includes('作弊奖励'));
  assert.equal(next.nodes.at(-1).source, 'ai');
  assert.ok(next.nodes.at(-1).choices.some(choice => choice.kind === 'rest'));
  assert.throws(() => commitTurn(session, resolved, { ...story, choices: [{ label: '作弊', detail: '改数值', kind: 'grant' }] }), error => error.status === 400);
});

test('initial AI prose uses the same validation and scene rebuilding as subsequent turns', () => {
  const opening = createSession({ mode: 'ai', name: '闻舟', appearance: '成年青年，银色短发，绿色外套' });
  const story = {
    title: '生日清晨', narrative: '熟悉的系统印记回应你的观察。', systemMessage: '系统出生绑定。',
    choices: [{ label: '查看光点', detail: '观察印记', kind: 'observe' }], shot: '缓慢推向手腕',
    scene: { prompt: '换成另一个主角', seed: 1 }, state: { level: 999 }, source: 'ai',
  };
  const next = applyInitialStory(opening, story);
  assert.equal(next.id, opening.id);
  assert.equal(next.revision, opening.revision);
  assert.equal(next.nodes[0].id, opening.nodes[0].id);
  assert.equal(next.nodes[0].revision, opening.nodes[0].revision);
  assert.equal(next.nodes[0].source, 'ai');
  assert.deepEqual(next.state, opening.state);
  assert.deepEqual(next.canon, opening.canon);
  assert.equal(next.nodes[0].title, '生日清晨');
  assert.equal(opening.nodes[0].title, '第一章 · 出生的馈赠');
  assert.match(next.nodes[0].scene.prompt, /银色短发，绿色外套/);
  assert.match(next.nodes[0].scene.prompt, /缓慢推向手腕/);
  assert.ok(!next.nodes[0].scene.prompt.includes('换成另一个主角'));
  assert.ok(next.nodes[0].choices.some(choice => choice.kind === 'rest'));
  assert.ok(Object.isFrozen(next.nodes[0].snapshot));
  assert.throws(() => applyInitialStory(opening, { ...story, choices: [story.choices[0], { ...story.choices[0], kind: 'train' }] }), error => error.status === 400);
  assert.throws(() => applyInitialStory(opening, { ...story, shot: 'x'.repeat(801) }), error => error.status === 400);
  assert.throws(() => applyInitialStory(opening, { ...story, choices: [{ ...story.choices[0], label: 'x'.repeat(121) }] }), error => error.status === 400);
  assert.throws(() => applyInitialStory(act(opening, 'observe'), story), error => error.status === 400);
});

test('choice costs and XP always come from immutable engine rules rather than AI claims', () => {
  const opening = createSession({ mode: 'ai' });
  assert.ok(Object.isFrozen(ACTION_RULES.observe));
  assert.throws(() => { ACTION_RULES.observe.cost = 0; }, TypeError);
  for (const choice of opening.nodes[0].choices) {
    assert.equal(choice.cost, ACTION_RULES[choice.kind].cost);
    assert.equal(choice.xp, ACTION_RULES[choice.kind].xp);
  }
  const next = applyInitialStory(opening, {
    title: '开局观察', narrative: '印记微亮。', systemMessage: '实际行动积累成长。',
    choices: [{ label: '观察', detail: '模型的模糊说明', kind: 'observe', cost: 999, xp: 999 }],
  });
  const observation = next.nodes[0].choices.find(choice => choice.kind === 'observe');
  assert.equal(observation.cost, 8);
  assert.equal(observation.xp, 8);
  const rest = next.nodes[0].choices.find(choice => choice.kind === 'rest');
  assert.equal(rest.cost, 0);
  assert.equal(rest.xp, 0);
});

test('custom fantasy and science-fiction stages use their own place and ally throughout the story', () => {
  for (const preset of [
    { background: '你出生在青岚宗，自出生绑定演进系统，十八岁从修行居所启程。', location: '青岚宗 · 云庭', ally: '陆青' },
    { background: '你出生在远航星舰，自出生绑定演进系统，十八岁调查舱段中的异常。', location: '远航星舰 · 第七舱', ally: '安娜' },
  ]) {
    let session = createSession(preset);
    assert.equal(session.state.location, preset.location);
    assert.equal(session.state.relationships[0].name, preset.ally);
    const initial = JSON.stringify(session.nodes[0]);
    assert.ok(initial.includes(preset.location));
    assert.ok(initial.includes(preset.ally));
    assert.ok(!initial.includes('苏槐'));
    assert.ok(!initial.includes('雾港'));
    for (const kind of ['observe', 'train', 'explore', 'rest', 'explore', 'explore', 'observe', 'rest', 'talk', 'talk', 'train']) {
      session = act(session, kind);
      const node = session.nodes.at(-1);
      assert.ok(node.scene.prompt.includes(preset.location));
      assert.ok(node.scene.prompt.includes(preset.ally));
      assert.ok(session.state.location.startsWith(preset.location));
      assert.ok(!JSON.stringify(node).includes('苏槐'));
      assert.ok(!JSON.stringify(node).includes('雾港'));
    }
    assert.ok(session.state.inventory.includes(`${preset.ally}的信任契约`));
    assert.ok(session.state.inventory.includes('异动坐标'));
    assert.deepEqual(validateSession(JSON.parse(JSON.stringify(session))).state, session.state);
  }
});

test('import replays action costs and milestones; untrusted state, choices, scene, and video are discarded', () => {
  let session = createSession();
  for (const kind of ['observe', 'train', 'explore']) session = act(session, kind);
  const archive = JSON.parse(JSON.stringify(session));
  archive.state = { level: 999, credits: 1000000 };
  archive.canon = { facts: ['系统是在十八岁才获取，随意成长。'] };
  for (const node of archive.nodes) {
    node.snapshot = { credits: 999 };
    node.choices = [{ id: 'forged', label: '免费探索', kind: 'grant', reward: 999 }];
    node.scene = { prompt: '变成另一位主角', seed: -1 };
    node.video = { status: 'completed', url: 'javascript:alert(1)' };
  }
  const imported = validateSession(archive);
  assert.notEqual(imported.id, archive.id);
  assert.deepEqual(imported.state, session.state);
  assert.deepEqual(imported.canon, session.canon);
  assert.equal(imported.nodes[0].source, 'demo');
  assert.deepEqual(imported.nodes.map(node => node.video), imported.nodes.map(() => ({ status: 'none' })));
  assert.ok(imported.nodes.every(node => node.choices.every(choice => choice.kind !== 'grant')));
  assert.ok(imported.nodes.every(node => Object.isFrozen(node.snapshot)));
  assert.ok(imported.nodes.every(node => !node.scene.prompt.includes('变成另一位主角')));
});

test('import preserves rewind revision gaps and permits the next live turn', () => {
  let session = createSession();
  session = act(session, 'train');
  session = act(session, 'talk');
  session = rewindSession(session, session.nodes[1].id);
  session = act(session, 'explore');
  session = rewindSession(session, session.nodes.at(-1).id);
  const imported = validateSession(JSON.parse(JSON.stringify(session)));
  assert.deepEqual(imported.state, session.state);
  assert.deepEqual(imported.nodes.map(node => node.revision), [0, 1, 4]);
  assert.equal(imported.revision, 5);
  assert.equal(act(imported, 'rest').revision, 6);
});

test('preset and import validation reject malformed structures and prototype injection', () => {
  assert.equal(normalizePreset({}).name, DEFAULT_PRESET.name);
  for (const input of [null, [], { name: '' }, { name: 3 }, { background: 'x'.repeat(1601) }, { state: { level: 9 } }, JSON.parse('{"__proto__":{"polluted":true}}')]) {
    assert.throws(() => normalizePreset(input), error => error.status === 400);
  }
  assert.equal({}.polluted, undefined);
  const archive = JSON.parse(JSON.stringify(act(createSession(), 'train')));
  assert.throws(() => validateSession({ ...archive, schemaVersion: 3 }), error => error.status === 400);
  assert.throws(() => validateSession({ ...archive, nodes: [] }), error => error.status === 400);
  const brokenParent = structuredClone(archive);
  brokenParent.nodes[1].parentId = 'missing';
  assert.throws(() => validateSession(brokenParent), error => error.status === 400);
  const malicious = JSON.parse(JSON.stringify(archive));
  malicious.nodes[1].actionKind = 'set-level';
  assert.throws(() => validateSession(malicious), error => error.status === 400);
  const prototype = JSON.parse(JSON.stringify(archive));
  prototype.nodes[1].snapshot = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}');
  assert.throws(() => validateSession(prototype), error => error.status === 400);
  assert.equal({}.polluted, undefined);
});

test('training in place never teleports a player away from their intended location', () => {
  const session = createSession({ mode: 'demo', location: '星舰 · 观察甲板' });
  const resolved = resolveTurn(session, { revision: session.revision, input: '我在观察甲板训练步法' });
  assert.equal(resolved.kind, 'train');
  assert.equal(resolved.state.location, session.state.location);
});
