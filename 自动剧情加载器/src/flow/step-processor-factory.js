import { StepProcessor } from "../steps/step-processor.js";
import { processDialogStep } from "../steps/dialog-step.js";

  // 步骤处理器工厂 - 更好的扩展性设计
  // TAG:添加脚本功能点2
  export const StepProcessorFactory = {
    // 步骤处理器映射表
    processors: {
      地图追踪: async (step, context) => {
        await StepProcessor.processMapTracking(
          step,
          context
        );
      },

      等待: async (step, context) => {
        const waitTime = step.data || 5000;
        log.info("等待 {time} 毫秒", waitTime);
        await sleep(waitTime);
      },

      追踪委托: async (step, context) => {
        await StepProcessor.processCommissionTracking(step);
      },

      键鼠脚本: async (step, context) => {
        await StepProcessor.processKeyMouseScript(
          step,
          context
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
      await StepProcessor.processKeyPress(step);
      },

      tp: async (step, context) => {
        await StepProcessor.processTeleport(step);
      },

      等待返回主界面: async (step, context) => {
        await StepProcessor.processWaitMainUI(step.data);
      },

      切换角色: async (step, context) => {
        await StepProcessor.processSwitchRole(step);
      },

      自动任务: async (step, context) => {
        await StepProcessor.processAutoTask(step);
      },
	  长按: async (step, context) => {
		const keydownTime = context.data || 3000;
        log.info("等待 {keydownTime} 毫秒", keydownTime);
		keyDown(data.step)
        await sleep(keydownTime);
		keyup(data.step)
        await StepProcessor.longpressthebutton(step);
      },
    },

    // 注册新的步骤处理器
    register: (stepType, processor) => {
      StepProcessorFactory.processors[stepType] = processor;
      log.info("注册新的步骤处理器: {type}", stepType);
    },

    // 处理步骤
    process: async (step, context) => {
      const processor = StepProcessorFactory.processors[step.type];
      if (processor) {
        await processor(step, context);
      } else {
        log.warn("未知的流程类型: {type}", step.type);
      }
    },
  };
