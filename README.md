# Elysia with Bun runtime

## Development
To start the development server run:
```bash
bun run dev
```

Open http://localhost:3000/ with your browser to see the result.

## Building a Static Binary

Compile the service into a standalone Bun binary:

```bash
bun run build
```

The binary is written to `dist/Lucky` and can be copied straight into minimal container images or executed on compatible Linux hosts.

## Container Image (rootless Podman)

Build a scratch-based container image that embeds the static binary:

```bash
podman build -t lucky:static .
```

Run the container using rootless Podman:

```bash
podman run --rm -p 3000:3000 lucky:static
```

When you are done, remove the image to keep the local registry clean:

```bash
podman rmi lucky:static
```
