import { DialogProcessor } from "./dialog-processor.js";

// 处理对话步骤
export async function processDialogStep(step, priorityOptions, npcWhiteList, isInMainUI) {
  log.info("执行对话");
  let skipCount = 2; // 默认跳过2次

  // 处理对话选项
  if (typeof step.data === "number") {
    // 兼容旧版本，如果data是数字，则视为skipCount
    skipCount = step.data;
  } else if (typeof step.data === "object" && step.data.skipCount) {
    // 新版本，data是对象，包含skipCount
    skipCount = step.data.skipCount;
  }

  // 执行对话，使用当前步骤的优先选项和NPC白名单
  await DialogProcessor.executeOptimizedAutoTalk(
    skipCount,
    priorityOptions,
    npcWhiteList,
    isInMainUI
  );
}
