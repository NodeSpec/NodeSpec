// The walkthrough (owner 2026-09-30): "Update our product internal tutorial.
// Reference the entire internal workflow, then upon a new account being
// created, do a walkthrough of the different functionalities of the
// application."
//
// One tour, in the order a project runs: what NodeSpec is and the loop it
// keeps, connecting the user's AI, then each surface where it lives. A stop
// with a surface switches the app to it (Work and its tabs, Architecture) so
// the user sees the real thing; a stop with an anchor spotlights the control
// that carries `data-tour="<anchor>"`. Stops for what the project's plan does
// not carry are not in the list at all (Q: below a plan, nothing of it shows),
// so a Free account is never told about Plan, Workflows, constraints, the
// repository import or Team.
//
// AJ.6 (owner 2026-09-30): a new account lands in its example project and the
// tour runs over it. There every feature the build ships has a stop, Team
// under its own name, Team mode; a stop for a feature the owner's plan does
// not carry says it is view only; and the last button starts the account's
// own project.
//
// AK.2 (owner 2026-10-01): the order a person starts a project in. "Upon
// entering the project, the user needs to connect a single agent before
// anything else and set the permissions. Then recommended start is
// workflows and constraints (if the user's plan allows it) ... not required
// for requirement generation or project continuation, but improves the
// user's AI ability to build the right portions of the project. Then
// Requirements view and what's important. Then Plan View and how to
// interpret. Then architecture view and how the user, if they know what
// changes they want to make to a project, can select a node type and drop
// it into the canvas." The two agent stops open the Agents panel on its
// Connected and Autonomy tabs and let the person act in it (interactive):
// the tour teaches the one place an agent is connected, by the method this
// build uses (agent-connect.ts).
//
// Pure module: the stops, the plan filter and where the card sits beside a
// spotlight carry no DOM, so they are tested directly.
import type { WorkTab } from '../work/work-tabs.js';
import { viewOnlyLine } from '../../utils/example-project.js';
import type { ConnectLane } from './agent-connect.js';

/** The Agents panel tabs a stop opens. */
export type AgentsSurfaceTab = 'connected' | 'autonomy' | 'pending';

/** Where a stop takes the app before it spotlights anything. */
export type WalkthroughSurface = { view: 'work'; tab: WorkTab } | { view: 'architecture' } | { view: 'agents'; tab: AgentsSurfaceTab };

/** What the project's plan and this build carry, as the tour needs to know it. */
export interface WalkthroughContext {
  /** `workflow_space`: the Workflows tab and constraints (Indie and above). */
  workflows: boolean;
  /** `priority_board`: the Plan tab (Indie and above). */
  plan: boolean;
  /** `repo_import`: importing an existing codebase (Indie and above). */
  repoImport: boolean;
  /** `team_lanes`: the Team button (Team). */
  team: boolean;
  /** AJ.6: the tour runs over the account's example project. */
  example?: boolean;
  /** AJ.6: in the example, the features shown above the owner's plan. */
  viewOnly?: { workflows?: boolean; plan?: boolean; repoImport?: boolean; team?: boolean };
  /** AK: how this build connects an agent (the managed platform signs in; a local build uses a key). */
  connect?: ConnectLane;
}

export interface WalkthroughItem { anchor: string; title: string; text: string }

export interface WalkthroughStop {
  id: string;
  /** The chapter label above the title. */
  chapter: string;
  title: string;
  body: string[];
  /** `data-tour` value of the control or surface to spotlight. */
  anchor?: string;
  surface?: WalkthroughSurface;
  /** `control`: dim everything but the anchor. `surface`: ring it, keep the surface readable. */
  focus?: 'control' | 'surface';
  /** A stop that walks a list of controls, spotlighting each on click. */
  items?: WalkthroughItem[];
  /** AK: the person acts in the spotlighted surface while the card stays. */
  interactive?: boolean;
}

/** The loop every project runs, as the welcome stop draws it. */
export const WALKTHROUGH_LOOP: ReadonlyArray<{ label: string; text: string }> = [
  { label: 'Vision', text: 'What you are building and for whom, in your words.' },
  { label: 'Requirements', text: 'What must exist. Each one serves an outcome and carries acceptance criteria, which start unmet.' },
  { label: 'Architecture', text: 'Nodes and the connections between them, each connection with a contract. Every requirement maps to the nodes that serve it.' },
  { label: 'Task documents', text: 'A brief per node: its role, its connections, its files and the criteria it serves. Your AI generates them.' },
  { label: 'Code', text: 'Your AI builds from the brief, in your own editor.' },
  { label: 'Tests', text: 'Your AI reports test results against the criteria, citing the commit. A passing result is what marks a criterion met.' },
  { label: 'Git', text: 'With a repository connected, the design commits beside your code, and commits made elsewhere come back for review.' },
];

/** The header controls the last stop walks, in header order. A control this
 *  build does not draw (Templates on the open-source build) drops out at run
 *  time because its anchor is not on the page. */
export const HEADER_ITEMS: readonly WalkthroughItem[] = [
  { anchor: 'templates', title: 'Browse Templates', text: 'Start a project from a published architecture instead of a blank canvas.' },
  { anchor: 'help', title: 'Help', text: 'This walkthrough, whenever you want it back.' },
  { anchor: 'notifications', title: 'Notifications', text: 'Proposals, test results and repository events as they happen.' },
  { anchor: 'account', title: 'Account Settings', text: 'Your profile and your plan.' },
];

/** Every stop the project's plan carries, in the order a project runs. */
export function walkthroughStops(ctx: WalkthroughContext): WalkthroughStop[] {
  const ro = ctx.example ? (ctx.viewOnly ?? {}) : {};
  const lane = ctx.connect ?? 'key';
  const stops: Array<WalkthroughStop | false> = [
    {
      id: 'welcome', chapter: 'Welcome', title: 'Welcome to NodeSpec',
      body: [
        'You say what your system must do and how it is built. Your AI does the building, connected over MCP. NodeSpec holds the work to the design: your AI\'s changes arrive as proposals, you decide which kinds it may apply on its own, and a requirement counts as met only when a test proves it.',
        'This is the loop every project runs. The tour starts where every project starts: your agent.',
        ...(ctx.example ? [
          `You are in Harbor Lane Bakery, an example project that comes with your account and does not count against your plan: a bakery building order ahead for pickup. Every feature this build ships shows here with its own data${ctx.team ? ', Team mode included' : ''}.`
            + (Object.values(ro).some(Boolean) ? ' What your plan does not carry is view only here.' : ''),
        ] : []),
      ],
    },
    {
      id: 'connect', chapter: 'Your agent', title: 'Connect one agent', anchor: 'agents-panel', focus: 'surface', interactive: true,
      surface: { view: 'agents', tab: 'connected' },
      body: [
        'Before anything else, connect the one agent you will build with. NodeSpec never runs a model of its own: your agent reads the design, proposes changes and reports its tests over MCP.',
        lane === 'sign-in'
          ? 'Pick its client in the panel and follow the line: you add NodeSpec there and approve the sign-in it opens. An agent that cannot open a browser connects with a key from the same panel.'
          : 'Choose Connect an agent in the panel. It gives you a key once, and each client its exact line: Claude Code, Codex, Gemini CLI, Antigravity, the Claude app, or any MCP client such as Hermes.',
        'This card says when your agent has called. No agent on hand? Go on; the MCP button in the header brings you back to this panel.',
      ],
    },
    {
      id: 'permissions', chapter: 'Your agent', title: 'Set what it may do', anchor: 'agents-panel', focus: 'surface', interactive: true,
      surface: { view: 'agents', tab: 'autonomy' },
      body: [
        'For each kind of change (outcomes and workflow steps, requirements, architecture, task documents, the test plan) choose how far your agent may go. Ask first: it may not make the change and asks you instead. Propose: the change waits under Proposals for you to accept. Auto-apply: it lands at once and is logged.',
        'Approve each puts every kind on Propose, a safe start; loosen a kind once you trust your agent with it. Confirmed and locked requirements hold whatever you choose here, and code is never on the list: your agent builds in your own repository.',
      ],
    },
    ctx.workflows && {
      id: 'workflows', chapter: 'Recommended start', title: 'Workflows and constraints', anchor: 'work-workflows', focus: 'surface',
      surface: { view: 'work', tab: 'workflows' },
      body: [
        'Recommended, not required: your agent writes requirements and carries the project forward without them.',
        'Workflows are your users\' journeys as stages; constraints are the rules the design must keep, such as a cost ceiling or a response time. With them your agent knows which parts of the system matter most, builds those first, and knows what it must not break. The Constraints lens in this space shows them; both are edited here.',
        ...(ctx.example ? ['Here: the customer\'s order and the kitchen\'s day, and constraints such as six orders per pickup slot and preorders closing at 20:00.'] : []),
        ...(ctx.example && ctx.team ? ['In Team mode each workflow shows its owner, and a teammate\'s edit arrives under Proposals for the owner to decide.'] : []),
        ...(ro.workflows ? [viewOnlyLine('workflow_space')] : []),
      ],
    },
    {
      id: 'requirements', chapter: 'Work', title: 'Requirements', anchor: 'work-requirements', focus: 'surface',
      surface: { view: 'work', tab: 'requirements' },
      body: [
        'What matters on each requirement: the outcome it serves, and its acceptance criteria. Criteria start unmet. An automated one is met only when your agent reports a passing test for it; a manual one only when you approve its ticked box.',
        'Open one for its chain: Criteria, Architecture, Tasks, Tests and Code, from what was asked to what proves it. "Confirm" it and an agent\'s edit comes back as a proposal; "Lock" it and an agent cannot change it at all.',
        ...(ctx.example
          ? ['Here, REQ-008 is blocked because its provider-retry test fails, and REQ-005 is locked: the card processor\'s review settled it.']
          : ['Start with "Write the vision", then "New requirement", or let your agent draft them from the vision.']),
      ],
    },
    ctx.plan && {
      id: 'plan', chapter: 'Work', title: 'Plan', anchor: 'work-plan', focus: 'surface',
      surface: { view: 'work', tab: 'plan' },
      body: [
        'How to read it: the order of operations, left to right. Each column is a set; everything in a set can be built at the same time, and a set waits for the sets before it. Each row is a node with its tasks (square chips) and tests (round chips), green when done or passed, red when failed, and a red bar marks the critical path.',
        'Work your agents cannot order on their own, such as two tasks that wait on each other, reads Needs a decision. A plan your agent proposes shows as a difference from the current order until you accept or reject it, and Holds names what an agent is working on now. Click a chip for what it serves and what comes before it.',
        ...(ctx.example ? ['Here a proposed plan is waiting, and it answers one such cycle in the Orders API.'] : []),
        ...(ro.plan ? [viewOnlyLine('priority_board')] : []),
      ],
    },
    {
      id: 'architecture', chapter: 'Architecture', title: 'Change the architecture yourself', anchor: 'nodes-sidebar', focus: 'control',
      surface: { view: 'architecture' },
      body: [
        'If you already know a change you want, make it here. Find the node type in the Nodes tab (Node types, Platforms and hosts, Structure, Technologies), or search for it, and drag it onto the canvas. Draw a line from one node to another to connect them; every connection carries a contract.',
        'Your agent reads the change the next time it looks at the design. Work and Architecture switch at the top of the window, and the Files tab lists the files bound to the design.',
      ],
    },
    {
      id: 'nodes', chapter: 'Architecture', title: 'Nodes and views', anchor: 'canvas-dock', focus: 'control',
      surface: { view: 'architecture' },
      body: [
        'Click a node to see its details: Work here (the requirements it serves and how many are proven), Held by (the agent working on it), Connects to and History. "Expand" asks your AI to split a node into its parts.',
        'The dock switches between the Functional view, what talks to what, and the Deployment view, where each part runs.',
      ],
    },
    {
      id: 'skills', chapter: 'Your AI at work', title: 'Skills', anchor: 'skills', focus: 'control',
      body: ['Instructions that teach your agent the NodeSpec workflow: which tools to call, in which order, and what a proposal must carry. Copy one into your agent, or download it as a .md file.'],
    },
    {
      id: 'agents', chapter: 'Your AI at work', title: 'Proposals', anchor: 'changes', focus: 'control',
      body: [
        'What your agent proposes waits under Agents, Proposals, and each card\'s button says what accepting it does. Each card names who filed it: an agent by the key or sign-in it used, a teammate by email, a repository import as the import. Repository and History show what came in from git and what was decided, with your note on anything you rejected.',
      ],
    },
    ctx.team && (ctx.example ? {
      id: 'team', chapter: 'Team mode', title: 'Team mode', anchor: 'team', focus: 'control',
      body: [
        'Team mode is NodeSpec for a team: people seated on one project, each with a role. The owner adds a person by the exact email of their account and can hand ownership to someone else.',
        'This example comes with three teammates, Rosa, Sam and Lena. They own its workflows, wrote some of its constraints, and one of Rosa\'s edits waits under Proposals. They are part of the example, not accounts: to seat real people, open a project of your own on the Team plan and press Team there.',
        ...(ro.team ? [viewOnlyLine('team_lanes')] : []),
      ],
    } : {
      id: 'team', chapter: 'Your AI at work', title: 'Team', anchor: 'team', focus: 'control',
      body: ['Who is on this project. Add a person by the exact email of their account and give them a role; the owner can hand ownership to someone else.'],
    }),
    {
      id: 'git', chapter: 'Your repository', title: 'Git', anchor: 'git', focus: 'control',
      body: [
        'Connect a GitHub or GitLab repository with a token. "Commit to Repository" writes the model, the task documents and the test plans to a .nodespec/ folder beside your code, and commits made outside NodeSpec come back as change cards for you or your AI to reconcile.',
        ...(ctx.repoImport ? ['Already have code? Ask your AI to import the repository: it proposes the architecture it finds, for you to review.'] : []),
        ...(ctx.repoImport && ro.repoImport ? [viewOnlyLine('repo_import')] : []),
      ],
    },
    {
      id: 'export', chapter: 'Your repository', title: 'Export', anchor: 'export', focus: 'control',
      body: ['The project as files, no repository needed: the specification, the test plans, CLAUDE.md, AGENTS.md, Cursor rules, a Mermaid diagram, or the whole project as a zip.'],
    },
    {
      id: 'header', chapter: 'The header', title: 'The rest of the header', focus: 'control',
      items: [...HEADER_ITEMS],
      body: ['Click a row and the control lights up where it lives.'],
    },
    ctx.example ? {
      id: 'finish', chapter: 'Start', title: 'Start your own project', surface: { view: 'work', tab: 'requirements' },
      body: [
        '"Create your own project" opens a new, empty project of yours. The example stays in your projects to come back to, until you delete it.',
        'Reopen this walkthrough from the ? button whenever you need it.',
      ],
    } : {
      id: 'finish', chapter: 'Start', title: 'Start your project', surface: { view: 'work', tab: 'requirements' },
      body: [
        'Choose "Start new" to work out the vision and requirements with your AI, or "Import a specification" to hand it one you already have.',
        'Reopen this walkthrough from the ? button whenever you need it.',
      ],
    },
  ];
  return stops.filter((s): s is WalkthroughStop => s !== false);
}

export interface Rect { top: number; left: number; width: number; height: number }

const MARGIN = 16;
const GAP = 14;

/** Where the tour card sits so it covers neither the spotlighted anchor nor
 *  the edge of the window: below the anchor when it fits, above it when that
 *  fits, else beside it on the side with more room, else docked to the
 *  bottom corner away from the anchor. Without an anchor it is centred. On a
 *  phone it spans the width at the bottom. */
export function placeCard(anchor: Rect | null, card: { width: number; height: number }, viewport: { width: number; height: number }): { top: number; left: number; width: number } {
  const clampX = (x: number, w: number) => Math.min(Math.max(MARGIN, x), Math.max(MARGIN, viewport.width - w - MARGIN));
  const clampY = (y: number) => Math.min(Math.max(MARGIN, y), Math.max(MARGIN, viewport.height - card.height - MARGIN));
  if (viewport.width < 640) {
    const width = viewport.width - 2 * MARGIN;
    return { top: Math.max(MARGIN, viewport.height - card.height - MARGIN), left: MARGIN, width };
  }
  const width = Math.min(card.width, viewport.width - 2 * MARGIN);
  if (!anchor) {
    return { top: clampY((viewport.height - card.height) / 2), left: clampX((viewport.width - width) / 2, width), width };
  }
  const bottom = anchor.top + anchor.height;
  const right = anchor.left + anchor.width;
  // Aligned to the anchor's right edge (header controls sit on the right).
  const alignedX = clampX(right - width, width);
  if (bottom + GAP + card.height <= viewport.height - MARGIN) return { top: bottom + GAP, left: alignedX, width };
  if (anchor.top - GAP - card.height >= MARGIN) return { top: anchor.top - GAP - card.height, left: alignedX, width };
  const roomRight = viewport.width - right;
  const roomLeft = anchor.left;
  if (roomRight >= width + GAP + MARGIN) return { top: clampY(anchor.top), left: right + GAP, width };
  if (roomLeft >= width + GAP + MARGIN) return { top: clampY(anchor.top), left: anchor.left - GAP - width, width };
  // A surface that fills the window: dock in the bottom corner farther from its centre.
  const centre = anchor.left + anchor.width / 2;
  const left = centre > viewport.width / 2 ? MARGIN : viewport.width - width - MARGIN;
  return { top: Math.max(MARGIN, viewport.height - card.height - MARGIN), left, width };
}

/** What the editor does for a stop's surface: the view to show and, for
 *  Work, the tab to open (a focus Work applies once per `at`). An Agents
 *  surface opens the Agents panel instead (the editor's openAgents). */
export function surfaceTarget(surface: Exclude<WalkthroughSurface, { view: 'agents' }>, at: number): { view: 'ideation' | 'architecture'; focus: { kind: 'tab'; tab: WorkTab; at: number } | null } {
  return surface.view === 'architecture'
    ? { view: 'architecture', focus: null }
    : { view: 'ideation', focus: { kind: 'tab', tab: surface.tab, at } };
}

/** Has this account seen the walkthrough? Its own settings row decides
 *  (owner 2026-08-14: never another account's browser); a new account has
 *  no row, so it has not. A read that failed, or threw, says nothing about
 *  the account, and this browser's flag decides instead, so a returning
 *  person is not walked through again because a request failed. */
export function seenWalkthrough(read: { data: { has_seen_onboarding?: boolean | null } | null; error: unknown } | null, browserFlag: boolean): boolean {
  if (!read || read.error) return browserFlag;
  return read.data?.has_seen_onboarding === true;
}
