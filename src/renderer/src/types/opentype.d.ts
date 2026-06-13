// opentype.js 2.0 未携带类型声明；仅 vitest（emoji-blank-font.test.ts）使用，
// 这里只声明用到的最小 API（解析 + cmap/advance 校验）。
// 注意：必须是无顶层 import/export 的全局声明文件，模块文件里的 declare module
// 只是 augmentation，对无类型包不生效。
declare module 'opentype.js' {
  interface OpentypeGlyph {
    advanceWidth?: number
  }
  interface OpentypeFont {
    unitsPerEm: number
    charToGlyphIndex(char: string): number
    charToGlyph(char: string): OpentypeGlyph
  }
  const opentype: {
    parse(buffer: ArrayBuffer): OpentypeFont
  }
  export default opentype
}
