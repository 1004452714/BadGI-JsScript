import { chooseProcess } from "../picker/picker.js";
import { processMapTracking } from "../steps/map-tracking.js";
import { executeOptimizedAutoTalk } from "../steps/dialog-processor.js";
import { processRegisteredStep } from "../flow/step-processor-factory.js";
import { switchPartyIfNeeded } from "./switch-party.js";
import { isInMainUI } from "../common/main-ui.js";
import { initRealtimeTriggers, disableAllRealtimeTriggers } from "../common/realtime-triggers.js";
import { loadAndParseProcessFile } from "../flow/parser.js";
import { executeSimpleScriptFlow } from "../flow/simple-script-runner.js";

// 版本号以 manifest.json 为单一来源；读取失败或缺少版本时返回空字符串
function readManifestVersion() {
  try {
    const manifest = JSON.parse(file.readTextSync("manifest.json"));
    return manifest.version || "";
  } catch {
    return "";
  }
}

const VERSION = readManifestVersion();

// 读取设置
const team = settings.team || "";
const elementTeam = settings.elementTeam || "";
async function errorlog() {
  // 输出版本信息
  log.info("=".repeat(20));
  log.info("版本: {version}", VERSION);
  log.info("=".repeat(20));
}

// 执行对话委托流程（优化版）
async function executeTalkCommission(process_path, resumeRelativePath) {
  try {

    // 实时任务在流程真正开始时启用，而不是在脚本启动阶段
    initRealtimeTriggers();
    const processSteps = await loadAndParseProcessFile(process_path);

    //log.info("文件位置: {path}", process_path);

    // 使用统一的处理器执行流程
    if (processSteps && processSteps.__simpleScript) {
      if (settings.useBreakPoint) {
        try {
          log.info("尝试读取断点文件");
          // 拼接断点文件路径
          const breakpointFilePath = `resuming/${resumeRelativePath}`;
          const simpleScript = JSON.parse(file.readTextSync(breakpointFilePath));
          return await executeSimpleScriptFlow(simpleScript, process_path, resumeRelativePath, team, elementTeam);
        } catch (error) {
          log.debug(`读取断点文件时出错: {error}`, error.message);
          log.info("未找到断点文件，执行完整任务流程");
        }
      }
      return await executeSimpleScriptFlow(processSteps.script, process_path, resumeRelativePath, team, elementTeam);
    }
    return await executeUnifiedTalkProcess(
      processSteps,
      process_path
    );
  } catch (error) {
    log.error("执行对话委托时出错: {error}", error.message);
    if (settings.xiaoxitongzhi) notification.error("执行对话委托时出错: " + error.message);
    return false;
  }
}

// 统一的对话委托流程处理器（重构版 - 更简洁的主控制函数）
async function executeUnifiedTalkProcess(
  processSteps,
  processPath,
  location
) {
  try {
    log.info("执行统一对话委托流程: {path}", processPath);

    if (!processSteps || processSteps.length === 0) {
      log.warn("没有找到有效的流程步骤");
      return false;
    }

    // 初始化优先选项与NPC白名单
    let priorityOptions = [];
    let npcWhiteList = [];

    // 刚开始就追踪委托目标
    //await findCommissionTarget(processPath);

    // 执行处理步骤
    for (let i = 0; i < processSteps.length; i++) {
      const step = processSteps[i];
      log.info("执行流程步骤 {step}: {type}", i + 1, step.type || step);

      try {
        // 重置为默认值并处理自定义配置
        const stepConfig = processStepConfiguration(
          step,
          priorityOptions,
          npcWhiteList
        );
        priorityOptions = stepConfig.priorityOptions;
        npcWhiteList = stepConfig.npcWhiteList;

        // TAG:添加脚本功能点3
        const context = {
          processPath,
          location,
          processSteps,
          currentIndex: i,
          isInMainUI,
          priorityOptions,
          npcWhiteList,
        };

        // 处理步骤
        await processStep(step, context);
      } catch (stepError) {
        log.error(
          "执行步骤 {step} 时出错: {error}",
          i + 1,
          stepError.message
        );
        // 继续执行下一步，不中断整个流程
      }

      // 每个步骤之间等待一段时间
      await sleep(2000);
    }

    log.info("统一对话委托流程执行完成: {path}", processPath);
    return true;
  } catch (error) {
    log.error("执行统一对话委托流程时出错: {error}", error.message);
    return false;
  }
}

// 处理步骤配置（优先选项和NPC白名单）
function processStepConfiguration(
  step,
  defaultPriorityOptions,
  defaultNpcWhiteList
) {
  let priorityOptions = [...defaultPriorityOptions];
  let npcWhiteList = [...defaultNpcWhiteList];

  // 如果步骤中包含自定义的优先选项和NPC白名单，则使用它们
  if (step.data && typeof step.data === "object") {
    if (Array.isArray(step.data.priorityOptions)) {
      priorityOptions = step.data.priorityOptions;
      log.info("使用自定义优先选项: {options}", priorityOptions.join(", "));
    }
    if (Array.isArray(step.data.npcWhiteList)) {
      npcWhiteList = step.data.npcWhiteList;
      log.info("使用自定义NPC白名单: {npcs}", npcWhiteList.join(", "));
    }
  }

  return { priorityOptions, npcWhiteList };
}

// 处理单个步骤
async function processStep(step, context) {
  if (typeof step === "string") {
    // 简单格式处理
    await processStringStep(step, context);
  } else if (typeof step === "object") {
    // JSON格式处理
    await processObjectStep(step, context);
  }
}

// 处理字符串格式的步骤
async function processStringStep(step, context) {
  if (step.endsWith(".json")) {
    // 地图追踪文件
    await processMapTracking({ data: step }, context.processPath);
  } else if (step === "F") {
    // 按F键并执行优化的自动剧情
    log.info("执行自动剧情");
    await executeOptimizedAutoTalk(
      5,
      context.priorityOptions,
      context.npcWhiteList,
      context.isInMainUI
    );
  }
}

// 处理对象格式的步骤
async function processObjectStep(step, context) {
  if (step.note) {
    log.info("步骤说明: {note}", step.note);
  }

  // 使用步骤处理器工厂来处理步骤
  await processRegisteredStep(step, context);
}

//Main
export const Main = async () => {
  log.debug("版本: {version}", VERSION);
  try {
    if (!settings.pause) {
      log.error("请在JS脚本自定义配置中配置暂停键");
      log.error("");
      log.error("请在JS脚本自定义配置中配置暂停键");
      log.error("");
      log.error("请在JS脚本自定义配置中配置暂停键");
      log.error("");
      await sleep(10000);
      return;
    }
    const picked = await chooseProcess();
    if (!picked) {
      log.info("未选择剧情，脚本结束");
      return;
    }

    log.info("执行任务: {path}", picked.name);
    const resumeRelativePath = picked.path.replace(/^process[\\/]/, "");
    await switchPartyIfNeeded(team);
    await executeTalkCommission(picked.path, resumeRelativePath);
    if (settings.xiaoxitongzhi) notification.Send("脚本执行完成");
  } catch (error) {
    log.error("执行出错: {error}", error.message);
    errorlog();
    if (settings.xiaoxitongzhi) notification.error("脚本执行出错: " + error.message);
  } finally {
    // 出错路径同样要复位实时任务，否则自动拾取/吃药/跳过会残留到下一个脚本
    disableAllRealtimeTriggers();
  }
};