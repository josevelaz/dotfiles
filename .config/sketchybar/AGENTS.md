# SketchyBar agent notes

## Reinstall recovery

This config uses the SbarLua module (`require("sketchybar")`). A SketchyBar reinstall may leave the bar running but with no items loaded if the module is missing.

Symptom:

```text
module 'sketchybar' not found
```

Fix:

```bash
git clone https://github.com/FelixKratz/SbarLua.git /tmp/SbarLua
cd /tmp/SbarLua
make install
rm -rf /tmp/SbarLua
brew services restart felixkratz/formulae/sketchybar
```

Validate:

```bash
sketchybar --query bar
```

Expected: `drawing` is `on` and the `items` array is populated.

## SketchyBar 2.24 item image note

Do not set a top-level `image = { ... }` block on regular items in the Lua config. SketchyBar reports `Invalid subdomain 'image'` for app items. Use `background.image = { ... }` for app icons, and omit top-level `image` blocks when hiding icons.
