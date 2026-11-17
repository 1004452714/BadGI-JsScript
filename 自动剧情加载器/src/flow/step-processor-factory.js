// 步骤处理器工厂：按 JSON 步骤类型分发给对应处理器，并支持运行时注册新类型。
// 依赖：log / sleep；各步骤处理器来自 steps 模块。

import { processSwitchRole } from "../steps/party-actions.js";
import { processAutoTask } from "../steps/auto-task.js";
import { processMapTracking, processCommissionTracking } from "../steps/map-tracking.js";
import { processKeyMouseScript } from "../steps/keymouse.js";
import { processKeyPress } from "../steps/key-commands.js";
import { processWaitMainUI } from "../steps/timers.js";
import { processDialogStep } from "../steps/dialog-step.js";

// 步骤类型 → 处理器的映射表
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

/**
 * 注册一个新的步骤处理器。
 * @param {string} stepType 步骤类型名
 * @param {(step: Object, context: Object) => Promise<void>} processor 处理器函数
 * @returns {void}
 */
export function registerStepProcessor(stepType, processor) {
  processors[stepType] = processor;
  log.info("注册新的步骤处理器: {type}", stepType);
}

/**
 * 按步骤类型查找并执行处理器；未知类型仅记录警告。
 * @param {{type: string}} step 步骤对象
 * @param {Object} context 执行上下文
 * @returns {Promise<void>}
 */
export async function processRegisteredStep(step, context) {
  const processor = processors[step.type];
  if (processor) {
    await processor(step, context);
  } else {
    log.warn("未知的流程类型: {type}", step.type);
  }
}
