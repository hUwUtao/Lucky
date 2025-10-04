import { Elysia, t } from "elysia";
import { swagger } from "@elysiajs/swagger";
import {
  EnvelopeV1,
  EnvelopeV2,
  createEnvelopeV2,
  encodeEnvelopeV1,
  encodeEnvelopeV2,
  RouteV2,
} from "./event";
import {
  envelopeV1FromV2,
  envelopeV2FromV1,
  isRouteV1Candidate,
  isRouteV2Candidate,
  normalizeEnvelopeV2,
  normalizeRouteV2,
  routeV2FromV1,
} from "./compat";
import { TTLFIFOQueue } from "./spmc_ttlfifo";
import { FileConfigBackend } from "./file_config";
import process from "node:process";

type ProducerItem = [string, EnvelopeV2];

const producer = new TTLFIFOQueue<ProducerItem>(1000);

const delay = (delayInms: number) =>
  new Promise((resolve) => setTimeout(resolve, delayInms));

const EMPTY_STRING = "";
const HEARTBEAT_SECONDS = 5;
const POLL_DELAY_MS = 10;

let time = 0;
setInterval(() => {
  time = process.uptime();
}, 500);

const DEFAULT_ROUTES_PATH = "./default_routes.json";

const defaultRouteConfig = new FileConfigBackend<RouteV2[]>(
  DEFAULT_ROUTES_PATH,
  (value) => extractRoutes(value),
  () => [],
);

function extractRoutes(value: unknown): RouteV2[] {
  const sourceArray = Array.isArray(value)
    ? value
    : typeof value === "object" &&
        value !== null &&
        Array.isArray((value as { _v?: unknown[] })._v)
      ? (value as { _v: unknown[] })._v
      : [];

  const routes: RouteV2[] = [];
  for (const entry of sourceArray) {
    const route = toRouteV2(entry);
    if (route) {
      routes.push(route);
    }
  }
  return routes;
}

function toRouteV2(value: unknown): RouteV2 | null {
  if (isRouteV2Candidate(value)) {
    return normalizeRouteV2(value);
  }
  if (isRouteV1Candidate(value)) {
    return routeV2FromV1(value);
  }
  return null;
}

function enqueue(instance: string, envelope: EnvelopeV2) {
  producer.add([instance, normalizeEnvelopeV2(envelope)]);
}

async function bootstrapInstance(instance: string) {
  const routes = await defaultRouteConfig.snapshot();
  enqueue(instance, createEnvelopeV2("Hello", {}));
  for (const route of routes) {
    enqueue(instance, createEnvelopeV2("SetRoute", route));
  }
}

async function respondWithRouteList(instance: string) {
  const routes = await defaultRouteConfig.snapshot();
  enqueue(
    instance,
    createEnvelopeV2("ListRouteResponse", {
      _v: routes.map((route) => normalizeRouteV2(route)),
    }),
  );
}

async function handleIncomingEnvelope(instance: string, envelope: EnvelopeV2) {
  switch (envelope._c) {
    case "Hello":
    case "HandshakeIdent":
      await bootstrapInstance(instance);
      return { ok: true, msg: "I sent hi" } as const;
    case "ListRouteRequest":
      await respondWithRouteList(instance);
      return { ok: true } as const;
    default:
      enqueue(instance, envelope);
      return { ok: true } as const;
  }
}

type StreamEncoder = (envelope: EnvelopeV2) => string | null;

const encodeForV2: StreamEncoder = (envelope) => encodeEnvelopeV2(envelope);
const encodeForV1: StreamEncoder = (envelope) => {
  try {
    const legacy = envelopeV1FromV2(envelope);
    return encodeEnvelopeV1(legacy);
  } catch (error) {
    console.error("Failed to encode v1 envelope", error);
    return null;
  }
};

function makeStreamHandler(encoder: StreamEncoder) {
  return async function* ({
    set,
    params,
  }: {
    set: any;
    params: { instance: string };
  }) {
    const instance = params.instance || "";
    let heartbeatDeadline = time + HEARTBEAT_SECONDS;
    set.headers["X-Accel-Buffering"] = "no";
    set.headers["Content-Type"] = "text/event-stream";

    const consumer = producer.createConsumer();
    yield "1\n";

    while (true) {
      if (time > heartbeatDeadline) {
        yield "0\n";
        heartbeatDeadline = time + HEARTBEAT_SECONDS;
      }

      const item = consumer.peek();
      if (item) {
        const [target, rawEnvelope] = item;
        if (target === instance) {
          const encoded = encoder(normalizeEnvelopeV2(rawEnvelope));
          if (encoded) {
            yield encoded;
          }
        }
        consumer.seek();
        continue;
      }

      yield EMPTY_STRING;
      await delay(POLL_DELAY_MS);
    }
  };
}

const app = new Elysia()
  .use(swagger())
  .model({
    envelopeV1: EnvelopeV1,
    envelopeV2: EnvelopeV2,
    status: t.Object(
      {
        ok: t.Boolean(),
        msg: t.Optional(t.String()),
      },
      {
        title: "Status",
      },
    ),
  })
  .get("/api/v1/lure/:instance", makeStreamHandler(encodeForV1), {
    params: t.Object({
      instance: t.String(),
    }),
  })
  .get("/api/v2/lure/:instance", makeStreamHandler(encodeForV2), {
    params: t.Object({
      instance: t.String(),
    }),
  })
  .post(
    "/api/v1/lure/:instance",
    async ({ body, params }) => {
      const instance = params.instance || "";
      const canonical = normalizeEnvelopeV2(envelopeV2FromV1(body));
      return handleIncomingEnvelope(instance, canonical);
    },
    {
      params: t.Object({
        instance: t.String(),
      }),
      response: {
        200: "status",
      },
      body: "envelopeV1",
    },
  )
  .post(
    "/api/v2/lure/:instance",
    async ({ body, params }) => {
      const instance = params.instance || "";
      const canonical = normalizeEnvelopeV2(body);
      return handleIncomingEnvelope(instance, canonical);
    },
    {
      params: t.Object({
        instance: t.String(),
      }),
      response: {
        200: "status",
      },
      body: "envelopeV2",
    },
  );

function resolvePort(defaultPort = 3000): number {
  const raw = process.env.PORT ?? Bun.env?.PORT;
  const port = raw !== undefined ? Number(raw) : defaultPort;
  return Number.isFinite(port) ? port : defaultPort;
}

type StartServerOptions = {
  port?: number;
  log?: boolean;
};

function startServer(options: StartServerOptions = {}) {
  const port = options.port ?? resolvePort();
  defaultRouteConfig.preload();
  const instance = app.listen(port);
  if (options.log !== false) {
    console.log(
      `🦊 Elysia is running at ${instance.server?.hostname}:${instance.server?.port}`,
    );
  }
  return instance;
}

if (import.meta.main) {
  startServer();
}

export { app, resolvePort, startServer };
