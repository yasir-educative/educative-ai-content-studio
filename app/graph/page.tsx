'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { outlineGraph, blogGraph, newsletterGraph, courseGraph, mobileCourseGraph, mobileShortGraph, type PipelineGraph, type GraphNode, type AgentKind } from '@/lib/pipelineGraph';

const GRAPH_TABS = [
  { id: 'blog',           label: 'Blog',           graph: blogGraph },
  { id: 'newsletter',     label: 'Newsletter',     graph: newsletterGraph },
  { id: 'course',         label: 'Course',         graph: courseGraph },
  { id: 'mobile-course',  label: 'Mobile Course',  graph: mobileCourseGraph },
  { id: 'mobile-short',   label: 'Mobile Short',   graph: mobileShortGraph },
  { id: 'outline',        label: 'Outline',        graph: outlineGraph },
] as const;
type GraphTabId = typeof GRAPH_TABS[number]['id'];

// Vertical (top-down) layered DAG renderer.
// Layout: y = node.rank (depth from top), x = node.lane (column, 0 = center, negatives left).
// Edges drawn as vertical S-curves. `when` labels sit near the source so they always belong
// to the correct branch visually. Click a node to focus it; if it has a prompt, the side panel
// links to /prompts/{name}.

const ROW_H = 130;        // vertical spacing between ranks
const COL_W = 240;        // horizontal spacing between lanes
const NODE_W = 220;
const NODE_H = 78;
const PAD_X = 60;
const PAD_Y = 50;

const AGENT_STYLE: Record<AgentKind, { fill: string; stroke: string; label: string }> = {
  'openai-search':  { fill: 'rgba(16,185,129,0.10)',  stroke: '#10b981', label: 'web search' },
  'gemini-text':    { fill: 'rgba(168,85,247,0.10)',  stroke: '#a855f7', label: 'gemini write' },
  'gemini-review':  { fill: 'rgba(244,114,182,0.10)', stroke: '#f472b6', label: 'gemini review' },
  'transform':      { fill: 'rgba(148,163,184,0.10)', stroke: '#94a3b8', label: 'code' },
  'http':           { fill: 'rgba(59,130,246,0.10)',  stroke: '#3b82f6', label: 'http' },
  'fanout':         { fill: 'rgba(245,158,11,0.10)',  stroke: '#f59e0b', label: 'fan-out' },
  'terminal':       { fill: 'rgba(255,255,255,0.04)', stroke: '#64748b', label: 'terminal' },
};

function layout(g: PipelineGraph) {
  const minLane = Math.min(...g.nodes.map((n) => n.lane));
  const maxLane = Math.max(...g.nodes.map((n) => n.lane));
  const maxRank = Math.max(...g.nodes.map((n) => n.rank));
  const cols = maxLane - minLane + 1;
  const width = PAD_X * 2 + cols * COL_W;
  const height = PAD_Y * 2 + (maxRank + 1) * ROW_H;
  const positions = new Map<string, { x: number; y: number; cx: number; cy: number }>();
  for (const n of g.nodes) {
    const col = n.lane - minLane;
    const x = PAD_X + col * COL_W + (COL_W - NODE_W) / 2;
    const y = PAD_Y + n.rank * ROW_H + (ROW_H - NODE_H) / 2;
    positions.set(n.id, { x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2 });
  }
  return { positions, width, height };
}

function isIncident(graph: PipelineGraph, focus: string, nodeId: string): boolean {
  if (focus === nodeId) return true;
  for (const e of graph.edges) {
    if ((e.from === focus && e.to === nodeId) || (e.to === focus && e.from === nodeId)) return true;
  }
  return false;
}

function PipelineCard({ graph }: { graph: PipelineGraph }) {
  const [focus, setFocus] = useState<string | null>(null);
  const { positions, width, height } = useMemo(() => layout(graph), [graph]);
  const focusNode = useMemo(() => graph.nodes.find((n) => n.id === focus) || null, [focus, graph]);

  const incidentEdgeIdx = useMemo(() => {
    if (!focus) return new Set<number>();
    const s = new Set<number>();
    graph.edges.forEach((e, i) => { if (e.from === focus || e.to === focus) s.add(i); });
    return s;
  }, [focus, graph.edges]);

  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="text-lg font-semibold">{graph.title}</h2>
          <p className="text-xs text-[var(--text-faint)] mt-0.5 max-w-3xl">{graph.description}</p>
        </div>
        <div className="text-xs text-[var(--text-faint)]">
          {graph.nodes.length} nodes · {graph.edges.length} edges
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
        <div className="overflow-auto rounded-md border border-[var(--border)] bg-[rgba(0,0,0,0.18)]">
          <svg width={width} height={height} className="block">
            <defs>
              <marker id={`arrow-${graph.id}`}        viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
              </marker>
              <marker id={`arrow-active-${graph.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#fbbf24" />
              </marker>
            </defs>

            {/* Edges first so nodes draw on top */}
            {graph.edges.map((e, i) => {
              const a = positions.get(e.from);
              const b = positions.get(e.to);
              if (!a || !b) return null;

              // Top-down vertical S-curve. Source bottom → target top.
              const x1 = a.cx;
              const y1 = a.y + NODE_H;
              const x2 = b.cx;
              const y2 = b.y;
              const dy = Math.max(30, (y2 - y1) / 2);
              const path = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;

              const active = incidentEdgeIdx.has(i);
              const dim = focus !== null && !active;
              const dashed = e.style === 'dashed' || (e.when && /else|none/i.test(e.when));

              // Place the `when` label near the source (top quarter of the edge) so it's
              // unambiguously attached to the correct out-edge — this fixes the "else" label
              // floating between nodes on long edges.
              const labelT = 0.28;
              const lx = (1 - labelT) * (1 - labelT) * (1 - labelT) * x1
                       + 3 * (1 - labelT) * (1 - labelT) * labelT * x1
                       + 3 * (1 - labelT) * labelT * labelT * x2
                       + labelT * labelT * labelT * x2;
              const ly = (1 - labelT) * (1 - labelT) * (1 - labelT) * y1
                       + 3 * (1 - labelT) * (1 - labelT) * labelT * (y1 + dy)
                       + 3 * (1 - labelT) * labelT * labelT * (y2 - dy)
                       + labelT * labelT * labelT * y2;

              return (
                <g key={i} opacity={dim ? 0.18 : 1}>
                  <path
                    d={path}
                    fill="none"
                    stroke={active ? '#fbbf24' : '#94a3b8'}
                    strokeWidth={active ? 2.2 : 1.3}
                    strokeDasharray={dashed ? '5 4' : undefined}
                    markerEnd={`url(#arrow${active ? '-active' : ''}-${graph.id})`}
                  />
                  {e.when && (
                    <g transform={`translate(${lx},${ly})`} style={{ pointerEvents: 'none' }}>
                      <rect
                        x={-(approxLabelWidth(e.when) / 2) - 6}
                        y={-9}
                        rx={4}
                        ry={4}
                        width={approxLabelWidth(e.when) + 12}
                        height={18}
                        fill="rgba(15,23,42,0.92)"
                        stroke={active ? '#fbbf24' : '#475569'}
                        strokeWidth={1}
                      />
                      <text
                        x={0}
                        y={4}
                        textAnchor="middle"
                        fontSize="11"
                        fontWeight={600}
                        fill={active ? '#fbbf24' : '#cbd5e1'}
                      >
                        {e.when}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {graph.nodes.map((n) => {
              const p = positions.get(n.id)!;
              const style = AGENT_STYLE[n.agent];
              const isFocus = focus === n.id;
              const dim = focus !== null && !isIncident(graph, focus, n.id);
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x},${p.y})`}
                  style={{ cursor: 'pointer' }}
                  opacity={dim ? 0.4 : 1}
                  onClick={() => setFocus(isFocus ? null : n.id)}
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={10}
                    ry={10}
                    fill={style.fill}
                    stroke={isFocus ? '#fbbf24' : style.stroke}
                    strokeWidth={isFocus ? 2.6 : 1.6}
                  />
                  <text x={12} y={20} fontSize="10" fill={style.stroke} style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }} fontWeight={700}>
                    {style.label}
                  </text>
                  <text x={12} y={42} fontSize="14" fill="var(--text)" fontWeight={600}>
                    {truncate(n.label, 26)}
                  </text>
                  {n.prompt && (
                    <text x={12} y={62} fontSize="10.5" fill="var(--text-faint)">
                      prompt: {n.prompt}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <aside className="text-sm space-y-3">
          {focusNode ? (
            <>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                  {AGENT_STYLE[focusNode.agent].label}
                </div>
                <div className="text-base font-semibold">{focusNode.label}</div>
                <div className="text-xs text-[var(--text-faint)] mt-0.5">
                  id: <code>{focusNode.id}</code>
                </div>
              </div>
              {focusNode.model && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Model</div>
                  <div>{focusNode.model}</div>
                </div>
              )}
              {focusNode.prompt && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Prompt</div>
                  <Link href={`/prompts/${focusNode.prompt}`} className="text-emerald-300 underline">
                    {focusNode.prompt}
                  </Link>
                </div>
              )}
              {focusNode.notes && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Notes</div>
                  <div className="text-xs text-[var(--text-dim)]">{focusNode.notes}</div>
                </div>
              )}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Incident edges</div>
                <ul className="text-xs space-y-1 mt-1">
                  {graph.edges
                    .filter((e) => e.from === focusNode.id || e.to === focusNode.id)
                    .map((e, i) => (
                      <li key={i} className="text-[var(--text-dim)]">
                        <code>{e.from}</code> → <code>{e.to}</code>
                        {e.when && <span className="ml-1 text-amber-300">[{e.when}]</span>}
                      </li>
                    ))}
                </ul>
              </div>
              <button className="btn-secondary w-full" onClick={() => setFocus(null)}>Clear focus</button>
            </>
          ) : (
            <div className="text-xs text-[var(--text-faint)] leading-relaxed">
              Click any node to inspect it. Conditional edges show their guard
              (e.g. <code>isGenAI</code>, <code>isProjects</code>, <code>seoMode != none</code>) and
              are rendered dashed so the bypass paths are obvious. Adding a stage to{' '}
              <code>lib/pipelineGraph.ts</code> updates this view automatically.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function approxLabelWidth(s: string): number {
  // 11px font, ~6.6px/char average — good enough to size the label background.
  return Math.max(20, s.length * 6.6);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function Legend() {
  return (
    <div className="card p-3 flex flex-wrap items-center gap-3 text-xs">
      <span className="text-[var(--text-faint)]">Legend:</span>
      {(Object.keys(AGENT_STYLE) as AgentKind[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-3 rounded"
            style={{ background: AGENT_STYLE[k].fill, border: `1.5px solid ${AGENT_STYLE[k].stroke}` }}
          />
          {AGENT_STYLE[k].label}
        </span>
      ))}
      <span className="text-[var(--text-faint)] ml-auto">
        Dashed edges = conditional bypass (e.g. <code>else</code>, <code>seoMode == none</code>).
      </span>
    </div>
  );
}

export default function GraphPage() {
  const [activeTab, setActiveTab] = useState<GraphTabId>('blog');
  const activeGraph = GRAPH_TABS.find((t) => t.id === activeTab)!.graph;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>Pipeline Graph</h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--text-dim)' }}>
          Top-down visualization of every agent and transform. Sourced from{' '}
          <code className="text-xs px-1 py-0.5 rounded" style={{ background: 'var(--panel-2)' }}>lib/pipelineGraph.ts</code>
          {' '}— adding a node there updates this view on reload.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1" style={{ borderBottom: '1px solid var(--border)' }}>
        {GRAPH_TABS.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors"
              style={active
                ? { background: 'var(--panel-2)', border: '1px solid var(--border)', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', marginBottom: '-1px' }
                : { border: '1px solid transparent', color: 'var(--text-faint)' }
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <Legend />

      <PipelineCard key={activeTab} graph={activeGraph} />
    </div>
  );
}
