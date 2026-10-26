// Reference Remotion composition for a full-screen product demo loop.
// Every pixel is a pure function of the frame number.
// Frames come from capture-lib.mjs, copied to public/capture/<scene>/fNNNN.jpg
// (1440x900 viewport at DPR 2). Register <DemoComp /> in Root.tsx and render:
//   npx remotion render Demo master.mp4 --crf=10
// Everything in TIMELINE / CAPS / BRAND is example data: replace it per project.
import React from "react";
import { AbsoluteFill, Composition, Img, staticFile, useCurrentFrame } from "remotion";

// ---------- easing (cubic in-out for camera and cursor, expo-out entrances, cubic-in exits) ----------
const cl = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lp = (a: number, b: number, t: number) => a + (b - a) * t;
const P = (t: number, s: number, d: number) => cl((t - s) / d); // progress of [s, s+d]
const ex = (x: number) => (x >= 1 ? 1 : x <= 0 ? 0 : 1 - Math.pow(2, -10 * x));
const ei = (x: number) => x * x * x;
const eio = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

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
export const TOTAL = 1050; // 35 s
const END = TOTAL / FPS;

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
const Cursor: React.FC<{ t: number; c: Cur }> = ({ t, c }) => {
  if (t < c.show[0] || t > c.show[1]) return null;
  const op = P(t, c.show[0], 0.25) * (1 - P(t, c.show[1] - 0.2, 0.2));
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
type Cap = { a: number; b: number; text: string; acc?: string; left?: number };
const Caption: React.FC<{ t: number } & Cap> = ({ t, a, b, text, acc, left }) => {
  if (t < a - 0.01 || t > b + 0.3) return null;
  const i = a < 0 ? 1 : ex(P(t, a, 0.4)); // a < 0: already settled at frame 0 (poster)
  const o = ei(P(t, b, 0.22));
  const parts = acc && text.includes(acc) ? text.split(acc) : [text];
  return (
    <div style={{ position: "absolute", left: left ?? 0, right: left === undefined ? 0 : undefined, bottom: 74, display: "flex", justifyContent: "center", opacity: i * (1 - o) }}>
      <div style={{ background: "rgba(17,16,16,.94)", borderRadius: 999, padding: "16px 40px 18px", boxShadow: "0 18px 40px rgba(0,0,0,.35)", overflow: "hidden", transform: `translateY(${(1 - i) * 14}px)` }}>
        <div style={{ fontFamily: BRAND.display, fontWeight: 800, fontSize: 62, lineHeight: "70px", color: BRAND.text, whiteSpace: "nowrap", transform: `translateY(${(1 - i) * 60}%)` }}>
          {parts.length === 2 ? <>{parts[0]}<span style={{ color: BRAND.accent }}>{acc}</span>{parts[1]}</> : text}
        </div>
      </div>
    </div>
  );
};

// ---------- timeline ----------
// Seg = [from, to, sceneDir, firstFrame, lastFrame]: frames spread evenly over [from, to); first == last is a hold.
// Consecutive segs inside one scene are hard state changes (typing, reply landing, page navigation = hard cut).
type Seg = [number, number, string, number, number];
type Scene = { a: number; b: number; dipIn?: boolean; dipOut?: boolean; segs: Seg[]; zooms: Zoom[]; cur?: Cur };
const Z_PANEL = { k: 1.42, fx: 1224, fy: 530 }; // e.g. the assistant panel

const TIMELINE: Scene[] = [
  // hook: the hero feature's payoff, held in focus; frame 0 is the poster
  { a: 0, b: 2.4, dipOut: true, segs: [[0, 99, "assistant", 40, 40]], zooms: [{ a: -9, b: 99, ...Z_PANEL }] },
  // context: public site, one eased scroll
  { a: 2.5, b: 7.1, dipIn: true, dipOut: true, segs: [[2.5, 4.6, "site", 0, 0], [4.6, 6.6, "site", 0, 59], [6.6, 99, "site", 59, 59]], zooms: [] },
  // hero flow: dashboard -> click -> zoom in -> typing -> real answer -> zoom out -> navigate
  { a: 7.2, b: 18.0, dipIn: true,
    segs: [[7.2, 9.6, "assistant", 0, 0], [9.6, 10.6, "assistant", 1, 1], [10.6, 12.0, "assistant", 2, 20], [12.0, 12.8, "assistant", 21, 39], [12.8, 16.0, "assistant", 40, 40], [16.0, 99, "assistant", 41, 41]],
    zooms: [{ a: 9.75, b: 14.6, ...Z_PANEL }],
    cur: { show: [7.35, 18.0], keys: [[7.35, 760, 610], [9.35, 1366, 854], [10.4, 1182, 790], [15.9, 128, 314]], clicks: [9.5, 10.5, 16.0] } },
  // ...supporting pages, a second hero beat, then the end card...
  // Fill scenes up to END_CARD.a: any gap left here renders as bare background.
];
const CAPS: Cap[] = [
  { a: -1, b: 2.05, text: "Ask your app anything.", acc: "anything.", left: 96 },
  { a: 2.75, b: 4.45, text: "A real product, live.", acc: "live." },
];
const END_CARD = { a: END - 2.6, out: END - 0.9 }; // dips out before the loop-in starts

const imgAt = (t: number, segs: Seg[]) => {
  for (const [a, b, dir, i0, i1] of segs) {
    if (t >= a && t < b) {
      const n = i1 - i0 + 1;
      return img(dir, n === 1 ? i0 : i0 + Math.min(n - 1, Math.floor(((t - a) / (b - a)) * n)));
    }
  }
  const l = segs[segs.length - 1];
  return img(l[2], l[4]);
};

const SceneView: React.FC<{ t: number; s: Scene; settled?: boolean }> = ({ t, s, settled }) => {
  const i = settled || !s.dipIn ? 1 : ex(P(t, s.a, 0.3)); // dip in: 0.3 s, 18 px rise
  const o = s.dipOut && !settled ? ei(P(t, s.b - 0.2, 0.2)) : 0; // dip out: 0.2 s
  const cam = camOf(t, s.zooms);
  return (
    <AbsoluteFill style={{ opacity: i * (1 - o), transform: `translateY(${(1 - i) * 18 + o * 10}px)` }}>
      <AbsoluteFill style={{ transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.k})`, transformOrigin: "0 0" }}>
        <Window src={imgAt(t, s.segs)} />
        {s.cur ? <Cursor t={t} c={s.cur} /> : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const EndCard: React.FC<{ t: number }> = ({ t }) => {
  const i = ex(P(t, END_CARD.a, 0.45)), o = ei(P(t, END_CARD.out, 0.22));
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: i * (1 - o), transform: `translateY(${(1 - i) * 18 + o * 10}px)` }}>
      <div style={{ fontFamily: BRAND.display, fontWeight: 800, fontSize: 96, color: BRAND.text }}>PRODUCT NAME</div>
    </AbsoluteFill>
  );
};

export const Demo: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const LOOP_IN = 13 / FPS; // the hook rises in over the last 13 frames and lands on frame 0
  const hookIn = P(t, END - LOOP_IN, LOOP_IN);
  return (
    <AbsoluteFill style={{ background: BRAND.bg }}>
      {TIMELINE.map((s, k) => (t >= s.a && t < s.b ? <SceneView key={k} t={t} s={s} /> : null))}
      {t >= END_CARD.a && t < END - LOOP_IN ? <EndCard t={t} /> : null}
      {hookIn > 0 ? (
        <AbsoluteFill style={{ opacity: ex(hookIn), transform: `translateY(${(1 - ex(hookIn)) * 18}px)` }}>
          <SceneView t={0} s={TIMELINE[0]} settled />
          <Caption t={0} {...CAPS[0]} />
        </AbsoluteFill>
      ) : null}
      {CAPS.map((c, k) => <Caption key={k} t={t} {...c} />)}
    </AbsoluteFill>
  );
};

export const DemoComp = () => <Composition id="Demo" component={Demo} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />;
