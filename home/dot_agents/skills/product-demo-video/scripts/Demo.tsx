// Reference Remotion composition for a full-screen product demo loop.
// Every pixel is a pure function of the frame number.
// Frames come from capture-lib.mjs, copied to public/capture/<scene>/fNNNN.jpg
// (1440x900 viewport at DPR 2). Register <DemoComp /> in Root.tsx and render:
//   npx remotion render Demo master.mp4 --crf=10
// Everything in TIMELINE / BRAND is example data: replace it per project.
// One transition everywhere: a directional push with real motion blur, for every scene change,
// mid-scene caption entrances/exits, and the loop. No fades, dips or crossfades; no hard cuts between scenes.
import React from "react";
import { AbsoluteFill, Composition, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

// ---------- easing (cubic in-out for camera and cursor) ----------
const cl = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lp = (a: number, b: number, t: number) => a + (b - a) * t;
const P = (t: number, s: number, d: number) => cl((t - s) / d); // progress of [s, s+d]
const eio = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// ---------- push transition (generic: no dependencies beyond remotion) ----------
// expo in-out built from expo-out (1 - 2^-10x), normalised to exactly 0 and 1 at the ends
const exN = (x: number) => (1 - Math.pow(2, -10 * cl(x))) / (1 - Math.pow(2, -10));
export const expoInOut = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? (1 - exN(1 - 2 * x)) / 2 : (1 + exN(2 * x - 1)) / 2);
export const quintInOut = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 16 * x ** 5 : 1 - Math.pow(-2 * x + 2, 5) / 2);

export type PushOpts = {
  axis?: "x" | "y"; // x: horizontal push, y: vertical; one axis for the whole video
  dir?: 1 | -1; // 1: content moves left/up (next comes from right/bottom)
  frames?: number; // duration of the move (18 = 0.6 s at 30 fps)
  ease?: (x: number) => number;
  samples?: number; // temporal sub-frame samples while moving (12)
  shutter?: number; // shutter in frames (0.6)
  gauss?: number; // axis-only Gaussian per sample, as a fraction of the sample step (0.6)
};

/** Progress 0..1 of a push that starts at frame f0, at a fractional frame tf. */
export const pushProgress = (tf: number, f0: number, o: PushOpts = {}) => (o.ease ?? expoInOut)((tf - f0) / (o.frames ?? 18));

/** Axis-only Gaussian (px) at frame `frame`, from the velocity over distance `dist`: fills the gaps between samples. */
export const pushBlur = (frame: number, f0: number, o: PushOpts, dist: number) => {
  const v = (pushProgress(frame + 0.25, f0, o) - pushProgress(frame - 0.25, f0, o)) * 2 * dist; // px per frame
  return ((o.gauss ?? 0.6) * v * (o.shutter ?? 0.6)) / (o.samples ?? 12); // 0 at rest, ~11 px mid-move
};
const BLUR_MIN = 0.3; // px; below this the filter is skipped

const AxisBlur: React.FC<{ id: string; sd: number; axis: "x" | "y" }> = ({ id, sd, axis }) => (
  <svg width={0} height={0} style={{ position: "absolute" }}>
    <filter id={id} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
      <feGaussianBlur stdDeviation={axis === "x" ? `${sd.toFixed(2)} 0` : `0 ${sd.toFixed(2)}`} edgeMode="duplicate" />
    </filter>
  </svg>
);

/**
 * Temporal motion blur: the exact mean of `samples` opaque renders spread over `shutter` frames around
 * `frame` (layer k at opacity 1/(k+1)). Sample times are clamped to [lo, hi] so the ends of a move stay sharp.
 */
export const Accumulate: React.FC<{
  frame: number; lo: number; hi: number; samples?: number; shutter?: number;
  render: (tf: number, k: number) => React.ReactNode;
}> = ({ frame, lo, hi, samples = 12, shutter = 0.6, render }) => (
  <AbsoluteFill>
    {Array.from({ length: samples }, (_, k) => (
      <AbsoluteFill key={k} style={{ opacity: 1 / (k + 1) }}>
        {render(cl(frame + ((k + 0.5) / samples - 0.5) * shutter, lo, hi), k)}
      </AbsoluteFill>
    ))}
  </AbsoluteFill>
);

/**
 * Directional push with real motion blur. Render it for frames f0 < frame < f0 + frames; outside that
 * window render the held screen directly (a single sharp render), so p = 0 and p = 1 match the holds.
 * `outgoing` / `incoming` render one full opaque screen for content frame `f`. The two screens touch edge
 * to edge on one strip; the strip is sized to hold both so the blur filter region covers the incoming one.
 */
export const PushTransition: React.FC<{
  frame: number; f0: number; opts?: PushOpts;
  outgoing: (f: number) => React.ReactNode; incoming: (f: number) => React.ReactNode;
}> = ({ frame, f0, opts = {}, outgoing, incoming }) => {
  const { width, height } = useVideoConfig();
  const { axis = "x", dir = 1, frames = 18, samples = 12, shutter = 0.6 } = opts;
  const horiz = axis === "x";
  const D = horiz ? width : height;
  const sd = pushBlur(frame, f0, opts, D);
  const id = `push-${f0}`;
  const at = (off: number): React.CSSProperties => (horiz ? { left: off, top: 0 } : { left: 0, top: off });
  const box: React.CSSProperties = { position: "absolute", width, height, overflow: "hidden" };
  const out = outgoing(frame), inc = incoming(frame);
  return (
    <AbsoluteFill>
      {sd > BLUR_MIN ? <AxisBlur id={id} sd={sd} axis={axis} /> : null}
      <Accumulate frame={frame} lo={f0} hi={f0 + frames} samples={samples} shutter={shutter} render={(tf) => {
        const off = -dir * D * pushProgress(tf, f0, opts);
        return (
          <div style={{ position: "absolute", ...at(dir === 1 ? 0 : -D), width: horiz ? 2 * width : width, height: horiz ? height : 2 * height,
            transform: horiz ? `translateX(${off}px)` : `translateY(${off}px)`, filter: sd > BLUR_MIN ? `url(#${id})` : undefined }}>
            <div style={{ ...box, ...at(dir === 1 ? 0 : D) }}>{out}</div>
            <div style={{ ...box, ...at(dir === 1 ? D : 0) }}>{inc}</div>
          </div>
        );
      }} />
    </AbsoluteFill>
  );
};

/** Which push (if any) is moving at `frame`, given push start frames; -1 when none. */
export const activePush = (frame: number, starts: number[], frames = 18) =>
  starts.findIndex((f0) => frame > f0 && frame < f0 + frames);

// ---------- brand + format ----------
const BRAND = {
  bg: "#111010", // page background around the video slot
  text: "#f4efe7",
  accent: "#f6710a", // one caption word, cursor ring
  domain: "example.com", // neutral label in the window bar; never localhost
  display: "Inter, system-ui, sans-serif",
  mono: "ui-monospace, monospace",
};
const FPS = 30, W = 1920, H = 1200;
// the one transition: 0.6 s expo in-out horizontal push to the left (next screen enters from the right)
const PUSH: Required<PushOpts> = { axis: "x", dir: 1, frames: 18, ease: expoInOut, samples: 12, shutter: 0.6, gauss: 0.6 };
const DIST = PUSH.axis === "x" ? W : H;

// ---------- window geometry ----------
const VW = 1440, VH = 900; // capture viewport, CSS px
const WX = 104, WW = 1712, S = WW / VW; // window ~89% of frame width, scale ~1.19
const BAR = 34, VHpx = VH * S;
const WY = Math.round((H - (BAR + VHpx)) / 2);
const CY0 = WY + BAR;
const toX = (vx: number) => WX + vx * S; // viewport px -> frame px
const toY = (vy: number) => CY0 + vy * S;
const img = (dir: string, i: number) => staticFile(`capture/${dir}/f${String(i).padStart(4, "0")}.jpg`);

// ---------- camera: eased focus zoom in, hold, out; one at a time ----------
// a = zoom-in start, b = zoom-out start, k = scale, (fx, fy) = focus in viewport px, d = move seconds
type Zoom = { a: number; b: number; k: number; fx: number; fy: number; d?: number };
const camOf = (t: number, zooms: Zoom[]) => {
  for (const z of zooms) {
    const d = z.d ?? 0.8;
    if (t < z.a || t > z.b + d) continue;
    const e = eio(P(t, z.a, d)) * (1 - eio(P(t, z.b, d)));
    const Fx = toX(z.fx), Fy = toY(z.fy), K = z.k;
    // keep the focus near the centre, but never reveal past the window edge
    const cx = cl(W / 2, W - K * (WX + WW - Fx), K * (Fx - WX));
    const cy = cl(H / 2, H - K * (WY + BAR + VHpx - Fy), K * (Fy - WY));
    return { k: 1 + (K - 1) * e, tx: e * (cx - K * Fx), ty: e * (cy - K * Fy) };
  }
  return { k: 1, tx: 0, ty: 0 };
};

// ---------- cursor: hold, then an eased move (<= 0.6 s) arriving at each key; clicks = press + ring ----------
type CK = [number, number, number]; // [arrive-by t, vx, vy] from boxes.json
type Cur = { show: [number, number]; keys: CK[]; clicks: number[] };
const curPos = (t: number, keys: CK[]) => {
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2]];
  for (let i = 1; i < keys.length; i++) {
    const [t1, x1, y1] = keys[i];
    if (t <= t1) {
      const [t0, x0, y0] = keys[i - 1];
      const dur = Math.min(0.6, t1 - t0);
      const e = eio(P(t, t1 - dur, dur));
      return [lp(x0, x1, e), lp(y0, y1, e)];
    }
  }
  const l = keys[keys.length - 1];
  return [l[1], l[2]];
};
// on screen at a scene boundary (show reaches sa / sb): rides the push at full opacity;
// appearing or leaving inside a scene: a short opacity ramp on the cursor alone
const Cursor: React.FC<{ t: number; c: Cur; sa: number; sb: number }> = ({ t, c, sa, sb }) => {
  const fadeIn = c.show[0] > sa, fadeOut = c.show[1] < sb;
  if ((fadeIn && t < c.show[0]) || (fadeOut && t > c.show[1])) return null;
  const op = (fadeIn ? P(t, c.show[0], 0.25) : 1) * (fadeOut ? 1 - P(t, c.show[1] - 0.2, 0.2) : 1);
  const [vx, vy] = curPos(t, c.keys);
  let press = 0, ring = -1;
  for (const k of c.clicks) {
    const u = t - k;
    if (u > -0.1 && u < 0.12) press = Math.max(press, 1 - Math.abs(u) / 0.12);
    if (u >= 0 && u < 0.45) ring = u / 0.45;
  }
  const X = toX(vx), Y = toY(vy);
  return (
    <>
      {ring >= 0 ? (
        <div style={{ position: "absolute", left: X - 30, top: Y - 30, width: 60, height: 60, borderRadius: 30, border: `3px solid ${BRAND.accent}`, opacity: (1 - ring) * 0.7 * op, transform: `scale(${0.3 + ring * 0.9})` }} />
      ) : null}
      <svg width={34} height={44} viewBox="0 0 17 22" style={{ position: "absolute", left: X - 2, top: Y - 1, opacity: op, transform: `scale(${1 - press * 0.14})`, transformOrigin: "2px 1px", filter: "drop-shadow(0 3px 5px rgba(0,0,0,.35))" }}>
        <path d="M1 1 L1 17.5 L5.2 13.6 L8 20.2 L10.9 19 L8.2 12.6 L14 12.6 Z" fill="#111010" stroke="#ffffff" strokeWidth={1.3} strokeLinejoin="round" />
      </svg>
    </>
  );
};

// ---------- designed browser window (no real chrome) ----------
const Window: React.FC<{ src: string }> = ({ src }) => (
  <div style={{ position: "absolute", left: WX, top: WY, width: WW, height: BAR + VHpx, borderRadius: 14, overflow: "hidden", background: "#fff", boxShadow: "0 40px 90px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.06)" }}>
    <div style={{ height: BAR, background: "#ebe7e1", borderBottom: "1px solid #ddd7cf", position: "relative" }}>
      {[0, 1, 2].map((i) => <div key={i} style={{ position: "absolute", left: 18 + i * 20, top: 12, width: 11, height: 11, borderRadius: 6, background: "#cdc6bc" }} />)}
      <div style={{ position: "absolute", inset: 0, lineHeight: `${BAR}px`, textAlign: "center", fontFamily: BRAND.mono, fontSize: 15, letterSpacing: "0.04em", color: "#8c857c" }}>{BRAND.domain}</div>
    </div>
    <Img src={src} style={{ display: "block", width: WW, height: VHpx }} />
  </div>
);

// ---------- caption pill ----------
// a <= scene start: on screen when the scene lands (rides the push in); b >= scene end: rides the push out.
// Otherwise it slides in / out mid-scene with the same push (distance, ease, frames, blur) on its own.
type Cap = { a: number; b: number; text: string; acc?: string; left?: number };
const Caption: React.FC<Cap & { off: number; sd: number; id: string }> = ({ text, acc, left, off, sd, id }) => {
  const parts = acc && text.includes(acc) ? text.split(acc) : [text];
  return (
    <div style={{ position: "absolute", left: left ?? 0, right: left === undefined ? 0 : undefined, bottom: 74, display: "flex", justifyContent: "center", transform: PUSH.axis === "x" ? `translateX(${off}px)` : `translateY(${off}px)` }}>
      {sd > BLUR_MIN ? <AxisBlur id={id} sd={sd} axis={PUSH.axis} /> : null}
      <div style={{ background: "rgba(17,16,16,.94)", borderRadius: 999, padding: "16px 40px 18px", boxShadow: "0 18px 40px rgba(0,0,0,.35)", overflow: "hidden", filter: sd > BLUR_MIN ? `url(#${id})` : undefined }}>
        <div style={{ fontFamily: BRAND.display, fontWeight: 800, fontSize: 62, lineHeight: "70px", color: BRAND.text, whiteSpace: "nowrap" }}>
          {parts.length === 2 ? <>{parts[0]}<span style={{ color: BRAND.accent }}>{acc}</span>{parts[1]}</> : text}
        </div>
      </div>
    </div>
  );
};

// ---------- timeline ----------
// Seg = [from, to, sceneDir, firstFrame, lastFrame]: frames spread evenly over [from, to); first == last is a hold.
// Consecutive segs inside one scene are hard state changes (typing, reply landing, page navigation = hard cut).
// Each scene ends at b, where the push to the next starts; it starts (a) when the previous push lands, b + 0.6 s.
// The last screen is the end card: its push brings the hook back and ends exactly at TOTAL (frame 0 = poster).
type Seg = [number, number, string, number, number];
type SceneDef = { b: number; segs: Seg[]; zooms: Zoom[]; cur?: Cur; caps?: Cap[]; end?: boolean };
type Scene = SceneDef & { af: number; a: number };
const Z_PANEL = { k: 1.42, fx: 1224, fy: 530 }; // e.g. the assistant panel

const TIMELINE: SceneDef[] = [
  // hook: the hero feature's payoff, held in focus; frame 0 is the poster
  { b: 2.2, segs: [[0, 99, "assistant", 40, 40]], zooms: [{ a: -9, b: 99, ...Z_PANEL }],
    caps: [{ a: -1, b: 99, text: "Ask your app anything.", acc: "anything.", left: 96 }] },
  // context: public site, one eased scroll; the caption lands with the screen and slides out mid-scene
  { b: 6.7, segs: [[2.8, 4.6, "site", 0, 0], [4.6, 6.6, "site", 0, 59], [6.6, 99, "site", 59, 59]], zooms: [],
    caps: [{ a: 0, b: 4.45, text: "A real product, live.", acc: "live." }] },
  // hero flow: dashboard -> click -> zoom in -> typing -> real answer -> zoom out -> navigate
  { b: 18.0,
    segs: [[7.3, 9.6, "assistant", 0, 0], [9.6, 10.6, "assistant", 1, 1], [10.6, 12.0, "assistant", 2, 20], [12.0, 12.8, "assistant", 21, 39], [12.8, 16.0, "assistant", 40, 40], [16.0, 99, "assistant", 41, 41]],
    zooms: [{ a: 9.75, b: 14.6, ...Z_PANEL }],
    cur: { show: [7.55, 18.0], keys: [[7.55, 760, 610], [9.35, 1366, 854], [10.4, 1182, 790], [15.9, 128, 314]], clicks: [9.5, 10.5, 16.0] } },
  // ...supporting pages, a second hero beat... (start each scene's segs at the previous b + 0.6)
  // end card: static, entered and left by the push (~1.4 s hold)
  { b: 20.0, segs: [], zooms: [], end: true },
];
const PUSHES = TIMELINE.map((s) => Math.round(s.b * FPS)); // push i: screen i out, screen i + 1 (or the hook) in
export const TOTAL = PUSHES[PUSHES.length - 1] + PUSH.frames; // the loop push lands on frame TOTAL == frame 0
const SCREENS: Scene[] = TIMELINE.map((s, i) => {
  const af = i ? PUSHES[i - 1] + PUSH.frames : 0;
  return { ...s, af, a: af / FPS };
});

const imgAt = (t: number, segs: Seg[]) => {
  const tc = Math.max(t, segs[0][0]); // before the first seg: its first frame
  for (const [a, b, dir, i0, i1] of segs) {
    if (tc >= a && tc < b) {
      const n = i1 - i0 + 1;
      return img(dir, n === 1 ? i0 : i0 + Math.min(n - 1, Math.floor(((tc - a) / (b - a)) * n)));
    }
  }
  const l = segs[segs.length - 1];
  return img(l[2], l[4]);
};

// mid-scene caption slide start frames (null = rides with its screen at that end)
const capSlides = (s: Scene, c: Cap) => ({
  inF: c.a > s.a ? Math.round(c.a * FPS) : null,
  outF: c.b < s.b ? Math.round(c.b * FPS) : null,
});
// caption offset along the push axis at fractional frame tf (null = not on screen)
const capOffset = (s: Scene, c: Cap, tf: number): number | null => {
  const { inF, outF } = capSlides(s, c);
  if (inF !== null && tf <= inF) return null;
  if (outF !== null && tf >= outF + PUSH.frames) return null;
  let off = 0;
  if (inF !== null) off += PUSH.dir * DIST * (1 - pushProgress(tf, inF, PUSH));
  if (outF !== null) off -= PUSH.dir * DIST * pushProgress(tf, outF, PUSH);
  return off;
};

const EndCard: React.FC = () => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <div style={{ fontFamily: BRAND.display, fontWeight: 800, fontSize: 96, color: BRAND.text }}>PRODUCT NAME</div>
  </AbsoluteFill>
);

// One full opaque screen: scene content at integer frame f, captions at fractional frame tf.
const Screen: React.FC<{ s: Scene; f: number; tf?: number; capSd?: number; uid: string }> = ({ s, f, tf = f, capSd = 0, uid }) => {
  if (s.end) return <AbsoluteFill style={{ background: BRAND.bg }}><EndCard /></AbsoluteFill>;
  const t = f / FPS;
  const cam = camOf(t, s.zooms);
  return (
    <AbsoluteFill style={{ background: BRAND.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.k})`, transformOrigin: "0 0" }}>
        <Window src={imgAt(t, s.segs)} />
        {s.cur ? <Cursor t={t} c={s.cur} sa={s.a} sb={s.b} /> : null}
      </AbsoluteFill>
      {(s.caps ?? []).map((c, k) => {
        const off = capOffset(s, c, tf);
        return off === null ? null : <Caption key={k} {...c} off={off} sd={capSd} id={`${uid}c${k}`} />;
      })}
    </AbsoluteFill>
  );
};

export const Demo: React.FC = () => {
  const f = useCurrentFrame();

  // 1) scene change or loop: the whole screen (window, cursor, captions) pushes as a unit
  const pi = activePush(f, PUSHES, PUSH.frames);
  if (pi >= 0) {
    const out = SCREENS[pi], inc = SCREENS[(pi + 1) % SCREENS.length]; // incoming holds its first state
    return (
      <AbsoluteFill style={{ background: BRAND.bg }}>
        <PushTransition frame={f} f0={PUSHES[pi]} opts={PUSH}
          outgoing={(fr) => <Screen s={out} f={fr} uid="o" />} incoming={() => <Screen s={inc} f={inc.af} uid="i" />} />
      </AbsoluteFill>
    );
  }
  const s = SCREENS[PUSHES.filter((f0) => f >= f0 + PUSH.frames).length % SCREENS.length];

  // 2) a caption sliding in/out mid-scene: accumulate the whole screen with the caption at sub-frame positions
  for (const c of s.caps ?? []) {
    const { inF, outF } = capSlides(s, c);
    for (const sf of [inF, outF]) {
      if (sf === null || !(f > sf && f < sf + PUSH.frames)) continue;
      const sd = pushBlur(f, sf, PUSH, DIST);
      return (
        <AbsoluteFill style={{ background: BRAND.bg }}>
          <Accumulate frame={f} lo={sf} hi={sf + PUSH.frames} samples={PUSH.samples} shutter={PUSH.shutter}
            render={(tf, k) => <Screen s={s} f={f} tf={tf} capSd={sd} uid={`s${k}`} />} />
        </AbsoluteFill>
      );
    }
  }

  // 3) at rest: one sharp render
  return (
    <AbsoluteFill style={{ background: BRAND.bg }}>
      <Screen s={s} f={f} uid="r" />
    </AbsoluteFill>
  );
};

export const DemoComp = () => <Composition id="Demo" component={Demo} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />;
