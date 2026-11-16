import { easyOCR } from "./utils.js";
// UI工具模块 - 处理文本提取与 OCR 点击等工具函数
// 人名提取函数
export function extractName(text) {
  const patterns = [
    /与(.+?)对话/,
    /与(.+?)一起/,
    /同(.+?)交谈/,
    /向(.+?)打听/,
    /向(.+?)回报/,
    /向(.+?)报告/,
    /给(.+?)听/,
    /陪同(.+?)\S+/,
    /找到(.+?)\S+/,
    /询问(.+?)\S+/,
    /拜访(.+?)\S+/,
    /寻找(.+?)\S+/,
    /告诉(.+?)\S+/,
    /带(.+?)去\S+/,
    /跟随(.+?)\S+/,
    /协助(.+?)\S+/,
    /请教(.+?)\S+/,
    /拜托(.+?)\S+/,
    /委托(.+?)\S+/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

// OCR点击指定文本（包含关系），支持 Alt+Click
export async function clickTargetByText(text, region = { X: 0, Y: 0, WIDTH: 1920, HEIGHT: 1080 }) {
  try {
    const results = await easyOCR(region);
    for (let i = 0; i < results.count; i++) {
      const item = results[i];
      if (item && item.text && item.text.includes(text)) {
        keyDown("VK_MENU");
        await sleep(200);
        click(item.x, item.y);
        leftButtonClick();
        await sleep(200);
        keyUp("VK_MENU");
        return true;
      }
    }
    return false;
  } catch (e) {
    log.error("clickTargetByText 出错: {error}", e.message);
    return false;
  }
}
