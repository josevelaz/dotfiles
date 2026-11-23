import { Plugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { SyntaxStyle, TextAttributes, type KeyEvent, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { createSaver, flushAll, readNotes, resolveProject, sameNotesText, type ProjectNotes, type Saver } from "./project.js"
import {
  createState,
  insertText,
  modeLabel,
  pendingLabel,
  step,
  visualRange,
  type VimEffect,
  type VimKey,
  type VimState,
} from "./vim.js"

type Options = {
  vim: boolean
  open: string | false
  preview: string | false
  fullscreen: string | false
}

type ViewId = "page" | "panel"

type ActiveApi = {
  togglePreview: () => void
  toggleFullscreen: () => void
}

function bindOf(value: unknown, fallback: string): string | false {
  if (value === false || value === "none") return false
  if (typeof value === "string" && value.trim()) return value
  return fallback
}

function readOptions(raw: Readonly<Record<string, unknown>>): Options {
  const keybinds = raw.keybinds && typeof raw.keybinds === "object" ? raw.keybinds as Record<string, unknown> : {}
  return {
    vim: raw.vim === true,
    open: bindOf(keybinds.open, "<leader>o"),
    preview: bindOf(keybinds.preview, "alt+p"),
    fullscreen: bindOf(keybinds.fullscreen, "alt+f"),
  }
}

function directoryFor(context: Plugin.Context, sessionID?: string): string {
  if (sessionID) {
    const directory = context.data.session.get(sessionID)?.location?.directory
    if (directory) return directory
  }
  return context.location?.directory ?? context.data.location.default().directory
}

function toVimKey(key: KeyEvent): VimKey {
  const alt = key.option || (key as { alt?: boolean }).alt
  return {
    name: key.name,
    ctrl: key.ctrl,
    shift: key.shift,
    alt: !!alt,
    sequence: key.sequence,
  }
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function destroyed(area: TextareaRenderable | undefined): boolean {
  return !area || (area as { isDestroyed?: boolean }).isDestroyed === true
}

function headingColor(theme: Plugin.Context["theme"]) {
  const markdown = (theme as { markdown?: { heading?: unknown } }).markdown
  return (markdown?.heading as typeof theme.text.base | undefined) ?? theme.text.feedback.info.base
}

function syntaxFor(theme: Plugin.Context["theme"]): SyntaxStyle {
  const text = theme.text
  const info = text.feedback.info.base
  const warning = text.feedback.warning.base
  const heading = headingColor(theme)
  const styles: Record<string, { fg?: typeof text.base; bold?: boolean; italic?: boolean; underline?: boolean; dim?: boolean }> = {
    default: { fg: text.base },
    conceal: { fg: text.muted, dim: true },
    "markup.heading": { fg: heading, bold: true },
    "markup.strong": { fg: text.base, bold: true },
    "markup.italic": { fg: text.base, italic: true },
    "markup.strikethrough": { fg: text.muted },
    "markup.list": { fg: text.muted },
    "markup.link": { fg: info, underline: true },
    "markup.link.url": { fg: info, underline: true },
    "markup.link.label": { fg: info },
    "markup.raw": { fg: warning },
    "markup.raw.inline": { fg: warning },
    "markup.raw.block": { fg: warning },
    "markup.quote": { fg: text.muted, italic: true },
  }
  for (const level of [1, 2, 3, 4, 5, 6]) {
    styles[`markup.heading.${level}`] = { fg: heading, bold: true }
  }
  return SyntaxStyle.fromStyles(styles)
}

function fakeKey(name: string): KeyEvent {
  return { name, ctrl: false, shift: false, alt: false, option: false, meta: false, sequence: "" } as KeyEvent
}

function keyFromBind(bind: string): KeyEvent {
  const parts = bind.split("+")
  const name = parts[parts.length - 1] ?? bind
  const alt = parts.includes("alt") || parts.includes("option")
  return {
    name,
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    alt,
    option: alt,
    meta: false,
    sequence: "",
  } as KeyEvent
}

let openingReturn = false

function markOpeningReturn(drop: boolean) {
  openingReturn = drop
}

function claimOpeningReturn(): boolean {
  const drop = openingReturn
  openingReturn = false
  return drop
}

function NotesView(props: {
  context: Plugin.Context
  directory: string
  panel?: PanelInput
  vim: boolean
  previewBind: string
  fullscreenBind: string | false
  viewId: ViewId
  onClose: () => void
  onActive: (id: ViewId, active: boolean, api: ActiveApi) => void
}) {
  const theme = props.context.theme
  const [ready, setReady] = createSignal(false)
  const [project, setProject] = createSignal<ProjectNotes>()
  const [text, setText] = createSignal("")
  const [savedText, setSavedText] = createSignal("")
  const [cursor, setCursor] = createSignal(0)
  const [view, setView] = createSignal<"raw" | "rendered">("raw")
  const [mode, setMode] = createSignal(modeLabel("normal"))
  const [pending, setPending] = createSignal("")
  const [message, setMessage] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const [loadError, setLoadError] = createSignal("")
  const [epoch, setEpoch] = createSignal(0)
  let body = ""
  let caret = 0
  let editor: TextareaRenderable | undefined
  let scroll: ScrollBoxRenderable | undefined
  let saver: Saver | undefined
  let vimState: VimState | undefined
  let applying = false
  let switching = false
  let recovering = false
  let hydrated = false
  let shellTimer: ReturnType<typeof setTimeout> | undefined
  // Set once, when this view is created. Not reset when the textarea remounts.
  let dropReturn = claimOpeningReturn()
  let sameReturn = false
  let focusSeen = false
  let focusWas = false
  const [shell, setShell] = createSignal(props.panel?.presentation ?? "page")
  const syntax = syntaxFor(theme)
  onCleanup(() => syntax.destroy())

  function status(): string {
    if (loadError()) return "Error"
    if (failed()) return "Error"
    if (saving()) return "Saving"
    if (!sameNotesText(text(), savedText())) return "Unsaved"
    return "Saved"
  }

  function statusColor() {
    if (loadError() || failed()) return theme.text.feedback.error.base
    if (saving()) return theme.text.feedback.info.base
    if (!sameNotesText(text(), savedText())) return theme.text.feedback.warning.base
    return theme.text.muted
  }

  function editorText(): string | undefined {
    if (props.vim || view() !== "raw" || !editor || destroyed(editor)) return undefined
    try { return editor.plainText } catch { return undefined }
  }

  function currentText(): string {
    if (props.vim && vimState) return vimState.text
    return editorText() ?? body
  }

  function rememberCursor(offset: number) {
    caret = offset
    setCursor(offset)
  }

  function userEdit(value: string) {
    hydrated = true
    body = value
    setText(value)
    saver?.schedule(value)
  }

  function isSubmitName(name: string | undefined): boolean {
    return name === "return" || name === "linefeed" || name === "kpenter" || name === "enter"
  }

  function consumeOpeningReturn(): boolean {
    if (sameReturn) return true
    if (!dropReturn) return false
    dropReturn = false
    sameReturn = true
    queueMicrotask(() => { sameReturn = false })
    return true
  }

  function dropFocusedReturn(): boolean {
    if (sameReturn) return true
    if (!dropReturn) return false
    if (!notesFocused() && !(editor && !destroyed(editor) && editor.focused)) return false
    return consumeOpeningReturn()
  }

  function clearReturnDrop() {
    dropReturn = false
    sameReturn = false
  }

  function leakedNewline(before: string, after: string, cursor: number): boolean {
    if (after.length !== before.length + 1) return false
    const at = cursor > 0 && after[cursor - 1] === "\n" ? cursor - 1 : cursor
    return after === before.slice(0, at) + "\n" + before.slice(at)
  }

  function ignoreLeakedNewline(area: TextareaRenderable): boolean {
    if (!dropReturn || applying) return false
    let after = ""
    let cursor = 0
    try {
      after = area.plainText
      cursor = area.cursorOffset
    } catch {
      return false
    }
    const before = props.vim && vimState ? vimState.text : body
    if (!leakedNewline(before, after, cursor)) return false
    dropReturn = false
    applying = true
    try {
      area.setText(normalizeNewlines(before))
      const at = cursor > 0 && after[cursor - 1] === "\n" ? cursor - 1 : cursor
      area.cursorOffset = Math.min(Math.max(0, at), area.plainText.length)
      rememberCursor(area.cursorOffset)
    } catch {
      editor = undefined
    } finally {
      applying = false
    }
    return true
  }

  function readEditor(area: TextareaRenderable) {
    queueMicrotask(() => {
      if (applying || editor !== area || destroyed(area)) return
      try {
        rememberCursor(area.cursorOffset)
        const value = area.plainText
        if (value !== body) userEdit(value)
      } catch {
        editor = undefined
      }
    })
  }

  function syncShell() {
    clearTimeout(shellTimer)
    shellTimer = setTimeout(() => {
      setShell(props.panel?.presentation ?? "page")
    }, 0)
  }

  function recover() {
    if (recovering) return
    recovering = true
    editor = undefined
    setEpoch((value) => value + 1)
    queueMicrotask(() => { recovering = false })
  }

  function applyEditor(state: VimState) {
    const area = editor
    if (!area || view() !== "raw") return
    if (destroyed(area)) {
      editor = undefined
      recover()
      return
    }
    applying = true
    try {
      if (area.plainText !== state.text) area.setText(state.text)
      area.cursorOffset = Math.min(Math.max(0, state.cursor), state.text.length)
    } catch {
      applying = false
      editor = undefined
      recover()
      return
    }
    try {
      const range = visualRange(state)
      if (range && state.text.length > 0 && (state.mode === "visual" || state.mode === "visual-line")) {
        area.setSelectionInclusive(range.start, Math.min(range.end, Math.max(0, state.text.length - 1)))
      } else area.clearSelection()
      area.cursorStyle = state.mode === "insert" ? { style: "line", blinking: true } : { style: "block", blinking: true }
    } catch {
      // Selection is cosmetic. Remounting here drops keystrokes during a burst.
    } finally {
      applying = false
    }
  }

  function paint(state: VimState, changed: boolean) {
    vimState = state
    rememberCursor(state.cursor)
    setMode(modeLabel(state.mode))
    setPending(pendingLabel(state))
    setMessage(state.message)
    if (changed) userEdit(state.text)
    else setText(state.text)
    applyEditor(state)
  }

  function onVimKey(key: KeyEvent): boolean {
    if (isSubmitName(key.name)) {
      if (consumeOpeningReturn()) return true
    } else clearReturnDrop()
    if (!vimState) return false
    const before = vimState.text
    const next = step(vimState, toVimKey(key))
    paint(next.state, next.state.text !== before)
    void runEffects(next.effects)
    guardVim()
    return true
  }

  function guardVim() {
    const area = editor
    queueMicrotask(() => {
      if (!props.vim || !vimState || applying || switching || view() !== "raw" || !area || editor !== area || destroyed(area)) return
      let value = ""
      let offset = vimState.cursor
      try {
        value = area.plainText
        offset = area.cursorOffset
      } catch {
        return
      }
      if (value === vimState.text) return
      const cursor = Math.min(Math.max(0, offset), value.length)
      const line = value.lastIndexOf("\n", cursor - 1)
      paint({ ...vimState, text: value, cursor, desiredCol: cursor - (line + 1) }, true)
    })
  }

  function notesFocused(): boolean {
    return props.panel ? props.panel.focused : true
  }

  function inputBlocked(): boolean {
    const current = props.context.keymap.mode.current()
    return current === "modal" || current === "menu" || current === "autocomplete"
  }

  function allow(): boolean {
    return notesFocused() && !inputBlocked() && !loadError()
  }

  function insertPlainNewline() {
    if (!editor || destroyed(editor)) {
      recover()
      return
    }
    editor.newLine()
    rememberCursor(editor.cursorOffset)
    userEdit(editor.plainText)
  }

  function onReturn() {
    if (sameReturn) return
    if (view() !== "raw") return
    if (props.vim) {
      onVimKey(fakeKey("return"))
      return
    }
    insertPlainNewline()
  }

  function onEscape() {
    if (props.vim && vimState) {
      onVimKey(fakeKey("escape"))
      return
    }
    void closeNotes()
  }

  async function saveNow() {
    const value = currentText()
    if (!saver) return
    saver.schedule(value)
    await saver.flush()
  }

  async function closeNotes() {
    if (loadError()) {
      props.onClose()
      return
    }
    if (saver) {
      saver.schedule(currentText())
      await saver.flush()
      if (saver.failed()) return
    }
    props.onClose()
  }

  async function runEffects(effects: readonly VimEffect[]) {
    if (effects.includes("save")) await saveNow()
    if (effects.includes("close")) await closeNotes()
  }

  function togglePreview() {
    clearReturnDrop()
    if (loadError()) return
    let saved = caret
    if (props.vim && vimState) {
      saved = vimState.cursor
      body = vimState.text
      setText(vimState.text)
    } else if (view() === "raw" && editor && !destroyed(editor)) {
      try { saved = editor.cursorOffset } catch { editor = undefined }
    }
    switching = true
    rememberCursor(saved)
    setView((value) => value === "raw" ? "rendered" : "raw")
    queueMicrotask(() => {
      rememberCursor(saved)
      switching = false
    })
  }

  let focusTimer: ReturnType<typeof setTimeout> | undefined
  let focusGen = 0

  function clearFocusTimer() {
    focusGen += 1
    clearTimeout(focusTimer)
    focusTimer = undefined
  }

  function mayFocusEditor(): boolean {
    if (view() !== "raw" || loadError()) return false
    if (props.panel && !props.panel.focused) return false
    if (inputBlocked()) return false
    return true
  }

  function focusEditor() {
    clearFocusTimer()
    const gen = focusGen
    const kick = () => {
      if (gen !== focusGen) return
      if (!mayFocusEditor()) return
      if (destroyed(editor)) {
        if (editor) recover()
        return
      }
      if (editor && !editor.focused) editor.focus()
    }
    queueMicrotask(kick)
    focusTimer = setTimeout(kick, 30)
  }

  function canFullscreen(): boolean {
    if (!props.panel) return false
    // The host only splits a side panel above 80 columns. Below that fullscreen cannot change the layout.
    return props.context.renderer.terminalWidth > 80
  }

  function toggleFullscreen() {
    clearReturnDrop()
    if (!props.panel) return
    const before = props.panel.presentation
    if (!props.vim && editor && !destroyed(editor)) {
      try { rememberCursor(editor.cursorOffset) } catch { editor = undefined }
    }
    props.panel.toggleFullscreen()
    if (props.panel.presentation !== before) syncShell()
    props.panel.focus()
    focusEditor()
  }

  function release() {
    props.onActive(props.viewId, false, { togglePreview: () => {}, toggleFullscreen: () => {} })
    if (saver && !loadError() && hydrated) {
      const pending = saver
      pending.schedule(currentText())
      void pending.flush().finally(() => pending.untrack())
    } else saver?.untrack()
  }
  onCleanup(() => {
    clearTimeout(shellTimer)
    clearFocusTimer()
  })

  onMount(() => {
    props.onActive(props.viewId, true, {
      togglePreview,
      toggleFullscreen,
    })
  })
  onCleanup(release)

  onMount(() => {
    let alive = true
    onCleanup(() => { alive = false })
    void (async () => {
      try {
        const resolved = await resolveProject(props.directory)
        const loaded = await readNotes(resolved.path)
        if (!alive) return
        if (loaded.discarded) {
          props.context.ui.toast.show({
            variant: "warning",
            message: "Project notes on disk are newer. Unsaved text was not restored.",
          })
        }
        setProject(resolved)
        body = loaded.text
        setText(loaded.text)
        setSavedText(loaded.disk)
        rememberCursor(0)
        if (props.vim) vimState = createState(loaded.text, 0)
        saver = createSaver(resolved.path, {
          onStart: () => { if (alive) setSaving(true) },
          onSuccess: (value) => {
            if (!alive) return
            setSaving(false)
            setFailed(false)
            setSavedText(value)
          },
          onError: (error) => {
            if (alive) {
              setSaving(false)
              setFailed(true)
            }
            const detail = error.length > 160 ? `${error.slice(0, 157)}...` : error
            props.context.ui.toast.show({ variant: "error", message: `Could not save project notes: ${detail}` })
          },
        }, 500, loaded.disk)
        if (!sameNotesText(loaded.text, loaded.disk)) {
          hydrated = true
          saver.schedule(loaded.text)
        }
        setReady(true)
      } catch (error) {
        if (!alive) return
        const detail = error instanceof Error ? error.message : String(error)
        setLoadError(detail)
        setReady(true)
      }
    })()
  })

  createEffect(() => {
    const presentation = props.panel?.presentation ?? "page"
    const focused = props.panel ? props.panel.focused : true
    if (focusSeen && focused !== focusWas) clearReturnDrop()
    focusWas = focused
    focusSeen = true
    ready()
    view()
    if (!focused || inputBlocked() || view() !== "raw" || !ready() || loadError()) clearFocusTimer()
    if (presentation !== shell()) {
      syncShell()
      return
    }
    if (!focused || view() !== "raw" || !ready() || loadError() || inputBlocked()) return
    focusEditor()
  })

  props.context.keymap.layer(() => {
    const commands: Array<{ id?: string; bind: string; run: () => false | void }> = []
    if (view() === "rendered") {
      commands.push(
        { bind: "up", run: () => { if (!allow()) return false; clearReturnDrop(); scroll?.scrollBy(-1) } },
        { bind: "down", run: () => { if (!allow()) return false; clearReturnDrop(); scroll?.scrollBy(1) } },
        { bind: "k", run: () => { if (!allow()) return false; clearReturnDrop(); scroll?.scrollBy(-1) } },
        { bind: "j", run: () => { if (!allow()) return false; clearReturnDrop(); scroll?.scrollBy(1) } },
        { bind: "pageup", run: () => { if (!allow()) return false; scroll?.scrollBy(-1, "viewport") } },
        { bind: "pagedown", run: () => { if (!allow()) return false; scroll?.scrollBy(1, "viewport") } },
        { bind: "home", run: () => { if (!allow()) return false; scroll?.scrollTo(0) } },
        { bind: "end", run: () => { if (!allow()) return false; if (scroll) scroll.scrollTo(scroll.scrollHeight) } },
      )
    } else {
      commands.push(
        { bind: "return", run: () => { if (dropFocusedReturn()) return; if (!allow()) return false; onReturn() } },
        { bind: "kpenter", run: () => { if (dropFocusedReturn()) return; if (!allow()) return false; onReturn() } },
        { bind: "linefeed", run: () => { if (dropFocusedReturn()) return; if (!allow()) return false; onReturn() } },
      )
      if (!props.vim) {
        commands.push(
          { bind: "backspace", run: () => { if (!allow() || !editor || destroyed(editor)) return false; clearReturnDrop(); editor.deleteCharBackward(); readEditor(editor) } },
          { bind: "delete", run: () => { if (!allow() || !editor || destroyed(editor)) return false; clearReturnDrop(); editor.deleteChar(); readEditor(editor) } },
          { bind: "home", run: () => { if (!allow() || !editor || destroyed(editor)) return false; clearReturnDrop(); editor.gotoLineStart(); readEditor(editor) } },
          { bind: "end", run: () => { if (!allow() || !editor || destroyed(editor)) return false; clearReturnDrop(); editor.gotoLineEnd(); readEditor(editor) } },
        )
      }
      if (props.vim) {
        for (const bind of ["left", "right", "up", "down", "home", "end", "backspace", "delete", "tab", "ctrl+a", "ctrl+e", "ctrl+b", "ctrl+f", "ctrl+w", "ctrl+u", "ctrl+k", "alt+backspace", "option+backspace"]) {
          commands.push({
            bind,
            run: () => {
              if (!allow()) return false
              onVimKey(keyFromBind(bind))
            },
          })
        }
      }
    }
    commands.push({
      bind: "escape",
      run: () => {
        if (!notesFocused() || inputBlocked()) return false
        onEscape()
      },
    })
    if (props.panel && props.fullscreenBind) {
      commands.push({
        id: "project-notes.fullscreen",
        bind: props.fullscreenBind,
        run: () => {
          if (!allow()) return false
          toggleFullscreen()
        },
      })
    }
    return { mode: "global", priority: 220, commands }
  })

  function attach(area: TextareaRenderable) {
    if (editor === area && (area as { __notesWired?: boolean }).__notesWired) return
    ;(area as { __notesWired?: boolean }).__notesWired = true
    editor = area
    const originalKey = area.handleKeyPress.bind(area)
    area.handleKeyPress = (key) => {
      if (isSubmitName(key.name)) {
        if (consumeOpeningReturn()) return true
        return false
      }
      clearReturnDrop()
      if (key.name === "escape" || key.name === "esc") return false
      if (props.vim) return onVimKey(key)
      const move = () => { rememberCursor(area.cursorOffset); return true }
      if (key.name === "left") return area.moveCursorLeft(), move()
      if (key.name === "right") return area.moveCursorRight(), move()
      if (key.name === "up") return area.moveCursorUp(), move()
      if (key.name === "down") return area.moveCursorDown(), move()
      if (key.name === "home") return area.gotoLineStart(), move()
      if (key.name === "end") return area.gotoLineEnd(), move()
      if (!key.ctrl && !key.meta && !key.super) {
        const ch = key.name === "space" ? " " : key.sequence && key.sequence >= " " ? key.sequence : key.name.length === 1 ? (key.shift ? key.name.toUpperCase() : key.name) : ""
        if (ch) {
          area.insertText(ch)
          rememberCursor(area.cursorOffset)
          userEdit(area.plainText)
          return true
        }
      }
      return originalKey(key)
    }
    area.handlePaste = (event) => {
      const value = normalizeNewlines(new TextDecoder().decode(event.bytes))
      if (!value) return
      if (props.vim) {
        if (!vimState || vimState.mode !== "insert") return
        const before = vimState.text
        const next = insertText(vimState, value)
        paint(next.state, next.state.text !== before)
        return
      }
      area.insertText(value)
      rememberCursor(area.cursorOffset)
      userEdit(area.plainText)
    }
    area.onCursorChange = () => {
      if (applying || switching || props.vim || destroyed(area)) return
      try { rememberCursor(area.cursorOffset) } catch { /* editor went away */ }
    }
    const hostUndo = area.undo.bind(area)
    const hostRedo = area.redo.bind(area)
    area.undo = () => {
      const result = hostUndo()
      if (!props.vim) readEditor(area)
      return result
    }
    area.redo = () => {
      const result = hostRedo()
      if (!props.vim) readEditor(area)
      return result
    }
    const buffer = area.editBuffer
    buffer.on("content-changed", () => {
      if (applying) return
      if (ignoreLeakedNewline(area)) return
      if (props.vim) guardVim()
      else readEditor(area)
    })
    const snapshot = props.vim && vimState ? vimState.text : body
    const place = () => {
      if (editor !== area || destroyed(area)) return
      if (notesFocused() && !area.focused) area.focus()
      if (props.vim && vimState) applyEditor(vimState)
      else {
        applying = true
        try {
          if (!sameNotesText(area.plainText, snapshot)) area.setText(normalizeNewlines(snapshot))
          area.cursorOffset = Math.min(Math.max(0, caret), area.plainText.length)
        } catch {
          recover()
        } finally {
          applying = false
        }
      }
    }
    place()
    queueMicrotask(() => {
      place()
      if (editor === area) hydrated = true
    })
  }

  const mountKey = () => `${shell()}:${epoch()}`

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      gap={1}
      onMouseDown={() => { clearReturnDrop(); if (mayFocusEditor()) focusEditor() }}
    >
      <box flexShrink={0} focusable={false} onMouseDown={() => { clearReturnDrop(); if (mayFocusEditor()) focusEditor() }}>
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>{project()?.name ?? "Notes"}</text>
          <text fg={statusColor()}>{status()}</text>
          <text fg={theme.text.muted}>{view() === "raw" ? "Raw" : "Rendered"}</text>
          <Show when={props.vim && ready() && !loadError()}>
            <text fg={theme.text.feedback.info.base}>{mode()}</text>
          </Show>
          <Show when={pending()}>
            <text fg={theme.text.muted}>{pending()}</text>
          </Show>
        </box>
        <Show when={project()}>
          <text fg={theme.text.muted} wrapMode="word">{props.context.ui.format.path(project()!.path)}</text>
        </Show>
        <Show when={message()}>
          <text fg={theme.text.feedback.warning.base} wrapMode="word">{message()}</text>
        </Show>
      </box>
      <Show when={ready()} fallback={<text fg={theme.text.muted}>Loading notes…</text>}>
        <Show
          when={loadError()}
          fallback={
            <Show when={view() === "raw" ? mountKey() : undefined} keyed fallback={
              <scrollbox
                ref={(value) => { scroll = value }}
                flexGrow={1}
                minHeight={0}
                scrollX={false}
                focusable={true}
                horizontalScrollbarOptions={{ visible: false }}
                verticalScrollbarOptions={{ trackOptions: { foregroundColor: theme.scrollbar.base, backgroundColor: theme.background.base } }}
              >
                <markdown content={text()} syntaxStyle={syntax} fg={theme.text.base} conceal={true} />
              </scrollbox>
            }>
              {() => {
                const initial = body
                return (
                  <textarea
                    ref={attach}
                    flexGrow={1}
                    minHeight={0}
                    width="100%"
                    focusable={true}
                    initialValue={initial}
                    wrapMode="word"
                    backgroundColor={theme.background.base}
                    focusedBackgroundColor={theme.background.base}
                    textColor={theme.text.base}
                    focusedTextColor={theme.text.base}
                    cursorColor={theme.text.base}
                    placeholder="Project notes"
                    placeholderColor={theme.text.muted}
                    onContentChange={() => {
                      if (editor && ignoreLeakedNewline(editor)) return
                      if (!hydrated || applying || switching || view() !== "raw" || props.vim || !editor) return
                      readEditor(editor)
                    }}
                  />
                )
              }}
            </Show>
          }
        >
          <text fg={theme.text.feedback.error.base} wrapMode="word">{`Could not open project notes: ${loadError()}`}</text>
        </Show>
      </Show>
      <text fg={theme.text.muted} wrapMode="word" flexShrink={0}>
        {loadError() || !props.vim ? "esc close" : "esc normal"}
        {props.previewBind ? ` · ${props.previewBind} preview` : ""}
        {props.panel && props.fullscreenBind && canFullscreen() ? ` · ${props.fullscreenBind} fullscreen` : ""}
        {props.vim ? " · :w save · :q close" : ""}
      </text>
    </box>
  )
}

export default Plugin.define({
  id: "project-notes",
  setup(context) {
    const options = readOptions(context.options)
    const [notesActive, setNotesActive] = createSignal(false)
    const [panelOpen, setPanelOpen] = createSignal(false)
    const apis = new Map<ViewId, ActiveApi>()
    function activeApi(): ActiveApi | undefined {
      return apis.get("panel") ?? apis.get("page")
    }

    function openNotes(_input?: string, event?: { name?: string }) {
      const route = context.ui.router.current()
      if (route.type === "plugin" && route.name === "notes") return
      if (route.type === "session" && context.ui.panel.current()?.name === "project-notes") return
      const name = event?.name
      const submit = name === "return" || name === "linefeed" || name === "kpenter" || name === "enter"
      // Slash and the palette dispatch as "command", or with no event. A keybind arrives as its last key.
      const keybind = !!name && name !== "command" && !submit
      markOpeningReturn(!keybind)
      if (route.type === "session" && context.ui.panel.open("project-notes")) return
      context.ui.router.navigate({ type: "plugin", name: "notes" })
    }

    function onActive(id: ViewId, on: boolean, api: ActiveApi) {
      if (on) {
        apis.set(id, api)
        if (id === "panel") setPanelOpen(true)
        setNotesActive(true)
        return
      }
      apis.delete(id)
      if (id === "panel") setPanelOpen(false)
      setNotesActive(apis.size > 0)
    }

    function Host() {
      context.keymap.layer(() => ({
        mode: "global" as const,
        commands: [
          {
            id: "project-notes.open",
            title: "Open project notes",
            group: "Project notes",
            bind: options.open,
            palette: true as const,
            slash: { name: "notes" },
            run: (input, event) => openNotes(input, event),
          },
          {
            id: "project-notes.preview.toggle",
            title: "Toggle notes preview",
            group: "Project notes",
            bind: options.preview,
            palette: true as const,
            enabled: () => notesActive(),
            run: () => activeApi()?.togglePreview(),
          },
          {
            id: "project-notes.fullscreen.toggle",
            title: "Toggle notes fullscreen",
            group: "Project notes",
            palette: true as const,
            enabled: () => panelOpen(),
            run: () => activeApi()?.toggleFullscreen(),
          },
        ],
      }))
      return null
    }

    function Page() {
      const directory = directoryFor(context)
      return (
        <box width="100%" height="100%">
          <Show when={directory} keyed>
            {(dir) => (
              <NotesView
                context={context}
                directory={dir}
                vim={options.vim}
                previewBind={options.preview || ""}
                fullscreenBind={options.fullscreen}
                viewId="page"
                onClose={() => context.ui.router.navigate({ type: "home" })}
                onActive={onActive}
              />
            )}
          </Show>
        </box>
      )
    }

    function PanelHost(props: { panel: PanelInput }) {
      const directory = () => props.panel.name === "project-notes" ? directoryFor(context, props.panel.sessionID) : ""
      return (
        <Show when={directory()} keyed>
          {(dir) => (
            <NotesView
              context={context}
              directory={dir}
              panel={props.panel}
              vim={options.vim}
              previewBind={options.preview || ""}
              fullscreenBind={options.fullscreen}
              viewId="panel"
              onClose={() => props.panel.close()}
              onActive={onActive}
            />
          )}
        </Show>
      )
    }

    const unregister = context.ui.router.register({ name: "notes", render: () => <Page /> })
    const stopPanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => <PanelHost panel={panel} />,
    })
    const stopHost = context.ui.slot({ append: "app", render: () => <Host /> })
    return () => {
      unregister()
      stopPanel()
      stopHost()
      return flushAll()
    }
  },
})
