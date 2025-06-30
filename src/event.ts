import createAccelerator from "json-accelerator";
import { type Static, Type } from "@sinclair/typebox";

// Route schema
const SetRoute = Type.Object({
  id: Type.Integer(),
  matchers: Type.Array(Type.String()),
  endpoints: Type.Array(Type.String()),
  disabled: Type.Boolean(),
  priority: Type.Integer(),
  handshake: Type.Union([Type.Literal("Vanilla"), Type.Literal("HAProxy")]),
});

// RemoveRoute schema
const RemoveRoute = Type.Object({
  id: Type.Integer(),
});

// FlushRoute schema
const Empty = Type.Object({}, { additionalProperties: false });

const HandshakeRoute = Type.Object(
  {
    active: Type.Integer(),
  },
  { additionalProperties: false },
);

const HandshakeIdent = Type.Object({
  id: Type.String(),
});

const Commands = {
  Hello: Empty,
  FlushRoute: Empty,
  SetRoute,
  RemoveRoute,
  HandshakeRoute,
  HandshakeIdent,
} as const;

// Envelope: discriminated union based on _c field
export const Envelope = Type.Union(
  [
    Type.Intersect([Type.Object({ _c: Type.Literal("Hello") })], {
      title: "Hello",
    }),
    Type.Intersect([Type.Object({ _c: Type.Literal("SetRoute") }), SetRoute], {
      title: "SetRoute",
    }),
    Type.Intersect(
      [Type.Object({ _c: Type.Literal("RemoveRoute") }), RemoveRoute],
      {
        title: "RemoveRoute",
      },
    ),
    Type.Intersect([Type.Object({ _c: Type.Literal("FlushRoute") })], {
      title: "FlushRoute",
    }),
    Type.Intersect(
      [Type.Object({ _c: Type.Literal("HandshakeRoute") }), HandshakeRoute],
      {
        title: "HandshakeRoute",
      },
    ),
    Type.Intersect(
      [Type.Object({ _c: Type.Literal("HandshakeIdent") }), HandshakeIdent],
      {
        title: "HandshakeIdent",
      },
    ),
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
