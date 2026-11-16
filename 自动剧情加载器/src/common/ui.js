  export const UI = {
    // 角色选择界面滚动页面函数
    scrollPage: async (totalDistance, stepDistance = 10, delayMs = 5) => {
      try {
        moveMouseTo(400, 750);
        await sleep(50);
        leftButtonDown();
        const steps = Math.ceil(totalDistance / stepDistance);
        for (let j = 0; j < steps; j++) {
          const remainingDistance = totalDistance - j * stepDistance;
          const moveDistance =
            remainingDistance < stepDistance ? remainingDistance : stepDistance;
          moveMouseBy(0, -moveDistance);
          await sleep(delayMs);
        }
        await sleep(700);
        leftButtonUp();
        await sleep(100);
        return true;
      } catch (error) {
        log.error(`角色选择界面滚动操作时发生错误：${error.message}`);
        return false;
      }
    },
  };
