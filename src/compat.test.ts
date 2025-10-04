import { describe, expect, test } from "bun:test";
import {
  envelopeV1FromV2,
  envelopeV2FromV1,
  isRouteV1Candidate,
  isRouteV2Candidate,
  normalizeEnvelopeV2,
  normalizeRouteV2,
  routeV1FromV2,
  routeV2FromV1,
} from "./compat";
import { createEnvelopeV1, createEnvelopeV2, RouteV1, RouteV2 } from "./event";

describe("route compatibility", () => {
  test("routeV2FromV1 transforms legacy flags", () => {
    const routeV1: RouteV1 = {
      id: 7,
      matchers: ["/path"],
      endpoints: ["http://backend"],
      disabled: true,
      priority: 10,
      handshake: "HAProxy",
      override_query: true,
    };

    const converted = routeV2FromV1(routeV1, 3);

    expect(converted.flags).toBe(13);
    expect(converted.zone).toBe(3);
    expect(converted.matchers).toEqual(routeV1.matchers);
    expect(converted.matchers).not.toBe(routeV1.matchers);
  });

  test("routeV1FromV2 recovers handshake and booleans", () => {
    const routeV2: RouteV2 = normalizeRouteV2({
      id: 9,
      zone: 1,
      priority: 2,
      flags: ["Disabled", "CacheQuery"],
      matchers: ["/"],
      endpoints: ["s1"],
    });

    const legacy = routeV1FromV2(routeV2);

    expect(legacy.disabled).toBe(true);
    expect(legacy.override_query).toBe(false);
    expect(legacy.handshake).toBe("Vanilla");
  });
});

describe("envelope compatibility", () => {
  test("normalizeEnvelopeV2 clones list route payload", () => {
    const route: RouteV2 = {
      id: 1,
      zone: 0,
      priority: 0,
      flags: 0,
      matchers: ["/api"],
      endpoints: ["edge"],
    };

    const envelope = createEnvelopeV2("ListRouteResponse", { _v: [route] });
    const normalized = normalizeEnvelopeV2(envelope);

    expect(normalized).not.toBe(envelope);
    expect(normalized._v[0].matchers).toEqual(route.matchers);
    expect(normalized._v[0].matchers).not.toBe(route.matchers);
  });

  test("envelope conversions round-trip between versions", () => {
    const route: RouteV1 = {
      id: 11,
      matchers: ["/compat"],
      endpoints: ["route"],
      disabled: false,
      priority: 5,
      handshake: "Vanilla",
      override_query: true,
    };

    const v1Envelope = createEnvelopeV1("SetRoute", route);
    const toV2 = envelopeV2FromV1(v1Envelope);
    const roundTrip = envelopeV1FromV2(toV2);

    expect(isRouteV2Candidate(toV2)).toBe(true);
    expect(isRouteV1Candidate(roundTrip)).toBe(true);
    expect(roundTrip._c).toBe("SetRoute");
    expect(roundTrip.matchers).toEqual(route.matchers);
  });
});
