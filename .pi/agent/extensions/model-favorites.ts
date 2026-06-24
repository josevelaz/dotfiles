/**
 * model-favorites.ts
 *
 * Adds favorite model support to the model picker and cycling keybinds.
 *
 *  alt+m       → custom model picker
 *                  ↑/↓ or ctrl+p/n  navigate
 *                  ctrl+f           toggle ★ favorite on highlighted model
 *                  enter            select
 *                  esc              cancel
 *
 *  alt+.       → cycle forward  through ★ favorites (falls back to all if none)
 *  alt+,       → cycle backward through ★ favorites
 *
 * Favorites are persisted globally to ~/.pi/agent/model-favorites.json
 * so they survive across sessions.
 */

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ─── Persistence ──────────────────────────────────────────────────────────────

function favoritesPath(): string {
  return join(getAgentDir(), "model-favorites.json");
}

function loadFavorites(): Set<string> {
  try {
    const p = favoritesPath();
    if (!existsSync(p)) return new Set();
    const data = JSON.parse(readFileSync(p, "utf-8")) as { favorites?: string[] };
    return new Set(Array.isArray(data.favorites) ? data.favorites : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(favorites: Set<string>): void {
  try {
    writeFileSync(favoritesPath(), JSON.stringify({ favorites: [...favorites] }, null, 2));
  } catch {
    // ignore write errors
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function modelKey(m: Model<Api>): string {
  return `${m.provider}:${m.id}`;
}

function cyclePool(ctx: ExtensionContext, favorites: Set<string>): Model<Api>[] {
  const all = ctx.modelRegistry.getAvailable();
  const favs = all.filter(m => favorites.has(modelKey(m)));
  return favs.length > 0 ? favs : all;
}

// ─── Model picker component ───────────────────────────────────────────────────

const MAX_VISIBLE = 14;

interface PickerCallbacks {
  onSelect: (model: Model<Api>) => void;
  onCancel: () => void;
  onFavoritesChange: () => void;
  requestRender: () => void;
}

class ModelPickerComponent {
  private models: Model<Api>[];
  private favorites: Set<string>;
  private selectedIndex: number;
  private scrollOffset: number;
  private callbacks: PickerCallbacks;
  private cache: { w: number; lines: string[] } | undefined;

  // Passed in so render() can style without capturing theme in constructor
  private theme: Parameters<Parameters<ExtensionContext["ui"]["custom"]>[0]>[1];

  constructor(
    models: Model<Api>[],
    favorites: Set<string>,
    currentModel: Model<Api> | undefined,
    theme: ModelPickerComponent["theme"],
    callbacks: PickerCallbacks,
  ) {
    this.models = models;
    this.favorites = favorites;
    this.callbacks = callbacks;
    this.theme = theme;

    const curIdx = currentModel
      ? models.findIndex(m => modelKey(m) === modelKey(currentModel))
      : -1;
    this.selectedIndex = Math.max(0, curIdx);
    this.scrollOffset = 0;
    this.clampScroll();
  }

  private clampScroll() {
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + MAX_VISIBLE) {
      this.scrollOffset = this.selectedIndex - MAX_VISIBLE + 1;
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.callbacks.onCancel();
      return;
    }

    if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl("p"))) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.clampScroll();
        this.invalidate();
        this.callbacks.requestRender();
      }
      return;
    }

    if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl("n"))) {
      if (this.selectedIndex < this.models.length - 1) {
        this.selectedIndex++;
        this.clampScroll();
        this.invalidate();
        this.callbacks.requestRender();
      }
      return;
    }

    if (matchesKey(data, Key.enter)) {
      const m = this.models[this.selectedIndex];
      if (m) this.callbacks.onSelect(m);
      return;
    }

    if (matchesKey(data, Key.ctrl("f"))) {
      const m = this.models[this.selectedIndex];
      if (m) {
        const key = modelKey(m);
        if (this.favorites.has(key)) this.favorites.delete(key);
        else this.favorites.add(key);
        this.callbacks.onFavoritesChange();
        this.invalidate();
        this.callbacks.requestRender();
      }
      return;
    }
  }

  render(width: number): string[] {
    if (this.cache?.w === width) return this.cache.lines;

    const t = this.theme;
    const p = " ";

    const lines: string[] = [];

    // ── header ──
    const favCount = this.models.filter(m => this.favorites.has(modelKey(m))).length;
    const favHint = favCount > 0
      ? t.fg("accent", `${favCount} ★`)
      : t.fg("dim", "no ★");
    const header =
      `${p}${t.bold("Models")}  ${favHint}  ` +
      t.fg("dim", "ctrl+f ★ · ↑↓ navigate · enter select · esc cancel");
    lines.push(truncateToWidth(header, width));

    const rule = t.fg("dim", "─".repeat(Math.max(0, width - 2)));
    lines.push(truncateToWidth(` ${rule}`, width));

    // ── items ──
    const visible = this.models.slice(this.scrollOffset, this.scrollOffset + MAX_VISIBLE);
    for (let i = 0; i < visible.length; i++) {
      const model = visible[i]!;
      const absIdx = this.scrollOffset + i;
      const isSelected = absIdx === this.selectedIndex;
      const isFav = this.favorites.has(modelKey(model));

      const star = isFav ? "★ " : "  ";
      const name = `${model.provider} / ${model.name}`;
      const reasoning = model.reasoning ? t.fg("dim", " (reasoning)") : "";

      let line: string;
      if (isSelected) {
        line = `${p}${t.fg("accent", star + name)}${reasoning}`;
      } else {
        const starStyled = isFav ? t.fg("warning", star) : star;
        line = `${p}${starStyled}${t.fg("text", name)}${reasoning}`;
      }

      lines.push(truncateToWidth(line, width));
    }

    // ── scroll hint ──
    const total = this.models.length;
    if (total > MAX_VISIBLE) {
      const end = Math.min(this.scrollOffset + MAX_VISIBLE, total);
      lines.push(truncateToWidth(
        ` ${t.fg("dim", `${this.scrollOffset + 1}–${end} of ${total}`)}`,
        width,
      ));
    }

    this.cache = { w: width, lines };
    return lines;
  }

  invalidate(): void {
    this.cache = undefined;
  }
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const favorites = loadFavorites();

  // ── Status bar hint ───────────────────────────────────────────────────────



  // ── Model picker (alt+m) ──────────────────────────────────────────────────

  pi.registerShortcut("alt+m", {
    description: "Model picker  (ctrl+f to ★ favorite)",
    handler: async (ctx) => {
      const models = ctx.modelRegistry.getAvailable();
      if (models.length === 0) {
        ctx.ui.notify("No models available — check API keys", "warning");
        return;
      }

      const chosen = await ctx.ui.custom<Model<Api> | null>(
        (tui, theme, _kb, done) => {
          const picker = new ModelPickerComponent(
            models,
            favorites,
            ctx.model,
            theme,
            {
              onSelect: done,
              onCancel: () => done(null),
              onFavoritesChange: () => { saveFavorites(favorites); },
              requestRender: () => tui.requestRender(),
            },
          );
          return picker;
        },
        {
          overlay: true,
          overlayOptions: { anchor: "center", width: 64 },
        },
      );

      if (chosen) {
        const ok = await pi.setModel(chosen);
        if (!ok) ctx.ui.notify(`No API key for ${chosen.provider}/${chosen.name}`, "error");
      }
    },
  });

  // ── Cycling (alt+. / alt+,) ───────────────────────────────────────────────

  function cycle(ctx: ExtensionContext, direction: 1 | -1) {
    const pool = cyclePool(ctx, favorites);
    if (pool.length === 0) return;

    const cur = ctx.model;
    const curKey = cur ? modelKey(cur) : null;
    const idx = curKey ? pool.findIndex(m => modelKey(m) === curKey) : -1;
    const next = pool[(idx + direction + pool.length) % pool.length]!;

    pi.setModel(next).then(ok => {
      if (ok) {
        const star = favorites.has(modelKey(next)) ? "★ " : "";
        ctx.ui.notify(`${star}${next.provider} / ${next.name}`, "info");
      }
    });
  }

  pi.registerShortcut("alt+.", {
    description: "Cycle to next model  (★ favorites only, or all if none)",
    handler: ctx => cycle(ctx, 1),
  });

  pi.registerShortcut("alt+,", {
    description: "Cycle to previous model  (★ favorites only, or all if none)",
    handler: ctx => cycle(ctx, -1),
  });
}
