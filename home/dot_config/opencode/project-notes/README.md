# Project notes

One Markdown file per project. Open it from the command palette, `/notes`, or `<leader>o`.

This plugin is CLI-only. It is registered in `cli.json`, not discovered from `plugins/`, so it can take options.

## Options

```json
{
  "package": "./project-notes",
  "options": {
    "vim": false,
    "keybinds": {
      "open": "<leader>o",
      "preview": "alt+p",
      "fullscreen": "alt+f"
    }
  }
}
```

`vim` defaults to false. Set it to `true` for Normal, Insert, Visual, and Visual Line. `false` or `"none"` on a keybind turns that shortcut off. Palette and `/notes` still work.

## Shortcuts

| Action | Default |
| --- | --- |
| Open notes | `<leader>o`, palette **Open project notes**, `/notes` |
| Toggle preview | `alt+p`, palette **Toggle notes preview** |
| Toggle fullscreen | `alt+f` inside a session panel, palette **Toggle notes fullscreen** |
| Close | `Esc` when vim is off. `:q` when vim is on |

Leader defaults to `Ctrl+X`. Change it with `keybinds.leader` in `cli.json`.

Inside a session, notes open in the side panel. On the home screen they open as a page. `Esc` or closing the page returns home. Closing the panel returns to the chat.

Preview scrolls with up/down, j/k, Page Up/Down, Home, and End. Headings render in bold. Switching back to raw keeps the text and cursor.

With vim on, `Esc` leaves Insert or Visual and never closes the notes. In Normal mode it only clears a pending count or operator. `:w` saves now. `:q` closes. `:wq` and `:x` save and close.

`Ctrl+P` still opens the command palette while notes are focused. `Ctrl+C` still quits OpenCode.

## Storage

Notes live at:

```text
$XDG_DATA_HOME/opencode/project-notes/<name>-<hash>.md
```

If `XDG_DATA_HOME` is unset, that is `~/.local/share/opencode/project-notes/`. `<hash>` is the first 8 hex digits of the sha256 of the project key. The plugin creates the directory. It saves about 500 ms after typing stops, and again on close. A failed save shows an error toast and keeps the text in the editor.

## Project key

The key is `git rev-parse --path-format=absolute --git-common-dir` for the session directory, or the current location on the home screen. Worktrees of one repo, including bare-repo worktrees, share one file.

The name comes from that path: `/x/repo/.git` is `repo`; a bare `/x/repo.git` or `/x/repo/.bare` is `repo`. Other characters become `-`.

A folder that is not a git repo uses its own real path as the key.

## Keybinds

Plugin command IDs such as `project-notes.open` cannot be set in `cli.json` `keybinds`. An unknown ID is ignored. Change these shortcuts with `options.keybinds` above. Do not use `ctrl+g` for open: OpenCode already binds that to `session.first` while a chat is focused.

Command IDs in the palette are `project-notes.open`, `project-notes.preview.toggle`, and `project-notes.fullscreen.toggle`.

## Limits

- No `.` repeat, text objects, macros, or search. `ge` is ignored. `f`, `F`, `t`, and `T` swallow the next character and do nothing. `;` and `,` are ignored. `/` and `?` swallow until Enter or Esc. `q`, `m`, `@`, `"`, `'`, `` ` ``, `Z`, `z`, `[`, and `]` swallow their argument and do nothing. `S` is `cc`.
- No autoindent. `o`, `O`, `cc`, and `S` do not copy the indent of the line above.
- A trailing newline is the end of the last line, not an extra empty line. `G` on a file that ends with a newline stays on the last text line. Deleting that last line does not leave a blank line you can move back to.
- `gg` and `G` move to the first non-blank character. `nvim --clean` keeps the column.
- `ce`, `c3e`, and `yw` then `P` on a blank last line follow the trailing-newline rule above, so they can differ from nvim by one newline.
- `de` on `x\ny\nz` and `j2dw` on `x\ny\nz` keep a newline that nvim joins. `3l2dw` on `  ind\n\nz` joins the lines (`  iz`); nvim keeps the newline (`  i\nz`).
- A linewise yank that starts on a blank line drops that blank line. A counted `w` delete that ends at column 0 of a later line includes the line break; nvim does not. `yb` that starts and ends at column 0 is linewise, matching nvim. `db`, `dB`, and `d2b` from column 0 stay characterwise; nvim is linewise. From column 0 onto the first non-blank of an indented line, `yb` also stays characterwise. Counted `y3w`/`y3W` across lines and `y2b`/`c2b` across blank lines can differ from nvim.
- After opening notes from a slash command or the palette, the first Enter in the notes is ignored unless you first type, click in them, or toggle preview or fullscreen. Opening and closing the palette does not cancel it. Opening with the keybind does not ignore Enter.
- `o` on an empty buffer inserts on the first line. nvim inserts below a blank line.
- Motions use string indexes, not display columns. A tab counts as one character.
- `Ctrl+C` and `Ctrl+D` still quit OpenCode.
- At 80 columns or fewer the side panel is already full width, so fullscreen does not change the layout and the shortcut is hidden. Typing still works if you press it.
- Visual `$` then `j` includes the line break when that line is not the last, matching nvim. On the last line it does not eat the final newline.
- A failed save blocks close so the text is not dropped. If the panel closes anyway, the text is kept until a newer file is on disk.
- Opening a file does not write it, including a file with Windows line endings. The editor shows Unix line endings. A later edit saves Unix line endings.
