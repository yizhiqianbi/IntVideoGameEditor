export type Category = "治愈日常" | "轻松陪伴" | "奇幻冒险" | "轻悬疑";
export interface Choice { id: string; label: string; next: string }
export interface Scene { text: string; choices: Choice[]; chapter: string }
export interface Character {
  id: string; name: string; subtitle: string; category: Category; art: string;
  description: string; personality: string; goal: string; tags: string[];
  story: string; storyDescription: string; duration: string; color: string;
  scenes: Record<string, Scene>;
}
export const categories: Category[] = ["治愈日常", "轻松陪伴", "奇幻冒险", "轻悬疑"];
export const characters: Character[] = [
  {
    id: "lin", name: "林间", subtitle: "把平凡的日子，种成花", category: "治愈日常", art: "/art/lin.webp", color: "#e8eddf",
    description: "巷尾花店的主人，总能发现日常里不起眼的小美好。最近，她想把一块荒着的窗台变成大家的微型花园。",
    personality: "24岁的花艺师。说话轻快，喜欢先听别人的主意再动手。珍惜植物，也尊重人各自的步调；不会替对方决定心情或行动。",
    goal: "和旅人一起选择窗台花园的第一盆植物，并把它安顿好。", tags: ["花店日常", "温柔倾听"],
    story: "花店的第一位客人", storyDescription: "一盆还没有名字的小花，和一个等待被点亮的窗台。", duration: "约 5 分钟",
    scenes: {
      start: { chapter: "初见 · 巷尾花店", text: "风铃轻轻响了一声。林间从花叶后探出头，手里还拿着一只小陶盆。\n\n“来得正好。我想给街角的空窗台添一点颜色，可一直没选定第一盆花。”她把雏菊和迷迭香放在桌上，“如果是你，会选哪一盆？”", choices: [{ id: "daisy", label: "选这盆小雏菊", next: "daisy" }, { id: "herb", label: "闻一闻迷迭香", next: "herb" }] },
      daisy: { chapter: "第一章 · 小小的决定", text: "“那就让雏菊先来报到。”林间在盆底铺好碎石，把花移到窗边。\n\n阳光刚好落在花瓣上。她找来两张空白木牌：“一张写养护提醒，另一张留给路过的人。你想先做哪件事？”", choices: [{ id: "care", label: "一起写养护提醒", next: "care" }, { id: "note", label: "给路过的人留句话", next: "note" }] },
      herb: { chapter: "第一章 · 风的味道", text: "林间轻轻揉了一片叶子，清新的气味散开。\n\n“它耐旱，适合第一次照顾植物的人。”她在窗台右侧空出一个位置，“花园不必一下子长好，我们先把这盆安顿下来。”", choices: [{ id: "care", label: "了解它需要的照顾", next: "care" }, { id: "note", label: "给小花园写张卡片", next: "note" }] },
      care: { chapter: "终章 · 窗台开始发芽", text: "林间把“土干了再浇水”认真写在木牌上，又在背面添了日期。\n\n“这样，下一位来照顾它的人也知道该怎么办。”她擦干净窗沿，给你留出放工具的位置。\n\n窗台还很空，但花园已经有了开始。今天的这一页，就停在花叶轻轻摇动的地方。", choices: [{ id: "again", label: "从另一种选择重新开始", next: "start" }] },
      note: { chapter: "终章 · 给路过的你", text: "“今天也可以慢慢来。”林间把这句话写在小卡片上，夹在盆边。\n\n第一位路过的邻居停下来笑了笑。林间向她挥手，又转回来说：“等这盆长稳了，我想邀请大家各带一粒种子。”\n\n小小的花园有了第一位主人，也有了下一次相遇的理由。", choices: [{ id: "again", label: "再来看看另一种开头", next: "start" }] },
    },
  },
  {
    id: "yu", name: "屿白", subtitle: "你的心事，我慢慢听", category: "轻松陪伴", art: "/art/yu.webp", color: "#e3eaf0",
    description: "住在海边的插画师，习惯带着速写本散步。他想画完一本关于小岛的图画书，却还缺一个特别的开头。",
    personality: "25岁的插画师。安静但有自己的好奇心，习惯用具体的问题倾听；不宣称自己是真人，不要求排他关系，不替旅人下决定。",
    goal: "向旅人征集图画书的开头，并完成一张草图。", tags: ["海边散步", "认真倾听"],
    story: "把海风画进信里", storyDescription: "翻开空白的速写本，第一笔由你来决定。", duration: "约 5 分钟",
    scenes: {
      start: { chapter: "初见 · 海边书屋", text: "书屋的窗帘被海风轻轻吹起。屿白把桌上的速写本转向你，第一页还是空白。\n\n“我想画一本关于这座岛的书。灯塔和日出都很好，但总觉得少了点什么。”他停了停，“你想从一段海边散步，还是一场窗边的雨开始？”", choices: [{ id: "sea", label: "从海边散步开始", next: "sea" }, { id: "rain", label: "听一场窗边的雨", next: "rain" }] },
      sea: { chapter: "第一章 · 留白的海岸", text: "“那第一页就给海。”屿白画出一条很轻的水平线，给天空留了大半张纸。\n\n“有时不必把每个角落填满。”他把另一支铅笔放在桌边，“岸上要有一串脚印，还是一只等风的小船？”", choices: [{ id: "steps", label: "画一串自由的脚印", next: "steps" }, { id: "boat", label: "画一只等风的小船", next: "boat" }] },
      rain: { chapter: "第一章 · 雨落在纸上", text: "细雨很快在玻璃上留下水痕。屿白用灰蓝色铺出窗外的天空，把屋内的灯留成暖黄色。\n\n“雨天也可以有远方。”他在纸边空出一角，“这里可以画一条走向海的路，或者一只避雨的小船。”", choices: [{ id: "steps", label: "画一条通向海的路", next: "steps" }, { id: "boat", label: "给小船留个避雨处", next: "boat" }] },
      steps: { chapter: "终章 · 第一页", text: "屿白在沙岸添上脚印，却没有把它们画到画外。\n\n“后面怎么走，留给翻书的人。”他将草图夹在板上，题了一个小小的日期。\n\n第一张画完成了。窗外的海还在轻响，这一页终于有了自己的呼吸。", choices: [{ id: "again", label: "试试另一个开头", next: "start" }] },
      boat: { chapter: "终章 · 风会来的", text: "纸上的小船停在浅浅的港湾。屿白给它画上一根结实的系绳，旁边是可以歇脚的小码头。\n\n“等风的时候，也能好好休息。”他合上颜料盒，准备明天再画第二页。\n\n不必着急出发，这个开头已经很好。", choices: [{ id: "again", label: "再画一个不一样的开头", next: "start" }] },
    },
  },
  {
    id: "mori", name: "森森", subtitle: "走吧，去森林捡一点奇遇", category: "奇幻冒险", art: "/art/mori.webp", color: "#e5ead9",
    description: "森林邮局的新任信使，一只带着大围巾的小狐狸。今天，它收到一封只写着“请交给星星”的信。",
    personality: "虚构的森林精灵狐狸。爱冒险，也会承认不知道；遇到没核实的路先查地图。对送信认真，不把未经确认的猜测当事实。",
    goal: "和旅人核实收信人的身份，把信送到正确的地方。", tags: ["森林精灵", "轻奇幻"],
    story: "寄给星星的信", storyDescription: "地址只有三个字。小狐狸邮差需要一位靠谱的同行者。", duration: "约 8 分钟",
    scenes: {
      start: { chapter: "初见 · 森林邮局", text: "一只围着绿色围巾的小狐狸从邮袋里钻出来，鼻尖沾着一小片树叶。\n\n“我叫森森，今天第一天送信！”它举起一封信，“可是地址只写了‘交给星星’。我们先查森林地图，还是去问值班的猫头鹰？”", choices: [{ id: "map", label: "先查森林地图", next: "map" }, { id: "owl", label: "请教猫头鹰先生", next: "owl" }] },
      map: { chapter: "第一章 · 核实地址", text: "地图上有一座星星观测台，也有一家叫“星星”的种子铺。森森用爪子点着两个位置。\n\n“光凭名字还不能决定。”它翻过信封，发现背面画着一颗发芽的种子，“这个标记也许能帮我们。”", choices: [{ id: "seed", label: "去种子铺核对标记", next: "seed" }, { id: "check", label: "先回邮局查寄件记录", next: "check" }] },
      owl: { chapter: "第一章 · 多问一句", text: "猫头鹰推了推眼镜：“星星是种子铺老板的名字，不过，最好核对信封背面的标记。”\n\n森森认真记下，又轻轻翻过信封。那里果然有一颗小芽。“知道去哪里了！也要先确认，再交信。”", choices: [{ id: "seed", label: "去种子铺确认收件人", next: "seed" }, { id: "check", label: "查一查邮局的投递册", next: "check" }] },
      seed: { chapter: "终章 · 正确的收信人", text: "种子铺的门牌上画着同样的小芽。老板核对了寄件人的名字，笑着接过信。\n\n“是我订的春播清单，谢谢你们。”\n\n森森在投递册上认真打勾，尾巴高兴得摇起来。第一封信终于到了该去的地方，下一趟路，也会先把地址查清楚。", choices: [{ id: "again", label: "换一条路再走走", next: "start" }] },
      check: { chapter: "终章 · 不赶路的信使", text: "投递册里写着寄件人和种子铺的完整地址。森森把新地址抄在临时签上，再请值班员核对一次。\n\n“多走一小段，也比送错好。”\n\n黄昏前，信平安交到种子铺老板手里。森森把今天学到的事记在地图角落：不确定的时候，可以多问一句。", choices: [{ id: "again", label: "从邮局再出发一次", next: "start" }] },
    },
  },
  {
    id: "wan", name: "晚晴", subtitle: "和你收集，小岛的晴天", category: "轻悬疑", art: "/art/wan.webp", color: "#eee8df",
    description: "喜欢旧相机和慢车的旅行摄影师。她在车站捡到一张没有署名的老照片，想替它找到原来的主人。",
    personality: "26岁的摄影师。观察细致，重视他人隐私；不凭相貌猜身份，不擅自公开照片，习惯找可核对的线索。",
    goal: "核实旧照片里的地点，通过失物招领找到它的主人。", tags: ["旅行搭子", "温柔解谜"],
    story: "没有署名的晴天", storyDescription: "一张老照片，藏着小岛上一个还没被讲完的故事。", duration: "约 8 分钟",
    scenes: {
      start: { chapter: "初见 · 海风车站", text: "晚晴站在车站的失物招领处，手里夹着一张老照片。照片里是一扇开着白色小花的窗。\n\n“工作人员说，可以先核实拍摄地点，再等主人来认领。”她指了指照片角落，“这里有半个店招，也有一个旧邮戳。你想先看哪一个？”", choices: [{ id: "sign", label: "看看角落的店招", next: "sign" }, { id: "stamp", label: "辨认背面的邮戳", next: "stamp" }] },
      sign: { chapter: "第一章 · 窗边的线索", text: "店招只露出一个“书”字。晚晴取出车站的旧街区地图，找到两家当时营业的书店。\n\n“我们还需要另一条线索。”她看见窗框上独特的三叶雕花，“去问问车站的老员工，或者找旧报纸，都可以。”", choices: [{ id: "ask", label: "请老员工帮忙核实", next: "ask" }, { id: "archive", label: "翻一翻街区旧报纸", next: "archive" }] },
      stamp: { chapter: "第一章 · 日期的另一边", text: "邮戳上能辨认出年份，却没有姓名。晚晴没有继续猜收信人的身份，而是把日期记在纸上。\n\n“用这个年份找书店的旧资料，也许能确认窗户的位置。”", choices: [{ id: "ask", label: "向车站老员工询问", next: "ask" }, { id: "archive", label: "去资料室找旧报纸", next: "archive" }] },
      ask: { chapter: "终章 · 照片暂时的家", text: "老员工认出了海边书屋的三叶窗框，也找出一张当年的站前街景。两张照片的细节对上了。\n\n晚晴把核实的地点交给失物招领处，只留下必要信息。\n\n“现在，让主人自己来补完这个故事。”她收起相机。今天没有解开所有谜底，但照片离家近了一点。", choices: [{ id: "again", label: "从另一条线索开始", next: "start" }] },
      archive: { chapter: "终章 · 留给重逢", text: "旧报纸里登着海边书屋开张的消息，窗上的雕花和照片完全一致。\n\n晚晴把报纸日期和书屋地址一并交回车站，照片仍妥善放在失物柜里。\n\n“我们找到的是地点，主人的故事还得等本人来讲。”窗外放晴了，她为今天拍下一张没有陌生人入镜的海。", choices: [{ id: "again", label: "再寻找另一条线索", next: "start" }] },
    },
  },
];
export const getCharacter = (id: string) => characters.find(c => c.id === id);
export interface CustomCharacter { id: string; baseId: string; name: string; description: string; createdAt: number }
export interface Message { id: string; role: "user" | "assistant"; content: string }
export interface Conversation { id: string; characterId: string; customId?: string; messages: Message[]; node: string; updatedAt: number; mode: "demo" | "live" }
