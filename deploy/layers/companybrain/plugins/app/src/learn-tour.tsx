import { CaretLeft, CaretRight, Pause, Play } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { hudPalette } from "./graph-scene";
import { paint, SCENES } from "./learn-scenes";
import { EASE, injectCss, useReducedMotion, useWidth } from "./shared";
import { Eyebrow, IconButton, tokens, usePal } from "./ui";

injectCss(
  "cb-learn-tour",
  `
  .cb-tour-stage { position: relative; background: #04090a; }
  .cb-tour-stage canvas { display: block; width: 100%; }
  .cb-tour-top { position: absolute; top: 14px; left: 14px; right: 16px; display: flex; justify-content: space-between; align-items: center; pointer-events: none; }
  .cb-tour-count { font: 500 11px/1 ${tokens.font.mono}; letter-spacing: 0.08em; color: rgba(214,236,231,0.66); font-variant-numeric: tabular-nums; }
  .cb-tour-foot { container-type: inline-size; display: flex; flex-direction: column; gap: 16px; padding: 18px 20px 18px; border-top: 1px solid rgba(45,212,180,0.14); }
  .cb-tour-caps { display: grid; }
  .cb-tour-cap { grid-area: 1 / 1; display: flex; flex-direction: column; gap: 6px; opacity: 0; transform: translateY(4px); transition: opacity 260ms ${EASE}, transform 260ms ${EASE}; }
  .cb-tour-cap[data-on="true"] { opacity: 1; transform: none; }
  .cb-tour-cap h3 { margin: 0; font-size: 17px; line-height: 1.3; font-weight: 600; letter-spacing: -0.015em; color: #f4f4f6; text-wrap: balance; }
  .cb-tour-cap p { margin: 0; font-size: 13.5px; line-height: 1.6; color: rgba(244,244,246,0.74); max-width: 64ch; text-wrap: pretty; }
  .cb-tour-nav { display: flex; align-items: center; gap: 14px; }
  .cb-tour-chapters { flex: 1; min-width: 0; display: grid; grid-template-columns: repeat(${SCENES.length}, minmax(0, 1fr)); gap: 6px; }
  .cb-tour-chapter { all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; gap: 8px; padding: 8px 2px; min-width: 0; font-size: 11.5px; font-weight: 500; color: rgba(244,244,246,0.52); transition: color 200ms ${EASE}; }
  .cb-tour-chapter[aria-current="step"] { color: #f4f4f6; }
  .cb-tour-chapter:focus-visible { outline: 2px solid #5eeab0; outline-offset: 2px; border-radius: 6px; }
  .cb-tour-chapter > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (hover: hover) and (pointer: fine) { .cb-tour-chapter:hover { color: #f4f4f6; } }
  .cb-tour-track { display: block; height: 3px; border-radius: 999px; background: rgba(255,255,255,0.09); overflow: hidden; }
  .cb-tour-fill { display: block; height: 100%; border-radius: 999px; background: #5eeab0; box-shadow: 0 0 10px rgba(94,234,176,0.6); transform-origin: left center; transform: scaleX(0); }
  .cb-tour-buttons { display: flex; gap: 6px; flex-shrink: 0; }
  @container (max-width: 470px) { .cb-tour-chapter > span:last-child { display: none; } .cb-tour-chapter { padding: 12px 0; } }
  @media (prefers-reduced-motion: reduce) { .cb-tour-cap, .cb-tour-chapter { transition: none; } }
  `,
);

export function Tour(): JSX.Element {
  const pal = usePal();
  const hud = useMemo(() => hudPalette(pal), [pal]);
  const reduced = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const fills = useRef<Array<HTMLSpanElement | null>>([]);
  const elapsed = useRef(0);
  const width = useWidth(stage);
  const height = width < 560 ? 360 : 430;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(true);
  const scene = SCENES[index] ?? SCENES[0];
  const motion = !reduced;

  const go = (next: number): void => {
    elapsed.current = 0;
    setIndex((next + SCENES.length) % SCENES.length);
  };

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g || !scene || width <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const draw = (t: number): void => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(g, scene, { w: width, h: height, t, motion, hud });
    };
    const fill = (p: number): void =>
      fills.current.forEach((el, i) => {
        if (el) el.style.transform = `scaleX(${i < index && motion ? 1 : i === index ? p : 0})`;
      });

    if (!motion) {
      draw(scene.still);
      fill(1);
      let live = true;
      void document.fonts?.ready.then(() => live && draw(scene.still));
      return () => {
        live = false;
      };
    }

    draw(!playing && elapsed.current === 0 ? scene.still : elapsed.current);
    fill(elapsed.current / scene.dur);
    if (!playing || !visible) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      elapsed.current += Math.min(0.1, (now - last) / 1000);
      last = now;
      if (elapsed.current >= scene.dur) {
        elapsed.current = 0;
        setIndex((i) => (i + 1) % SCENES.length);
        return;
      }
      draw(elapsed.current);
      fill(elapsed.current / scene.dur);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scene, index, width, height, playing, visible, motion, hud]);

  const number = (n: number): string => String(n).padStart(2, "0");

  return (
    <section className="cb-bezel" aria-label="Capabilities tour">
      <div className="cb-core" style={{ padding: 0 }}>
        <div ref={stage} className="cb-tour-stage" style={{ height }}>
          <canvas ref={canvas} role="img" aria-label={`${scene?.title}. ${scene?.text}`} style={{ height }} />
          <div className="cb-tour-top" aria-hidden>
            <Eyebrow dot={pal.accent}>Capabilities tour</Eyebrow>
            <span className="cb-tour-count">{`${number(index + 1)} / ${number(SCENES.length)}`}</span>
          </div>
        </div>
        <div className="cb-tour-foot">
          <div className="cb-tour-caps" aria-live={playing && motion ? "off" : "polite"}>
            {SCENES.map((s, i) => (
              <div key={s.id} className="cb-tour-cap" data-on={i === index} aria-hidden={i !== index}>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
          <div className="cb-tour-nav">
            <div className="cb-tour-chapters" role="group" aria-label="Chapters">
              {SCENES.map((s, i) => (
                <button key={s.id} className="cb-tour-chapter" aria-current={i === index ? "step" : undefined} aria-label={s.label} onClick={() => go(i)}>
                  <span className="cb-tour-track">
                    <span
                      className="cb-tour-fill"
                      ref={(el) => {
                        fills.current[i] = el;
                      }}
                    />
                  </span>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
            <div className="cb-tour-buttons">
              <IconButton label="Previous chapter" size={34} icon={<CaretLeft size={14} weight="bold" />} onClick={() => go(index - 1)} />
              {motion ? (
                <IconButton label={playing ? "Pause the tour" : "Play the tour"} size={34} icon={playing ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />} onClick={() => setPlaying(!playing)} />
              ) : null}
              <IconButton label="Next chapter" size={34} icon={<CaretRight size={14} weight="bold" />} onClick={() => go(index + 1)} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
