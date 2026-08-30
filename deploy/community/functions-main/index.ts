// NodeSpec Community — edge-runtime main router (compose stack).
//
// The Supabase CLI provides this dispatcher implicitly; a raw edge-runtime
// container needs it as the --main-service. It spawns one user worker per
// function directory and forwards the request. Pattern mirrors the
// supabase/docker reference router; environment flows through so the
// functions see the same variables bootstrap's .env used to provide.
declare const EdgeRuntime: {
  userWorkers: {
    create(opts: {
      servicePath: string;
      memoryLimitMb: number;
      workerTimeoutMs: number;
      noModuleCache: boolean;
      importMapPath: string | null;
      envVars: Array<[string, string]>;
    }): Promise<{ fetch(req: Request): Promise<Response> }>;
  };
};

const FUNCTIONS_DIR = "/home/deno/functions";

Deno.serve(async (req: Request) => {
  const { pathname } = new URL(req.url);
  const serviceName = pathname.split("/")[1];

  if (!serviceName || serviceName === "main") {
    return new Response(
      JSON.stringify({ error: "missing function name in request path" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `${FUNCTIONS_DIR}/${serviceName}`,
      // The MCP server and generators legitimately run long.
      memoryLimitMb: 512,
      workerTimeoutMs: 5 * 60 * 1000,
      noModuleCache: false,
      importMapPath: null,
      envVars: Object.entries(Deno.env.toObject()),
    });
    return await worker.fetch(req);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ error: `function "${serviceName}" failed to start: ${message}` }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
