import createAccelerator from "json-accelerator";
import { type Static, type TSchema, Type } from "@sinclair/typebox";

// Route schema
const Route = Type.Object({
  id: Type.Integer(),
  matchers: Type.Array(Type.String()),
  endpoints: Type.Array(Type.String()),
  disabled: Type.Boolean(),
  priority: Type.Integer(),
  handshake: Type.Union([Type.Literal("Vanilla"), Type.Literal("HAProxy")]),
});

// FlushRoute schema
const Empty = Type.Object({});

function array<T extends TSchema>(t: T) {
  return Type.Object({
    _v: Type.Array(t),
  });
}

const Commands = {
  Hello: Empty,
  FlushRoute: Empty,
  SetRoute: Route,
  RemoveRoute: Type.Object({
    id: Type.Integer(),
  }),
  HandshakeRoute: Type.Object({
    active: Type.Integer(),
  }),
  HandshakeIdent: Type.Object({
    id: Type.String(),
  }),
  ListRouteRequest: Empty,
  ListRouteResponse: array(Route),
} as const;

/**
 * Type value macro to create typebox command entry
 * @param l type key from Commands
 */
function ctm<L extends keyof typeof Commands>(l: L) {
  return Type.Composite([Type.Object({ _c: Type.Literal(l) }), Commands[l]], {
    title: l,
  });
}

// Envelope: discriminated union based on _c field
export const Envelope = Type.Union(
  [
    ctm("Hello"),
    ctm("SetRoute"),
    ctm("FlushRoute"),
    ctm("RemoveRoute"),
    ctm("HandshakeRoute"),
    ctm("HandshakeIdent"),
    ctm("ListRouteRequest"),
    ctm("ListRouteResponse"),
  ],
  {
    title: "RPC Envelope",
    description:
      "The main schema to adapt with Lure's RPC system. Typesafe 100%.",
  },
);

export const encode = createAccelerator(Envelope);

export type Envelope = typeof Envelope.static;

export function envelope<T extends keyof typeof Commands>(
  c: T,
  v: Static<(typeof Commands)[T]>,
): string {
  // @ts-ignore
  v._c = c;
  // @ts-ignore
  return `${encode(v)}\n`;
}
