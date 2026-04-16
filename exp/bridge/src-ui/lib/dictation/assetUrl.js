// 统一把连续听写静态资产解析到 renderer-dist 根目录，避免打包后 JS 落到 assets/ 时相对路径跑偏。
export function resolveDictationAssetUrl(relativePath) {
  return new URL(relativePath, window.location.href).href
}
