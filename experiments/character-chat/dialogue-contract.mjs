// Reject unmistakable roleplay formatting, rather than editing what she said.
// This is a format guard, not a semantic judge of every third-person sentence.
const quoted = /```[\s\S]*?```|`[^`]*`|“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"|(?<![\p{L}\p{N}])'[^'\n]*'(?![\p{L}\p{N}])/gu;
const label = /(?:^|\n)\s*(?:Yume|Nari|Assistant|助手|角色)\s*[:：]/iu;
const wrapped = /\(([^()\n]{1,160})\)|（([^（）\n]{1,160})）|\[([^\[\]\n]{1,160})\]|\*{1,2}([^*\n]{1,160})\*{1,2}/gu;
const stageAction = /^(?:(?:我|她|他|Yume|Nari)\s*)?(?:(?:轻轻|轻柔地|微微|悄悄|偷偷|慢慢|害羞地|红着脸|笑着|微笑着)\s*)?(?:笑(?:了笑|着)?$|微笑$|脸红(?:着)?|低下头|抬起头|眨(?:眨)?眼|伸(?:出)?手|抱住|抱紧|拥抱|靠近|靠在|贴近|凑近|握住|牵起|亲吻|踮起脚|推开门|走(?:向|到)你|看着你|摸(?:摸)?你的|心里(?:暗暗)?(?:想|想着))/iu;
const englishAction = /^(?:(?:she|he|I|Yume|Nari)\s+)?(?:(?:gently|softly|slowly|shyly)\s+)?(?:smiles?|blush(?:es)?|hugs?|nods?|winks?|leans? closer|holds? your hand|looks? (?:at you|down)|whispers?)(?:\s|[.,]|$)/iu;

export function assertDirectDialogue(value) {
  const text = String(value);
  const inspect = text.replace(quoted, '');
  let action = false;
  for (const match of inspect.matchAll(wrapped)) {
    const inside = match.slice(1).find(item => item !== undefined)?.trim() || '';
    if (stageAction.test(inside) || englishAction.test(inside)) { action = true; break; }
  }
  if (label.test(inspect) || action) {
    throw Object.assign(new Error('这次回复混入了角色标签或动作旁白，请重试。'), { status: 502, code: 'DIALOGUE_FORMAT' });
  }
  return value;
}
