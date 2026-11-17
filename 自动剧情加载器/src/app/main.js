import { chooseProcess } from "../picker/picker.js";
import { normalizeText, easyOCR, similarity } from "../common/utils.js";
import { interactWithTarget, clickAtCoordinates, clickByImageMatch, clickByOcrText, returnToMainUI } from "../steps/ui-actions.js";
import { switchPartyCharacters, switchPartyByName, switchCharacterBodyType } from "../steps/party-actions.js";
import { processMapTracking, processCommissionTracking } from "../steps/map-tracking.js";
import { processKeyMouseScript } from "../steps/keymouse.js";
import { processKeyPress } from "../steps/key-commands.js";
import { processWaitMainUI } from "../steps/timers.js";
import { executeAutoTalk, executeOptimizedAutoTalk } from "../steps/dialog-processor.js";
import { processRegisteredStep } from "../flow/step-processor-factory.js";
import { autoNavigateToIcon } from "../steps/navigator.js";
import { switchPartyIfNeeded } from "./switch-party.js";
import { isInMainUI } from "../common/main-ui.js";
import { initRealtimeTriggers, setRealtimeTrigger, disableAllRealtimeTriggers } from "../common/realtime-triggers.js";
import { buildBlockIndex, loadAndParseProcessFile } from "../flow/parser.js";

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

  const executeInstruction = async (instr) => {
    const type = instr.type;
    const data = instr.data;
    switch (type) {
      case "地图追踪":
        await processMapTracking({ data }, process_path);
        break;
      case "键鼠脚本":
        await processKeyMouseScript({ data }, process_path);
        break;
      case "对话": {
        // 优先点击NPC名
        await executeAutoTalk(data);
        break;
      }
      case "交互": {
        await interactWithTarget(data);
        break;
      }
      case "等待返回主界面":
        await processWaitMainUI(data);
        break;
      case "追踪图标": {
        const iconType = data || "Bigmap";
        await autoNavigateToIcon(iconType);
        break;
      }
      case "追踪委托": {
        if (data !== undefined && data !== null) {
          await processCommissionTracking({ data });
        }
        break;
      }
      case "提示": {
        if (data) {
          log.info("提示: {data}", data);
        }
        break;
      }
      case "调时间": {
        await sleep(1000);//等待任务弹出
        let filePath = `Data/time.json`;
        await keyMouseScript.runFile(filePath);
        break;
      }
      case "按键":
        await processKeyPress({ data });
        break;
      case "等待":
        log.info("等待{data}毫秒", data);
        await sleep(typeof data === "number" ? data : 5000);
        break;
      case "自动拾取":
        // 只切换自动拾取本身，不再整体清空启用名单，避免连带关掉自动剧情/自动吃药
        if (data === "关闭") {
          setRealtimeTrigger("autoPick", false);
        } else {
          setRealtimeTrigger("autoPick", true);
        }
        break;
      case "任务完成":
        return "DONE";
      case "暂停":
        let isPaused = true;
        let hook = null;
        let stopkey = settings.pause //定义暂停键(可能多此一举？)
        try {
          await sleep(1000);//暂停前等待（似乎没用吧）
          log.warn("脚本已暂停，请手动操作游戏");
          if (settings.xiaoxitongzhi) notification.error("脚本已暂停，请手动操作游戏");
          if (data) {
            log.warn('作者提示：{data}', data);
          }
          log.warn(`完成后按 ${stopkey} 键继续...`);
          hook = new KeyMouseHook();  // 注册按键回调
          hook.OnKeyDown(function (stopkeykey) {
            // 判断是否是暂停键
            if (stopkeykey === stopkey) {
              isPaused = false;
              log.info(`已检测到 ${stopkey} 键，准备继续执行`);
            }
          });
          // 等待按下暂停键
          while (isPaused) {
            await sleep(100); // 等待减少资源消耗
          }
          log.info("脚本继续执行...");
        } catch (error) {
          log.error("发生错误:", error);
        } finally {
          // 释放键鼠资源；new KeyMouseHook() 失败时 hook 仍为 null，直接 dispose 会二次抛错
          if (hook) {
            hook.dispose();
            log.info("已释放资源");
          }
        }
        // 继续执行其他任务
        log.info("执行后续任务...");
        await sleep(1000);
        break;
      case "战斗":
        await dispatcher.runTask(new SoloTask("AutoFight"));
        break;
      case "切换": {
        await switchPartyCharacters(data, teamState);
        break;
      }
      case "点击": {
        await clickAtCoordinates(data);
        break;
      }
      case "切换队伍": {
        await switchPartyByName(data, team, elementTeam);
        break;
      }
      case "图像匹配": {
        await clickByImageMatch(data, process_path);
        break;
      }
      case "切换角色体型": {
        await switchCharacterBodyType(data);
        break;
      }
      case "点击文字": {
        await clickByOcrText(data);
        break;
      }
      case "返回主界面":
        await returnToMainUI();
        break;
      default:
        log.warn("未实现的指令类型: {type}", type);
    }
    return "OK";
  };

  // 检查是否有非默认块（任务描述块）
  const hasTaskBlocks = BLOCKS.some(block => !block.isDefault);

  // 如果没有任务描述块，只有默认块，则直接执行默认块一次后返回
  if (!hasTaskBlocks && defaultBlock) {
    log.info("脚本中无任务描述块，直接执行默认块");
    //log.info("位置: {path}", process_path);
    while (0 < defaultBlock.instructions.length) {
      const instr = defaultBlock.instructions[0];
      const res = await executeInstruction(instr);

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
      const res = await executeInstruction(instr);
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
