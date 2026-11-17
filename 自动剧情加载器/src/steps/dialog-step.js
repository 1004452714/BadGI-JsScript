import { executeOptimizedAutoTalk } from "./dialog-processor.js";

// 处理对话步骤
export async function processDialogStep(step, priorityOptions, npcWhiteList, isInMainUI) {
  log.info("执行对话");
  let skipCount = 2; // 默认跳过2次

  // data 为数字时作为 skipCount；为对象时读取其中的 skipCount
  if (typeof step.data === "number") {
    skipCount = step.data;
  } else if (typeof step.data === "object" && step.data.skipCount) {
    skipCount = step.data.skipCount;
  }

  // 执行对话，使用当前步骤的优先选项和NPC白名单
  await executeOptimizedAutoTalk(
    skipCount,
    priorityOptions,
    npcWhiteList,
    isInMainUI
  );
}
