import { readAliases } from "../common/utils.js";
import { scrollPage } from "../common/ui.js";
import { isInMainUI } from "../common/main-ui.js";
import { autoNavigateToTalk } from "./navigator.js";

// 截图查找后立即释放截图；返回的 Region 不含 Mat，可继续使用其坐标与文本
const findInGameScreen = (ro) => {
  const captureRegion = captureGameRegion();
  try {
    return captureRegion.find(ro);
  } finally {
    captureRegion.dispose();
  }
};

// 步骤处理器类 - 处理不同类型的委托执行步骤
// TAG:添加脚本功能点1
// 处理地图追踪步骤
export async function processMapTracking(step, processFilePath) {
  //log.info("1");
  const normalizedPath = processFilePath.replace(/\\/g, '/');
  const processDir = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
  const fullPath = `${processDir}/${step.data}`;
  log.info("执行地图追踪: {path}", fullPath);
  try {
    await pathingScript.runFile(fullPath);
    log.info("地图追踪执行完成");
  } catch (error) {
    log.error("执行地图追踪时出错: {error}", error.message);
    throw error;
  }
}

// 处理追踪委托步骤
export async function processCommissionTracking(step) {
  try {
    // 获取目标NPC名称和图标类型
    let targetNpc = "";
    let iconType = "bigmap";

    if (typeof step.data === "string") {
      targetNpc = step.data;
    } else if (typeof step.data === "object") {
      if (step.data.npc) targetNpc = step.data.npc;
      if (step.data.iconType) iconType = step.data.iconType;
    }

    log.info(
      "执行追踪委托，目标NPC: {target}，图标类型: {type}",
      targetNpc,
      iconType
    );
    await autoNavigateToTalk(targetNpc, iconType);
    log.info("追踪委托执行完成");
  } catch (error) {
    log.error("执行追踪委托时出错: {error}", error.message);
    throw error;
  }
}

// 处理键鼠脚本步骤
export async function processKeyMouseScript(step, processFilePath) {
  const normalizedPath = processFilePath.replace(/\\/g, '/');
  const processDir = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
  const fullPath = `${processDir}/${step.data}`;
  log.info("执行键鼠脚本: {path}", fullPath);
  try {
    await keyMouseScript.runFile(fullPath);
    log.info("键鼠脚本执行完成");
  } catch (error) {
    log.error("执行键鼠脚本时出错: {error}", error.message);
    throw error;
  }
}

// 处理按键步骤
// 处理按键步骤（新增长按/多键同步功能）
// 执行按键操作
export async function processKeyPress(step) {
  // 解析按键数据
  const parseKeyData = (data) => {
    log.info("data: {data}", data);
    let action = "press"; // 默认点按
    let keys = [];
    let duration = 5000; // 长按默认时长（毫秒）
    data = String(data);//转为字符串
    if (typeof data === "string") {
      // 简化格式："F" → 点按F；"长按 W" → 长按W5秒；"长按 Shift,W 4000" → 同步长按Shift+W 4秒
      const parts = data.split(' ');
      if (parts[0] === "长按") {
        action = "longpress";
        // 提取按键（支持多键用逗号分隔）
        const keyPart = parts[1];
        keys = keyPart.split(",").map(k => k.trim());
        // 提取自定义时长（可选）
        if (parts[2] && !isNaN(parseInt(parts[2]))) {
          duration = parseInt(parts[2]);
        }
      } else if (parts[0] === "松开") {
        action = "release";
        keys = parts[1].split(",").map(k => k.trim());
      } else if (parts[0] === "点按") {
        // 完整格式："点按 F"
        action = "press";
        keys = [parts[1]];
      }
      else if (parts[0] === "按下") {
        action = "down";
        // 提取按键（支持多键用逗号分隔）
        const keyPart = parts[1];
        keys = keyPart.split(",").map(k => k.trim());
      } else {
        // 简化点按："F"
        keys = [data];
      }
    } else if (typeof data === "object") {
      // 对象格式兼容（保留原有逻辑）
      action = data.action || "press";
      if (action === "longpress") {
        keys = Array.isArray(data.key) ? data.key : [data.key];
        duration = data.duration || 5000;
      } else {
        keys = Array.isArray(data.key) ? data.key : [data.key];
      }
    }
    return { action, keys, duration };
  };

  const { action, keys, duration } = parseKeyData(step.data);

  // 执行按键操作
  switch (action) {
    case "press":
      // 单键/多键点按（依次点击）
      for (const key of keys) {
        log.info(`点击按键: ${key}`);
        keyPress(key);
        await sleep(100); // 多键点按间隔
      }
      break;
    case "down":
      // 单键/多键按下（不松开）
      for (const key of keys) {
        log.info(`按下按键: ${key}`);
        keyDown(key);
      }
      break;
    case "up":
      // 单键/多键松开
      for (const key of keys) {
        log.info(`释放按键: ${key}`);
        keyUp(key);
      }
      break;
    case "longpress":
      // 单键/多键同步长按
      log.info(`同步长按按键: ${keys.join(", ")}，时长: ${duration}毫秒`);
      // 按下所有键
      for (const key of keys) {
        keyDown(key);
      }
      // 保持长按
      await sleep(duration);
      // 松开所有键
      for (const key of keys) {
        keyUp(key);
      }
      log.info(`长按结束，已释放按键: ${keys.join(", ")}`);
      break;
    case "release":
      // 手动松开多键
      log.info(`同步释放按键: ${keys.join(", ")}`);
      for (const key of keys) {
        keyUp(key);
      }
      break;
  }
}

// 处理等待主界面步骤
export async function processWaitMainUI(time = 600) {
  for (let i = 0; i < time; i++) {
    if (isInMainUI()) {
      log.info("检测到已返回主界面，结束等待");
      break;
    }
    await sleep(1000);
  }
  if (!isInMainUI()) {
    log.info("等待返回主界面超时，尝试继续执行后续步骤");
  }
}

// 处理角色切换步骤
export async function processSwitchRole(step) {
  try {
    const { position, character } = step.data;

    if (!position || !character) {
      log.error("角色切换参数不完整，需要 position 和 character");
      return false;
    }

    log.info(`开始切换角色：第${position}号位 -> ${character}`);

    const positionCoordinates = [
      [460, 538],
      [792, 538],
      [1130, 538],
      [1462, 538],
    ];

    // 读取别名
    const aliases = readAliases();
    const actualName = aliases[character] || character;
    log.info(`设置对应号位为【${character}】，切换角色为【${actualName}】`);

    // 识别对象定义
    const roTeamConfig = RecognitionObject.TemplateMatch(
      file.ReadImageMatSync(`Data/RecognitionObject/队伍配置.png`),
      0,
      0,
      1920,
      1080
    );
    const roReplace = RecognitionObject.TemplateMatch(
      file.ReadImageMatSync(`Data/RecognitionObject/更换.png`),
      0,
      0,
      1920,
      1080
    );
    const roJoin = RecognitionObject.TemplateMatch(
      file.ReadImageMatSync(`Data/RecognitionObject/加入.png`),
      0,
      0,
      1920,
      1080
    );

    let openPairingTries = 0;
    let totalOpenPairingTries = 0;

    // 打开配对界面的内部函数
    const openPairingInterface = async () => {
      while (openPairingTries < 3) {
        keyPress("l");
        await sleep(3500);
        const teamConfigResult = findInGameScreen(roTeamConfig);
        if (teamConfigResult.isExist()) {
          openPairingTries = 0;
          return true;
        }
        openPairingTries++;
        totalOpenPairingTries++;
      }
      if (totalOpenPairingTries < 6) {
        await genshin.tp("2297.630859375", "-824.5517578125");
        openPairingTries = 0;
        return openPairingInterface();
      } else {
        log.error("无法打开配对界面，任务结束");
        return false;
      }
    };

    if (!(await openPairingInterface())) {
      return false;
    }

    const rolenum = position;
    const selectedCharacter = actualName;
    const [x, y] = positionCoordinates[position - 1];
    click(x, y);
    log.info(`开始设置${rolenum}号位角色`);
    await sleep(1000);
    let characterFound = false;
    let pageTries = 0;

    // 角色图像以角色名开头（如 可莉.png、可莉01.png、琴02.png），先按前缀筛选出候选文件，
    // 避免用无上界数字循环探测不存在的文件；ReadImageMatSync 读失败只返回空 Mat 不抛异常
    const imageDir = "Data/characterimage/";
    const characterImagePaths = Array.from(file.ReadPathSync(imageDir))
      .filter((imagePath) => {
        const fileName = imagePath.split(/[\\/]/).pop();
        return fileName.startsWith(selectedCharacter);
      });

    if (characterImagePaths.length === 0) {
      log.error(`未找到【${selectedCharacter}】的角色图像，无法切换`);
      return false;
    }
    log.info(`角色【${selectedCharacter}】共 ${characterImagePaths.length} 张候选图像`);

    // 最多尝试滚动页面20次
    while (pageTries < 20) {
      // 依次比对候选图像，命中即点击并结束
      for (const imagePath of characterImagePaths) {
        const characterRo = RecognitionObject.TemplateMatch(
          file.ReadImageMatSync(imagePath),
          0,
          0,
          1920,
          1080
        );
        let characterResult;
        try {
          characterResult = findInGameScreen(characterRo);
        } finally {
          // 每次匹配都会读入一张模板图，用完立即释放，避免逐轮累积
          characterRo.TemplateImageMat?.dispose();
          characterRo.TemplateImageGreyMat?.dispose();
        }
        if (!characterResult.isExist()) {
          continue;
        }
        log.info(`已找到角色${selectedCharacter}`);
        // 计算向右偏移35像素、向下偏移35像素的位置
        const targetX = characterResult.x + 35;
        const targetY = characterResult.y + 35;

        // 边界检查，确保坐标在屏幕范围内
        const safeX = Math.min(Math.max(targetX, 0), 1920);
        const safeY = Math.min(Math.max(targetY, 0), 1080);

        click(safeX, safeY);
        await sleep(500); // 点击角色后等待0.5秒
        characterFound = true;
        break;
      }

      if (characterFound) {
        break;
      }

      // 如果不是最后一次尝试，尝试滚动页面
      if (pageTries < 15) {
        log.info("当前页面没有目标角色，滚动页面");
        await scrollPage(200); // 使用UI模块的scrollPage函数
      }
      pageTries++;
    }

    if (!characterFound) {
      log.error(`未找到【${selectedCharacter}】`);
      return false;
    }

    // 识别"更换"或"加入"按钮
    const replaceResult = findInGameScreen(roReplace);
    const joinResult = findInGameScreen(roJoin);

    if (replaceResult.isExist() || joinResult.isExist()) {
      await sleep(300);
      click(68, 1020);
      keyPress("VK_LBUTTON");
      await sleep(500);
      log.info(`角色切换完成：${character} -> ${actualName}`);
      return true;
    } else {
      log.error(`该角色已在队伍中，无需切换`);
      await sleep(300);
      keyPress("VK_ESCAPE");
      await sleep(500);
      return false;
    }
  } catch (error) {
    log.error("角色切换过程中出错: {error}", error.message);
    return false;
  }
}

// 处理自动任务步骤
export async function processAutoTask(step) {
  try {
    const { action, taskType, config } = step.data;

    if (!action) {
      log.error("自动任务参数不完整，需要 action 参数");
      return false;
    }

    log.info("执行自动任务操作: {action}", action);

    switch (action) {
      case "enable":
        // 启用自动任务
        if (!taskType) {
          log.error("启用自动任务需要指定 taskType");
          return false;
        }

        if (config && typeof config === "object") {
          log.info("启用自动任务: {type}，配置: {config}", taskType, JSON.stringify(config));
          dispatcher.addTimer(new RealtimeTimer(taskType, config));
        } else {
          log.info("启用自动任务: {type}", taskType);
          dispatcher.addTimer(new RealtimeTimer(taskType));
        }
        break;

      case "disable":
        // 取消所有自动任务
        log.info("取消所有自动任务");
        dispatcher.ClearAllTriggers();
        break;

      default:
        log.error("未知的自动任务操作: {action}", action);
        return false;
    }

    return true;
  } catch (error) {
    log.error("处理自动任务步骤时出错: {error}", error.message);
    return false;
  }
}
