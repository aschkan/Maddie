import { getConfig } from "@/lib/config";
import { upstreamBytes } from "@/lib/http/fetch";
import { allowedOrigins, isJsonContentType, publicOrigin, rewriteStyle, upstreamUrlFor } from "@/lib/map/proxy";

export const dynamic = "force-dynamic";

/**
 * The basemap, served through the app so a browser on a blocked network still
 * gets ground under the markers. The upstream is fixed in code; nothing about
 * the target ever comes from the request.
 */
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const config = getConfig();
  const { path } = await context.params;
  const url = new URL(request.url);
  const upstream = upstreamUrlFor(path, config.mapTilesUpstream, url.search);

  if (upstream === null) {
    return new Response(JSON.stringify({ error: "not-allowed", message: "That map path is not served here." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const response = await upstreamBytes(upstream, { timeoutMs: 15_000 });
    if (!response.ok) {
      // The upstream's status is passed through unchanged, with a body that
      // says which of the two it is: a tile that does not exist, or a tile
      // host this network cannot reach.
      return new Response(
        JSON.stringify({
          error: "upstream-status",
          status: response.status,
          message: `The tile host answered ${response.status}. The map is missing here, not empty.`,
        }),
        { status: response.status, headers: { "content-type": "application/json" } },
      );
    }

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";

    // Style documents and TileJSON come back through this same route, and get
    // the same treatment: every absolute URL inside is pointed back here.
    if (isJsonContentType(contentType)) {
      const document: unknown = JSON.parse(new TextDecoder().decode(response.bytes));
      // Absolute, not root-relative: MapLibre rejects a relative `sprite`
      // outright ("must be absolute") and draws the basemap without any of its
      // symbols. The origin comes from the forwarded headers, so it is the one
      // the browser actually used.
      const mount = `${publicOrigin(request.headers, url.origin)}/api/map`;
      const rewritten = rewriteStyle(document, allowedOrigins(config.mapTilesUpstream), mount);
      return new Response(JSON.stringify(rewritten), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          // 60s, not 600. This document now embeds an origin and its shape has
          // changed twice; pinning it for ten minutes means a fix is invisible
          // for ten minutes, on exactly the machine someone is setting up. The
          // style is one request per map load — the saving was never the point.
          "cache-control": "public, max-age=60",
          // The body now names an origin, so a shared cache must not hand a
          // document built for one host to a browser that asked on another.
          vary: "X-Forwarded-Host, X-Forwarded-Proto, Host",
          "access-control-allow-origin": "*",
        },
      });
    }

    return new Response(response.bytes as BodyInit, {
      status: 200,
      headers: {
        "content-type": contentType,
        // NOT content-encoding: undici has already decoded the body, so
        // passing the upstream's encoding header through would tell the
        // browser to decompress plain bytes.
        "cache-control": "public, max-age=86400, immutable",
        "access-control-allow-origin": "*",
      },
    });
  } catch {
    return new Response(
      JSON.stringify({
        error: "upstream-unreachable",
        message: "The map tiles could not be fetched. The map is missing, not empty.",
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
}
