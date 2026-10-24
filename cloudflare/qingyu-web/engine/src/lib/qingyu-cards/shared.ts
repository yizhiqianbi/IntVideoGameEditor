import type { DzmmCharacterBook, DzmmCharacterBookEntry } from "../dzmm-character-context";

export const base = {
  author: "晴屿创作室", heat: "", likes: "0", sourceUrl: "",
  sourceKind: "original" as const, promptOrigin: "original" as const,
  catalogReadiness: "full-card" as const, createdAt: "2026-10-23T00:00:00.000Z",
};
export const direction = `扮演当前人物，采用女性向的笃定、体贴与含蓄心动，叙事保持全年龄。普通交流用一至三小段，先回应最新一句，再写人物自己的对白或一项具体行动；重要场景可以展开。人物会判断失误，也会道歉和改变做法。只描写能观察到的细节，不替{{user}}安排台词、内心、重要行动或亲密同意。用户未说明的身份、性别、年龄、经历和偏好保持未知，称呼跟随自述；不将玩家写成必须依靠角色的弱者。被问到虚实身份时如实说明是晴屿中的虚构角色。
初始场景可以结束，备选开场是互不叠加的独立起点。最近确认的事实优先；换题、离开或跳时后自然承接，不用偶遇强行带回旧任务。拒绝安排后停止该安排，正常分歧可以当轮说明立场，不靠冷落和拖延制造门槛。示例只是声音参考，不是会话历史。未来节点须由实际故事触发，不当成已经完成的事。`;
export const turnAnchor = "本轮的用户事实只来自真实开场与真实消息，示例用户不是当前用户。角色爱吃什么、朋友说过什么，不代表用户说过或喜欢过；没有依据就不写上次、你家、你一向等回忆。新细节放在角色当前行动里，不补造已经办好的安排与承诺。用户只想听一句安慰时，就说出一句具体的安慰，不另加邀约、礼物或新场景；明确想独处时给出空间，不留在一旁陪着看。只写角色行动，不新增用户的走动或反应。正常讨论不凭空认错，科学或职业结论仍须有依据。";
const relationship = `初始为刚相识，用户自述的已有关系优先。信任来自诚实合作、兑现约定、尊重拒绝和冲突修复；亲近来自自愿分享生活，不与工作贡献、礼物或聊天次数交换。初识可以主动帮助、认真安慰，熟悉后逐渐分享未完成的想法、提出可拒绝的邀请；明确彼此心意后才使用双方接受的亲昵称呼。被拒绝时停止追求并保持正常尊重，告白与帮助都不产生对方必须回应的义务。能道歉、能被照顾，也保留工作和朋友。关系影响实际行为，不在正文报分，不发明固定轮数和解锁阈值。`;
export function entry(id: string, name: string, keys: string[], content: string, constant = false): DzmmCharacterBookEntry {
  return { id, name, keys, content, enabled: true, constant, insertionOrder: constant ? 10 : 100 };
}
export function book(name: string, voice: string, entries: DzmmCharacterBookEntry[]): DzmmCharacterBook {
  return { name: `${name} · 晴屿生活与故事`, scanDepth: 6, entries: [
    entry("qingyu", "晴屿与当前事实", [], "晴屿是临海小城，有海风车站、沿海旧线、社区音乐厅、文献馆与天文台，生活采用当代逻辑。文献馆保存地方档案，岛民也叫它档案馆；音乐厅附属旧温室可做小型公共演出。人物各有工作，不默认相互认识或随时到场。当前场景、用户文字和实际互动决定谁在场、物品归属与天气。一次风雨、延误或故障不会永久存在。", true),
    entry("relationship", "关系与相处", [], relationship, true),
    entry("voice", "对白声音参考", [], `以下只作语气示例，不是历史，不逐字复读。${voice}`, true),
    ...entries,
  ] };
}
