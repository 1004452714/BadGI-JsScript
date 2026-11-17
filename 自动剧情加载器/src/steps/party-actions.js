// 队伍与角色指令：按号位切换角色。
// 依赖：file / log / genshin / RecognitionObject / captureGameRegion / click / keyPress / sleep。

import { readAliases } from "../common/utils.js";
import { scrollPage } from "../common/ui.js";

// 1~4 号位在队伍配置界面中的头像坐标（1920×1080 基准）
const POSITION_COORDINATES = [
  [460, 538],
  [792, 538],
  [1130, 538],
  [1462, 538],
];
// 角色选择列表最多滚动轮数，以及仍允许滚动的前置轮数
const MAX_PAGE_TRIES = 20;
const SCROLLABLE_PAGE_TRIES = 15;
// 打开配对界面连续失败时，先传送到固定锚点再重试的最大累计次数
const MAX_PAIRING_ATTEMPTS = 6;
const PAIRING_ANCHOR_X = "2297.630859375";
const PAIRING_ANCHOR_Y = "-824.5517578125";

/**
 * 截图并查找目标，查找结束后立即释放截图。
 * 返回的 Region 不含 Mat，可继续使用其坐标与文本。
 * @param {Object} ro 识别对象
 * @returns {Object} 查找结果 Region
 */
function findInGameScreen(ro) {
  const captureRegion = captureGameRegion();
  try {
    return captureRegion.find(ro);
  } finally {
    captureRegion.dispose();
  }
}

/**
 * 按号位切换角色：打开配对界面、选中号位、在角色列表中匹配头像并确认更换。
 * @param {{data: {position: number, character: string}}} step 步骤对象；
 *        position 仅接受 1–4，character 可为别名
 * @returns {Promise<boolean>} 切换成功返回 true；参数不全、找不到角色图像或角色已在队伍中返回 false
 */
export async function processSwitchRole(step) {
  try {
    const { position, character } = step.data;

    if (!position || !character) {
      log.error("角色切换参数不完整，需要 position 和 character");
      return false;
    }

    log.info(`开始切换角色：第${position}号位 -> ${character}`);

    // 别名先还原为正式角色名，后续按正式名匹配头像文件
    const aliases = readAliases();
    const actualName = aliases[character] || character;
    log.info(`设置对应号位为【${character}】，切换角色为【${actualName}】`);

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

    // 连续三次识别不到队伍配置界面即视为打开失败，累计超过上限后传送到锚点重试
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
      if (totalOpenPairingTries < MAX_PAIRING_ATTEMPTS) {
        await genshin.tp(PAIRING_ANCHOR_X, PAIRING_ANCHOR_Y);
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
    const [x, y] = POSITION_COORDINATES[position - 1];
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

    while (pageTries < MAX_PAGE_TRIES) {
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
        // 头像命中后点击其右下偏移位置，避免点到头像中心的选中态
        const targetX = characterResult.x + 35;
        const targetY = characterResult.y + 35;

        // 边界检查，确保坐标在屏幕范围内
        const safeX = Math.min(Math.max(targetX, 0), 1920);
        const safeY = Math.min(Math.max(targetY, 0), 1080);

        click(safeX, safeY);
        await sleep(500);
        characterFound = true;
        break;
      }

      if (characterFound) {
        break;
      }

      // 列表可能未加载完目标角色，滚动后继续查找
      if (pageTries < SCROLLABLE_PAGE_TRIES) {
        log.info("当前页面没有目标角色，滚动页面");
        await scrollPage(200);
      }
      pageTries++;
    }

    if (!characterFound) {
      log.error(`未找到【${selectedCharacter}】`);
      return false;
    }

    // 识别"更换"或"加入"按钮：命中说明可切换，否则角色已在队伍中
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
