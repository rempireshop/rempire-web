"use client";
// TowerAnimated — motion-capable REMPIRE tower mark.
// API-compatible with Tower.tsx (same viewBox, className passthrough); static Tower.tsx stays for non-animated use.
// Technique: the canonical path is UNTOUCHED. Groups are clip windows over six copies of it
// (three merlons, collar/flare, band, body); windows tile through the paper channels and the two
// unavoidable ink crossings (merlon roots y≈210–212, band neck x≈337–339.5) are overlapped so the
// rest pose overlays rempire-tower.svg pixel-identically. Transform + opacity only. See docs/design/MOTION.md.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type TowerVariant = "reveal" | "idle" | "loop" | "none";
export type TowerReveal = "draw" | "brick" | "castle" | "placed" | "build";

export interface TowerAnimatedProps {
  className?: string;
  variant?: TowerVariant;      // reveal: once per session; idle: rare sentry blink; loop: 2s rook turn
  reveal?: TowerReveal;        // which reveal concept (default castling — the signature)
  identOnClick?: boolean;      // gate to >=48px rendered size; sub-pixel at 28px
  lightPass?: boolean;         // with reveal="build": one 9% light travels up the ink after the build (homepage opening)
  title?: string;
}

export interface TowerAnimatedHandle { ident: () => void; }

const VB = "292.24 171.22 265.18 409.8";
const D = "M541.42,377.53l-18.69,10.82s11.14,130.41,11.54,135.02c-.23,7.19-11.13,15.39-28.52,21.44-20.85,7.24-49.58,11.23-80.91,11.23s-59.98-3.98-80.82-11.21c-17.37-6.02-28.29-14.2-28.6-21.39.67-7.94,14-157.47,15.72-177.3,6.37-6.37,30.14-20.91,95.48-18.91,72.13,2.21,93.63,19.61,93.88,19.75l16.98-11.55-12.38-117.42c-.91-14.04-12.92-23.77-33.91-33.43h0c-1.28-.59-2.76-.48-3.94.28l-8.63,5.58c-1.17.76-1.88,2.05-1.88,3.45v22.14c-6.08-1.56-13.19-3.4-19.85-4.35l-.52-32.33c-.05-3.02-2.31-5.55-5.31-5.93l-3.33-.42c-15.83-1.78-31.85-1.73-47.62.16l-3.82.46c-3.02.36-5.31,2.9-5.35,5.94l-.52,32.29c-6.72.99-12.86,3.08-18.9,4.68v-22.4c0-1.25-.57-2.44-1.55-3.22l-7.71-6.16c-1.22-.97-2.88-1.18-4.29-.53h0c-1.16.53-2.3,1.07-3.4,1.62-19.74,9.8-30.84,19.65-31.12,33.52l-7.12,64.63,5.48,16.43s32.05-29.18,102.06-26.35c39.67.51,59.56,11.01,59.56,11.01l11.75-15.24s-31.68-13.66-73.8-13.66c-59.49,0-86.24,15.83-86.24,15.83,0,0,5.09-51.57,5.11-51.87,0,0-.58,6.05.01-.28.87-9.26,15.42-13.93,15.42-13.93l-1.08,34.17s28.19-12.25,53.12-12.25l.6-37.37c0-2.19,30.62-2.27,30.63-.09l.6,37.39c24.34,0,53.11,11.72,53.11,11.72v-31.59s15.68,5.68,16.2,14.85l9.32,102.14c-9.24-2.87-25.63-14.19-93.35-16.33-69.08-2.19-111.82,15.96-113.22,30.02l-.45,4.28c-18.92,186.41-18.92,181.8-18.92,182.08,0,16.85,15.11,31.77,42.54,42.03,24.21,9.05,56.19,14.04,90.05,14.04s65.84-4.99,90.05-14.04c27.43-10.26,42.54-25.18,42.54-42.03,0-.3-16.02-147.42-16.02-147.42Z";
const CLIPS: Record<string, string> = {
  m1: "M270,150H381V212H270Z",
  m2: "M381,150H466V212H381Z",
  m3: "M466,150H580V212H466Z",
  fl: "M270,210H580V371H508V300H270Z M339.5,244H500V302H339.5Z",
  bd: "M337,244H500V302H337Z",
  by: "M270,300H508V371H580V600H270Z",
};

// Draw reveal: the mark is one continuous line — two mask strokes re-trace it (body loop, then
// crown and band). stroke-dashoffset animates on the hidden mask stroke, never on the mark itself.
const DRAW_BODY = "M531,383 C534,398 537,430 539,455 C541,478 544,505 543,522 C542,538 532,548 512,554 C485,562 452,566 424,566 C396,566 362,562 336,554 C316,548 306,538 306,521 C306,505 309,472 311,450 C313,428 318,382 322,352 C324,336 330,328 344,323 C368,315 396,311 424,311 C452,311 474,313 492,319 C504,324 512,331 520,340";
const DRAW_CROWN = "M529,343 C525,322 522,300 519,268 C517,244 516,228 515,216 C514,204 514,196 508,192 C500,188 490,196 486,204 C483,212 480,218 472,221 L457,220 C450,217 449,208 448,197 C448,186 446,179 436,176 C428,174 407,175 401,180 C397,184 398,192 397,200 C396,212 391,218 383,220 L371,220 C364,218 362,211 361,202 C360,195 354,190 347,191 C340,192 334,198 332,208 C329,216 328,224 327,234 C326,250 325,266 328,282 C330,291 338,289 347,284 C360,276 385,262 411,259 C432,257 452,260 465,266 C472,269 476,272 478,275";
// Brick reveal: running-bond brick mask, laid in courses from the crown down.
const BRICKS: { x: number; y: number; d: number }[] = [];
for (let r = 0; r < 13; r++) {
  const y = 150 + r * 34, x0 = 244 + (r % 2 ? -34 : 0);
  for (let c = 0; c < 6; c++) {
    const x = x0 + c * 68;
    if (x + 64 < 270 || x > 566) continue;
    BRICKS.push({ x, y, d: r * 48 + ((r * 7 + c * 13) % 3) * 14 });
  }
}

// Motion tokens — keep in sync with docs/design/MOTION.md and the /brand/motion demo.
const CSS = `
.twm{--tw-ease-firm:cubic-bezier(.2,.8,.2,1);--tw-ease-inout:cubic-bezier(.45,0,.25,1);--tw-ease-settle:cubic-bezier(.3,1.4,.4,1)}
@keyframes tw-castle{0%{opacity:0;transform:translateX(-146px)}22%{opacity:1}72%{transform:translateX(8px);animation-timing-function:var(--tw-ease-settle)}100%{transform:translateX(0)}}
@keyframes tw-drop{0%{opacity:0;transform:translateY(-73px)}14%{opacity:1}58%{transform:translateY(0);animation-timing-function:var(--tw-ease-settle)}78%{transform:translateY(-7px);animation-timing-function:var(--tw-ease-settle)}100%{transform:translateY(0)}}
@keyframes tw-rise{0%{opacity:0;transform:translateY(24px)}100%{opacity:1;transform:translateY(0)}}
@keyframes tw-blink{0%{transform:translateX(0)}45%{transform:translateX(-14px)}100%{transform:translateX(0)}}
@keyframes tw-turn{0%{transform:translateY(0)}38%{transform:translateY(-18px)}100%{transform:translateY(0)}}
@keyframes tw-turnloop{0%{transform:translateY(0)}7.2%{transform:translateY(-18px)}19%,100%{transform:translateY(0)}}
.twm.play-castle [data-mark]{animation:tw-castle 640ms var(--tw-ease-firm) both}
.twm.play-placed [data-body]{animation:tw-drop 520ms var(--tw-ease-firm) both}
.twm.play-placed [data-crown]{animation:tw-drop 520ms var(--tw-ease-firm) 50ms both}
.twm.play-build [data-body]{animation:tw-b-body 340ms var(--tw-ease-firm) both}
.twm.play-build [data-band]{animation:tw-b-band 300ms var(--tw-ease-firm) 360ms both;transform-box:fill-box;transform-origin:50% 50%}
.twm.play-build [data-flare]{animation:tw-b-flare 300ms var(--tw-ease-firm) 480ms both}
.twm.play-build [data-merlon="1"]{animation:tw-b-merlon 340ms var(--tw-ease-firm) 620ms both}
.twm.play-build [data-merlon="2"]{animation:tw-b-merlon 340ms var(--tw-ease-firm) 700ms both}
.twm.play-build [data-merlon="3"]{animation:tw-b-merlon 340ms var(--tw-ease-firm) 780ms both}
.twm.play-blink [data-band]{animation:tw-blink 380ms var(--tw-ease-inout) both}
.twm.play-ident [data-merlon="1"]{animation:tw-turn 380ms var(--tw-ease-inout) both}
.twm.play-ident [data-merlon="2"]{animation:tw-turn 380ms var(--tw-ease-inout) 110ms both}
.twm.play-ident [data-merlon="3"]{animation:tw-turn 380ms var(--tw-ease-inout) 220ms both}
.twm.play-loop [data-merlon="1"]{animation:tw-turnloop 2000ms var(--tw-ease-inout) infinite}
.twm.play-loop [data-merlon="2"]{animation:tw-turnloop 2000ms var(--tw-ease-inout) 110ms infinite}
.twm.play-loop [data-merlon="3"]{animation:tw-turnloop 2000ms var(--tw-ease-inout) 220ms infinite}
@keyframes tw-swap-in{0%,88%{opacity:0}100%{opacity:1}}
@keyframes tw-swap-out{0%,88%{opacity:1}100%{opacity:0}}
@keyframes tw-b-body{0%{opacity:0;transform:translateY(46px)}100%{opacity:1;transform:translateY(0)}}
@keyframes tw-b-band{0%{opacity:0;transform:scaleX(.35)}100%{opacity:1;transform:scaleX(1)}}
@keyframes tw-b-flare{0%{opacity:0;transform:translateY(26px)}100%{opacity:1;transform:translateY(0)}}
@keyframes tw-b-merlon{0%{opacity:0;transform:translateY(40px)}70%{opacity:1;transform:translateY(-4px)}100%{transform:translateY(0)}}
@keyframes tw-light{0%{transform:translateY(0);opacity:0}10%{opacity:.09}90%{opacity:.09}100%{transform:translateY(-560px);opacity:0}}
@keyframes tw-sketch{0%,96%{opacity:.45}100%{opacity:0}}
@keyframes tw-fill-hold{0%,96%{opacity:1}100%{opacity:0}}
@keyframes tw-swap-in-late{0%,96%{opacity:0}100%{opacity:1}}
.twm.play-draw [data-draw-plain]{animation:tw-swap-in-late 1600ms linear both}
.twm.play-draw [data-draw-masked]{animation:tw-sketch 1600ms linear both}
.twm.play-draw [data-draw-fill]{animation:tw-fill-hold 1600ms linear both}
.twm.play-light [data-light]{animation:tw-light 1300ms cubic-bezier(.45,0,.25,1) both}
.twm.play-brick [data-brick-plain]{animation:tw-swap-in 980ms linear both}
.twm.play-brick [data-brick-masked]{animation:tw-swap-out 980ms linear both}
.twm [data-parts]{opacity:0}
.twm.play-placed [data-parts],.twm.play-build [data-parts],.twm.play-ident [data-parts],.twm.play-blink [data-parts],.twm.play-loop [data-parts]{opacity:1}
.twm.play-placed [data-rest],.twm.play-build [data-rest],.twm.play-ident [data-rest],.twm.play-blink [data-rest],.twm.play-loop [data-rest]{opacity:0}
@media (prefers-reduced-motion: reduce){.twm *{animation:none !important;transition:none !important}}
`;

const REVEAL_CLASS: Record<TowerReveal, string> = { draw: "play-draw", brick: "play-brick", castle: "play-castle", placed: "play-placed", build: "play-build" };
const SESSION_KEY = "rempire-tower-revealed";
let cssMounted = false;

function reducedMotion() {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// CSS animations do not tick inside a <mask> subtree — the draw strokes and brick rects are
// driven by rAF attribute writes instead (attribute mutation reliably invalidates the mask).
function runMask(root: SVGSVGElement, kind: "draw" | "brick") {
  const T = kind === "draw" ? 1600 : 980;
  const s1 = root.querySelectorAll("[data-draw-s1]"), s2 = root.querySelectorAll("[data-draw-s2]"), bricks = root.querySelectorAll("[data-brick]");
  const fills = root.querySelectorAll("[data-draw-fill-rect]");
  if (kind === "draw") {
    s1.forEach(n => n.setAttribute("stroke-dashoffset", "1000"));
    s2.forEach(n => n.setAttribute("stroke-dashoffset", "1000"));
    fills.forEach(n => { n.setAttribute("y", "592"); n.setAttribute("height", "0"); });
  }
  const t0 = performance.now();
  const step = () => {
    const t = performance.now() - t0;
    if (kind === "draw") {
      const p1 = Math.min(1, t / (T * 0.42)), p2 = Math.max(0, Math.min(1, (t - T * 0.42) / (T * 0.20)));
      s1.forEach(n => n.setAttribute("stroke-dashoffset", String(1000 * (1 - p1))));
      s2.forEach(n => n.setAttribute("stroke-dashoffset", String(1000 * (1 - p2))));
      const pf = Math.max(0, Math.min(1, (t - T * 0.60) / (T * 0.40))), ef = 1 - Math.pow(1 - pf, 3);
      fills.forEach(n => { const y = 592 - 462 * ef; n.setAttribute("y", String(y)); n.setAttribute("height", String(618 - y)); });
    } else {
      bricks.forEach(n => {
        const p = Math.max(0, Math.min(1, (t - (+(n.getAttribute("data-d") || 0))) / 240));
        const e = 1 - (1 - p) * (1 - p);
        n.setAttribute("opacity", String(e));
        n.setAttribute("transform", `translate(0 ${-16 * (1 - e)})`);
      });
    }
    if (t < T) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const TowerAnimated = forwardRef<TowerAnimatedHandle, TowerAnimatedProps>(function TowerAnimated(
  { className, variant = "none", reveal = "build", identOnClick = false, lightPass = false, title = "REMPIRE tower" },
  ref
) {
  const uid = useRef(`tw${Math.random().toString(36).slice(2, 8)}`).current;
  const el = useRef<SVGSVGElement>(null);
  const [mountCss] = useState(() => { const first = !cssMounted; cssMounted = true; return first; });

  const strip = () => el.current?.classList.remove("play-castle", "play-placed", "play-build", "play-blink", "play-ident", "play-draw", "play-brick", "play-light");
  const stripT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fire = (cls: string) => {
    const n = el.current;
    if (!n || reducedMotion()) return;
    strip();
    clearTimeout(stripT.current);
    void n.getBoundingClientRect(); // restartable
    n.classList.add(cls);
    if (cls === "play-draw") runMask(n, "draw");
    if (cls === "play-brick") runMask(n, "brick");
    stripT.current = setTimeout(strip, 1800); // back to the canonical rest node
  };

  useImperativeHandle(ref, () => ({ ident: () => fire("play-ident") }));

  // Reveal — once per session, attached after hydration; server markup is the rest pose (CLS 0).
  useEffect(() => {
    if (variant !== "reveal" || reducedMotion()) return;
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch { /* still reveal without storage */ }
    fire(REVEAL_CLASS[reveal]);
    if (reveal === "build" && lightPass) {
      const t = setTimeout(() => fire("play-light"), 1320);
      return () => clearTimeout(t);
    }
  }, [variant, reveal, lightPass]);

  // Idle — rare sentry blink: randomized 6–9s, suppressed on hidden tab and reduced motion (skipped, not shortened).
  useEffect(() => {
    if (variant !== "idle") return;
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      t = setTimeout(() => {
        if (!document.hidden && !reducedMotion()) fire("play-blink");
        arm();
      }, 6000 + Math.random() * 3000);
    };
    const vis = () => { clearTimeout(t); if (!document.hidden) arm(); };
    arm();
    document.addEventListener("visibilitychange", vis);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", vis); };
  }, [variant]);

  // Loop — 2s period; on exit, finish the current iteration so we stop on the rest pose.
  useEffect(() => {
    const n = el.current;
    if (!n) return;
    if (variant === "loop") {
      if (!reducedMotion()) n.classList.add("play-loop");
      return () => {
        const m = n.querySelector('[data-merlon="1"]');
        const done = () => n.classList.remove("play-loop");
        if (!m || reducedMotion()) return done();
        const h = () => { m.removeEventListener("animationiteration", h); done(); };
        m.addEventListener("animationiteration", h);
        setTimeout(() => { m.removeEventListener("animationiteration", h); done(); }, 2200);
      };
    }
  }, [variant]);

  const use = <use href={`#${uid}-p`} />;
  return (
    <svg
      ref={el}
      className={`twm${className ? ` ${className}` : ""}`}
      viewBox={VB}
      fill="currentColor"
      role="img"
      aria-label={title}
      style={{ overflow: "visible" }}
      onClick={identOnClick ? () => fire("play-ident") : undefined}
    >
      {mountCss && <style>{CSS}</style>}
      <defs>
        <path id={`${uid}-p`} fill="currentColor" d={D} />
        {Object.entries(CLIPS).map(([k, d]) => (
          <clipPath id={`${uid}-${k}`} key={k}>
            <path clipRule="evenodd" d={d} />
          </clipPath>
        ))}
        {reveal === "draw" && variant === "reveal" && (
          <mask id={`${uid}-dm`} maskUnits="userSpaceOnUse" x="240" y="130" width="360" height="480">
            <path data-draw-s1 d={DRAW_BODY} pathLength={1000} fill="none" stroke="#fff" strokeWidth={30} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={1000} />
            <path data-draw-s2 d={DRAW_CROWN} pathLength={1000} fill="none" stroke="#fff" strokeWidth={30} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={1000} />
          </mask>
        )}
        {reveal === "draw" && variant === "reveal" && (
          <mask id={`${uid}-df`} maskUnits="userSpaceOnUse" x="240" y="130" width="360" height="480">
            <rect data-draw-fill-rect x="240" y="130" width="360" height="480" fill="#fff" />
          </mask>
        )}
        {lightPass && <clipPath id={`${uid}-full`}><path d={D} /></clipPath>}
        {reveal === "brick" && variant === "reveal" && (
          <mask id={`${uid}-bm`} maskUnits="userSpaceOnUse" x="240" y="130" width="360" height="480">
            {BRICKS.map((b, i) => (
              <rect key={i} data-brick data-d={b.d} x={b.x} y={b.y} width={64} height={30} fill="#fff" />
            ))}
          </mask>
        )}
      </defs>
      <g data-draw-plain data-brick-plain>
      <g data-mark>
        <g data-parts>
        <g data-crown>
          <g data-merlon="1" clipPath={`url(#${uid}-m1)`}>{use}</g>
          <g data-merlon="2" clipPath={`url(#${uid}-m2)`}>{use}</g>
          <g data-merlon="3" clipPath={`url(#${uid}-m3)`}>{use}</g>
          <g data-flare clipPath={`url(#${uid}-fl)`}>{use}</g>
          <g data-band clipPath={`url(#${uid}-bd)`}>{use}</g>
        </g>
        <g data-body clipPath={`url(#${uid}-by)`}>{use}</g>
        </g>
        <g data-rest>{use}</g>
      </g>
      </g>
      {reveal === "draw" && variant === "reveal" && (
        <g data-draw-masked mask={`url(#${uid}-dm)`} style={{ opacity: 0 }}>{use}</g>
      )}
      {reveal === "draw" && variant === "reveal" && (
        <g data-draw-fill mask={`url(#${uid}-df)`} style={{ opacity: 0 }}>{use}</g>
      )}
      {lightPass && (
        <g clipPath={`url(#${uid}-full)`}>
          <rect data-light x="240" y="590" width="360" height="150" fill="#fdfcf9" opacity="0" />
        </g>
      )}
      {reveal === "brick" && variant === "reveal" && (
        <g data-brick-masked mask={`url(#${uid}-bm)`} style={{ opacity: 0 }}>{use}</g>
      )}
    </svg>
  );
});

export default TowerAnimated;
