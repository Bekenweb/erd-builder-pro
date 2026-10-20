import { AIAction } from './types';
import { DEFAULT_FLOWCHART_COLOR } from '@/components/flowchart/flowchartColors';

const SHAPE_MEANINGS: Record<string, string> = {
  oval: 'Start/End',
  rectangle: 'Process/Action',
  diamond: 'Decision/Branch',
  parallelogram: 'Input/Output',
  database: 'Database/Storage',
  document: 'Document/Report',
  cloud: 'External System/Service',
  circle: 'Connector/Junction',
};

function flowchartSymbolDetail(context: Record<string, any>): string {
  const nodes: any[] = context.nodes || [];
  const edges: any[] = context.edges || [];
  if (nodes.length === 0) return '(empty flowchart — no symbols yet)';

  const nodeMap = new Map<string, any>(nodes.map((n: any) => [n.id, n]));

  const outgoing: Record<string, string[]> = {};
  const incoming: Record<string, string[]> = {};
  for (const e of edges) {
    const src: any = nodeMap.get(e.source);
    const tgt: any = nodeMap.get(e.target);
    const sLabel = src?.data?.label || e.source;
    const tLabel = tgt?.data?.label || e.target;
    if (!outgoing[e.source]) outgoing[e.source] = [];
    outgoing[e.source].push(`${tLabel}${e.label ? ` [${e.label}]` : ''}`);
    if (!incoming[e.target]) incoming[e.target] = [];
    incoming[e.target].push(`${sLabel}${e.label ? ` [${e.label}]` : ''}`);
  }

  // Helper: format a single node
  function formatNode(n: any, idx: number): string {
    const d = n.data || {};
    const shape = d.shape || 'rectangle';
    const meaning = SHAPE_MEANINGS[shape] || shape;
    const outStr = (outgoing[n.id] || []).join(', ');
    const inStr = (incoming[n.id] || []).join(', ');
    const connParts: string[] = [];
    if (outStr) connParts.push(`→ ${outStr}`);
    if (inStr) connParts.push(`← ${inStr}`);
    const connStr = connParts.length > 0 ? ` [${connParts.join('; ')}]` : ' [isolated]';
    const groupRef = d.groupId ? ` [id:${d.groupId}]` : '';
    return `  [#${idx + 1}] "${d.label || 'unnamed'}" (${meaning}, color: ${d.color || DEFAULT_FLOWCHART_COLOR})${groupRef}${connStr}`;
  }

  // Find all start nodes
  const startNodes = nodes.filter(
    (n: any) => n.data?.label?.trim().toLowerCase().includes('start')
  );

  // If no start nodes, show flat list (backward compatible)
  if (startNodes.length === 0) {
    return nodes.map((n: any, idx: number) => formatNode(n, idx)).join('\n');
  }

  // BFS from a start node to collect reachable nodes
  function collectGroup(startId: string): Set<string> {
    const visited = new Set<string>();
    const queue = [startId];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const e of edges) {
        if (e.source === id && !visited.has(e.target)) {
          queue.push(e.target);
        }
      }
    }
    return visited;
  }

  // Build groups per section
  const grouped = new Map<string, { startNode: any; nodeIds: Set<string> }>();
  const ungroupedNodes = new Set(nodes.map((n: any) => n.id));

  for (const start of startNodes) {
    const section = start.data?.section || '(no title)';
    const nodeIds = collectGroup(start.id);
    // Merge with existing group if same section
    if (grouped.has(section)) {
      const existing = grouped.get(section)!;
      for (const id of nodeIds) existing.nodeIds.add(id);
    } else {
      grouped.set(section, { startNode: start, nodeIds });
    }
    // Remove from ungrouped
    for (const id of nodeIds) ungroupedNodes.delete(id);
  }

  const parts: string[] = [];

  // Render per-section groups
  for (const [section, { startNode, nodeIds }] of grouped) {
    const groupNodes = nodes.filter((n: any) => nodeIds.has(n.id));
    if (groupNodes.length === 0) continue;
    // Map to 0-based original index for consistent numbering
    const globalIdx = (n: any) => nodes.indexOf(n);
    const groupId = startNode.data?.groupId;
    const groupTag = groupId ? ` [id:${groupId}]` : '';
    parts.push(`=== ${section}${groupTag} ===`);
    for (const n of groupNodes) {
      parts.push(formatNode(n, globalIdx(n)));
    }
  }

  // Remaining nodes not reachable from any Start
  if (ungroupedNodes.size > 0) {
    const remaining = nodes.filter((n: any) => ungroupedNodes.has(n.id));
    if (remaining.length > 0) {
      parts.push('=== Ungrouped ===');
      for (const n of remaining) {
        parts.push(formatNode(n, nodes.indexOf(n)));
      }
    }
  }

  return parts.join('\n');
}

export const flowchartActions: AIAction[] = [
  {
    id: 'flowchart-generate',
    label: 'Generate Flowchart',
    description: 'Create flowchart from text description',
    icon: 'Plus',
    buildPrompt: (ctx) => {
      const symbols = flowchartSymbolDetail(ctx);
      return `You are a flowchart generator. The user's current flowchart context is provided separately — focus on the user's new request.

Current symbols:\n${symbols}

Note on groups: Symbols grouped under === headers are separate sections. If the user asks to modify only "section X", "grup Y", or references a specific [id:grp_xxx], focus ONLY on that group and preserve all other groups unchanged.

User Request: Generate a flowchart for [USER TOPIC].

Instruction:
1. Respond with a JSON code block containing "nodes" and "edges".
2. Multi-case support: You can create multiple independent process flows (each with its own Start and End) within the same file if the user describes multiple scenarios.
3. Node shapes (use ONLY these exact values — do not use descriptions like "Start/End"): "oval", "rectangle", "diamond", "parallelogram", "database", "document", "cloud", "circle".
4. Colors: Use the monochrome default by omitting the color field unless the user explicitly requests colors. If the user requests a color (for example red for errors), include its hex code in the relevant nodes' color field. Do not assign random or semantic colors without a user request. Preserve existing user-chosen colors when modifying existing symbols.
5. For edges, use "sourceLabel" and "targetLabel" matching the node labels exactly. Do NOT use "from"/"to" or numeric ids.
6. Use UNIQUE labels for every node — do not create two nodes with the same label. If duplicate labels are unavoidable, use "sourceIndex" and "targetIndex" (1‑based, matching the [#N] numbers from the existing symbols context) instead of "sourceLabel"/"targetLabel" to disambiguate.
7. For diamond (decision) nodes, ALWAYS label the outgoing edges: "Yes" for the true/positive branch, "No" for the false/negative branch.

Example with decision branching:
\`\`\`json
{
  "nodes": [
    { "label": "Start", "shape": "oval" },
    { "label": "Check Stock", "shape": "diamond" },
    { "label": "Process Payment", "shape": "rectangle" },
    { "label": "Show Error", "shape": "rectangle" },
    { "label": "End", "shape": "oval" }
  ],
  "edges": [
    { "sourceLabel": "Start", "targetLabel": "Check Stock" },
    { "sourceLabel": "Check Stock", "targetLabel": "Process Payment", "label": "Yes" },
    { "sourceLabel": "Check Stock", "targetLabel": "Show Error", "label": "No" },
    { "sourceLabel": "Process Payment", "targetLabel": "End" },
    { "sourceLabel": "Show Error", "targetLabel": "End" }
  ]
}
\`\`\`

After the JSON block, add a brief message: "Klik tombol **Append** untuk menambahkan flowchart ini ke kanvas."`;
    },
  },
  {
    id: 'flowchart-explain',
    label: 'Explain Flow',
    description: 'Natural language description of the flow',
    icon: 'Explain',
    buildPrompt: (ctx) => {
      const symbols = flowchartSymbolDetail(ctx);
      return `Describe what this flowchart represents in plain language. Explain the process flow step by step, including what each symbol does and how the flow branches:\n\n${symbols}`;
    },
  },
  {
    id: 'flowchart-pseudocode',
    label: 'Generate Pseudocode',
    description: 'Pseudocode from the flowchart',
    icon: 'Code',
    buildPrompt: (ctx) => {
      const symbols = flowchartSymbolDetail(ctx);
      return `Generate pseudocode that represents the logic and flow shown in this flowchart. Map each symbol to code:\n- Oval → start/end block\n- Rectangle → action/process statement\n- Diamond → if/else or switch condition\n- Parallelogram → input/output statement\n- Database → data store operation\n\nFlowchart:\n${symbols}`;
    },
  },
  {
    id: 'flowchart-insert',
    label: 'Insert Symbol',
    description: 'Add a symbol between two existing symbols',
    icon: 'Between',
    buildPrompt: (ctx) => {
      const symbols = flowchartSymbolDetail(ctx);
      return `You are a flowchart editor. The user wants to insert a new symbol between two existing symbols.

Current symbols:\n${symbols}

Instructions:
1. The user will say something like "Insert 'Validate Payment' after 'Checkout'" or "Add step between A and B".
2. Respond with a JSON code block containing:
   - "sourceLabel": the label of the existing node that comes BEFORE the insertion point
   - "targetLabel": the label of the existing node that comes AFTER the insertion point
   - "newNode": object with "label" and "shape" for the new symbol. Omit "color" for the monochrome default, unless the user explicitly requests a color; then include the requested color as a hex code. Do not assign a random color.
   - "insertEdgeLabel1" (optional): label for the edge from source to new node
   - "insertEdgeLabel2" (optional): label for the edge from new node to target
   - Resolution priority (highest → lowest): "sourceGroupId"/"targetGroupId" → "sourceIndex"/"targetIndex" → "sourceLabel"/"targetLabel"
   - If two symbols have the same label, use "sourceIndex" and "targetIndex" (the [#] number from the symbols list above) instead of sourceLabel/targetLabel to disambiguate
   - If you need to reference a specific group, use "sourceGroupId" or "targetGroupId" (the [id:...] value from the context above)

Example:
\`\`\`json
{
  "sourceLabel": "Check Stock",
  "targetLabel": "Process Payment",
  "newNode": {
    "label": "Verify Inventory",
    "shape": "rectangle"
  },
  "insertEdgeLabel1": "Available",
  "insertEdgeLabel2": "Proceed"
}
\`\`\`

3. Use ONLY these shape values: "oval", "rectangle", "diamond", "parallelogram", "database", "document", "cloud", "circle".
4. After the JSON block, add a brief message: "Klik tombol **Append** untuk menyisipkan simbol ini."`;
    },
  },
  {
    id: 'flowchart-import',
    label: 'Import from Description',
    description: 'Generate entire flowchart from a text description, replacing current',
    icon: 'Import',
    buildPrompt: (ctx) => {
      return `You are a flowchart generator. The user will describe a process or workflow, and you will generate a complete flowchart.

Instructions:
1. Respond with a JSON code block containing "nodes" and "edges".
2. Design the complete flowchart based on the user's description.
3. Node shapes (use ONLY these exact values): "oval", "rectangle", "diamond", "parallelogram", "database", "document", "cloud", "circle".
4. Colors: Use the monochrome default by omitting the color field unless the user explicitly requests colors. If the user requests a color (for example red for errors), include its hex code in the relevant nodes' color field. Do not assign random or semantic colors without a user request. Preserve existing user-chosen colors when modifying existing symbols.
5. For edges, use "sourceLabel" and "targetLabel" matching the node labels exactly.
6. Use UNIQUE labels for every node — do not create two nodes with the same label. If duplicate labels are unavoidable, use "sourceIndex" and "targetIndex" (1‑based) instead of "sourceLabel"/"targetLabel" to disambiguate.
7. For diamond (decision) nodes, ALWAYS label the outgoing edges: "Yes" for the true/positive branch, "No" for the false/negative branch.
8. You MUST always include a Start (oval) and End (oval) node.

Example:
\`\`\`json
{
  "nodes": [
    { "label": "Start", "shape": "oval" },
    { "label": "Check Condition", "shape": "diamond" },
    { "label": "Do Action", "shape": "rectangle" },
    { "label": "Skip", "shape": "rectangle" },
    { "label": "End", "shape": "oval" }
  ],
  "edges": [
    { "sourceLabel": "Start", "targetLabel": "Check Condition" },
    { "sourceLabel": "Check Condition", "targetLabel": "Do Action", "label": "Yes" },
    { "sourceLabel": "Check Condition", "targetLabel": "Skip", "label": "No" },
    { "sourceLabel": "Do Action", "targetLabel": "End" },
    { "sourceLabel": "Skip", "targetLabel": "End" }
  ]
}
\`\`\`

After the JSON block, add a brief message: "Klik tombol **Append** untuk mengganti diagram saat ini."`;
    },
  },
];
