import createAccelerator from "json-accelerator";
import { Static, TSchema, Type } from "@sinclair/typebox";

export type RouteFlagName =
  | "Disabled"
  | "CacheQuery"
  | "OverrideQuery"
  | "ProxyProtocol";

const Empty = Type.Object({});
const Id = Type.Object({ id: Type.Integer() });
const RouteReport = Type.Object({ active: Type.Integer() });
const HandshakeIdent = Type.Object({ id: Type.String() });

const RouteFlag = Type.Union([
  Type.Literal("Disabled"),
  Type.Literal("CacheQuery"),
  Type.Literal("OverrideQuery"),
  Type.Literal("ProxyProtocol"),
]);

const RouteFlagsV2 = Type.Union([
  Type.Integer({ minimum: 0 }),
  Type.Array(RouteFlag),
]);

export const RouteV2 = Type.Object({
  id: Type.Integer(),
  zone: Type.Integer({ minimum: 0 }),
  priority: Type.Integer(),
  flags: RouteFlagsV2,
  matchers: Type.Array(Type.String()),
  endpoints: Type.Array(Type.String()),
});
export type RouteV2 = Static<typeof RouteV2>;

export const RouteV1 = Type.Object({
  id: Type.Integer(),
  matchers: Type.Array(Type.String()),
  endpoints: Type.Array(Type.String()),
  disabled: Type.Boolean(),
  priority: Type.Integer(),
  handshake: Type.Union([Type.Literal("Vanilla"), Type.Literal("HAProxy")]),
  override_query: Type.Boolean(),
});
export type RouteV1 = Static<typeof RouteV1>;

function array<T extends TSchema>(schema: T) {
  return Type.Object({ _v: Type.Array(schema) });
}

const RouteListV2 = array(RouteV2);
const RouteListV1 = array(RouteV1);

type CommandsMap = Record<string, TSchema>;

function schemaFor<T extends CommandsMap>(commands: T) {
  const entries = Object.entries(commands).map(([name, schema]) =>
    Type.Composite([Type.Object({ _c: Type.Literal(name) }), schema], {
      title: name,
    }),
  );
  return Type.Union(entries, { title: "RPC Envelope" });
}

type EnvelopeOf<T extends CommandsMap> = Static<
  ReturnType<typeof schemaFor<T>>
>;

type EnvelopeFactoryResult<T extends CommandsMap> = {
  schema: ReturnType<typeof schemaFor<T>>;
  create: <K extends keyof T>(
    command: K,
    payload: Static<T[K]>,
  ) => EnvelopeOf<T>;
  encode: (envelope: EnvelopeOf<T>) => string;
};

function buildEnvelope<T extends CommandsMap>(
  commands: T,
): EnvelopeFactoryResult<T> {
  const schema = schemaFor(commands);
  const encoder = createAccelerator(schema);
  return {
    schema,
    create: <K extends keyof T>(command: K, payload: Static<T[K]>) =>
      ({
        _c: command,
        ...(payload as Record<string, unknown>),
      }) as EnvelopeOf<T>,
    encode: (envelope: EnvelopeOf<T>) => `${encoder(envelope)}\n`,
  };
}

const CommandsV2 = {
  Hello: Empty,
  FlushRoute: Empty,
  SetRoute: RouteV2,
  RemoveRoute: Id,
  HandshakeRoute: RouteReport,
  HandshakeIdent,
  ListRouteRequest: Empty,
  ListRouteResponse: RouteListV2,
} as const;

type CommandsV2 = typeof CommandsV2;

const CommandsV1 = {
  Hello: Empty,
  FlushRoute: Empty,
  SetRoute: RouteV1,
  RemoveRoute: Id,
  HandshakeRoute: RouteReport,
  HandshakeIdent,
  ListRouteRequest: Empty,
  ListRouteResponse: RouteListV1,
} as const;

type CommandsV1 = typeof CommandsV1;

const EnvelopeFactoryV2 = buildEnvelope(CommandsV2);
const EnvelopeFactoryV1 = buildEnvelope(CommandsV1);

export const EnvelopeV2 = EnvelopeFactoryV2.schema;
export type EnvelopeV2 = EnvelopeOf<CommandsV2>;
export const EnvelopeV1 = EnvelopeFactoryV1.schema;
export type EnvelopeV1 = EnvelopeOf<CommandsV1>;

export const Envelope = EnvelopeV2;
export type Envelope = EnvelopeV2;

export const encodeEnvelopeV2 = EnvelopeFactoryV2.encode;
export const encodeEnvelopeV1 = EnvelopeFactoryV1.encode;

export const createEnvelopeV2 = EnvelopeFactoryV2.create;
export const createEnvelopeV1 = EnvelopeFactoryV1.create;

export const encode = encodeEnvelopeV2;

export type IRoute = RouteV2;
export type IRouteV1 = RouteV1;
export type IRouteV2 = RouteV2;

export function envelope<K extends keyof CommandsV2>(
  c: K,
  v: Static<CommandsV2[K]>,
): string {
  return encodeEnvelopeV2(createEnvelopeV2(c, v));
}
