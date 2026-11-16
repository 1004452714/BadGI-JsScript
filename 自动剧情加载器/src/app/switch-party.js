//切换队伍
export async function switchPartyIfNeeded(partyName) {
  if (!partyName) {
      await genshin.returnMainUi();
      return;
  }
  try {
      log.info("正在尝试切换至" + partyName);
      if (!await genshin.switchParty(partyName)) {
          log.info("切换队伍失败，前往七天神像重试");
          await genshin.tpToStatueOfTheSeven();
          await genshin.switchParty(partyName);
      }
  } catch {
      log.error("队伍切换失败，可能处于联机模式或其他不可切换状态");
      notification.error(`切换失败，可能处于联机模式或其他不可切换状态`);
      await genshin.returnMainUi();
  }
}
