export type VimMode = "normal" | "insert" | "visual" | "visual-line"

export type VimKey = {
  name: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  sequence?: string
}

export type Register = {
  text: string
  linewise: boolean
}

export type Snapshot = {
  text: string
  cursor: number
}

export type VimState = {
  text: string
  cursor: number
  mode: VimMode
  anchor: number
  desiredCol: number
  prefix: string
  motionCount: string
  operator: "" | "d" | "c" | "y"
  pending: "" | "g" | "r" | "arg" | "search"
  ex: boolean
  exBuf: string
  register: Register
  undo: Snapshot[]
  redo: Snapshot[]
  change?: Snapshot
  message: string
}

export type VimEffect = "save" | "close"

export type VimStep = {
  state: VimState
  effects: VimEffect[]
}

const emptyRegister: Register = { text: "", linewise: false }

export function createState(text: string, cursor = 0): VimState {
  const clamped = clampNormal(text, cursor)
  return {
    text,
    cursor: clamped,
    mode: "normal",
    anchor: clamped,
    desiredCol: colOf(text, clamped),
    prefix: "",
    motionCount: "",
    operator: "",
    pending: "",
    ex: false,
    exBuf: "",
    register: emptyRegister,
    undo: [],
    redo: [],
    message: "",
  }
}

export function modeLabel(mode: VimMode): "NORMAL" | "INSERT" | "VISUAL" | "V-LINE" {
  if (mode === "insert") return "INSERT"
  if (mode === "visual") return "VISUAL"
  if (mode === "visual-line") return "V-LINE"
  return "NORMAL"
}

export function pendingLabel(state: VimState): string {
  if (state.ex) return `:${state.exBuf}`
  const wait = state.pending === "g" ? "g" : state.pending === "r" ? "r" : state.pending === "search" ? "/" : state.pending === "arg" ? "…" : ""
  return `${state.prefix}${state.operator}${state.motionCount}${wait}`
}

/** Inclusive visual span, or undefined outside visual modes. */
export function visualRange(state: VimState): { start: number; end: number } | undefined {
  if (state.mode !== "visual" && state.mode !== "visual-line") return undefined
  if (state.text.length === 0) return { start: 0, end: 0 }
  if (state.mode === "visual-line") {
    const [start, end] = linewiseSpan(state.text, state.anchor, state.cursor)
    return { start, end: Math.max(start, end - 1) }
  }
  return { start: Math.min(state.anchor, state.cursor), end: Math.max(state.anchor, state.cursor) }
}

export function insertText(state: VimState, text: string): VimStep {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  if (state.mode !== "insert" || !normalized) return { state, effects: [] }
  return { state: typeText(state, normalized), effects: [] }
}

export function step(state: VimState, key: VimKey): VimStep {
  const base = state.message ? { ...state, message: "" } : state
  if (base.ex) return exKey(base, key)
  if (base.pending === "r") return replaceKey(base, key)
  if (base.mode === "insert") return { state: insertKey(base, key), effects: [] }
  if (base.mode === "visual" || base.mode === "visual-line") return visualKey(base, key)
  return normalKey(base, key)
}

function takesArg(ch: string | undefined): boolean {
  return !!ch && "fFtTqm'`\"@Zz[]".includes(ch)
}

function swallow(state: VimState, key: VimKey): VimStep | undefined {
  if (state.pending !== "arg" && state.pending !== "search") return undefined
  if (isEscape(key) || (state.pending === "search" && isReturn(key))) return { state: clearPending(state), effects: [] }
  if (state.pending === "search") return { state, effects: [] }
  return { state: clearPending(state), effects: [] }
}

function normalKey(state: VimState, key: VimKey): VimStep {
  const swallowed = swallow(state, key)
  if (swallowed) return swallowed
  if (isEscape(key)) return { state: clearPending(state), effects: [] }
  if (isUndo(key)) {
    if (state.operator) return { state: clearPending(state), effects: [] }
    return { state: undo(state), effects: [] }
  }
  if (isRedo(key)) return { state: redo(state), effects: [] }
  if (state.pending === "g") {
    if (letter(key) === "g") return { state: applyMotion(clearWait(state), "gg"), effects: [] }
    return { state: clearPending(state), effects: [] }
  }
  const digit = digitOf(key)
  if (digit) {
    const counted = takeDigit(state, digit)
    if (counted) return { state: counted, effects: [] }
  }
  const ch = letter(key)
  if (!state.operator && ch === ":") return { state: { ...clearPending(state), ex: true, exBuf: "" }, effects: [] }
  if (!state.operator && ch === "v") return { state: enterVisual(state, false), effects: [] }
  if (!state.operator && ch === "V") return { state: enterVisual(state, true), effects: [] }
  if (!state.operator && (ch === "d" || ch === "c" || ch === "y")) {
    return { state: { ...state, operator: ch, motionCount: "", pending: "" }, effects: [] }
  }
  if (state.operator && ch === state.operator) return { state: lineOp(state, state.operator), effects: [] }
  if (!state.operator && ch === "S") return { state: lineOp({ ...state, operator: "c" }, "c"), effects: [] }
  if (!state.operator && ch === "D") return { state: applyMotion({ ...state, operator: "d" }, "$"), effects: [] }
  if (!state.operator && ch === "C") return { state: applyMotion({ ...state, operator: "c" }, "$"), effects: [] }
  if (!state.operator && (ch === "x" || isDelete(key))) return { state: deleteChars(state, countOf(state), false), effects: [] }
  if (!state.operator && ch === "X") return { state: deleteChars(state, countOf(state), true), effects: [] }
  if (!state.operator && ch === "~") return { state: toggleCase(state), effects: [] }
  if (isBackspace(key)) return { state: applyMotion(state, "h"), effects: [] }
  if (!state.operator && ch === "p") return { state: paste(state, false), effects: [] }
  if (!state.operator && ch === "P") return { state: paste(state, true), effects: [] }
  if (!state.operator) {
    if (ch === "i") return { state: enterInsert(state, state.cursor), effects: [] }
    if (ch === "a") return { state: enterInsert(state, afterChar(state.text, state.cursor)), effects: [] }
    if (ch === "I") return { state: enterInsert(state, firstNonBlank(state.text, state.cursor)), effects: [] }
    if (ch === "A") return { state: enterInsert(state, lineEnd(state.text, state.cursor)), effects: [] }
    if (ch === "o") return { state: openLine(state, false), effects: [] }
    if (ch === "O") return { state: openLine(state, true), effects: [] }
    if (ch === "r") return { state: { ...state, pending: "r" }, effects: [] }
  }
  if (!state.operator && ch === "J") return { state: joinLines(state, countOf(state)), effects: [] }
  if (ch === "g") return { state: { ...state, pending: "g" }, effects: [] }
  if (ch === "/" || ch === "?") return { state: { ...clearPending(state), pending: "search" }, effects: [] }
  if (takesArg(ch)) return { state: { ...clearPending(state), pending: "arg" }, effects: [] }
  if (motionName(key, ch)) return { state: applyMotion(state, motionName(key, ch)!), effects: [] }
  if (state.operator || state.prefix || state.pending) return { state: clearPending(state), effects: [] }
  return { state, effects: [] }
}

function visualKey(state: VimState, key: VimKey): VimStep {
  const swallowed = swallow(state, key)
  if (swallowed) return swallowed
  if (isEscape(key)) {
    const cursor = clampNormal(state.text, state.cursor)
    return { state: { ...clearPending(state), mode: "normal", cursor, desiredCol: colOf(state.text, cursor) }, effects: [] }
  }
  if (isBackspace(key)) return { state: moveVisual(state, "h"), effects: [] }
  if (isDelete(key)) return { state: visualOp(state, "d"), effects: [] }
  const ch = letter(key)
  if (ch === "v") return { state: toggleVisual(state, false), effects: [] }
  if (ch === "V") return { state: toggleVisual(state, true), effects: [] }
  if (ch === "d" || ch === "x" || ch === "c" || ch === "y") return { state: visualOp(state, ch), effects: [] }
  if (ch === "~") return { state: visualToggle(state), effects: [] }
  if (state.pending === "g") {
    if (ch === "g") return { state: moveVisual(clearWait(state), "gg"), effects: [] }
    return { state: clearPending(state), effects: [] }
  }
  const digit = digitOf(key)
  if (digit && !(digit === "0" && !state.prefix)) {
    return { state: { ...state, prefix: state.prefix + digit }, effects: [] }
  }
  if (ch === "g") return { state: { ...state, pending: "g" }, effects: [] }
  if (ch === "/" || ch === "?") return { state: { ...state, pending: "search" }, effects: [] }
  if (takesArg(ch)) return { state: { ...state, pending: "arg", prefix: "" }, effects: [] }
  const motion = motionName(key, ch)
  if (motion) return { state: moveVisual(state, motion), effects: [] }
  return { state: state.prefix || state.pending ? clearPending(state) : state, effects: [] }
}

function insertKey(state: VimState, key: VimKey): VimState {
  if (isEscape(key)) return leaveInsert(state)
  if (isBackspace(key) && !key.alt && !key.ctrl) return backspace(state)
  if ((key.alt && isBackspace(key)) || (key.ctrl && key.name === "w")) return deleteWordBefore(state)
  if (key.ctrl && key.name === "u") return deleteTo(state, lineStart(state.text, state.cursor))
  if (key.ctrl && key.name === "k") return deleteTo(state, lineEnd(state.text, state.cursor), false)
  if (isDelete(key)) return delForward(state)
  if (isReturn(key) || key.sequence === "\n" || key.sequence === "\r" || (key.ctrl && key.name === "j")) return typeText(state, "\n")
  if (key.name === "tab") return typeText(state, "\t")
  if (key.name === "left" || (key.ctrl && key.name === "b")) return moveInsert(state, -1, 0)
  if (key.name === "right" || (key.ctrl && key.name === "f")) return moveInsert(state, 1, 0)
  if (key.name === "up") return moveInsert(state, 0, -1)
  if (key.name === "down") return moveInsert(state, 0, 1)
  if (key.name === "home" || (key.ctrl && key.name === "a")) return { ...state, cursor: lineStart(state.text, state.cursor) }
  if (key.name === "end" || (key.ctrl && key.name === "e")) return { ...state, cursor: lineEnd(state.text, state.cursor) }
  if (key.ctrl || key.alt) return state
  const ch = charOf(key)
  if (ch) return typeText(state, ch)
  return state
}

function exKey(state: VimState, key: VimKey): VimStep {
  if (isEscape(key)) return { state: { ...state, ex: false, exBuf: "" }, effects: [] }
  if (isBackspace(key)) return { state: { ...state, exBuf: state.exBuf.slice(0, -1) }, effects: [] }
  if (isReturn(key)) return runEx(state)
  if (key.ctrl || key.alt) return { state, effects: [] }
  const ch = charOf(key)
  if (!ch || ch === "\n") return { state, effects: [] }
  return { state: { ...state, exBuf: state.exBuf + ch }, effects: [] }
}

function runEx(state: VimState): VimStep {
  const cmd = state.exBuf.trim()
  const next = { ...state, ex: false, exBuf: "" }
  if (cmd === "w") return { state: next, effects: ["save"] }
  if (cmd === "q") return { state: next, effects: ["close"] }
  if (cmd === "wq" || cmd === "x") return { state: next, effects: ["save", "close"] }
  return { state: { ...next, message: cmd ? "Not an editor command" : "" }, effects: [] }
}

function replaceKey(state: VimState, key: VimKey): VimStep {
  if (isEscape(key)) return { state: { ...state, pending: "" }, effects: [] }
  const ch = isReturn(key) ? "\n" : charOf(key)
  if (!ch || key.ctrl || key.alt) return { state: clearPending(state), effects: [] }
  return { state: replaceChars(clearPending(state), ch, countOf(state)), effects: [] }
}

function letter(key: VimKey): string | undefined {
  if (key.ctrl || key.alt) return undefined
  const ch = charOf(key)
  if (!ch || ch.length !== 1 || ch < " " || ch === "\n") return undefined
  return ch
}

function charOf(key: VimKey): string | undefined {
  if (key.name === "space") return " "
  if (key.sequence && [...key.sequence].length === 1 && key.sequence >= " ") return key.sequence
  if (key.name.length === 1) return key.shift ? key.name.toUpperCase() : key.name
  return undefined
}

function digitOf(key: VimKey): string | undefined {
  const ch = letter(key)
  return ch && ch >= "0" && ch <= "9" ? ch : undefined
}

function takeDigit(state: VimState, digit: string): VimState | undefined {
  if (digit === "0" && !state.operator && !state.prefix) return undefined
  if (digit === "0" && state.operator && !state.motionCount) return undefined
  if (state.operator) return { ...state, motionCount: state.motionCount + digit }
  return { ...state, prefix: state.prefix + digit }
}

function countOf(state: VimState): number {
  return explicitCount(state) ?? 1
}

function explicitCount(state: VimState): number | undefined {
  if (!state.prefix && !state.motionCount) return undefined
  const prefix = state.prefix ? Number(state.prefix) : 1
  const motion = state.motionCount ? Number(state.motionCount) : 1
  return state.operator ? prefix * motion : prefix
}

function motionName(key: VimKey, ch: string | undefined): string | undefined {
  if (key.name === "left") return "h"
  if (key.name === "right") return "l"
  if (key.name === "down") return "j"
  if (key.name === "up") return "k"
  if (key.name === "home") return "0"
  if (key.name === "end") return "$"
  if (!ch) return undefined
  if ("hjklwbeWBE0^$G".includes(ch)) return ch
  return undefined
}

function isEscape(key: VimKey): boolean {
  return key.name === "escape" || key.name === "esc"
}

function isReturn(key: VimKey): boolean {
  return key.name === "return" || key.name === "enter" || key.name === "linefeed" || key.name === "kpenter"
}

function isBackspace(key: VimKey): boolean {
  return key.name === "backspace"
}

function isDelete(key: VimKey): boolean {
  return key.name === "delete"
}

function isUndo(key: VimKey): boolean {
  return letter(key) === "u"
}

function isRedo(key: VimKey): boolean {
  return !!key.ctrl && key.name === "r"
}

function clearPending(state: VimState): VimState {
  return { ...state, prefix: "", motionCount: "", operator: "", pending: "", ex: false, exBuf: "" }
}

function clearWait(state: VimState): VimState {
  return { ...state, pending: "" }
}

function snap(state: VimState): Snapshot {
  return { text: state.text, cursor: state.cursor }
}

function commit(state: VimState, before: Snapshot): VimState {
  if (before.text === state.text) return { ...state, change: undefined }
  return {
    ...state,
    undo: [...state.undo, before].slice(-200),
    redo: [],
    change: undefined,
  }
}

function undo(state: VimState): VimState {
  const before = state.undo[state.undo.length - 1]
  if (!before) return clearPending(state)
  const current = snap(state)
  return {
    ...clearPending(state),
    text: before.text,
    cursor: clampNormal(before.text, before.cursor),
    desiredCol: colOf(before.text, clampNormal(before.text, before.cursor)),
    undo: state.undo.slice(0, -1),
    redo: [...state.redo, current].slice(-200),
    mode: "normal",
  }
}

function redo(state: VimState): VimState {
  const next = state.redo[state.redo.length - 1]
  if (!next) return clearPending(state)
  return {
    ...clearPending(state),
    text: next.text,
    cursor: clampNormal(next.text, next.cursor),
    desiredCol: colOf(next.text, clampNormal(next.text, next.cursor)),
    undo: [...state.undo, snap(state)].slice(-200),
    redo: state.redo.slice(0, -1),
    mode: "normal",
  }
}

function enterInsert(state: VimState, cursor: number): VimState {
  const before = snap(state)
  const at = clampOffset(state.text, cursor)
  return {
    ...clearPending(state),
    mode: "insert",
    cursor: at,
    desiredCol: colOf(state.text, at),
    change: before,
  }
}

function visualToggle(state: VimState): VimState {
  const before = snap(state)
  const line = state.mode === "visual-line"
  const span = line ? linewiseSpan(state.text, state.anchor, state.cursor) : [Math.min(state.anchor, state.cursor), Math.max(state.anchor, state.cursor) + 1] as [number, number]
  let text = state.text
  for (let i = span[0]; i < span[1] && i < text.length; i++) {
    const ch = text[i]
    if (ch === "\n") continue
    const flipped = ch.toLowerCase() === ch ? ch.toUpperCase() : ch.toLowerCase()
    if (flipped !== ch) text = text.slice(0, i) + flipped + text.slice(i + 1)
  }
  const cursor = clampNormal(text, span[0])
  return commit({ ...clearPending(state), text, cursor, mode: "normal", desiredCol: colOf(text, cursor) }, before)
}

function leaveInsert(state: VimState): VimState {
  const start = lineStart(state.text, Math.min(state.cursor, state.text.length))
  let cursor = state.cursor > start ? state.cursor - 1 : state.cursor
  cursor = clampNormal(state.text, cursor)
  const next = {
    ...state,
    mode: "normal" as const,
    cursor,
    desiredCol: colOf(state.text, cursor),
  }
  if (!state.change) return clearPending(next)
  return clearPending(commit(next, state.change))
}

function typeText(state: VimState, text: string): VimState {
  const next = state.text.slice(0, state.cursor) + text + state.text.slice(state.cursor)
  const cursor = state.cursor + text.length
  return { ...state, text: next, cursor, desiredCol: colOf(next, cursor) }
}

function deleteTo(state: VimState, at: number, before = true): VimState {
  const from = before ? Math.min(at, state.cursor) : state.cursor
  const to = before ? state.cursor : Math.max(at, state.cursor)
  if (from === to) return state
  return { ...state, text: state.text.slice(0, from) + state.text.slice(to), cursor: from }
}

function deleteWordBefore(state: VimState): VimState {
  const start = lineStart(state.text, state.cursor)
  if (state.cursor <= start) return state
  let i = state.cursor
  while (i > start && isSpace(state.text[i - 1])) i--
  while (i > start && !isSpace(state.text[i - 1])) i--
  return deleteTo(state, i)
}

function toggleCase(state: VimState): VimState {
  const end = lineEnd(state.text, state.cursor)
  if (state.cursor >= end || state.text[state.cursor] === "\n") return clearPending(state)
  const before = snap(state)
  let text = state.text
  let i = state.cursor
  const count = countOf(state)
  let n = 0
  while (n < count && i < end && text[i] !== "\n") {
    const ch = text[i]
    const flipped = ch.toLowerCase() === ch ? ch.toUpperCase() : ch.toLowerCase()
    text = text.slice(0, i) + flipped + text.slice(i + 1)
    i++
    n++
  }
  const cursor = clampNormal(text, i >= end ? end - 1 : i)
  return commit({ ...clearPending(state), text, cursor, desiredCol: colOf(text, cursor) }, before)
}

function backspace(state: VimState): VimState {
  if (state.cursor <= 0) return state
  return {
    ...state,
    text: state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor),
    cursor: state.cursor - 1,
  }
}

function delForward(state: VimState): VimState {
  if (state.cursor >= state.text.length) return state
  return { ...state, text: state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1) }
}

function moveInsert(state: VimState, cols: number, rows: number): VimState {
  if (rows) {
    const moved = moveVertical(state.text, state.cursor, rows, state.desiredCol, true)
    return { ...state, cursor: moved.offset, desiredCol: state.desiredCol }
  }
  const start = lineStart(state.text, state.cursor)
  const end = lineEnd(state.text, state.cursor)
  const cursor = Math.max(start, Math.min(end, state.cursor + cols))
  return { ...state, cursor, desiredCol: colOf(state.text, cursor) }
}

function enterVisual(state: VimState, line: boolean): VimState {
  return { ...clearPending(state), mode: line ? "visual-line" : "visual", anchor: state.cursor }
}

function toggleVisual(state: VimState, line: boolean): VimState {
  const target: VimMode = line ? "visual-line" : "visual"
  if (state.mode === target) return { ...clearPending(state), mode: "normal" }
  return { ...clearPending(state), mode: target, anchor: state.anchor }
}

function moveVisual(state: VimState, motion: string): VimState {
  const count = state.prefix ? Number(state.prefix) : 1
  const moved = runMotion(state.text, state.cursor, motion, count, state.desiredCol, state.prefix ? count : undefined, false, true)
  return {
    ...state,
    cursor: moved.offset,
    desiredCol: moved.desiredCol,
    prefix: "",
    pending: "",
  }
}

function visualOp(state: VimState, op: "d" | "x" | "c" | "y"): VimState {
  const before = snap(state)
  const line = state.mode === "visual-line"
  const from = Math.min(state.anchor, state.cursor)
  const to = Math.max(state.anchor, state.cursor)
  if (op === "y") {
    const yanked = line ? yankLines(state.text, from, to) : state.text.slice(from, to + 1)
    const cursor = clampNormal(state.text, line ? lineStart(state.text, from) : from)
    return {
      ...clearPending(state),
      mode: "normal",
      cursor,
      desiredCol: colOf(state.text, cursor),
      register: { text: yanked, linewise: line },
    }
  }
  const removed = line
    ? removeLines(state.text, from, to, op === "c")
    : removeSpan(state.text, from, to + 1, op === "c")
  let next: VimState = {
    ...clearPending(state),
    text: removed.text,
    cursor: op === "c" ? removed.cursor : clampNormal(removed.text, removed.cursor),
    mode: op === "c" ? "insert" : "normal",
    register: { text: removed.yanked, linewise: line },
    change: op === "c" ? before : undefined,
  }
  next = { ...next, desiredCol: colOf(next.text, next.cursor) }
  return op === "c" ? next : commit(next, before)
}

function applyMotion(state: VimState, motion: string): VimState {
  if (state.operator && isEmptyLine(state.text, state.cursor) && countOf(state) === 1) {
    if (motion === "w" || motion === "W") {
      if (state.operator === "c") return enterInsert(state, lineStart(state.text, state.cursor))
      const end = lineEnd(state.text, state.cursor)
      const hasNext = end < state.text.length && state.text[end] === "\n" && end + 1 < state.text.length
      if (state.operator === "y" && !hasNext) return { ...clearPending(state), register: { text: "", linewise: false } }
      if (end < state.text.length && state.text[end] === "\n") return operate(state, end + 1, "exclusive", state.operator)
      return clearPending(state)
    }
    if (motion === "$") {
      if (state.operator === "c") return enterInsert(state, lineStart(state.text, state.cursor))
      if (state.operator === "y") return { ...clearPending(state), register: { text: "", linewise: false } }
      return clearPending(state)
    }
  }
  if (state.operator === "c" && (motion === "w" || motion === "W")) {
    const ch = state.text[state.cursor]
    if (ch && ch !== "\n" && !isSpace(ch)) {
      return operate(state, nthWordEnd(state.text, state.cursor, countOf(state), motion === "W"), "inclusive", "c")
    }
  }
  const mapped = changeWord(state, motion)
  if (mapped === "char") return changeChar(state)
  const moved = runMotion(state.text, state.cursor, mapped, countOf(state), state.desiredCol, explicitCount(state), !!state.operator, false)
  if (moved.failed) return clearPending(state)
  if (state.operator && (motion === "b" || motion === "B") && moved.offset === state.cursor) return clearPending(state)
  if (state.operator === "c" && (motion === "b" || motion === "B") && isEmptyLine(state.text, moved.offset) && lineStart(state.text, moved.offset) !== lineStart(state.text, state.cursor)) {
    return enterInsert(state, lineStart(state.text, moved.offset))
  }
  if (!state.operator) {
    const cursor = clampNormal(state.text, moved.offset)
    return {
      ...clearPending(state),
      cursor,
      desiredCol: motion === "j" || motion === "k" ? state.desiredCol : motion === "$" ? 1_000_000 : colOf(state.text, cursor),
    }
  }
  let target = moved.offset
  let kind = moved.kind
  if (state.operator === "c" && motion === "$" && countOf(state) > 1 && isEmptyLine(state.text, moved.offset)) {
    const start = lineStart(state.text, moved.offset)
    if (start > state.cursor) {
      target = start - 1
      kind = "inclusive"
    }
  }
  if (state.operator === "d" && motion === "$" && countOf(state) > 1) {
    const eol = lineEnd(state.text, moved.offset)
    target = eol < state.text.length && state.text[eol] === "\n" ? eol + 1 : state.text.length
    kind = "exclusive"
  }
  return operate(state, target, kind, state.operator)
}

function operate(state: VimState, target: number, kind: MotionKind, op: "d" | "c" | "y"): VimState {
  const before = snap(state)
  if (op === "y") {
    let from = state.cursor
    let to = target
    if (kind === "exclusive" && state.cursor > target && lineStart(state.text, state.cursor) === state.cursor && state.text[state.cursor - 1] === "\n" && lineStart(state.text, target) !== target) {
      from = target
      to = state.cursor - 1
    }
    const atStart = kind === "exclusive" && lineStart(state.text, state.cursor) === state.cursor && lineStart(state.text, target) === target && target !== state.cursor
    const yankLine = kind === "linewise" || atStart
    const higher = Math.max(state.cursor, target)
    const yanked = yankLine
      ? yankLines(state.text, atStart ? Math.min(state.cursor, target) : state.cursor, atStart ? Math.max(0, higher - 1) : target)
      : yankChars(state.text, from, to, kind)
    if (!yankLine && (yanked === "" || (isEmptyLine(state.text, state.cursor) && from === to))) {
      return { ...clearPending(state), register: { text: "", linewise: false } }
    }
    const backward = yankLine
      ? lineIndex(state.text, target) < lineIndex(state.text, state.cursor)
      : target < state.cursor
    const cursor = backward
      ? clampNormal(state.text, yankLine ? lineStart(state.text, Math.min(state.cursor, target)) : Math.min(state.cursor, target))
      : state.cursor
    return { ...clearPending(state), cursor, desiredCol: colOf(state.text, cursor), register: { text: yanked, linewise: yankLine } }
  }
  const removed = kind === "linewise"
    ? removeLines(state.text, state.cursor, target, op === "c")
    : removeBetween(state.text, state.cursor, target, kind, op)
  if (removed.yanked === "" && removed.text === state.text) {
    if (op === "c" && kind !== "linewise") return enterInsert(state, state.cursor)
    return clearPending(state)
  }
  let next: VimState = {
    ...clearPending(state),
    text: removed.text,
    cursor: op === "c" ? removed.cursor : clampNormal(removed.text, removed.cursor),
    mode: op === "c" ? "insert" : "normal",
    register: { text: removed.yanked, linewise: kind === "linewise" },
    change: op === "c" ? before : undefined,
  }
  next = { ...next, desiredCol: colOf(next.text, next.cursor) }
  return op === "c" ? next : commit(next, before)
}

function lineOp(state: VimState, op: "d" | "c" | "y"): VimState {
  const count = Math.max(countOf(state), 1)
  const starts = lineStarts(state.text)
  const current = lineIndex(state.text, state.cursor)
  if (count > 1 && current >= starts.length - 1) return clearPending(state)
  const target = starts[Math.min(current + count - 1, starts.length - 1)] ?? 0
  if (op === "y") {
    return {
      ...clearPending(state),
      register: { text: yankLines(state.text, state.cursor, target), linewise: true },
    }
  }
  return operate({ ...state, operator: op }, target, "linewise", op)
}

function deleteChars(state: VimState, count: number, before: boolean): VimState {
  const snapBefore = snap(state)
  const removed = before ? removeBefore(state.text, state.cursor, count) : removeAfter(state.text, state.cursor, count)
  if (!removed.yanked) return clearPending(state)
  const cursor = clampNormal(removed.text, removed.cursor)
  return commit({
    ...clearPending(state),
    text: removed.text,
    cursor,
    desiredCol: colOf(removed.text, cursor),
    register: { text: removed.yanked, linewise: false },
  }, snapBefore)
}

function paste(state: VimState, before: boolean): VimState {
  if (!state.register.text) return clearPending(state)
  const snapBefore = snap(state)
  const count = countOf(state)
  let text = state.text
  let cursor = state.cursor
  for (let i = 0; i < count; i++) {
    const pasted = state.register.linewise
      ? pasteLines(text, cursor, state.register.text, before)
      : pasteChars(text, cursor, state.register.text, before)
    text = pasted.text
    cursor = pasted.cursor
  }
  return commit({
    ...clearPending(state),
    text,
    cursor: clampNormal(text, cursor),
    desiredCol: colOf(text, cursor),
  }, snapBefore)
}

function openLine(state: VimState, above: boolean): VimState {
  const before = snap(state)
  const start = lineStart(state.text, state.cursor)
  const end = lineEnd(state.text, state.cursor)
  let text = state.text
  let cursor = state.cursor
  if (above) {
    text = text.slice(0, start) + "\n" + text.slice(start)
    cursor = start
  } else if (end < text.length) {
    text = text.slice(0, end + 1) + "\n" + text.slice(end + 1)
    cursor = end + 1
  } else {
    if (text.length > 0 && !text.endsWith("\n")) text += "\n"
    cursor = text.length
  }
  return {
    ...clearPending(state),
    text,
    cursor,
    mode: "insert",
    change: before,
    desiredCol: 0,
  }
}

function joinLines(state: VimState, count: number): VimState {
  const times = Math.max(count, 2) - 1
  const before = snap(state)
  let text = state.text
  let cursor = state.cursor
  for (let n = 0; n < times; n++) {
    const end = lineEnd(text, cursor)
    if (end >= text.length || text[end] !== "\n") break
    let i = end + 1
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i++
    const nextEmpty = i >= text.length || text[i] === "\n"
    const curStart = lineStart(text, cursor)
    const curEmpty = end === curStart
    const trail = end > curStart && (text[end - 1] === " " || text[end - 1] === "\t")
    const paren = text[i] === ")"
    const gap = nextEmpty || curEmpty || trail || paren ? "" : " "
    text = text.slice(0, end) + gap + text.slice(i)
    cursor = gap ? end : Math.max(curStart, end - 1)
  }
  if (text === state.text) return clearPending(state)
  cursor = clampNormal(text, cursor)
  return commit({
    ...clearPending(state),
    text,
    cursor,
    desiredCol: colOf(text, cursor),
  }, before)
}

function replaceChars(state: VimState, ch: string, count: number): VimState {
  if (state.cursor >= state.text.length || state.text[state.cursor] === "\n") return state
  const end = lineEnd(state.text, state.cursor)
  if (ch === "\n") {
    const before = snap(state)
    const text = state.text.slice(0, state.cursor) + "\n" + state.text.slice(state.cursor + 1)
    return commit({ ...state, text, cursor: state.cursor, desiredCol: 0 }, before)
  }
  if (state.cursor + count > end) return state
  const before = snap(state)
  const text = state.text.slice(0, state.cursor) + ch.repeat(count) + state.text.slice(state.cursor + count)
  const cursor = state.cursor + count - 1
  return commit({ ...state, text, cursor, desiredCol: colOf(text, cursor) }, before)
}

type MotionKind = "exclusive" | "inclusive" | "linewise"

function atWordEnd(text: string, cursor: number, big: boolean): boolean {
  const next = text[cursor + 1]
  if (!next || next === "\n" || isSpace(next)) return true
  if (big) return false
  return kindOf(text[cursor], false) !== kindOf(next, false)
}

function changeWord(state: VimState, motion: string): string {
  if (state.operator !== "c" || (motion !== "w" && motion !== "W")) return motion
  const ch = state.text[state.cursor]
  if (!ch || ch === "\n" || ch === " " || ch === "\t") return motion
  if (countOf(state) === 1 && atWordEnd(state.text, state.cursor, motion === "W")) return "char"
  return motion === "w" ? "e" : "E"
}

function changeChar(state: VimState): VimState {
  const ch = state.text[state.cursor]
  if (!ch || ch === "\n") return enterInsert(state, state.cursor)
  const before = snap(state)
  const text = state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1)
  return {
    ...clearPending(state),
    text,
    cursor: state.cursor,
    mode: "insert",
    change: before,
    desiredCol: 0,
    register: { text: ch, linewise: false },
  }
}

function runMotion(
  text: string,
  cursor: number,
  motion: string,
  count: number,
  desiredCol: number,
  explicit: number | undefined,
  asOperator: boolean,
  visual: boolean,
): {
  offset: number
  desiredCol: number
  kind: MotionKind
  failed?: boolean
} {
  if (motion === "j" || motion === "k") {
    const starts = lineStarts(text)
    const current = lineIndex(text, cursor)
    const delta = motion === "j" ? count : -count
    const dest = current + delta
    const atEdge = delta > 0 ? current >= starts.length - 1 : current <= 0
    if (asOperator && delta !== 0 && atEdge && (dest < 0 || dest >= starts.length)) {
      return { offset: cursor, desiredCol, kind: "linewise", failed: true }
    }
    const index = Math.max(0, Math.min(starts.length - 1, dest))
    const start = starts[index] ?? 0
    const limit = lineContentEnd(text, start) - start
    if (visual && desiredCol >= 1_000_000 && index < starts.length - 1) {
      const eol = lineEnd(text, start)
      if (eol < text.length && text[eol] === "\n") return { offset: eol, desiredCol, kind: "inclusive" }
    }
    const col = Math.max(0, Math.min(desiredCol, Math.max(0, limit)))
    return { offset: start + col, desiredCol, kind: "linewise" }
  }
  if (motion === "gg" || motion === "G") {
    const last = lineStarts(text).length
    const line = motion === "gg" ? (explicit ?? 1) : (explicit ?? last)
    const offset = gotoLine(text, line)
    return { offset, desiredCol: colOf(text, offset), kind: "linewise" }
  }
  let offset = cursor
  let col = desiredCol
  if (motion === "h") offset = moveH(text, cursor, count)
  else if (motion === "l") offset = moveL(text, cursor, count, asOperator)
  else if (motion === "0") offset = lineStart(text, cursor)
  else if (motion === "^") offset = firstNonBlank(text, cursor)
  else if (motion === "$") {
    const starts = lineStarts(text)
    const current = lineIndex(text, cursor)
    if (asOperator && count > 1 && current >= starts.length - 1) {
      return { offset: cursor, desiredCol: 1_000_000, kind: "inclusive", failed: true }
    }
    const line = starts[Math.min(current + count - 1, starts.length - 1)] ?? 0
    const eol = lineEnd(text, line)
    if (visual && eol < text.length && text[eol] === "\n") {
      return { offset: eol, desiredCol: 1_000_000, kind: "inclusive" }
    }
    return { offset: lineContentEnd(text, line), desiredCol: 1_000_000, kind: "inclusive" }
  } else if (motion === "w" || motion === "W") {
    offset = asOperator
      ? wordForwardOp(text, cursor, motion === "W", count)
      : repeatMove(text, cursor, count, (pos) => wordForward(text, pos, motion === "W"))
  }
  else if (motion === "b" || motion === "B") offset = repeatMove(text, cursor, count, (pos) => wordBack(text, pos, motion === "B"))
  else if (motion === "e" || motion === "E") offset = repeatMove(text, cursor, count, (pos) => wordEnd(text, pos, motion === "E"))
  col = colOf(text, offset)
  const inclusive = motion === "e" || motion === "E"
  return { offset, desiredCol: col, kind: inclusive ? "inclusive" : "exclusive" }
}

function repeatMove(text: string, cursor: number, count: number, move: (pos: number) => number): number {
  let pos = cursor
  for (let i = 0; i < count; i++) {
    const next = move(pos)
    if (next === pos) break
    pos = next
  }
  return pos
}

function moveH(text: string, cursor: number, count: number): number {
  return Math.max(lineStart(text, cursor), cursor - count)
}

function moveL(text: string, cursor: number, count: number, asOperator = false): number {
  const limit = asOperator ? lineEnd(text, cursor) : lineContentEnd(text, cursor)
  return Math.min(limit, cursor + count)
}

function gotoLine(text: string, line: number): number {
  const starts = lineStarts(text)
  const index = Math.min(Math.max(line, 1), starts.length) - 1
  return firstNonBlank(text, starts[index] ?? 0)
}

function moveVertical(text: string, cursor: number, lines: number, desiredCol: number, insert: boolean): { offset: number } {
  const starts = lineStarts(text)
  const current = lineIndex(text, cursor)
  const index = Math.max(0, Math.min(starts.length - 1, current + lines))
  const start = starts[index] ?? 0
  const limit = insert ? lineEnd(text, start) - start : lineContentEnd(text, start) - start
  const col = Math.max(0, Math.min(desiredCol, Math.max(0, limit)))
  return { offset: start + col }
}

function isEmptyLine(text: string, offset: number): boolean {
  const start = lineStart(text, offset)
  return lineEnd(text, start) === start
}

function wordForward(text: string, pos: number, big: boolean): number {
  const n = text.length
  if (n === 0) return 0
  if (pos >= n) return Math.max(0, n - 1)
  const end = lineEnd(text, pos)
  if (isEmptyLine(text, pos)) {
    if (end >= n || end + 1 >= n) return lineContentEnd(text, pos)
    return landWord(text, end + 1, big)
  }
  let i = pos
  if (i < end && !isSpace(text[i])) {
    const kind = kindOf(text[i], big)
    while (i < end && !isSpace(text[i]) && kindOf(text[i], big) === kind) i++
  }
  while (i < end && isSpace(text[i])) i++
  if (i < end) return i
  if (end + 1 >= n) return lineContentEnd(text, pos)
  const next = end + 1
  if (isEmptyLine(text, next)) return next
  return landWord(text, next, big)
}

/** Operator `w`: one step lands on the first character of the next line, then the column-1 rule pulls the end back. */
function wordStop(text: string, pos: number, big: boolean): number {
  const n = text.length
  if (pos >= n) return n
  const end = lineEnd(text, pos)
  if (isEmptyLine(text, pos)) {
    if (end < n && text[end] === "\n" && end + 1 < n) return end + 1
    return end < n ? end : n
  }
  let i = pos
  if (i < end && text[i] !== "\n" && !isSpace(text[i])) {
    const kind = kindOf(text[i], big)
    while (i < end && !isSpace(text[i]) && kindOf(text[i], big) === kind) i++
  }
  while (i < end && isSpace(text[i])) i++
  if (i < end) return i
  if (end < n && text[end] === "\n") return end + 1 < n ? end + 1 : end
  return n
}

function wordForwardOp(text: string, pos: number, big: boolean, count: number): number {
  let p = pos
  let crossed = false
  for (let i = 0; i < count; i++) {
    const next = wordStop(text, p, big)
    if (next === p) break
    if (i < count - 1 && lineStart(text, next) !== lineStart(text, p)) crossed = true
    p = next
  }
  if (!crossed && p > 0 && p < text.length && lineStart(text, p) === p) return p - 1
  return p
}

function landWord(text: string, pos: number, big: boolean): number {
  if (pos >= text.length) return Math.max(0, text.length - 1)
  if (isEmptyLine(text, pos) || text[pos] === "\n") return pos
  let i = pos
  const end = lineEnd(text, pos)
  while (i < end && isSpace(text[i])) i++
  return i < end ? i : pos
}

function nthWordEnd(text: string, cursor: number, count: number, big: boolean): number {
  const endOf = (pos: number) => {
    if (pos >= text.length || text[pos] === "\n" || isSpace(text[pos])) return pos
    let i = pos
    const kind = kindOf(text[i], big)
    while (i + 1 < text.length && text[i + 1] !== "\n" && !isSpace(text[i + 1]) && kindOf(text[i + 1], big) === kind) i++
    return i
  }
  let end = endOf(cursor)
  for (let n = 1; n < count; n++) {
    let i = end + 1
    while (i < text.length && (isSpace(text[i]) || text[i] === "\n")) i++
    if (i >= text.length) break
    end = endOf(i)
  }
  return end
}

function wordEnd(text: string, pos: number, big: boolean): number {
  const n = text.length
  if (n === 0 || pos >= n) return Math.max(0, n - 1)
  let i = pos
  if (text[i] !== "\n" && !isSpace(text[i])) {
    const kind = kindOf(text[i], big)
    const atEnd = i + 1 >= n || text[i + 1] === "\n" || isSpace(text[i + 1]) || kindOf(text[i + 1], big) !== kind
    if (atEnd) i++
  }
  while (i < n && (isSpace(text[i]) || text[i] === "\n")) i++
  if (i >= n) return pos
  const kind = kindOf(text[i], big)
  while (i + 1 < n && text[i + 1] !== "\n" && !isSpace(text[i + 1]) && kindOf(text[i + 1], big) === kind) i++
  return i
}

function wordBack(text: string, pos: number, big: boolean): number {
  if (pos <= 0) return 0
  if (!isEmptyLine(text, pos) && text[pos] !== "\n" && !isSpace(text[pos])) {
    const start = lineStart(text, pos)
    const kind = kindOf(text[pos], big)
    if (pos > start && !isSpace(text[pos - 1]) && kindOf(text[pos - 1], big) === kind) {
      let i = pos
      while (i > start && !isSpace(text[i - 1]) && kindOf(text[i - 1], big) === kind) i--
      return i
    }
  }
  let i = pos - 1
  while (i > 0 && isSpace(text[i])) i--
  if (text[i] === "\n" && isEmptyLine(text, i)) return i
  while (i > 0 && (isSpace(text[i]) || (text[i] === "\n" && !isEmptyLine(text, i)))) i--
  if (text[i] === "\n" && isEmptyLine(text, i)) return i
  if (text[i] === "\n" || isSpace(text[i])) return 0
  const kind = kindOf(text[i], big)
  const start = lineStart(text, i)
  while (i > start && !isSpace(text[i - 1]) && kindOf(text[i - 1], big) === kind) i--
  return i
}

function kindOf(ch: string, big: boolean): "word" | "other" {
  if (big) return "word"
  return /[A-Za-z0-9_]/.test(ch) ? "word" : "other"
}

function isSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t"
}

function yankChars(text: string, from: number, to: number, kind: MotionKind): string {
  const range = charSpan(from, to, kind)
  if (!range) return ""
  return text.slice(range[0], range[1])
}

function yankLines(text: string, from: number, to: number): string {
  const [start, end] = linewiseSpan(text, from, to)
  let chunk = text.slice(start, end)
  if (chunk.startsWith("\n")) chunk = chunk.slice(1)
  if (!chunk.endsWith("\n")) chunk += "\n"
  return chunk
}

function removeBetween(text: string, from: number, to: number, kind: MotionKind, op: "d" | "c" | "y"): { text: string; cursor: number; yanked: string } {
  const range = charSpan(from, to, kind)
  if (!range) return { text, cursor: from, yanked: "" }
  let [start, end] = range
  const higher = Math.max(from, to)
  const lower = Math.min(from, to)
  if (kind === "exclusive" && end > start && text[end - 1] === "\n" && lineStart(text, higher) === higher) {
    const emptyHigher = higher < text.length && isEmptyLine(text, higher)
    const lowerAtStart = lineStart(text, lower) === lower
    const backward = higher === from
    if (op === "c" || (op === "d" && !lowerAtStart && (emptyHigher || backward))) end -= 1
  }
  if (start === end) return { text, cursor: from, yanked: "" }
  return removeSpan(text, start, end, op === "c")
}

function removeSpan(text: string, start: number, end: number, change: boolean): { text: string; cursor: number; yanked: string } {
  const yanked = text.slice(start, end)
  const next = text.slice(0, start) + text.slice(end)
  return { text: next, cursor: change ? start : start, yanked }
}

function removeLines(text: string, from: number, to: number, change: boolean): { text: string; cursor: number; yanked: string } {
  const yanked = yankLines(text, from, to)
  const start = lineStart(text, Math.min(from, to))
  const last = lineStart(text, Math.max(from, to))
  const end = lineEnd(text, last)
  const hasNl = end < text.length && text[end] === "\n"
  if (change) {
    const next = text.slice(0, start) + (hasNl ? "\n" : "") + text.slice(hasNl ? end + 1 : end)
    const cursor = hasNl ? start : start
    return { text: next, cursor, yanked }
  }
  let delStart = start
  let delEnd = hasNl ? end + 1 : end
  if (!hasNl && delStart > 0) delStart--
  const next = text.slice(0, delStart) + text.slice(delEnd)
  return { text: next, cursor: delStart, yanked }
}

function removeAfter(text: string, cursor: number, count: number): { text: string; cursor: number; yanked: string } {
  if (cursor >= text.length || text[cursor] === "\n") return { text, cursor, yanked: "" }
  const limit = lineEnd(text, cursor)
  const end = Math.min(limit, cursor + count)
  if (end === cursor) return { text, cursor, yanked: "" }
  return { text: text.slice(0, cursor) + text.slice(end), cursor, yanked: text.slice(cursor, end) }
}

function removeBefore(text: string, cursor: number, count: number): { text: string; cursor: number; yanked: string } {
  const start = lineStart(text, cursor)
  const from = Math.max(start, cursor - count)
  if (from === cursor) return { text, cursor, yanked: "" }
  return { text: text.slice(0, from) + text.slice(cursor), cursor: from, yanked: text.slice(from, cursor) }
}

function pasteChars(text: string, cursor: number, chunk: string, before: boolean): { text: string; cursor: number } {
  let at = cursor
  // On an empty line the cursor sits on the line break. Paste before it, not after.
  if (!before && at < text.length && text[at] !== "\n") at++
  const next = text.slice(0, at) + chunk + text.slice(at)
  return { text: next, cursor: Math.max(at, at + chunk.length - 1) }
}

function pasteLines(text: string, cursor: number, chunk: string, before: boolean): { text: string; cursor: number } {
  let body = chunk.startsWith("\n") ? chunk.replace(/^\n+/, "") : chunk
  if (body.endsWith("\n")) body = body.slice(0, -1)
  if (before) {
    const at = lineStart(text, cursor)
    const next = text.slice(0, at) + body + "\n" + text.slice(at)
    return { text: next, cursor: firstNonBlank(next, at) }
  }
  const end = lineEnd(text, cursor)
  if (end < text.length) {
    const at = end + 1
    const next = text.slice(0, at) + body + "\n" + text.slice(at)
    return { text: next, cursor: firstNonBlank(next, at) }
  }
  const sep = text.length > 0 && !text.endsWith("\n") ? "\n" : ""
  const next = text + sep + body
  return { text: next, cursor: firstNonBlank(next, text.length + sep.length) }
}

function charSpan(from: number, to: number, kind: MotionKind): [number, number] | undefined {
  if (from === to) return kind === "inclusive" ? [from, from + 1] : undefined
  const min = Math.min(from, to)
  const max = Math.max(from, to)
  if (kind === "exclusive") return [min, max]
  return [min, max + 1]
}

function linewiseSpan(text: string, from: number, to: number): [number, number] {
  const start = lineStart(text, Math.min(from, to))
  const last = lineStart(text, Math.max(from, to))
  const end = lineEnd(text, last)
  if (end < text.length && text[end] === "\n") return [start, end + 1]
  if (start > 0) return [start - 1, end]
  return [start, end]
}

function afterChar(text: string, cursor: number): number {
  if (cursor >= text.length || text[cursor] === "\n") return cursor
  return cursor + 1
}

export function lineStarts(text: string): number[] {
  if (text.length === 0) return [0]
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n" && i + 1 < text.length) starts.push(i + 1)
  }
  return starts
}

function lineIndex(text: string, offset: number): number {
  const starts = lineStarts(text)
  let index = 0
  for (let i = 0; i < starts.length; i++) if (starts[i] <= offset) index = i
  return index
}

function lineStart(text: string, offset: number): number {
  if (offset <= 0) return 0
  const from = Math.min(offset, text.length) - 1
  const found = text.lastIndexOf("\n", from)
  return found + 1
}

function lineEnd(text: string, offset: number): number {
  if (offset >= text.length) return text.length
  const found = text.indexOf("\n", offset)
  return found === -1 ? text.length : found
}

function lineContentEnd(text: string, offset: number): number {
  const start = lineStart(text, offset)
  const end = lineEnd(text, start)
  return end > start ? end - 1 : start
}

function firstNonBlank(text: string, offset: number): number {
  const start = lineStart(text, offset)
  const end = lineEnd(text, start)
  let i = start
  while (i < end && (text[i] === " " || text[i] === "\t")) i++
  if (i === end) return end > start ? end - 1 : start
  return i
}

function colOf(text: string, offset: number): number {
  return Math.max(0, offset - lineStart(text, offset))
}

function clampOffset(text: string, offset: number): number {
  if (offset < 0) return 0
  if (offset > text.length) return text.length
  return offset
}

function clampNormal(text: string, offset: number): number {
  if (text.length === 0) return 0
  if (offset < 0) return 0
  const last = lineStarts(text).at(-1) ?? 0
  const max = lineContentEnd(text, last)
  if (offset > max) return max
  if (offset < text.length && text[offset] === "\n" && lineStart(text, offset) < offset) return offset - 1
  return offset
}
