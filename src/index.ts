import { Elysia, t } from "elysia";
import { swagger } from "@elysiajs/swagger";
import {
  EnvelopeV1,
  EnvelopeV2,
  createEnvelopeV2,
  encodeEnvelopeV1,
  encodeEnvelopeV2,
  envelopeV1FromV2,
  envelopeV2FromV1,
  isRouteV1Candidate,
  isRouteV2Candidate,
  normalizeEnvelopeV2,
  normalizeRouteV2,
  RouteV2,
  routeV2FromV1,
} from "./event";
import { TTLFIFOQueue } from "./spmc_ttlfifo";
import process from "node:process";

type ProducerItem = [string, EnvelopeV2];

const producer = new TTLFIFOQueue<ProducerItem>(1000);

const delay = (delayInms: number) => new Promise((resolve) => setTimeout(resolve, delayInms));

const EMPTY_STRING = "";
const HEARTBEAT_SECONDS = 5;
const POLL_DELAY_MS = 10;

let time = 0;
setInterval(async () => {
  time = process.uptime();
}, 500);

let defaultRoutes: RouteV2[] = [];

if (await Bun.file("./default_routes.json").exists()) {
  const file = Bun.file("./default_routes.json");
  const json = await file.json();
  defaultRoutes = extractRoutes(json);
}

function extractRoutes(value: unknown): RouteV2[] {
  const sourceArray = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null && Array.isArray((value as { _v?: unknown[] })._v)
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

function bootstrapInstance(instance: string) {
  enqueue(instance, createEnvelopeV2("Hello", {}));
  defaultRoutes.forEach((route) => {
    enqueue(instance, createEnvelopeV2("SetRoute", route));
  });
}

function respondWithRouteList(instance: string) {
  enqueue(
    instance,
    createEnvelopeV2("ListRouteResponse", {
      _v: defaultRoutes.map((route) => normalizeRouteV2(route)),
    }),
  );
}

function handleIncomingEnvelope(instance: string, envelope: EnvelopeV2) {
  switch (envelope._c) {
    case "Hello":
    case "HandshakeIdent":
      bootstrapInstance(instance);
      return { ok: true, msg: "I sent hi" } as const;
    case "ListRouteRequest":
      respondWithRouteList(instance);
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
  return async function* ({ set, params }: { set: any; params: { instance: string } }) {
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
  .get(
    "/api/v1/lure/:instance",
    makeStreamHandler(encodeForV1),
    {
      params: t.Object({
        instance: t.String(),
      }),
    },
  )
  .get(
    "/api/v2/lure/:instance",
    makeStreamHandler(encodeForV2),
    {
      params: t.Object({
        instance: t.String(),
      }),
    },
  )
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
  )
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
