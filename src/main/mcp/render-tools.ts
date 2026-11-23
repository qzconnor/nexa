import { isRenderTool, parseRenderInput, RENDER_SERVER } from '@shared/render'
import type { McpServerSpec, McpTool } from './mcp-protocol'

const title = { type: 'string', description: 'Short heading shown above it.' }
const description = { type: 'string', description: 'One sentence under the heading (optional).' }

/**
 * Tools that draw something in Nexa's chat. They return at once: the window draws the arguments of
 * the call (the tool row of the chat), so the model only has to call them with the data.
 */
export const RENDER_TOOL_DEFS: McpTool[] = [
  {
    name: 'render_chart',
    title: 'Chart',
    description:
      'Show a chart inline in the chat: bar, line, area, pie or donut. Use it for numbers that compare or change over time (benchmarks, sizes, counts, usage). ' +
      'Pass the rows in `data`, the column of the categories/x-axis in `x`, and one entry in `series` per numeric column to plot. Pie and donut use the first series.',
    inputSchema: {
      type: 'object',
      properties: {
        chart: { type: 'string', enum: ['bar', 'line', 'area', 'pie', 'donut'] },
        title,
        description,
        data: { type: 'array', items: { type: 'object' }, description: 'Rows, e.g. [{"month":"Jan","a":3,"b":5}]' },
        x: { type: 'string', description: 'Key of the category / x value in each row.' },
        series: {
          type: 'array',
          items: { type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' } }, required: ['key'] },
        },
        stacked: { type: 'boolean' },
        unit: { type: 'string', description: 'Unit appended to values, e.g. "ms" or "%".' },
      },
      required: ['chart', 'data', 'x', 'series'],
    },
    annotations: { readOnlyHint: true, title: 'Chart' },
  },
  {
    name: 'render_diagram',
    title: 'Diagramm',
    description:
      'Show a Mermaid diagram inline in the chat: flowcharts, sequence, class, state, ER, gantt, mindmap, timeline. Use it to explain architecture, data flow, call sequences or plans instead of ASCII art.',
    inputSchema: {
      type: 'object',
      properties: { mermaid: { type: 'string', description: 'Mermaid source, e.g. "flowchart LR\\n  A --> B".' }, title, description },
      required: ['mermaid'],
    },
    annotations: { readOnlyHint: true, title: 'Diagramm' },
  },
  {
    name: 'render_table',
    title: 'Tabelle',
    description: 'Show a sortable table inline in the chat. Use it for structured comparisons with more than a few rows or columns.',
    inputSchema: {
      type: 'object',
      properties: {
        title,
        description,
        columns: {
          type: 'array',
          items: {
            type: 'object',
            properties: { key: { type: 'string' }, label: { type: 'string' }, align: { type: 'string', enum: ['left', 'right', 'center'] } },
            required: ['key'],
          },
        },
        rows: { type: 'array', items: { type: 'object' } },
      },
      required: ['columns', 'rows'],
    },
    annotations: { readOnlyHint: true, title: 'Tabelle' },
  },
  {
    name: 'render_stats',
    title: 'Kennzahlen',
    description: 'Show a row of key figures (label, value, optional hint and trend) inline in the chat, e.g. results of a measurement or a summary of a change.',
    inputSchema: {
      type: 'object',
      properties: {
        title,
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              value: { type: 'string' },
              hint: { type: 'string' },
              trend: { type: 'string', enum: ['up', 'down', 'flat'] },
            },
            required: ['label', 'value'],
          },
        },
      },
      required: ['items'],
    },
    annotations: { readOnlyHint: true, title: 'Kennzahlen' },
  },
  {
    name: 'render_callout',
    title: 'Hinweis',
    description: 'Show a highlighted callout box (info, success, warning, danger) inline in the chat for something the user must not miss.',
    inputSchema: {
      type: 'object',
      properties: { tone: { type: 'string', enum: ['info', 'success', 'warning', 'danger'] }, title, text: { type: 'string', description: 'Markdown.' } },
      required: ['text'],
    },
    annotations: { readOnlyHint: true, title: 'Hinweis' },
  },
]

export const RENDER_INSTRUCTIONS =
  'Tools of Nexa, the app that shows this conversation. They draw in the chat; call them when a picture says more than text: ' +
  'render_chart for numbers, render_diagram (Mermaid) for structure and flow, render_table for larger comparisons, render_stats for key figures, render_callout for warnings. ' +
  'They return immediately; do not repeat their content as text afterwards.'

export function renderServerSpec(): McpServerSpec {
  return {
    name: RENDER_SERVER,
    version: '0.1.0',
    instructions: RENDER_INSTRUCTIONS,
    tools: RENDER_TOOL_DEFS,
    async callTool(name, args) {
      if (!isRenderTool(name)) return { content: [{ type: 'text', text: `Unbekanntes Werkzeug: ${name}` }], isError: true }
      const parsed = parseRenderInput(name, args)
      if ('error' in parsed) return { content: [{ type: 'text', text: parsed.error }], isError: true }
      return { content: [{ type: 'text', text: 'Shown to the user in the chat.' }] }
    },
  }
}
