import createAccelerator from "json-accelerator";
import { Static, TSchema, Type } from "@sinclair/typebox";

type RouteFlagName = "Disabled" | "CacheQuery" | "OverrideQuery" | "ProxyProtocol";

const ROUTE_FLAG_BITS: Record<RouteFlagName, number> = {
  Disabled: 1 << 0,
  CacheQuery: 1 << 1,
  OverrideQuery: 1 << 2,
  ProxyProtocol: 1 << 3,
};

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
    Type.Composite([Type.Object({ _c: Type.Literal(name) }), schema], { title: name }),
  );
  return Type.Union(entries, { title: "RPC Envelope" });
}

type EnvelopeOf<T extends CommandsMap> = Static<ReturnType<typeof schemaFor<T>>>;

type EnvelopeFactoryResult<T extends CommandsMap> = {
  schema: ReturnType<typeof schemaFor<T>>;
  create: <K extends keyof T>(command: K, payload: Static<T[K]>) => EnvelopeOf<T>;
  encode: (envelope: EnvelopeOf<T>) => string;
};

function buildEnvelope<T extends CommandsMap>(commands: T): EnvelopeFactoryResult<T> {
  const schema = schemaFor(commands);
  const encoder = createAccelerator(schema);
  return {
    schema,
    create: <K extends keyof T>(command: K, payload: Static<T[K]>) =>
      ({ _c: command, ...(payload as Record<string, unknown>) } as EnvelopeOf<T>),
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

function flagsToBits(flags: RouteV2["flags"]): number {
  if (Array.isArray(flags)) {
    return flags.reduce((bits, flag) => bits | ROUTE_FLAG_BITS[flag], 0);
  }
  return Number(flags ?? 0);
}

function hasFlag(bits: number, flag: RouteFlagName): boolean {
  return (bits & ROUTE_FLAG_BITS[flag]) !== 0;
}

export function normalizeRouteV2(route: RouteV2): RouteV2 {
  return {
    ...route,
    flags: flagsToBits(route.flags),
    matchers: [...route.matchers],
    endpoints: [...route.endpoints],
  };
}

export function routeV2FromV1(route: RouteV1, zone: number = 0): RouteV2 {
  let flags = 0;
  if (route.disabled) {
    flags |= ROUTE_FLAG_BITS.Disabled;
  }
  if (route.override_query) {
    flags |= ROUTE_FLAG_BITS.OverrideQuery;
  }
  if (route.handshake === "HAProxy") {
    flags |= ROUTE_FLAG_BITS.ProxyProtocol;
  }
  return normalizeRouteV2({
    id: route.id,
    zone,
    priority: route.priority,
    flags,
    matchers: route.matchers,
    endpoints: route.endpoints,
  });
}

export function routeV1FromV2(route: RouteV2): RouteV1 {
  const flags = flagsToBits(route.flags);
  return {
    id: route.id,
    matchers: [...route.matchers],
    endpoints: [...route.endpoints],
    disabled: hasFlag(flags, "Disabled"),
    priority: route.priority,
    handshake: hasFlag(flags, "ProxyProtocol") ? "HAProxy" : "Vanilla",
    override_query: hasFlag(flags, "OverrideQuery"),
  };
}

export function envelopeV2FromV1(envelope: EnvelopeV1): EnvelopeV2 {
  switch (envelope._c) {
    case "SetRoute":
      return createEnvelopeV2("SetRoute", routeV2FromV1(envelope));
    case "ListRouteResponse":
      return createEnvelopeV2("ListRouteResponse", {
        _v: envelope._v.map((route) => routeV2FromV1(route)),
      });
    case "Hello":
    case "FlushRoute":
    case "ListRouteRequest":
      return createEnvelopeV2(envelope._c, {});
    case "RemoveRoute":
      return createEnvelopeV2("RemoveRoute", { id: envelope.id });
    case "HandshakeRoute":
      return createEnvelopeV2("HandshakeRoute", { active: envelope.active });
    case "HandshakeIdent":
      return createEnvelopeV2("HandshakeIdent", { id: envelope.id });
    default:
      throw new Error(`Unsupported v1 envelope ${(envelope as { _c: string })._c}`);
  }
}

export function envelopeV1FromV2(envelope: EnvelopeV2): EnvelopeV1 {
  switch (envelope._c) {
    case "SetRoute":
      return createEnvelopeV1("SetRoute", routeV1FromV2(envelope));
    case "ListRouteResponse":
      return createEnvelopeV1("ListRouteResponse", {
        _v: envelope._v.map((route) => routeV1FromV2(route)),
      });
    case "Hello":
    case "FlushRoute":
    case "ListRouteRequest":
      return createEnvelopeV1(envelope._c, {});
    case "RemoveRoute":
      return createEnvelopeV1("RemoveRoute", { id: envelope.id });
    case "HandshakeRoute":
      return createEnvelopeV1("HandshakeRoute", { active: envelope.active });
    case "HandshakeIdent":
      return createEnvelopeV1("HandshakeIdent", { id: envelope.id });
    default:
      throw new Error(`Unsupported v2 envelope ${(envelope as { _c: string })._c}`);
  }
}

export function isRouteV2Candidate(value: unknown): value is RouteV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    "zone" in value &&
    "flags" in value &&
    "matchers" in value
  );
}

export function isRouteV1Candidate(value: unknown): value is RouteV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    "handshake" in value &&
    "override_query" in value
  );
}

export function normalizeEnvelopeV2(envelope: EnvelopeV2): EnvelopeV2 {
  switch (envelope._c) {
    case "SetRoute":
      return createEnvelopeV2("SetRoute", normalizeRouteV2(envelope));
    case "ListRouteResponse":
      return createEnvelopeV2("ListRouteResponse", {
        _v: envelope._v.map((route) => normalizeRouteV2(route)),
      });
    default:
      return envelope;
  }
}

export type IRoute = RouteV2;
export type IRouteV1 = RouteV1;
export type IRouteV2 = RouteV2;

export function envelope<K extends keyof CommandsV2>(
  c: K,
  v: Static<CommandsV2[K]>,
): string {
  return encodeEnvelopeV2(createEnvelopeV2(c, v));
}
