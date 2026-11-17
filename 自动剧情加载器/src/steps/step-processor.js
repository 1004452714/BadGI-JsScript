import { readAliases } from "../common/utils.js";
import { scrollPage } from "../common/ui.js";
import { setRealtimeTrigger, disableAllRealtimeTriggers, realtimeTriggerKeyOf } from "../common/realtime-triggers.js";

// 截图查找后立即释放截图；返回的 Region 不含 Mat，可继续使用其坐标与文本
const findInGameScreen = (ro) => {
  const captureRegion = captureGameRegion();
  try {
    return captureRegion.find(ro);
  } finally {
    captureRegion.dispose();
  }
};

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
      case "enable": {
        // 启用自动任务
        if (!taskType) {
          log.error("启用自动任务需要指定 taskType");
          return false;
        }

        // 只有 AutoSkip/AutoPick/AutoEat 在宿主白名单内，其它名字会抛 ArgumentException
        const triggerKey = realtimeTriggerKeyOf(taskType);
        if (!triggerKey) {
          log.error("不支持的自动任务类型: {type}，仅支持 AutoSkip/AutoPick/AutoEat", taskType);
          return false;
        }

        if (config && typeof config === "object") {
          log.warn("实时任务不支持附加配置，已忽略: {config}", JSON.stringify(config));
        }
        setRealtimeTrigger(triggerKey, true);
        break;
      }

      case "disable":
        // 取消所有自动任务
        log.info("取消所有自动任务");
        disableAllRealtimeTriggers();
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
