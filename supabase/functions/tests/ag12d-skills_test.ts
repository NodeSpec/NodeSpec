// AG.12d (owner 2026-09-28): "correct each skill in direct context to 'Developer' being
// for main NodeSpec platform and OSS being for the OSS. Ensure the skills are tight, high
// quality input on tool calls, what they do, and how the app works."
// Both skills are read against the live tool registry, per edition:
//  - every tool a skill's reference table names is served in its edition, and every tool
//    the edition serves has a row;
//  - every call written out in a skill, `tool(arg, ...)` or `tool { arg: ... }`, uses
//    arguments the tool takes;
//  - the Developer skill names the plan of each tool above Free; the OSS skill names no
//    tool, plan or feature the open source build does not carry;
//  - both teach how the canvas holds nodes: one parent, groups inside hosts, where code
//    runs, and none of the retired wording.
import { assert, assertEquals } from "./helpers.ts";
import { MCP_TOOLS } from "../mcp-server/tool-registry.ts";
import { toolsForTier } from "../mcp-server/tool-surface.ts";

const read = (dir: string) => Deno.readTextFileSync(new URL(`../../../skills/${dir}/SKILL.md`, import.meta.url));
const DEV = read("nodespec-developer");
const OSS = read("nodespec-oss-developer");
const TOOL_NAMES = new Set(MCP_TOOLS.map((t) => t.name));
const ARGS = new Map(MCP_TOOLS.map((t) => [t.name, new Set(Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}))]));

/** The tools a skill's reference tables give a row: a first cell made only of backticked names. */
function referencedTools(skill: string): Set<string> {
  const out = new Set<string>();
  for (const line of skill.split("\n")) {
    const m = line.match(/^\| ((?:`[a-z_]+`(?: \/ )?)+) \|/);
    if (!m) continue;
    for (const name of m[1].matchAll(/`([a-z_]+)`/g)) out.add(name[1]);
  }
  return out;
}

/** Every call written out as `tool(args)` or `tool { args }`: the tool and the argument names. */
function writtenCalls(skill: string): Array<{ tool: string; args: string[]; text: string }> {
  const calls: Array<{ tool: string; args: string[]; text: string }> = [];
  for (const m of skill.matchAll(/`([a-z_]+)\s*([({])([^`]*)[)}]`/g)) {
    if (!TOOL_NAMES.has(m[1])) continue;
    let body = m[3];
    // nested values ([...], {...}) are one argument's value, not arguments
    for (let i = 0; i < 4; i++) body = body.replace(/\[[^[\]]*\]/g, "").replace(/\{[^{}]*\}/g, "");
    const args = body.split(",").map((a) => a.trim().match(/^([a-z_]+)\??\s*(?::|$)/)?.[1]).filter((a): a is string => !!a);
    calls.push({ tool: m[1], args, text: m[0] });
  }
  return calls;
}

const HOSTED_ALL = new Set(toolsForTier("team", "hosted").map((t) => t.name));
const OSS_SERVED = new Set(toolsForTier("community", "oss").map((t) => t.name));
const FREE_SERVED = new Set(toolsForTier("community", "hosted").map((t) => t.name));
const INDIE_SERVED = new Set(toolsForTier("indie", "hosted").map((t) => t.name));

Deno.test("AG.12d Developer: the reference names every platform tool, and only tools the platform serves", () => {
  const named = referencedTools(DEV);
  assertEquals([...named].filter((t) => !HOSTED_ALL.has(t)), [], "a row names a tool the platform does not serve");
  assertEquals([...HOSTED_ALL].filter((t) => !named.has(t)), [], "a platform tool has no row");
});

Deno.test("AG.12d Developer: each tool above Free names its plan on its row", () => {
  const rows = DEV.split("\n").filter((l) => /^\| `[a-z_]+`/.test(l));
  const rowOf = (tool: string) => rows.find((l) => l.startsWith(`| \`${tool}\``)) ?? "";
  for (const tool of HOSTED_ALL) {
    if (FREE_SERVED.has(tool)) continue;
    const plan = INDIE_SERVED.has(tool) ? /Indie/ : /Team/;
    assert(plan.test(rowOf(tool)), `${tool}: its row names no plan (${rowOf(tool).slice(0, 80)})`);
  }
});

Deno.test("AG.12d OSS: the reference names every tool this build serves, and nothing it does not", () => {
  const named = referencedTools(OSS);
  assertEquals([...named].filter((t) => !OSS_SERVED.has(t)), [], "a row names a tool the open source build does not serve");
  assertEquals([...OSS_SERVED].filter((t) => !named.has(t)), [], "a served tool has no row");
  // no tool, plan or product the open source build lacks is named anywhere in the file
  const absent = [...HOSTED_ALL].filter((t) => !OSS_SERVED.has(t));
  assertEquals(absent.filter((t) => OSS.includes(t)), [], "a hosted-only tool is named");
  for (const word of [/\bIndie\b/, /\bTeam\b/, /\bEnterprise\b/, /\bGovernment\b/, /hosted app/i, /\bupgrade/i, /repo[ -]import/i]) {
    assert(!word.test(OSS), `the OSS skill names ${word}`);
  }
});

Deno.test("AG.12d both: every call written out uses arguments its tool takes", () => {
  for (const [name, skill] of [["developer", DEV], ["oss", OSS]] as const) {
    const calls = writtenCalls(skill);
    assert(calls.length >= 8, `${name}: the skill writes calls out (${calls.length})`);
    for (const c of calls) {
      const unknown = c.args.filter((a) => !ARGS.get(c.tool)!.has(a));
      assertEquals(unknown, [], `${name}: ${c.text} passes ${unknown.join(", ")}, which ${c.tool} does not take`);
    }
  }
});

Deno.test("AG.12d both: the skills teach how the canvas holds nodes, and not the retired rule", () => {
  for (const [name, skill] of [["developer", DEV], ["oss", OSS]] as const) {
    const flat = skill.replace(/\s+/g, " ");
    assert(flat.includes("A node has one parent"), `${name}: the one-parent rule`);
    assert(flat.includes("a group whose nodes all run on one host sits inside that host") || flat.includes("A group whose nodes all run on one host sits inside that host"), `${name}: groups inside hosts`);
    assert(skill.includes("### Where it runs"), `${name}: the Where it runs section`);
    assert(flat.includes("The runtime that runs portable code is its host"), `${name}: the host rule`);
    assert(flat.includes("is a Network Connection inside the VPC it serves"), `${name}: network links`);
    assert(flat.includes("so leave `placementKind` unset"), `${name}: the placement follows the parent`);
    assert(!/structural grouping/.test(flat), `${name}: the old container legend`);
    assert(!/never both/.test(flat), `${name}: the old one-parent rule`);
    assert(!/depends-on\/refines\/conflicts/.test(flat), `${name}: the wrong relation types`);
    assert(!/that single call flips the ticked criteria met/.test(flat), `${name}: criterion ticks are the user's`);
  }
});
