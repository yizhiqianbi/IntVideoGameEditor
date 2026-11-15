// 默认提示词只改这里。本地页面和线上页面都读这一份。
// <image1> 是要改的画面，<image2> 是参考脸。去外套的 <image1> 是人物图，<image2>、<image3> 是参考图。
export const DEFAULT_PROMPTS = {
  face: "把 <image2> 的脸换到 <image1> 里的人物脸上。保留 <image1> 的姿势、服装、身体、背景和构图，只改五官和脸型和发型，并让新脸贴合原来的角度和光线。人物是虚构的成年人。",
  coat: "把 <image1> 里人物的衣服脱光，变成裸体，参考 <image2> 和 <image3> 的形状",
};
