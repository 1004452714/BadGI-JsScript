export async function easyOCR({ X, Y, WIDTH, HEIGHT }) {
  let captureRegion = null;
  try {
    // 创建OCR识别对象
    const locationOcrRo = RecognitionObject.Ocr(X, Y, WIDTH, HEIGHT);

    // 截图识别；返回的 Region 列表不含 Mat，可在 finally 释放截图
    captureRegion = captureGameRegion();
    return await captureRegion.findMulti(locationOcrRo);
  } catch (error) {
    log.error("easyOCR识别出错: {error}", error.message);
    return { count: 0 };
  } finally {
    if (captureRegion) captureRegion.dispose();
  }
}
// 清理文本（去除标点符号等）
export function cleanText(text) {
  if (!text) return "";
  // 去除标点符号和特殊字符
  return text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "").trim();
}
// 规范化文本（清理并转小写）
export function normalizeText(text) {
  return cleanText(String(text || "")).toLowerCase();
}
// Levenshtein 距离
export function levenshteinDistance(a, b) {
  const s = String(a || "");
  const t = String(b || "");
  const n = s.length;
  const m = t.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    const si = s.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const tj = t.charCodeAt(j - 1);
      const cost = si === tj ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }
  return d[n][m];
}
// 文本相似度 [0,1]
export function similarity(a, b) {
  const s1 = normalizeText(a);
  const s2 = normalizeText(b);
  if (!s1 && !s2) return 1;
  if (!s1 || !s2) return 0;
  const dist = levenshteinDistance(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  return 1 - dist / maxLen;
}

// 读取角色别名文件
export function readAliases() {
  try {
    const combatText = file.ReadTextSync("Data/avatar/combat_avatar.json");
    const combatData = JSON.parse(combatText);
    const aliases = {};
    for (const character of combatData) {
      if (character.alias && character.name) {
        for (const alias of character.alias) {
          aliases[alias] = character.name;
        }
      }
    }
    return aliases;
  } catch (error) {
    log.error("读取角色别名文件失败: {error}", error.message);
    return {};
  }
}
