import { Utils } from "../common/utils.js";
import { UIUtils } from "../common/ui-utils.js";
import { StepProcessor } from "./step-processor.js";

  // 对话处理模块 - 处理自动对话相关功能
  export const DialogProcessor = {
    // 执行优化的自动对话
    executeOptimizedAutoTalk: async (
      extractedName = null,
      skipCount = 5,
      customPriorityOptions = null,
      customNpcWhiteList = null,
      isInMainUI
    ) => {
      // 使用传入的参数，不再加载默认配置
      const effectivePriorityOptions = customPriorityOptions || [];
      const effectiveNpcWhiteList = customNpcWhiteList || [];

      // 初始化
      keyPress("V");

      // 初始触发剧情 - 识别人名并点击
      extractedName = [];
      // 人名区域OCR识别
      const nameRegion = { X: 75, Y: 240, WIDTH: 225, HEIGHT: 60 };
      let nameResults = await Utils.easyOCR(nameRegion);
      // 尝试提取任务人名
      for (let i = 0; i < nameResults.count; i++) {
        let text = nameResults[i].text;
        log.info(`任务区域识别文本: ${text}`);

        // 尝试提取任务人名
        let name = UIUtils.extractName(text);
        if (name) {
          extractedName = name;
          log.info(`提取到人名: ${extractedName}`);
          break;
        }
      }

      // 对话选项区域OCR识别
      const dialogRegion = { X: 1150, Y: 300, WIDTH: 350, HEIGHT: 400 };
      nameResults = await Utils.easyOCR(dialogRegion);
      let clickedWhitelistNPC = false;
      let clickedExtractedName = false;

      // 处理人名区域的OCR结果
      if (nameResults.count > 0) {
        log.info(`人名区域识别到 ${nameResults.count} 个文本`);

        // 首先尝试点击白名单中的NPC
        for (let i = 0; i < nameResults.count; i++) {
          let text = nameResults[i].text;
          let res = nameResults[i];
          log.info(
            "人名区域识别到{text}:位置({x},{y},{h},{w})",
            res.text,
            res.x,
            res.y,
            res.width,
            res.Height
          );
          // 检查是否包含白名单中的NPC名称
          for (let j = 0; j < effectiveNpcWhiteList.length; j++) {
            if (text.includes(effectiveNpcWhiteList[j])) {
              log.info(`找到白名单NPC: ${effectiveNpcWhiteList[j]}，点击该NPC`);
              keyDown("VK_MENU");
              await sleep(500);
              res.x = res.x + Math.round(res.width / 2);
              res.y = res.y + Math.round(res.height / 2);
              log.info(`点击位置: ${res.x}, ${res.y}`);
              click(res.x, res.y);
              leftButtonClick();
              keyUp("VK_MENU");
              clickedWhitelistNPC = true;
              break;
            }
          }
          if (clickedWhitelistNPC) break;
        }

        // 如果没有点击白名单NPC，尝试点击包含提取到的人名的选项
        if (!clickedWhitelistNPC && extractedName) {
          for (let i = 0; i < nameResults.count; i++) {
            let text = nameResults[i].text;
            let res = nameResults[i];
            if (text.includes(extractedName)) {
              log.info(`点击包含提取到任务人名的选项: ${text}`);
              keyDown("VK_MENU");
              await sleep(500);
              res.x = res.x + Math.round(res.width / 2);
              res.y = res.y + Math.round(res.height / 2);
              log.info(`点击位置: ${res.x}, ${res.y}`);
              click(res.x, res.y);
              leftButtonClick();
              keyUp("VK_MENU");
              clickedExtractedName = true;
              break;
            }
          }
        }
      }

      // 如果没有找到NPC，使用默认触发
      if (!clickedWhitelistNPC && !clickedExtractedName) {
        log.info("未找到匹配的NPC，使用默认触发方式");
        keyPress("F"); // 默认触发剧情
        await sleep(500);
      }

      // 重复执行自动剧情，直到返回主界面
      let maxAttempts = 100; // 设置最大尝试次数，防止无限循环
      let attempts = 0;
      await sleep(1000);
      log.info("开始执行自动剧情");

      while (!isInMainUI() && attempts < maxAttempts) {
        attempts++;

        // 正常跳过对话
        await genshin.chooseTalkOption("纳西妲美貌举世无双", skipCount, false);

        if (isInMainUI()) {
          log.info("检测到已返回主界面，结束循环");
          break;
        }

        // 每skipCount次跳过后，进行OCR识别
        if (true) {
          // 检查是否有匹配的优先选项
          let foundPriorityOption = false;

          // 获取对话区域截图并进行OCR识别
          const dialogOptionsRegion = {
            X: 1250,
            Y: 450,
            WIDTH: 550,
            HEIGHT: 400,
          };
          let ocrResults = await Utils.easyOCR(dialogOptionsRegion);
          if (ocrResults.count > 0) {
            log.info(`识别到 ${ocrResults.count} 个选项`);

            for (let i = 0; i < ocrResults.count; i++) {
              let ocrText = ocrResults[i].text;

              // 检查是否在优先选项列表中
              for (let j = 0; j < effectivePriorityOptions.length; j++) {
                if (ocrText.includes(effectivePriorityOptions[j])) {
                  log.info(
                    `找到优先选项: ${effectivePriorityOptions[j]}，点击该选项`
                  );
                  // 点击该选项
                  ocrResults[i].click();
                  await sleep(500);
                  foundPriorityOption = true;
                  break;
                }
              }

              if (foundPriorityOption) break;
            }

            // 如果没有找到优先选项，则使用默认跳过
            if (!foundPriorityOption) {
              await genshin.chooseTalkOption("", 1, false);
            }
          }
        }

        // 检查是否已返回主界面
        if (isInMainUI()) {
          log.info("检测到已返回主界面，结束循环");
          break;
        }
      }

      if (isInMainUI()) {
        log.info("已返回主界面，自动剧情执行完成");
        keyPress("V");
      } else {
        log.warn(`已达到最大尝试次数 ${maxAttempts}，但未检测到返回主界面`);
      }
    },

    /**
     * 执行自动对话处理
     * @param {string|string[]} data - NPC名称
     * @returns {Promise<void>}
     */
    executeAutoTalk: async (data) => {
      // 使用传入的参数，不再加载默认配置
      // 确保 effectiveNpcWhiteList 始终是一个数组，并过滤掉空字符串
      let effectiveNpcWhiteList = [];
      if (Array.isArray(data)) {
        effectiveNpcWhiteList = data.filter(name => name && name.trim() !== "");
      } else if (data && data.trim() !== "") {
        effectiveNpcWhiteList = [data];
      }

      log.info(`白名单NPC: ${JSON.stringify(effectiveNpcWhiteList)}`);
      await genshin.returnMainUi();
      // 初始化
      keyPress("V");
      await sleep(1000);

      let extractedName = null;
      let retryCount = 0;
      const maxRetries = 3;

      // 处理任务提示重试逻辑
      while (retryCount < maxRetries) {
        // 人名区域OCR识别
        const nameRegion = { X: 75, Y: 240, WIDTH: 225, HEIGHT: 60 };
        let nameResults = await Utils.easyOCR(nameRegion);

        // 检查是否有"任务提示"
        let hasTaskHint = false;
        for (let i = 0; i < nameResults.count; i++) {
          let text = nameResults[i].text;
          log.info(`任务区域识别文本: ${text}`);

          if (text.includes("任务提示")) {
            log.info("检测到任务提示，等待4秒后重试");
            hasTaskHint = true;
            break;
          }

          // 尝试提取任务人名（排除空字符串）
          let name = UIUtils.extractName(text);
          if (name && name.trim() !== "") {
            extractedName = name;
            log.info(`提取到人名: ${extractedName}`);
            break;
          }
        }

        // 如果有任务提示，等待后重试
        if (hasTaskHint) {
          retryCount++;
          if (retryCount >= maxRetries) {
            log.warn("已达到最大重试次数，跳过任务提示");
            break;
          }
          await sleep(4000);
          continue;
        }

        // 如果没有任务提示，跳出循环
        break;
      }

      // 对话选项区域OCR识别
      const dialogRegion = { X: 1150, Y: 300, WIDTH: 350, HEIGHT: 400 };
      let dialogResults = await Utils.easyOCR(dialogRegion);
      let clickedWhitelistNPC = false;
      let clickedExtractedName = false;

      // 如果对话区域没有人名，尝试按键操作
      if (dialogResults.count === 0) {
        log.info("对话区域未识别到文本，尝试按键操作");

        // 尝试按下W键并重新OCR
        keyPress("W");
        await sleep(500);
        dialogResults = await Utils.easyOCR(dialogRegion);

        // 如果仍然没有人名，尝试按下A键
        if (dialogResults.count === 0) {
          keyPress("A");
          await sleep(500);
          dialogResults = await Utils.easyOCR(dialogRegion);
        }

        // 如果仍然没有人名，尝试按下S键
        if (dialogResults.count === 0) {
          keyPress("S");
          await sleep(500);
          dialogResults = await Utils.easyOCR(dialogRegion);
        }

        // 如果仍然没有人名，尝试按下D键
        if (dialogResults.count === 0) {
          keyPress("D");
          await sleep(500);
          dialogResults = await Utils.easyOCR(dialogRegion);
        }
      }

      // 处理人名区域的OCR结果
      if (dialogResults.count > 0) {
        log.info(`对话区域识别到 ${dialogResults.count} 个文本`);

        // 首先尝试点击白名单中的NPC
        for (let i = 0; i < dialogResults.count; i++) {
          let text = dialogResults[i].text;
          let res = dialogResults[i];
          log.info(
            "对话区域识别到{text}:位置({x},{y},{h},{w})",
            res.text,
            res.x,
            res.y,
            res.width,
            res.height
          );

          // 检查是否包含白名单中的NPC名称
          for (let j = 0; j < effectiveNpcWhiteList.length; j++) {
            if (text.includes(effectiveNpcWhiteList[j])) {
              log.info(`找到白名单NPC: ${effectiveNpcWhiteList[j]}，点击该NPC`);
              keyDown("VK_MENU");
              await sleep(500);
              res.x = res.x + Math.round(res.width / 2);
              res.y = res.y + Math.round(res.height / 2);
              log.info(`点击位置: ${res.x}, ${res.y}`);
              click(res.x, res.y);
              leftButtonClick();
              keyUp("VK_MENU");
              clickedWhitelistNPC = true;
              break;
            }
          }
          if (clickedWhitelistNPC) break;
        }

        // 如果没有点击白名单NPC，尝试点击包含提取到的人名的选项
        if (!clickedWhitelistNPC && extractedName) {
          for (let i = 0; i < dialogResults.count; i++) {
            let text = dialogResults[i].text;
            let res = dialogResults[i];
            if (text.includes(extractedName)) {
              log.info(`点击包含提取到任务人名的选项: ${text}`);
              keyDown("VK_MENU");
              await sleep(500);
              res.x = res.x + Math.round(res.width / 2);
              res.y = res.y + Math.round(res.height / 2);
              log.info(`点击位置: ${res.x}, ${res.y}`);
              click(res.x, res.y);
              leftButtonClick();
              keyUp("VK_MENU");
              clickedExtractedName = true;
              break;
            }
          }
        }
      }

      // 如果没有找到NPC，使用默认触发
      if (!clickedWhitelistNPC && !clickedExtractedName) {
        log.info("未找到匹配的NPC，使用默认触发方式");
        keyPress("F"); // 默认触发剧情
        await sleep(500);
      }

      await sleep(1000);
      log.info("开始自动剧情");

      await StepProcessor.processWaitMainUI(600);
    }
  };
