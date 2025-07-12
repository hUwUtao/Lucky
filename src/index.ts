import { Elysia, t } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { Envelope, envelope, IRoute } from "./event";
import { TTLFIFOQueue } from "./spmc_ttlfifo";
import process from "node:process";

const producer = new TTLFIFOQueue<[string, string]>(1000);

const delay = (delayInms: number) => {
  return new Promise((resolve) => setTimeout(resolve, delayInms));
};

const EMPTY_STRING = "";

let time = 0;
setInterval(async () => {
  time = process.uptime();
}, 500);

let default_routes: IRoute[] = [];

if (await Bun.file("./default_routes.json").exists()) {
  const file = Bun.file("./default_routes.json");
  default_routes = await file.json();
}

const app = new Elysia()
  .use(swagger())
  .model({
    envelope: Envelope,
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
    async function* ({ set, params }) {
      const instance = params.instance || "";
      let pc = time + 5;
      set.headers["X-Accel-Buffering"] = "no";
      const consumer = producer.createConsumer();
      yield "1\n";
      while (true) {
        if (time > pc) {
          yield "0\n";
          pc = time + 5;
        }
        const ing = consumer.peek();
        if (ing) {
          if (ing[0] === instance) yield ing[1];
          consumer.seek();
        }
        yield EMPTY_STRING;
        delay(10);
      }
    },
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
      // console.log(body)
      if (
        body._c === "HandshakeIdent" ||
        // Lure will not send this. send {"_c":"Hello"} to broadcast
        body._c === "Hello"
      ) {
        producer.add([instance, envelope("Hello", {})]);
        default_routes.forEach((route) => {
          console.log(route);
          producer.add([instance, envelope("SetRoute", route)]);
        });
        return { ok: true, msg: "I sent hi" };
      }
      console.log(body);
      producer.add([instance, envelope(body._c, body)]);
      return { ok: true };
    },
    {
      params: t.Object({
        instance: t.String(),
      }),
      response: {
        200: "status",
      },
      body: "envelope",
    },
  )
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
