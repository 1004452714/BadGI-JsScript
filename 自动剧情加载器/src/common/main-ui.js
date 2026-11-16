// 定义识别对象

const paimonMenuRo = RecognitionObject.TemplateMatch(
  file.ReadImageMatSync("Data/RecognitionObject/paimon_menu.png"),
  0,
  0,
  genshin.width / 3.0,
  genshin.width / 5.0
);
//新增识别退出按钮
const exitBtnRo = RecognitionObject.TemplateMatch(
  file.ReadImageMatSync("Data/RecognitionObject/exitbtn.png"),
  0,
  0,
  genshin.width / 3.0,
  genshin.width / 5.0
);

// 判断是否在主界面的函数
export const isInMainUI = () => {
  let captureRegion = captureGameRegion();
  let res = captureRegion.Find(paimonMenuRo)
  let res2 = captureRegion.Find(exitBtnRo);
  return !res.isEmpty() || !res2.isEmpty();
};
