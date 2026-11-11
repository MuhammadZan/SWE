// System-design building blocks inserted as Excalidraw element skeletons.
export type Stencil = {
  key: string;
  label: string;
  shape: "rectangle" | "ellipse" | "diamond";
  bg: string;
  dashed?: boolean;
  width?: number;
  height?: number;
};

export const STENCILS: Stencil[] = [
  { key: "client", label: "Client", shape: "ellipse", bg: "#a5d8ff", width: 150, height: 70 },
  { key: "cdn", label: "CDN", shape: "rectangle", bg: "#d0bfff" },
  { key: "lb", label: "Load Balancer", shape: "diamond", bg: "#d0bfff", width: 180, height: 100 },
  { key: "gateway", label: "API Gateway", shape: "rectangle", bg: "#d0bfff" },
  { key: "service", label: "API Service", shape: "rectangle", bg: "#b2f2bb" },
  { key: "worker", label: "Worker", shape: "rectangle", bg: "#b2f2bb" },
  { key: "db", label: "Database", shape: "rectangle", bg: "#ffec99" },
  { key: "replica", label: "Read Replica", shape: "rectangle", bg: "#fff3bf" },
  { key: "cache", label: "Cache (Redis)", shape: "rectangle", bg: "#ffc9c9" },
  { key: "queue", label: "Queue", shape: "rectangle", bg: "#ffd8a8", width: 190, height: 56 },
  { key: "storage", label: "Object Storage", shape: "rectangle", bg: "#eebefa" },
  { key: "external", label: "External API", shape: "rectangle", bg: "#e9ecef", dashed: true },
  { key: "module", label: "Module / Layer", shape: "rectangle", bg: "#e7f5ff", width: 220, height: 90 },
  { key: "interface", label: "«interface»", shape: "rectangle", bg: "#ffffff", dashed: true },
];

export function stencilSkeleton(s: Stencil, x: number, y: number, id?: string) {
  const width = s.width ?? 170;
  const height = s.height ?? 70;
  return {
    id,
    type: s.shape,
    x: x - width / 2,
    y: y - height / 2,
    width,
    height,
    backgroundColor: s.bg,
    fillStyle: "solid",
    strokeColor: "#1e1e1e",
    strokeWidth: 1,
    strokeStyle: s.dashed ? "dashed" : "solid",
    roughness: 1,
    roundness: s.shape === "rectangle" ? { type: 3 } : null,
    label: { text: s.label, fontSize: 18 },
  };
}

const byKey = (k: string) => STENCILS.find((s) => s.key === k)!;

/** A baseline web architecture to start a design from. */
export function starterTemplate(cx: number, cy: number) {
  const at = (key: string, dx: number, dy: number, id: string, label?: string) => {
    const s = label ? { ...byKey(key), label } : byKey(key);
    return stencilSkeleton(s, cx + dx, cy + dy, id);
  };
  const arrow = (from: string, to: string, label?: string) => ({
    type: "arrow",
    x: 0,
    y: 0,
    strokeColor: "#1e1e1e",
    start: { id: from },
    end: { id: to },
    ...(label ? { label: { text: label, fontSize: 14 } } : {}),
  });
  return [
    at("client", -520, 0, "t-client", "Users"),
    at("lb", -260, 0, "t-lb"),
    at("service", 0, -90, "t-api1", "API #1"),
    at("service", 0, 90, "t-api2", "API #2"),
    at("cache", 280, -170, "t-cache"),
    at("db", 280, 0, "t-db", "Postgres (primary)"),
    at("queue", 280, 170, "t-queue"),
    at("worker", 540, 170, "t-worker"),
    arrow("t-client", "t-lb", "HTTPS"),
    arrow("t-lb", "t-api1"),
    arrow("t-lb", "t-api2"),
    arrow("t-api1", "t-cache"),
    arrow("t-api1", "t-db"),
    arrow("t-api2", "t-db"),
    arrow("t-api2", "t-queue", "enqueue"),
    arrow("t-queue", "t-worker", "consume"),
  ];
}
