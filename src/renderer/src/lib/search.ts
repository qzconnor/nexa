// The text search is shared with the main process (the conversations' search); only what needs the DOM is here.
export * from '@shared/search'

/** The text node and offset at `position` of the nodes' joined text; an end prefers the node it ends in. */
export function locate(nodes: Text[], position: number, end: boolean): { node: Text; offset: number } {
  let rest = position
  for (const node of nodes) {
    const length = node.data.length
    if (rest < length || (end && rest === length)) return { node, offset: rest }
    rest -= length
  }
  const last = nodes[nodes.length - 1]
  return { node: last, offset: last.data.length }
}
