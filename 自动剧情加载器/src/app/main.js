import { chooseProcess } from "../picker/picker.js";
import { normalizeText, easyOCR, similarity } from "../common/utils.js";
import { processMapTracking } from "../steps/map-tracking.js";
import { executeOptimizedAutoTalk } from "../steps/dialog-processor.js";
import { processRegisteredStep } from "../flow/step-processor-factory.js";
import { switchPartyIfNeeded } from "./switch-party.js";
import { isInMainUI } from "../common/main-ui.js";
import { initRealtimeTriggers, disableAllRealtimeTriggers } from "../common/realtime-triggers.js";
import { buildBlockIndex, loadAndParseProcessFile } from "../flow/parser.js";
import { executeInstruction } from "../flow/instruction-executor.js";

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

// 执行扩展的简单格式脚本
async function executeSimpleScriptFlow(simpleScript, process_path, resumeRelativePath) {
  const META = simpleScript.meta || {};
  const BLOCKS = Array.isArray(simpleScript.blocks) ? simpleScript.blocks : [];
  const defaultBlock = BLOCKS.find(b => b.isDefault) || null;
  // 跨指令共享的队伍状态：记录原始队伍，供“切换 原来队伍”恢复
  const teamState = { originalTeam: null };
  // 指令执行上下文；teamState 在同一流程内共享
  const executionContext = { processPath: process_path, team, elementTeam, teamState };

  if (META.author) log.info("作者: {author}", META.author);
  if (META.description) log.info("描述: {desc}", META.description);

  // 建立描述 -> 块 列表映射，保持顺序；两份数组分别用于执行与断点
  const { groupMap, resumingMap } = buildBlockIndex(BLOCKS);

  const execCounter = new Map();

  const detectCurrentDesc = async () => {
    const region = { X: 75, Y: 240, WIDTH: 280, HEIGHT: 43 };
    const ocr = await easyOCR(region);
    let best = { sim: 0, descNorm: null };
    for (let i = 0; i < ocr.count; i++) {
      log.info("正在匹配任务区文本: {text}", ocr[i].text);
      const txt = normalizeText(ocr[i].text);
      for (const [descNorm] of groupMap) {
        if (!descNorm) continue;
        const sim = similarity(txt, descNorm);
        if (sim > best.sim) best = { sim, descNorm };
      }
    }
    if (ocr.count === 0) {
      log.info("未匹配到任务描述文本");
    }
    return best.sim >= 0.9 ? best.descNorm : null;
  };

  // 检查是否有非默认块（任务描述块）
  const hasTaskBlocks = BLOCKS.some(block => !block.isDefault);

  // 如果没有任务描述块，只有默认块，则直接执行默认块一次后返回
  if (!hasTaskBlocks && defaultBlock) {
    log.info("脚本中无任务描述块，直接执行默认块");
    //log.info("位置: {path}", process_path);
    while (0 < defaultBlock.instructions.length) {
      const instr = defaultBlock.instructions[0];
      const res = await executeInstruction(instr, executionContext);

      log.info("当前流程执行完毕，更新断点文件");
      defaultBlock.instructions.splice(0, 1);
      file.writeTextSync(`resuming/${resumeRelativePath}`, JSON.stringify(simpleScript, null, 2));
      if (res === "DONE") {
        log.info("收到任务完成指令，任务完成");
        return true;
      }
      await sleep(200);
    }
    return true;
  }

  let safety = 0;
  let lastMatchedDescNorm = null; // 记录上一次匹配到的描述
  let retryCount = 0; // 重试计数器
  const MAX_RETRY = 2; // 最大重试次数

  while (safety++ < 200) {
    // 13秒窗口尝试匹配
    let matchedDescNorm = null;
    await genshin.returnMainUi();
    for (let i = 0; i < 13; i++) {
      matchedDescNorm = await detectCurrentDesc();
      if (matchedDescNorm) break;
      keyPress("V");
      await sleep(1000);
    }

    // 保存断点进度
    if (lastMatchedDescNorm && matchedDescNorm !== lastMatchedDescNorm) {
      try {
        log.info("流程执行完毕，更新断点文件");
        resumingMap.get(lastMatchedDescNorm).shift();
        const descriptionNorms = Array.from(resumingMap.keys());
        const blocks = descriptionNorms.flatMap(norm => resumingMap.get(norm));
        const simpleScript = { meta: META, blocks: blocks };
        file.writeTextSync(`resuming/${resumeRelativePath}`, JSON.stringify(simpleScript, null, 2));
      } catch (error) {
        log.error(`更新断点文件时出错{error}`, error.message);
        break;
      }
    }

    // 如果任务描述变为其他，重置计数器
    if (matchedDescNorm !== lastMatchedDescNorm) {
      retryCount = 0;
      lastMatchedDescNorm = matchedDescNorm;
      const ran = execCounter.get(matchedDescNorm) || 0;
      execCounter.set(matchedDescNorm, ran + 1);
    } else {
      // 如果匹配到跟上次一样的，增加重试计数
      retryCount++;
    }

    // 如果重试超过限制，直接退出
    if (retryCount > MAX_RETRY) {
      log.error("同一任务描述已重试2次，执行失败，结束流程");
      break;
    }

    let blockToRun = null;
    if (matchedDescNorm && groupMap.has(matchedDescNorm)) {
      const ran = execCounter.get(matchedDescNorm) || 0;
      const list = groupMap.get(matchedDescNorm);
      const idx = Math.min(ran - 1, list.length - 1);
      blockToRun = list[idx];
      log.info("匹配到任务描述块: {desc}，第{idx}次执行", blockToRun.description, idx + 1);
    } else if (defaultBlock) {
      blockToRun = defaultBlock;
      log.info("未匹配到任务描述，执行默认块: {desc}", defaultBlock.description);
    } else {
      log.warn("未匹配到任务描述且不存在默认块，结束流程");
      break;
    }

    // 执行块内指令
    for (const instr of blockToRun.instructions) {
      const res = await executeInstruction(instr, executionContext);
      if (res === "DONE") {
        log.info("收到任务完成指令，任务完成");
        return true;
      }
      await sleep(200); // 指令间短暂间隔
    }

    await sleep(500); // 块间间隔
  }

  return true;
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
          return await executeSimpleScriptFlow(simpleScript, process_path, resumeRelativePath);
        } catch (error) {
          log.debug(`读取断点文件时出错: {error}`, error.message);
          log.info("未找到断点文件，执行完整任务流程");
        }
      }
      return await executeSimpleScriptFlow(processSteps.script, process_path, resumeRelativePath);
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