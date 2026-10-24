import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';
import { splitSqlStatements } from './sql-migrations.mjs';
const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
const { createXumengScenario, scenarioDraft, exportXumengScenario, importXumengScenario } = await tsImport('../../../src/lib/xumeng-scenarios.ts', import.meta.url);
const { parseXumengScenarioRoomDetail } = await tsImport('../../../src/lib/xumeng-scenarios-client.ts', import.meta.url);
const origin = 'https://scenarios.example.test'; let runtime, DB;
before(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01', modules: true, script: 'export default {fetch(){return new Response("isolated scenario test")}}', d1Databases: { DB: 'isolated-creator-scenarios' } }));
  DB = await runtime.getD1Database('DB');
  const files = (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
  for (const file of files) { const source = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'); await DB.batch(splitSqlStatements(source).filter(sql => sql.trim()).map(sql => DB.prepare(sql))); }
});
after(async () => { await runtime?.dispose(); });
class Client {
  cookie = ''; accountId; ip = randomUUID();
  async request(path, method = 'GET', body) {
    const response = await fetchRequest(new Request(`${origin}/v1/scenarios${path}`, { method, headers: { Origin: origin, Cookie: this.cookie, 'CF-Connecting-IP': this.ip, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify({ accountId: this.accountId, ...body }) }), { DB, APP_ORIGINS: origin });
    return { status: response.status, data: await response.json() };
  }
  async register() {
    const response = await fetchRequest(new Request(`${origin}/v1/auth/register`, { method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': this.ip, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `scenario-${randomUUID()}@example.test`, password: 'Isolated-Scenario-2026!', nickname: '私人冒险测试者' }) }), { DB, APP_ORIGINS: origin });
    const data = await response.json(); assert.equal(response.status, 201, JSON.stringify(data)); this.cookie = response.headers.get('Set-Cookie').split(';')[0]; this.accountId = data.user.id; assert.equal(data.user.isGuest, false); assert.equal(data.user.role, 'user'); return this;
  }
}
function expect(result, code = 200) { assert.equal(result.status, code, JSON.stringify(result.data)); return result.data; }
async function setup() { const host = await new Client().register(), player = await new Client().register(), draft = createXumengScenario(true); const saved = expect(await host.request('', 'POST', { scenario: draft }), 201).scenario; return { host, player, draft, saved }; }
async function createRoom(host, saved) { return expect(await host.request('/rooms', 'POST', { scenarioId: saved.id, version: saved.version, roomId: randomUUID() }), 201).room; }
async function getRoom(client, id) { return expect(await client.request(`/rooms/${id}`)).room; }
async function join(client, room, roleId = room.snapshot.roles[0].id) { const brief = expect(await client.request(`/rooms/code/${room.code}`)).preview; return expect(await client.request(`/rooms/code/${room.code}/join`, 'POST', { roleId, version: brief.version })).room; }
test('private scenario export/import preserves author fields and creates a fresh ID', () => {
  const original = createXumengScenario(true), copied = importXumengScenario(exportXumengScenario(original)); assert.notEqual(copied.id, original.id); assert.deepEqual({ ...copied, id: original.id }, original);
  assert.throws(() => importXumengScenario(JSON.stringify({ format: 'qingyu-scenario', version: 1, scenario: { ...original, unknown: 'bad' } })), /不支持/);
});
test('ordinary accounts persist private drafts, isolate ownership, CAS and account identity without wallet mutations', async () => {
  const { host, player, draft, saved } = await setup();
  assert.deepEqual(scenarioDraft(expect(await host.request(`/${draft.id}`)).scenario), draft);
  expect(await player.request(`/${draft.id}`), 404); expect(await player.request(`/${draft.id}`, 'PUT', { scenario: draft, version: 1 }), 404);
  const list = expect(await host.request('')).scenarios; assert.ok(list.some(item => item.id === draft.id && item.roleCount === 2)); assert.equal(Object.hasOwn(list[0], 'hostNotes'), false);
  expect(await host.request(`/${draft.id}`, 'PUT', { accountId: player.accountId, scenario: draft, version: 1 }), 401);
  const updated = expect(await host.request(`/${draft.id}`, 'PUT', { scenario: { ...draft, title: '新的冒险标题' }, version: saved.version })).scenario;
  expect(await host.request(`/${draft.id}`, 'PUT', { scenario: draft, version: 1 }), 409); assert.equal(expect(await host.request(`/${draft.id}`)).scenario.title, updated.title);
  const users = await DB.prepare('SELECT version FROM users WHERE id=?').bind(host.accountId).first(); assert.equal(users.version, 0);
});
test('invitation preview hides internal world and all secrets; only active members can read frozen room context', async () => {
  const { host, player, draft, saved } = await setup(), room = await createRoom(host, saved);
  const brief = expect(await player.request(`/rooms/code/${room.code}`)).preview;
  for (const key of ['world', 'opening', 'goal', 'dmPrompt', 'hostNotes', 'snapshot', 'members', 'events']) assert.equal(Object.hasOwn(brief, key), false, key);
  assert.ok(brief.roles.every(role => !Object.hasOwn(role, 'personality')));
  expect(await player.request(`/rooms/${room.id}`), 404);
  const joined = await join(player, room); assert.equal(joined.isHost, false); assert.equal(Object.hasOwn(joined.snapshot, 'hostNotes'), false); assert.equal(Object.hasOwn(joined.snapshot, 'dmPrompt'), false); assert.ok(joined.snapshot.roles.every(role => !Object.hasOwn(role, 'personality')));
  assert.deepEqual(parseXumengScenarioRoomDetail({ accountId: player.accountId, room: joined }, player.accountId).room, joined);
  const hostRoom = await getRoom(host, room.id); assert.equal(hostRoom.snapshot.hostNotes, draft.hostNotes); assert.equal(hostRoom.snapshot.roles[0].personality, draft.roles[0].personality);
  expect(await host.request(`/${draft.id}`, 'PUT', { scenario: { ...draft, opening: '这是后改的新开场', hostNotes: '后改谜底' }, version: saved.version }));
  const frozen = await getRoom(host, room.id); assert.equal(frozen.snapshot.opening, draft.opening); assert.equal(frozen.snapshot.hostNotes, draft.hostNotes);
});
test('role occupancy is transactional and repeat joining is safe without changing a participant role', async () => {
  const { host, player, saved } = await setup(), third = await new Client().register(), room = await createRoom(host, saved);
  const brief = expect(await player.request(`/rooms/code/${room.code}`)).preview;
  const [first, second] = await Promise.all([player.request(`/rooms/code/${room.code}/join`, 'POST', { roleId: room.snapshot.roles[0].id, version: brief.version }), third.request(`/rooms/code/${room.code}/join`, 'POST', { roleId: room.snapshot.roles[0].id, version: brief.version })]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]); const winner = first.status === 200 ? player : third;
  const joined = expect(first.status === 200 ? first : second).room;
  const again = expect(await winner.request(`/rooms/code/${room.code}/join`, 'POST', { roleId: room.snapshot.roles[0].id, version: brief.version })).room; assert.equal(again.version, joined.version); assert.equal(again.members.length, 2);
  expect(await winner.request(`/rooms/code/${room.code}/join`, 'POST', { roleId: room.snapshot.roles[1].id, version: again.version }), 409);
});
test('host start, member action, duplicate message, host narration and stage transition survive reopening', async () => {
  const { host, player, saved } = await setup(); let room = await createRoom(host, saved); await join(player, room);
  room = await getRoom(host, room.id);
  expect(await player.request(`/rooms/${room.id}/start`, 'POST', { version: room.version }), 403);
  room = expect(await host.request(`/rooms/${room.id}/start`, 'POST', { version: room.version })).room; assert.equal(room.status, 'active'); assert.equal(room.events.at(-1).content, room.snapshot.opening);
  const clientId = randomUUID(), payload = { version: room.version, clientId, kind: 'action', content: '我和同伴前往灯塔，先核对测量记录。' };
  const posted = expect(await player.request(`/rooms/${room.id}/events`, 'POST', payload)).room;
  const replay = expect(await player.request(`/rooms/${room.id}/events`, 'POST', payload)).room; assert.equal(replay.version, posted.version); assert.equal(replay.events.filter(event => event.content === payload.content).length, 1);
  expect(await player.request(`/rooms/${room.id}/events`, 'POST', { ...payload, content: '改变请求内容' }), 409);
  expect(await player.request(`/rooms/${room.id}/events`, 'POST', { version: posted.version, clientId: randomUUID(), kind: 'narration', content: '擅自写结局' }), 403);
  const advanced = expect(await host.request(`/rooms/${room.id}/advance`, 'POST', { version: posted.version, content: '同伴来到旧灯塔，管理员打开了测量记录的柜子。' })).room;
  assert.equal(advanced.stageIndex, 1); assert.equal(advanced.events.at(-1).stageIndex, 1);
  expect(await host.request(`/rooms/${room.id}/advance`, 'POST', { version: posted.version, content: '重复推进不应改变计数。' }), 409);
  const reopened = new Client(); reopened.cookie = player.cookie; reopened.accountId = player.accountId; const restored = await getRoom(reopened, room.id); assert.equal(restored.stageIndex, 1); assert.ok(restored.events.some(event => event.content === payload.content));
  assert.equal(expect(await reopened.request('/rooms')).rooms.filter(item => item.id === room.id).length, 1);
});
test('leaving revokes private reads, releases a role, ending freezes events and draft deletion preserves the room', async () => {
  const { host, player, saved } = await setup(); let room = await createRoom(host, saved); await join(player, room); room = await getRoom(host, room.id);
  expect(await player.request(`/rooms/${room.id}/leave`, 'POST', { version: room.version })); expect(await player.request(`/rooms/${room.id}`), 404); assert.equal(expect(await player.request(`/rooms/code/${room.code}`)).preview.roles[0].occupied, false);
  await join(player, room); room = await getRoom(host, room.id); room = expect(await host.request(`/rooms/${room.id}/end`, 'POST', { version: room.version })).room; assert.equal(room.status, 'ended');
  expect(await player.request(`/rooms/${room.id}/events`, 'POST', { version: room.version, clientId: randomUUID(), kind: 'speech', content: '结束后不能发送' }), 409);
  expect(await host.request(`/${saved.id}`, 'DELETE', { version: saved.version })); assert.equal((await getRoom(player, room.id)).status, 'ended');
  assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results, []);
});
test('unsigned users, guests, malformed requests and foreign origins cannot create rooms', async () => {
  expect(await new Client().request(''), 401);
  const client = new Client(), guestResponse = await fetchRequest(new Request(`${origin}/v1/auth/guest`, { method: 'POST', headers: { Origin: origin } }), { DB, APP_ORIGINS: origin }); client.cookie = guestResponse.headers.get('Set-Cookie').split(';')[0]; client.accountId = (await guestResponse.json()).user.id; expect(await client.request(''), 403);
  const { host, saved } = await setup(); expect(await host.request('/rooms', 'POST', { scenarioId: saved.id, version: saved.version, roomId: randomUUID(), injected: 'bad' }), 400);
  const foreign = await fetchRequest(new Request(`${origin}/v1/scenarios/rooms`, { method: 'POST', headers: { Origin: 'https://foreign.example.test', Cookie: host.cookie, 'Content-Type': 'application/json' }, body: '{}' }), { DB, APP_ORIGINS: origin }); assert.equal(foreign.status, 403);
});
