import { createEnvelopeV1, createEnvelopeV2 } from "./event";
import type {
  EnvelopeV1,
  EnvelopeV2,
  RouteFlagName,
  RouteV1,
  RouteV2,
} from "./event";

const ROUTE_FLAG_BITS: Record<RouteFlagName, number> = {
  Disabled: 1 << 0,
  CacheQuery: 1 << 1,
  OverrideQuery: 1 << 2,
  ProxyProtocol: 1 << 3,
};

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
      throw new Error(
        `Unsupported v1 envelope ${(envelope as { _c: string })._c}`,
      );
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
      throw new Error(
        `Unsupported v2 envelope ${(envelope as { _c: string })._c}`,
      );
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
