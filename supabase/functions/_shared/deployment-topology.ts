/**
 * Expanded deployment topology detection.
 * Detects serverless, PaaS, Kubernetes, and container patterns from infrastructure files.
 */

export interface DeploymentPattern {
  type: "container" | "serverless" | "paas" | "kubernetes";
  provider: string;
  configFile: string;
  services: string[];
  directories: string[];
  suggestedTarget: string;
  suggestedRoles: string[];
}

export interface DeploymentTopology {
  patterns: DeploymentPattern[];
  providerGuidance: string[];
}

interface FileInput {
  path: string;
  content: string;
}

interface CatalogDeploymentTarget {
  id: string;
  compatible_roles: string[];
}

interface CatalogProviderPattern {
  provider: string;
  archetype: string;
  guidance: string;
}

// ---------------------------------------------------------------------------
// Pattern matchers
// ---------------------------------------------------------------------------

function detectServerless(files: FileInput[]): DeploymentPattern[] {
  const patterns: DeploymentPattern[] = [];

  for (const f of files) {
    const filename = f.path.split("/").pop()?.toLowerCase() || "";
    const dir = f.path.split("/").slice(0, -1).join("/") || ".";

    // AWS SAM template
    if (
      (filename === "template.yaml" || filename === "template.yml") &&
      f.content.includes("AWS::Serverless")
    ) {
      const resources = extractSAMFunctions(f.content);
      patterns.push({
        type: "serverless",
        provider: "aws",
        configFile: f.path,
        services: resources.names,
        directories: resources.codePaths.length > 0 ? resources.codePaths : [dir],
        suggestedTarget: "serverless",
        suggestedRoles: ["backend-service", "rest-api", "worker"],
      });
    }

    // Serverless Framework
    if (filename === "serverless.yml" || filename === "serverless.ts" || filename === "serverless.yaml") {
      const provider = extractServerlessProvider(f.content);
      const functions = extractServerlessFunctions(f.content);
      patterns.push({
        type: "serverless",
        provider,
        configFile: f.path,
        services: functions,
        directories: [dir],
        suggestedTarget: "serverless",
        suggestedRoles: ["backend-service", "rest-api", "worker"],
      });
    }

    // Vercel
    if (filename === "vercel.json") {
      const hasApi = f.content.includes('"functions"') || f.content.includes('"rewrites"');
      patterns.push({
        type: "serverless",
        provider: "vercel",
        configFile: f.path,
        services: hasApi ? ["api-routes"] : ["static-site"],
        directories: [dir],
        suggestedTarget: hasApi ? "serverless" : "static-hosting",
        suggestedRoles: hasApi ? ["frontend-app", "rest-api"] : ["frontend-app", "static-site"],
      });
    }

    // CloudFlare Workers
    if (filename === "wrangler.toml") {
      const name = f.content.match(/name\s*=\s*"([^"]+)"/)?.[1] || "worker";
      const hasDO = f.content.includes("[durable_objects]");
      const hasD1 = f.content.includes("[[d1_databases]]");
      patterns.push({
        type: "serverless",
        provider: "cloudflare",
        configFile: f.path,
        services: [name, ...(hasDO ? ["durable-objects"] : []), ...(hasD1 ? ["d1-database"] : [])],
        directories: [dir],
        suggestedTarget: "edge",
        suggestedRoles: ["backend-service", "rest-api"],
      });
    }
  }

  return patterns;
}

function detectPaaS(files: FileInput[]): DeploymentPattern[] {
  const patterns: DeploymentPattern[] = [];

  for (const f of files) {
    const filename = f.path.split("/").pop()?.toLowerCase() || "";
    const dir = f.path.split("/").slice(0, -1).join("/") || ".";

    // Fly.io
    if (filename === "fly.toml") {
      const app = f.content.match(/app\s*=\s*"([^"]+)"/)?.[1] || "app";
      const hasHttp = f.content.includes("[http_service]") || f.content.includes("[[services]]");
      patterns.push({
        type: "paas",
        provider: "fly",
        configFile: f.path,
        services: [app],
        directories: [dir],
        suggestedTarget: "container",
        suggestedRoles: hasHttp ? ["backend-service", "rest-api"] : ["worker"],
      });
    }

    // Heroku / generic PaaS
    if (filename === "procfile") {
      const procs = extractProcfileProcesses(f.content);
      patterns.push({
        type: "paas",
        provider: "heroku",
        configFile: f.path,
        services: procs,
        directories: [dir],
        suggestedTarget: "container",
        suggestedRoles: procs.includes("web") ? ["backend-service", "rest-api"] : ["worker"],
      });
    }

    // Google App Engine
    if (filename === "app.yaml" || filename === "app.yml") {
      if (f.content.includes("runtime:") && !f.content.includes("AWS::")) {
        const runtime = f.content.match(/runtime:\s*(\S+)/)?.[1] || "unknown";
        patterns.push({
          type: "paas",
          provider: "gcp",
          configFile: f.path,
          services: [`appengine-${runtime}`],
          directories: [dir],
          suggestedTarget: "managed-cloud",
          suggestedRoles: ["backend-service", "rest-api"],
        });
      }
    }

    // Railway
    if (filename === "railway.json" || filename === "railway.toml") {
      patterns.push({
        type: "paas",
        provider: "railway",
        configFile: f.path,
        services: ["railway-service"],
        directories: [dir],
        suggestedTarget: "container",
        suggestedRoles: ["backend-service"],
      });
    }

    // Render
    if (filename === "render.yaml") {
      const services = extractRenderServices(f.content);
      patterns.push({
        type: "paas",
        provider: "render",
        configFile: f.path,
        services,
        directories: [dir],
        suggestedTarget: "container",
        suggestedRoles: ["backend-service", "rest-api", "worker"],
      });
    }
  }

  return patterns;
}

function detectKubernetes(files: FileInput[]): DeploymentPattern[] {
  const patterns: DeploymentPattern[] = [];
  const seenHelm = new Set<string>();

  for (const f of files) {
    const filename = f.path.split("/").pop()?.toLowerCase() || "";
    const dir = f.path.split("/").slice(0, -1).join("/") || ".";

    // Helm charts
    if (filename === "chart.yaml" || filename === "chart.yml") {
      const chartName = f.content.match(/name:\s*(\S+)/)?.[1] || "chart";
      seenHelm.add(dir);
      patterns.push({
        type: "kubernetes",
        provider: "kubernetes",
        configFile: f.path,
        services: [chartName],
        directories: [dir],
        suggestedTarget: "kubernetes-pod",
        suggestedRoles: ["backend-service", "worker"],
      });
    }

    // Raw K8s manifests
    if (
      (filename.endsWith(".yaml") || filename.endsWith(".yml")) &&
      !seenHelm.has(dir) &&
      isKubernetesManifest(f.content)
    ) {
      const kind = f.content.match(/kind:\s*(\S+)/)?.[1] || "Unknown";
      const name = f.content.match(/metadata:\s*\n\s+name:\s*(\S+)/)?.[1] || filename;
      const namespace = f.content.match(/namespace:\s*(\S+)/)?.[1];

      if (kind === "Deployment" || kind === "StatefulSet" || kind === "DaemonSet" || kind === "Job" || kind === "CronJob") {
        const image = f.content.match(/image:\s*['"]?([^\s'"]+)/)?.[1];
        patterns.push({
          type: "kubernetes",
          provider: "kubernetes",
          configFile: f.path,
          services: [namespace ? `${namespace}/${name}` : name],
          directories: [dir],
          suggestedTarget: "kubernetes-pod",
          suggestedRoles: inferK8sRoles(kind, f.content, image),
        });
      }
    }
  }

  return deduplicateK8sPatterns(patterns);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isKubernetesManifest(content: string): boolean {
  return (
    /apiVersion:\s*(apps\/v1|batch\/v1|v1)/.test(content) &&
    /kind:\s*(Deployment|Service|StatefulSet|DaemonSet|Job|CronJob|Ingress|ConfigMap)/.test(content)
  );
}

function inferK8sRoles(kind: string, content: string, image?: string): string[] {
  if (kind === "CronJob" || kind === "Job") return ["worker", "scheduler"];
  if (kind === "DaemonSet") return ["worker", "monitoring"];
  if (image) {
    if (/postgres|mysql|mariadb|mongo/i.test(image)) return ["database"];
    if (/redis|memcached/i.test(image)) return ["cache"];
    if (/kafka|rabbitmq|nats/i.test(image)) return ["message-broker"];
    if (/nginx|traefik|envoy|haproxy/i.test(image)) return ["backend-service", "rest-api"];
  }
  if (content.includes("containerPort") || content.includes("ports:")) {
    return ["backend-service", "rest-api"];
  }
  return ["backend-service", "worker"];
}

function extractSAMFunctions(content: string): { names: string[]; codePaths: string[] } {
  const names: string[] = [];
  const codePaths: string[] = [];
  const fnMatches = content.matchAll(/^\s{2}(\w+):\s*\n\s+Type:\s*AWS::Serverless::Function/gm);
  for (const m of fnMatches) {
    names.push(m[1]);
  }
  const codeUriMatches = content.matchAll(/CodeUri:\s*['"]?([^\s'"]+)/g);
  for (const m of codeUriMatches) {
    const p = m[1].replace(/^\.\//, "").replace(/\/+$/, "");
    if (p && p !== ".") codePaths.push(p);
  }
  return { names, codePaths: [...new Set(codePaths)] };
}

function extractServerlessProvider(content: string): string {
  if (content.includes("provider:")) {
    const match = content.match(/provider:\s*\n?\s*name:\s*(\w+)/);
    if (match) return match[1].toLowerCase();
    const inlineMatch = content.match(/provider:\s*(\w+)/);
    if (inlineMatch && !["name", "{"].includes(inlineMatch[1])) return inlineMatch[1].toLowerCase();
  }
  return "aws";
}

function extractServerlessFunctions(content: string): string[] {
  const fns: string[] = [];
  const matches = content.matchAll(/^\s{2}(\w[\w-]*):\s*$/gm);
  let inFunctions = false;
  for (const line of content.split("\n")) {
    if (/^functions:/.test(line)) { inFunctions = true; continue; }
    if (inFunctions && /^\S/.test(line)) break;
    if (inFunctions) {
      const m = line.match(/^\s{2}(\w[\w-]*):/);
      if (m) fns.push(m[1]);
    }
  }
  return fns.length > 0 ? fns : ["function"];
}

function extractProcfileProcesses(content: string): string[] {
  const procs: string[] = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^(\w+):/);
    if (m) procs.push(m[1]);
  }
  return procs.length > 0 ? procs : ["web"];
}

function extractRenderServices(content: string): string[] {
  const services: string[] = [];
  const matches = content.matchAll(/- type:\s*(\w+)\s*\n\s+name:\s*(\S+)/g);
  for (const m of matches) {
    services.push(m[2]);
  }
  return services.length > 0 ? services : ["service"];
}

function deduplicateK8sPatterns(patterns: DeploymentPattern[]): DeploymentPattern[] {
  const seen = new Map<string, DeploymentPattern>();
  for (const p of patterns) {
    const key = p.services[0];
    if (!seen.has(key)) {
      seen.set(key, p);
    }
  }
  return Array.from(seen.values());
}

// ---------------------------------------------------------------------------
// Cross-reference with catalog
// ---------------------------------------------------------------------------

function crossReferenceRoles(
  patterns: DeploymentPattern[],
  deploymentTargets: CatalogDeploymentTarget[],
): void {
  const targetMap = new Map(deploymentTargets.map((t) => [t.id, t.compatible_roles]));

  for (const pattern of patterns) {
    const compatibleRoles = targetMap.get(pattern.suggestedTarget);
    if (compatibleRoles) {
      pattern.suggestedRoles = pattern.suggestedRoles.filter((r) =>
        compatibleRoles.includes(r),
      );
      if (pattern.suggestedRoles.length === 0) {
        pattern.suggestedRoles = compatibleRoles.slice(0, 3);
      }
    }
  }
}

function selectProviderGuidance(
  patterns: DeploymentPattern[],
  providerPatterns: CatalogProviderPattern[],
): string[] {
  const detectedProviders = new Set(patterns.map((p) => p.provider));
  const guidance: string[] = [];

  for (const provider of detectedProviders) {
    if (provider === "kubernetes") continue;
    const match = providerPatterns.find(
      (pp) => pp.provider === provider && pp.archetype === "simple-web-app",
    ) || providerPatterns.find((pp) => pp.provider === provider);
    if (match) {
      guidance.push(match.guidance);
    }
  }

  return guidance;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function extractDeploymentTopology(
  files: FileInput[],
  deploymentTargets?: CatalogDeploymentTarget[],
  providerPatterns?: CatalogProviderPattern[],
): DeploymentTopology {
  const infraFiles = files.filter((f) => {
    const filename = f.path.split("/").pop()?.toLowerCase() || "";
    return (
      filename === "dockerfile" ||
      filename.startsWith("dockerfile.") ||
      filename.startsWith("docker-compose") ||
      filename === "template.yaml" ||
      filename === "template.yml" ||
      filename === "serverless.yml" ||
      filename === "serverless.yaml" ||
      filename === "serverless.ts" ||
      filename === "vercel.json" ||
      filename === "wrangler.toml" ||
      filename === "fly.toml" ||
      filename === "procfile" ||
      filename === "app.yaml" ||
      filename === "app.yml" ||
      filename === "railway.json" ||
      filename === "railway.toml" ||
      filename === "render.yaml" ||
      filename === "chart.yaml" ||
      filename === "chart.yml" ||
      filename.endsWith(".yaml") ||
      filename.endsWith(".yml")
    );
  });

  const serverless = detectServerless(infraFiles);
  const paas = detectPaaS(infraFiles);
  const kubernetes = detectKubernetes(infraFiles);
  const allPatterns = [...serverless, ...paas, ...kubernetes];

  if (deploymentTargets && deploymentTargets.length > 0) {
    crossReferenceRoles(allPatterns, deploymentTargets);
  }

  const providerGuidance = providerPatterns
    ? selectProviderGuidance(allPatterns, providerPatterns)
    : [];

  return { patterns: allPatterns, providerGuidance };
}

export function formatDeploymentTopologyForPrompt(topology: DeploymentTopology): string {
  if (topology.patterns.length === 0) return "";

  const lines: string[] = [];
  lines.push(`EXPANDED DEPLOYMENT TOPOLOGY (${topology.patterns.length} patterns detected):`);

  const byType = new Map<string, DeploymentPattern[]>();
  for (const p of topology.patterns) {
    if (!byType.has(p.type)) byType.set(p.type, []);
    byType.get(p.type)!.push(p);
  }

  for (const [type, patterns] of byType) {
    lines.push(`  [${type.toUpperCase()}]`);
    for (const p of patterns) {
      lines.push(
        `    ${p.provider}: ${p.services.join(", ")} (config: ${p.configFile})`,
      );
      lines.push(
        `      target=${p.suggestedTarget}, roles=[${p.suggestedRoles.join(", ")}], dirs=[${p.directories.join(", ")}]`,
      );
    }
  }

  if (topology.providerGuidance.length > 0) {
    lines.push("");
    lines.push("PROVIDER-SPECIFIC GUIDANCE:");
    for (const g of topology.providerGuidance) {
      const summary = g.split("\n").slice(0, 4).join("\n");
      lines.push(`  ${summary}`);
    }
  }

  return lines.join("\n");
}
