/**
 * The graph-worker producer — the first real slice of `wall-producers`.
 *
 * A stateful, single-structured-call extractor that turns a live transcript into
 * category-tagged wall events: an incremental architecture GRAPH (node/edge
 * deltas) and, when explicit numbers with a shared dimension are spoken, a data
 * CHART. It owns the accumulated graph in memory (design D4) so each call emits
 * only what's NEW, and pushes straight to the wall's JSONL event-source (design
 * D3/D6) — never back through the main session.
 *
 * Deliberately thin: one structured-output model call per transcript span, no
 * multi-turn tool loop (design D1/D3). The render is deterministic (the wall
 * client draws the delta); only this extraction step needs a model, because
 * turning free Hungarian speech into {nodes, edges} / {label, value} is
 * open-domain understanding that no regex can do.
 */

import Anthropic from "@anthropic-ai/sdk";

import type { DisplayEvent, GraphNode, GraphEdge, ChartDatum, WireMessage } from "../types.js";

/** Fast tier by default (design D3/1); a stronger model is opt-in for delta quality. */
export const DEFAULT_WORKER_MODEL = "claude-haiku-4-5";

/** The structured shape the model must return for one transcript span. */
interface Extraction {
  nodes: GraphNode[];
  edges: GraphEdge[];
  chart: { title: string; unit: string; data: ChartDatum[] } | null;
}

// Structured-output JSON schema (additionalProperties:false + required everywhere,
// per the structured-outputs constraints). A `null` chart means "nothing chartable
// in this span".
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: { id: { type: "string" }, label: { type: "string" } },
        required: ["id", "label"],
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: { source: { type: "string" }, target: { type: "string" }, label: { type: "string" } },
        required: ["source", "target", "label"],
      },
    },
    chart: {
      anyOf: [
        { type: "null" },
        {
          type: "object", additionalProperties: false,
          properties: {
            title: { type: "string" }, unit: { type: "string" },
            data: {
              type: "array",
              items: {
                type: "object", additionalProperties: false,
                properties: { label: { type: "string" }, value: { type: "number" } },
                required: ["label", "value"],
              },
            },
          },
          required: ["title", "unit", "data"],
        },
      ],
    },
  },
  required: ["nodes", "edges", "chart"],
} as const;

const SYSTEM = `You extract a live "architecture / system" diagram and, when applicable, a data chart from a spoken meeting transcript. The speech is usually Hungarian and messy (filler, self-corrections, implicit references).

You maintain an incremental graph. On each turn you are told which node ids are ALREADY on the diagram; emit ONLY the new nodes and edges implied by the newest transcript span — never re-emit an existing node. Node \`id\` is a short lowercase slug (e.g. "copilot", "mcp", "privat-ablak"); \`label\` is a short human caption. Edges connect node ids (existing or newly-emitted). An edge \`label\` may be "" if none fits.

Emit a \`chart\` ONLY when the span states explicit numbers that share one dimension and belong together (e.g. revenue per quarter, coverage per module). Otherwise \`chart\` is null. Never invent numbers that were not spoken.

If the span implies nothing new, return empty arrays and null chart. Keep deltas minimal — a few nodes at most per turn.`;

export interface WorkerOptions {
  model?: string;
  /** Optional canonical component names (the D5 context hint) to ground naming. */
  contextHint?: string;
}

/**
 * A stateful worker instance: holds the accumulated node ids across calls so its
 * deltas are minimal and non-duplicating.
 */
export class GraphWorker {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly knownNodes = new Map<string, GraphNode>();
  private readonly emittedEdges = new Set<string>();
  private hint?: string;

  constructor(opts: WorkerOptions = {}) {
    this.client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
    this.model = opts.model || DEFAULT_WORKER_MODEL;
    this.hint = opts.contextHint;
  }

  /** Feed a sparse context hint (canonical names) — consumed once, then cleared. */
  setContextHint(hint: string): void {
    this.hint = hint;
  }

  get nodeCount(): number {
    return this.knownNodes.size;
  }

  /**
   * Process one transcript span → zero or more wall events (graph delta + chart).
   * Dedups against accumulated state so the client only ever appends.
   */
  async process(span: string, zone: DisplayEvent["zone"] = "both"): Promise<WireMessage[]> {
    const known = [...this.knownNodes.keys()];
    const hintLine = this.hint ? `\nCanonical component names to prefer: ${this.hint}` : "";
    this.hint = undefined; // consume the hint once (design D5)

    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: `Nodes already on the diagram: ${known.length ? known.join(", ") : "(none yet)"}${hintLine}\n\nNewest transcript span:\n"""${span}"""`,
      }],
    });

    const text = resp.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return [];
    let out: Extraction;
    try {
      out = JSON.parse(text.text) as Extraction;
    } catch {
      return [];
    }
    return this.toEvents(out, zone);
  }

  /** Turn a raw extraction into deduped wall events against accumulated state. */
  private toEvents(out: Extraction, zone: DisplayEvent["zone"]): WireMessage[] {
    const events: WireMessage[] = [];

    const freshNodes = (out.nodes ?? []).filter((n) => n && n.id && !this.knownNodes.has(n.id));
    const freshEdges = (out.edges ?? []).filter((e) => {
      if (!e || !e.source || !e.target) return false;
      const key = `${e.source}->${e.target}`;
      if (this.emittedEdges.has(key)) return false;
      return true;
    });

    if (freshNodes.length || freshEdges.length) {
      const first = this.knownNodes.size === 0;
      for (const n of freshNodes) this.knownNodes.set(n.id, n);
      for (const e of freshEdges) this.emittedEdges.add(`${e.source}->${e.target}`);
      // The first delta opens the visual; the rest append to it.
      if (first) events.push({ category: "architektúra", zone, visual: "live", graph: { op: "reset" } });
      events.push({
        category: "architektúra", zone, visual: "live",
        graph: { op: "add", nodes: freshNodes, edges: freshEdges },
      });
    }

    if (out.chart && Array.isArray(out.chart.data) && out.chart.data.length) {
      events.push({
        category: "metrika", zone,
        chart: { type: "bar", title: out.chart.title, unit: out.chart.unit || undefined, data: out.chart.data },
      });
    }
    return events;
  }
}
