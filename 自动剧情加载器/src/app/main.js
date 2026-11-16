import { chooseProcess } from "../picker/picker.js";
import { normalizeText, easyOCR, similarity, readAliases } from "../common/utils.js";
import { clickTargetByText } from "../common/ui-utils.js";
import { processMapTracking, processKeyMouseScript, processWaitMainUI, processCommissionTracking, processKeyPress, processSwitchRole } from "../steps/step-processor.js";
import { executeAutoTalk, executeOptimizedAutoTalk } from "../steps/dialog-processor.js";
import { processRegisteredStep } from "../flow/step-processor-factory.js";
import { autoNavigateToIcon } from "../steps/navigator.js";
import { switchPartyIfNeeded } from "./switch-party.js";
import { isInMainUI } from "../common/main-ui.js";
import { initRealtimeTriggers, setRealtimeTrigger, disableAllRealtimeTriggers } from "../common/realtime-triggers.js";

// 按任务描述规范化文本分组；groupMap 用于执行查找，resumingMap 单独持有数组用于断点裁剪
function buildBlockIndex(blocks) {
  const build = () => {
    const map = new Map();
    for (const block of blocks) {
      if (!map.has(block.descriptionNorm)) map.set(block.descriptionNorm, []);
      map.get(block.descriptionNorm).push(block);
    }
    return map;
  };
  return { groupMap: build(), resumingMap: build() };
}

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

// 寻找委托目的地址带追踪任务
// 读取并解析流程文件为步骤数组
async function loadAndParseProcessFile(
  process_path
) {
  const processFilePath = process_path;
  let processContent;
  let processSteps;
  processContent = await file.readText(processFilePath);
  if (!processContent || !processContent.trim()) {
    log.error("流程文件为空或读取失败: {path}", processFilePath);
    return false;
  }
  log.info("找到流程文件: {path}", processFilePath);
  const pauseCount = (processContent.match(/^暂停/gm) || []).length;
  log.info(`共有 ${pauseCount} 个暂停`);
  // 解析流程内容

  try {
    // 尝试解析为JSON格式
    const jsonData = JSON.parse(processContent);
    if (Array.isArray(jsonData)) {
      processSteps = jsonData;
      log.debug("JSON流程解析成功");
      return processSteps;
    } else {
      log.error("JSON流程格式错误，应为数组");
      return false;
    }
  } catch (jsonError) {
    // 若非JSON，尝试解析为扩展的简单格式脚本
    try {
      const simpleScript = parseExtendedSimpleScript(processContent);
      if (simpleScript && simpleScript.blocks && simpleScript.blocks.length > 0) {
        log.info("检测到简单格式脚本，共{count}个步骤块", simpleScript.blocks.length);
        return { __simpleScript: true, script: simpleScript };
      }
    } catch (e) {
      log.error("简单格式脚本解析出错: {error}", e.message);
    }
    // 回退到旧的按行简单格式
    const lines = processContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    processSteps = lines;
    return processSteps;
  }
}

// 解析扩展的简单格式脚本
function parseExtendedSimpleScript(content) {
  const lines = content.split("\n");
  const blocks = [];
  const meta = { author: "", description: "" };
  let currentBlock = null;

  const isComment = (line) => {
    const t = line.trim();
    return t === "" || t.startsWith("#") || t.startsWith("//");
  };

  const isHeaderLine = (line) => {
    const trimmed = line.trim();
    return /[:：]$/.test(trimmed) && !/^https?:\/\//i.test(trimmed);
  };

  const extractHeaderKeyValue = (line) => {
    const idx = Math.max(line.indexOf("："), line.indexOf(":"));
    if (idx === -1) return { key: "", value: "" };
    return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
  };

  for (let raw of lines) {
    // 去注释尾部
    let line = raw;
    const cmtIdx1 = line.indexOf("#");
    const cmtIdx2 = line.indexOf("//");
    let cut = line.length;
    if (cmtIdx1 !== -1) cut = Math.min(cut, cmtIdx1);
    if (cmtIdx2 !== -1) cut = Math.min(cut, cmtIdx2);
    line = line.slice(0, cut).trim();
    if (isComment(line)) continue;

    // 元数据：作者/描述
    const { key, value } = extractHeaderKeyValue(line);
    if (/^作者$/i.test(key)) {
      meta.author = value;
      continue;
    }
    if (/^描述$/i.test(key)) {
      meta.description = value;
      continue;
    }

    // 块头：任务描述行
    if (isHeaderLine(line)) {
      const header = line.slice(0, line.length - 1).trim();
      const descNorm = normalizeText(header);
      const isDefault = /^(默认|無任務描述字符串|无任务描述字符串|nomatch|default|超时)$/i.test(header);
      currentBlock = { description: header, descriptionNorm: descNorm, isDefault, instructions: [] };
      blocks.push(currentBlock);
      continue;
    }

    // 指令行
    if (!currentBlock) {
      // 若还未开始任何块，则自动创建一个"默认"块
      currentBlock = { description: "默认", descriptionNorm: normalizeText("默认"), isDefault: true, instructions: [] };
      blocks.push(currentBlock);
    }

    const parts = line.trim().split(/\s+/);
    const cmd = parts.shift();
    const arg = parts.join(" ").trim();

    const pushInstr = (type, data = null) => {
      currentBlock.instructions.push({ type, data });
    };

    switch (cmd) {
      case "地图追踪":
        pushInstr("地图追踪", arg);
        break;
      case "调时间":
        pushInstr("调时间", arg);
        break;
      case "提示":
        pushInstr("提示", arg);
        break;
      case "键鼠脚本":
        pushInstr("键鼠脚本", arg);
        break;
      case "对话":
        pushInstr("对话", arg);
        break;
      case "交互":
        pushInstr("交互", arg);
        break;
      case "等待返回主界面": {
        // 秒数只取正数，缺省或非法值统一回落到 600
        const waitSeconds = parseInt(arg, 10);
        pushInstr("等待返回主界面", waitSeconds > 0 ? waitSeconds : 600);
        break;
      }
      case "追踪图标":
        pushInstr("追踪图标", arg);
        break;
      case "追踪委托":
        pushInstr("追踪委托", arg);
        break;
      case "按键":
        pushInstr("按键", arg || "F");
        break;
      case "等待":
        pushInstr("等待", parseInt(arg || "5000", 10) || 5000);
        break;
      case "任务完成":
        pushInstr("任务完成", null);
        break;
      case "暂停":
        pushInstr("暂停", arg);
        break;
      case "战斗":
        pushInstr("战斗", null);
        break;
      case "自动拾取": {
        pushInstr("自动拾取", arg);
        break;
      }
      case "切换":
        pushInstr("切换", arg);
        break;
      case "点击":
        pushInstr("点击", arg);
        break;
      case "切换队伍":
        pushInstr("切换队伍", arg);
        break;
      case "图像匹配":
        pushInstr("图像匹配", arg);
        break;
      case "切换角色体型":
        pushInstr("切换角色体型", arg);
        break;
      case "点击文字":
        pushInstr("点击文字", arg);
        break;
      case "返回主界面":
        pushInstr("返回主界面", null);
        break;
      default: {
        // 兼容旧格式：F xxx => 对话 xxx
        if (/^F$/i.test(cmd) && arg) {
          pushInstr("对话", arg);
          break;
        }
        // 兼容旧格式：xxx.json => 地图追踪 xxx.json
        if (/\.json$/i.test(cmd)) {
          pushInstr("地图追踪", line);
          break;
        }
        // 兼容旧格式：F 纳西达（不规范多空格）
        if (/^F$/i.test(cmd)) {
          //log.info("对话");
          pushInstr("对话", "");
          break;
        }
        // 未识别，作为日志忽略
        log.warn("未识别的指令行: {line}", line);
        break;
      }
    }
  }

  return { meta, blocks };
}

// 执行扩展的简单格式脚本
async function executeSimpleScriptFlow(simpleScript, process_path, resumeRelativePath) {
  const META = simpleScript.meta || {};
  const BLOCKS = Array.isArray(simpleScript.blocks) ? simpleScript.blocks : [];
  const defaultBlock = BLOCKS.find(b => b.isDefault) || null;
  let originalTeam = null;  // 存储原始队伍，用于"切换 原来队伍"恢复

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
        if (data) {
          await clickTargetByText(data);
          await sleep(300);
        }
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
        if (typeof data === "string") {
          await processCommissionTracking({ data });
        } else if (data && typeof data === "object") {
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
        // 通用切换函数
        const switchToCharacters = async (targetChars) => {
          const currentTeam = Array.from(getAvatars() || []);
          const aliases = readAliases();
          for (let i = 0; i < targetChars.length; i++) {
            const char = targetChars[i];
            const name = aliases[char] || char;
            if (currentTeam.includes(name)) {
              log.info(`${name} 已在队伍中，跳过`);
              continue;
            }
            if (!await processSwitchRole({ data: { position: i + 1, character: char } })) {
              log.error(`切换失败：第${i + 1}号位 ${char}`);
              return false;
            }
          }
          return true;
        };

        const args = data.trim().split(/\s+/);
        if (args[0] === "原来队伍") {
          if (!originalTeam || originalTeam.length === 0) {
            log.warn("未记录原始队伍，无法恢复");
            break;
          }
          log.info("开始恢复原始队伍");
          if (!await switchToCharacters(originalTeam)) log.warn("恢复失败");
          originalTeam = null;
          log.info("已恢复原始队伍");
        } else {
          if (!originalTeam) {
            originalTeam = Array.from(getAvatars() || []);
            log.info(`记录原始队伍: ${originalTeam.join(", ")}`);
          }
          if (!await switchToCharacters(args.slice(0, 4))) log.warn("切换失败");
          log.info("角色切换完成");
        }
        keyPress("VK_ESCAPE");
        await sleep(500);
        keyPress("VK_ESCAPE");
        await sleep(500);
        break;
      }
      case "点击": {
        const parts = String(data).split(/[,，]/);
        const cx = parseInt(parts[0], 10);
        const cy = parseInt(parts[1], 10);
        if (!isNaN(cx) && !isNaN(cy)) {
          log.info("点击坐标: ({x}, {y})", cx, cy);
          click(cx, cy);
          await sleep(300);
        } else {
          log.warn("点击指令格式错误，应为：点击 x,y，实际：{data}", data);
        }
        break;
      }
      case "切换队伍": {
        const teamArgs = String(data).trim().split(/\s+/);
        const teamType = teamArgs[0] || "战斗";
        const needStatue = teamArgs[1] === "是";
        const partyName = teamType === "元素采集" ? elementTeam : team;
        if (!partyName) {
          log.warn("未配置{teamType}队伍名称", teamType);
          break;
        }
        if (needStatue) {
          log.info("前往神像切换队伍: {partyName}", partyName);
          await genshin.tpToStatueOfTheSeven();
        }
        await switchPartyIfNeeded(partyName);
        break;
      }
      case "图像匹配": {
        const imagePath = String(data);
        const dir = process_path.replace(/[^\\/]+$/, "");
        const fullPath = dir + imagePath;
        log.info("图像匹配: {path}", fullPath);
        try {
          const template = file.ReadImageMatSync(fullPath);
          const screen = captureGameRegion();
          try {
            const ro = RecognitionObject.templateMatch(template, 0, 0, 1920, 1080);
            ro.Threshold = 0.8;
            const found = screen.find(ro);
            if (!found.isEmpty()) {
              found.click();
              log.info("图像匹配成功，已点击");
              await sleep(300);
            } else {
              log.warn("图像匹配未找到: {path}", fullPath);
            }
          } finally {
            screen.dispose();
            template.dispose();
          }
        } catch (e) {
          log.error("图像匹配失败: {e}", e);
        }
        break;
      }
      case "切换角色体型": {
        const targetBodyType = String(data);
        log.info("切换角色体型: {bodyType}", targetBodyType);
        try {
          const currentTeam = Array.from(getAvatars() || []);
          if (currentTeam.length === 0) {
            log.warn("无法识别当前队伍");
            break;
          }
          let avatarData;
          try {
            avatarData = JSON.parse(file.readTextSync("Data/avatar/combat_avatar.json"));
          } catch {
            log.warn("未找到角色数据文件 Data/avatar/combat_avatar.json");
            break;
          }
          const getBodyType = (charName) => {
            for (const entry of avatarData) {
              if (entry.name === charName || (entry.alias && entry.alias.includes(charName))) {
                return entry.bodyType;
              }
            }
            return null;
          };
          let targetIndex = -1;
          for (let i = 0; i < currentTeam.length; i++) {
            const bt = getBodyType(currentTeam[i]);
            if (bt === targetBodyType) {
              targetIndex = i;
              break;
            }
          }
          if (targetIndex === -1) {
            log.warn("队伍中没有体型为{bodyType}的角色", targetBodyType);
            break;
          }/*
          if (targetIndex === 0) {
            log.info("当前出战角色已是{bodyType}体型: {name}", targetBodyType, currentTeam[0]);
            break;
          }*/ //这段不知道能不能跑起来
          const slotKey = ["1", "2", "3", "4"][targetIndex];
          log.info("切换到第{idx}号位: {name}", targetIndex + 1, currentTeam[targetIndex]);
          keyPress(slotKey);
          await sleep(200);
          keyPress(slotKey);
          await sleep(200);
          keyPress(slotKey);
          await sleep(5000);
        } catch (e) {
          log.error("切换角色体型失败: {e}", e);
        }
        break;
      }
      case "点击文字": {
        // 格式：点击文字 x,y,w,h,文字
        const ocrParts = String(data).split(/[,，]/);
        if (ocrParts.length < 5) {
          log.warn("点击文字指令格式错误，应为：点击文字 x,y,w,h,文字，实际：{data}", data);
          break;
        }
        const ox = parseInt(ocrParts[0], 10);
        const oy = parseInt(ocrParts[1], 10);
        const ow = parseInt(ocrParts[2], 10);
        const oh = parseInt(ocrParts[3], 10);
        const targetText = ocrParts.slice(4).join(",");
        if (isNaN(ox) || isNaN(oy) || isNaN(ow) || isNaN(oh)) {
          log.warn("点击文字坐标无效: {data}", data);
          break;
        }
        log.info("点击文字: 区域({x},{y},{w},{h}) 目标文字: {text}", ox, oy, ow, oh, targetText);
        try {
          const screen = captureGameRegion();
          try {
            const ro = RecognitionObject.ocr(ox, oy, ow, oh);
            const regions = screen.findMulti(ro);
            let bestMatch = null;
            let bestSim = 0;
            for (let i = 0; i < regions.Count; i++) {
              const txt = normalizeText(regions[i].Text);
              const sim = similarity(txt, normalizeText(targetText));
              if (sim > bestSim) {
                bestSim = sim;
                bestMatch = regions[i];
              }
            }
            if (bestMatch && bestSim >= 0.6) {
              bestMatch.click();
              log.info("点击文字成功，相似度: {sim}", bestSim.toFixed(2));
              await sleep(300);
            } else {
              log.warn("点击文字未找到匹配: 目标={text}，最高相似度={sim}", targetText, bestSim.toFixed(2));
            }
          } finally {
            screen.dispose();
          }
        } catch (e) {
          log.error("点击文字失败: {e}", e);
        }
        break;
      }
      case "返回主界面":
        log.info("执行返回主界面");
        await genshin.returnMainUi();
        await sleep(500);
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
