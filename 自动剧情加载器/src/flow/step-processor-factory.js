import { processSwitchRole, processAutoTask } from "../steps/step-processor.js";
import { processMapTracking, processCommissionTracking } from "../steps/map-tracking.js";
import { processKeyMouseScript } from "../steps/keymouse.js";
import { processKeyPress } from "../steps/key-commands.js";
import { processWaitMainUI } from "../steps/timers.js";
import { processDialogStep } from "../steps/dialog-step.js";

// 步骤处理器工厂 - 更好的扩展性设计
// TAG:添加脚本功能点2

// 步骤处理器映射表
const processors = {
  地图追踪: async (step, context) => {
    await processMapTracking(
      step,
      context.processPath
    );
  },

  等待: async (step, context) => {
    const waitTime = step.data || 5000;
    log.info("等待 {time} 毫秒", waitTime);
    await sleep(waitTime);
  },

  追踪委托: async (step, context) => {
    await processCommissionTracking(step);
  },

  键鼠脚本: async (step, context) => {
    await processKeyMouseScript(
      step,
      context.processPath
    );
  },

  对话: async (step, context) => {
    await processDialogStep(
      step,
      context.priorityOptions,
      context.npcWhiteList,
      context.isInMainUI
    );
  },

  按键: async (step, context) => {
    await processKeyPress(step);
  },

  等待返回主界面: async (step, context) => {
    await processWaitMainUI(step.data);
  },

  切换角色: async (step, context) => {
    await processSwitchRole(step);
  },

  自动任务: async (step, context) => {
    await processAutoTask(step);
  },
};

// 注册新的步骤处理器
export function registerStepProcessor(stepType, processor) {
  processors[stepType] = processor;
  log.info("注册新的步骤处理器: {type}", stepType);
}

// 处理步骤
export async function processRegisteredStep(step, context) {
  const processor = processors[step.type];
  if (processor) {
    await processor(step, context);
  } else {
    log.warn("未知的流程类型: {type}", step.type);
  }
}
