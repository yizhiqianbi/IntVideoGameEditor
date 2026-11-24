import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { newShot, buildDramaInput } from '../src/lib/drama';
import { assetImagePrompt, assetThreeViewPrompt, newAsset, shotContext, variantAsset } from '../src/lib/drama-assets';
import { buildCharacterImagePrompt } from '../src/lib/image-generation';
test('linked character and scene settings enter the real generation input', () => {
  const a = {...newAsset('reference', 0), imageUrl: 'https://example.com/actor.png', description: '灰色风衣', title: '林夏'};
  const b = {...newAsset('scene', 1), description: '雨夜公寓'};
  const s = {...newShot(0, '来电', '她接通电话'), assetIds: [a.id, b.id]};
  const c = shotContext(s, [a,b]);
  assert.equal(c.mode, 'ri2v');
  assert.match(c.prompt, /Image 1 = 锁定角色「林夏」/);
  assert.match(c.prompt, /灰色风衣/);
  assert.match(c.prompt, /场景锁定「/);
  assert.match(c.prompt, /雨夜公寓/);
  assert.deepEqual(buildDramaInput({...c, aspectRatio: '9:16'}).reference_image_urls, [a.imageUrl]);
  assert.equal(shotContext({...s, assetIds: []}, [a,b]).mode, 't2v');
});
test('new shots and cards do not inject a default negative prompt', () => {
  const a = newAsset('reference', 0);
  const s = newShot(0, '来电', '她接通电话');
  assert.equal(a.negativePrompt, '');
  assert.equal(s.negativePrompt, '');
  assert.doesNotMatch(shotContext(s, [a]).prompt, /负面：/);
  assert.match(
    shotContext({ ...s, negativePrompt: '无画面闪烁' }, [a]).prompt,
    /负面：无画面闪烁/,
  );
  assert.doesNotMatch(
    shotContext(
      {
        ...s,
        negativePrompt:
          '人物身份或面容突变、肢体畸形、手指粘连、服装无故变化、画面闪烁、动作跳变、物体突然出现或消失、文字水印，未成年人、儿童、青少年、幼态面孔、未成年体态、校服',
      },
      [a],
    ).prompt,
    /负面：/,
  );
});
test('I2V keeps first-frame mode and references are deduplicated', () => {
  const a = {...newAsset('reference', 0), imageUrl: 'https://example.com/a.png', description:'blue coat'};
  const s = {...newShot(0), mode: 'i2v' as const, references:a.imageUrl, assetIds:[a.id]};
  assert.equal(shotContext(s,[a]).mode, 'i2v');
  assert.equal(shotContext(s,[a]).references.length, 1);
  assert.doesNotMatch(shotContext(s,[a]).prompt, /Image 1/);
});
test('variant cards get a new empty slot so rapid generates do not overwrite', () => {
  const a = {...newAsset('reference', 0), title: '林晚', description: '26岁', imageUrl: 'https://example.com/a.png'};
  const b = variantAsset(a, 2);
  assert.notEqual(b.id, a.id);
  assert.equal(b.imageUrl, '');
  assert.equal(b.title, a.title);
  assert.equal(b.description, a.description);
  assert.equal(b.position.x, a.position.x + 96);
  assert.equal(b.position.y, a.position.y + 96);
});
test('character and scene references preserve filmmaking and identity', () => {
  const a = {...newAsset('reference', 0), title: '林晚', description: '26岁，黑色长发'};
  assert.match(assetImagePrompt(a), /21岁以上/);
  assert.match(assetImagePrompt(a), /成年角色设定图/);
  assert.doesNotMatch(assetImagePrompt(a), /横向三格/);
  assert.match(assetImagePrompt({...newAsset('scene', 1), title: '酒店', description: '暖光'}), /影视场景参考图/);
  assert.doesNotMatch(assetImagePrompt({...newAsset('scene', 1), title: '酒店', description: '暖光'}), /横向三格/);
});
test("three-view prompt keeps identity and a three-panel layout", () => {
  const a = {...newAsset('reference', 0), title: '林晚', description: '26岁，黑色长发'};
  assert.match(assetThreeViewPrompt(a), /林晚/);
  assert.match(assetThreeViewPrompt(a), /横向三格/);
  assert.match(assetThreeViewPrompt(a), /正面视图/);
  assert.match(assetThreeViewPrompt(a), /21岁以上/);
  assert.doesNotMatch(assetThreeViewPrompt({...a, title: '林晚 · 三视图'}), /林晚 · 三视图/);
});
test('game editor character prompt still asks for a three-panel sheet', () => {
  const prompt = buildCharacterImagePrompt({
    name: '林晚',
    bio: '26岁，黑色长发',
    basePrompt: '',
  });
  assert.match(prompt, /林晚/);
  assert.match(prompt, /横向三格分镜排版/);
  assert.match(prompt, /21岁以上/);
});
