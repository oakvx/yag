import { useEffect, useState, type CSSProperties } from "react";

interface Spark {
  id: number;
  angle: number;
  distance: number;
}

interface Burst {
  id: number;
  x: number;
  y: number;
  sparks: Spark[];
}

export function emitBurst(x: number, y: number) {
  window.dispatchEvent(new CustomEvent("yag:burst", { detail: { x, y } }));
}

export function ParticleBurst() {
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(() => {
    let nextId = 0;
    const handler = (event: Event) => {
      const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail;
      const id = ++nextId;
      const count = 12;
      const sparks: Spark[] = Array.from({ length: count }, (_, i) => ({
        id: i,
        angle: (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.45,
        distance: 24 + Math.random() * 40,
      }));
      setBursts((prev) => [...prev, { id, x, y, sparks }]);
      window.setTimeout(() => {
        setBursts((prev) => prev.filter((b) => b.id !== id));
      }, 550);
    };

    window.addEventListener("yag:burst", handler);
    return () => window.removeEventListener("yag:burst", handler);
  }, []);

  if (bursts.length === 0) return null;

  return (
    <div className="xmb-burst-container" aria-hidden="true">
      {bursts.map((burst) => (
        <div
          key={burst.id}
          className="xmb-burst"
          style={{ left: burst.x, top: burst.y }}
        >
          {burst.sparks.map((spark) => (
            <span
              key={spark.id}
              className="xmb-spark"
              style={{
                "--spark-x": `${Math.cos(spark.angle) * spark.distance}px`,
                "--spark-y": `${Math.sin(spark.angle) * spark.distance}px`,
              } as CSSProperties}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
