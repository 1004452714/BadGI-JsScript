# 自动剧情加载器 代码审查问题清单

- 审查对象：`dev` 分支 `自动剧情加载器/`（含 `main.js`、`picker.js`、`src/**/*.js`、`manifest.json`）
- 审查方式：静态阅读 + `node --input-type=module --check` + 与上游 `better-genshin-impact` 源码核对
- 文档性质：本次审查发现的问题与修复方案快照，作为后续逐项修复的依据
- 说明：本文件创建后不再随修复提交改动，保持初始快照

## 一、结论摘要

当前 `dev` 分支只完成了“原样抽出”式初步模块化：入口 `main.js` 已收口为 3 行，叶子模块拆到 `src/`，但执行引擎（解析、执行、断点、切队编排）仍整体留在 `src/app/main.js`（约 943 行），无 `src/host` 宿主边界、无统一指令注册表，三套“指令→执行”分发并存。抽取过程忠实（与原 1.46 单文件逐段一致），未引入行为回归，但也原样保留了 1.46 的既有缺陷。

本清单只列本次要修复的问题；未列入的问题暂不修复，见第四节。

## 二、待修复问题

| 编号 | 位置 | 现状问题 | 修复方案 |
|---|---|---|---|
| 1 | `src/steps/navigator.js:134` | `autoNavigateToIcon` 内 `captureRegion = captureGameRegion()` 未声明；ES module 严格模式下赋未声明变量抛 ReferenceError，`追踪图标` 必失败 | 改为 `let captureRegion = captureGameRegion()`（释放交由第 8 项） |
| 4 | `src/flow/step-processor-factory.js:50`、`src/steps/step-processor.js:174` | `processWaitMainUI()` 无参调用，`for (i < undefined)` 不循环，JSON 流程“等待返回主界面”实际不等待 | 签名改为 `processWaitMainUI(time = 600)`，factory 传 `step.data` |
| 5 | `src/steps/dialog-processor.js:8`、`src/steps/dialog-step.js:18`、`src/app/main.js:880` | `executeOptimizedAutoTalk` 的 `extractedName` 入参实际不需要；函数内 `extractedName = []` 覆盖，导致 `text.includes([])` 恒真、误点第一个选项 | 删除 `extractedName` 形参，函数内改为局部 `let extractedName = null`，两处调用同步去掉 `null` 实参 |
| 7 | `src/flow/step-processor-factory.js`、`src/app/main.js` | JSON 流程 `地图追踪`/`键鼠脚本` 把 `context`（对象）当 `processFilePath` 传入，`context.replace` 抛错；`tp` 引用不存在的 `processTeleport`，`长按` 引用 `data.step`/`keyup`/`longpressthebutton` 均不存在 | `executeUnifiedTalkProcess` 把流程路径写入 `context.processPath`，factory 改传 `context.processPath`；删除 `tp`、`长按` 两个必错处理器 |
| 8 | `src/common/utils.js`、`src/common/main-ui.js`、`src/steps/navigator.js`、`src/steps/step-processor.js` | `captureGameRegion()` 结果多处不 `dispose`；`easyOCR` 在对话/13 秒循环中高频调用，持续泄漏 | `easyOCR` 用 try/finally 释放截图；`isInMainUI` 释放；navigator 每轮截图与 `DeriveCrop` 按“先子后父”释放；`processSwitchRole` 的截图统一局部变量并 finally 释放 |
| 9 | `src/app/main.js:937`、`src/app/switch-party.js:16` | 脚本完成用 `notification.error`（错误级别）；切队错误通知未受 `settings.xiaoxitongzhi` 开关控制 | 完成改 `notification.Send`；切队错误通知加开关判断 |
| 12 | `manifest.json:15-17` | 断点写入 `resuming/<相对路径>.json`（嵌套），而 `saved_files: ["resuming/*.json"]` 只匹配一层，升级脚本时断点不备份 | `saved_files` 改为 `["resuming/"]`，按目录递归备份 |
| 13 | `src/app/main.js:36-46` | `file.readText` 读取失败返回空串、不抛异常，“未找到流程文件”catch 为死代码；空文件会静默走空流程 | 读取后判空，空内容按出错记录并 `return false` |
| 15 | `src/app/main.js:338` | `调时间` 写死小写 `data/time.json`，实际文件是 `Data/time.json`（仅 Windows 大小写不敏感可用） | 改为 `Data/time.json` |
| 16 | `src/steps/dialog-processor.js:56,299` | 日志占位符 `位置({x},{y},{h},{w})` 与实际传参 `width,height` 顺序不符 | 统一为 `{w},{h}` 并正确传 `width,height` |
| 18 | `src/app/main.js:17` | `relativePath` 是模块级可变外部状态，`Main` 赋值、执行器读取，属隐式耦合 | 删除模块级变量，改为 `Main` 计算 `resumeRelativePath` 并显式传给 `executeTalkCommission`/`executeSimpleScriptFlow` |
| 19 | `src/common/main-ui.js` 与 `src/common/ui-utils.js`、`src/app/main.js`、`src/steps/dialog-processor.js`、`src/steps/navigator.js` | 重复实现：两套主界面检测；`groupMap`/`resumingMap` 重复构建；两套对话中相同的“白名单/人名点击选项”代码；两段相同的“前进一小步”代码 | 删除 `createMainUIChecker`，统一 `main-ui.js` 的 `isInMainUI`；抽 `buildBlockIndex()`；抽公共点击选项函数；抽 `advanceStep()`（其余差异保留） |
| 20 | `src/app/main.js:343,622` | 未使用的 `keyData`；注释掉的 `processAutoTask` 调用 | 删除 |
| 21 | `Data/暂停.json`、`Data/RecognitionObject/SwitchRoles/` | 全仓库（`自动剧情加载器` 内）无引用 | 删除 |
| 22 | `src/app/main.js:11-23` | `VERSION`/`BUILD_TIME` 与 `manifest.version` 双写 | 版本号统一从 `manifest.json` 读取，删除 `BUILD_TIME` 与编译时间日志 |
| 23 | `src/app/main.js`、`step-processor-factory.js`、`step-processor.js`、`dialog-step.js`、`navigator.js` 及各模块顶层 | Tab 与 2 空格混用、行尾空白、模块顶层残留 IIFE 缩进 | Tab→2 空格、去行尾空白、模块顶层去掉多余缩进（仅空白改动） |
| 24 | `picker.js` 位置、`src/app/main.js:1` | `picker.js` 仍在脚本根目录，导入为裸说明符 `"picker.js"`，与其它相对导入不一致 | `picker.js` 迁入 `src/picker/picker.js`，导入改为 `../picker/picker.js` |

## 三、关键上游核实（与第 7/8/9/12 项相关）

- `Notification` 提供 `Send`（成功通知）与 `Error`（错误通知）（`Notification.cs:68,93`）。
- `AutoPathingScript.RunFile(string)`、`KeyMouseScript.RunFile(string)` 均存在（`AutoPathingScript.cs:44`、`KeyMouseScript.cs:13`）；`StepProcessor` 确无 `processTeleport`/`longpressthebutton`，故第 7 项只是传参错误与无效处理器。
- `Region.Derive` 返回无 Mat 的 `Region`（`Region.cs:348-351`，`Dispose` 为空实现），`ImageRegion.DeriveCrop` 返回共享父 Mat 的视图（`ImageRegion.cs:71-79`），`ImageRegion.Dispose` 会释放 `SrcMat`（`ImageRegion.cs:581-593`）：释放顺序须先子区域、后父截图；`easyOCR`/`Find` 返回的 `Region` 不含 Mat，可安全在 `finally` 释放截图。
- `ScriptRepoUpdater.BackupScriptFiles` 对以 `/` 结尾的 `saved_files` 走 `CopyDirectory` 递归备份（`ScriptRepoUpdater.cs:3174-3197`）；`GetMatchedFiles` 对 `resuming/*.json` 使用非递归 `Directory.GetFiles`（`ScriptRepoUpdater.cs:3073-3095`）。
- 断点确会写嵌套路径：`Main` 由 `picked.path` 去掉 `process/` 前缀得到 `relativePath`，恒含一级以上目录；`resuming/` 现有样例即多层（如 `resuming/世界任务/溯流的变奏曲@正夢/溯流的变奏曲/process.json`）。
- `LimitedFile.ReadText` 读取失败返回空串、不抛异常（`LimitedFile.cs:170-184`）。

## 四、本次不修复的问题

以下问题已识别，但本次不处理：

- 2：角色图探测死循环（`src/steps/step-processor.js`）。
- 3：`processStringStep` 引用未定义的 `process_path`（`src/app/main.js`）。
- 6：暂停 `finally` 中 `hook` 可能为 null 的二次抛错（`src/app/main.js`）。
- 10：出错路径未 `ClearAllTriggers`（`src/app/main.js`）。
- 11：`自动拾取 关闭`/`自动任务 disable` 全局清空触发器、`自动拾取 开启` 叠加触发器。
- 14：硬编码 1920×1080。
- 17：`easyOCR` 成功/失败返回结构不一致。
- 25：`.gitignore`、`AGENTS.md`、`refactor-plan.md` 仍为未跟踪文件。
