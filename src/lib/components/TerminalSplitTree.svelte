<script>
  /**
   * @typedef {{ id: string, paneId: string, type: "pane" }} PaneNode
   * @typedef {{ id: string, direction: "row" | "column", type: "split", sizes: number[], children: Array<PaneNode | SplitNode> }} SplitNode
   * @typedef {PaneNode | SplitNode} LayoutNode
   */

  /** @type {LayoutNode} */
  export let node;
  /** @type {Array<{ id: string, title: string, host: HTMLDivElement | null, busy: boolean, cwd: string | null }>} */
  export let panes = [];
  /** @type {string | null} */
  export let activePaneId = null;
  /** @type {(paneId: string, element: HTMLDivElement | null) => void} */
  export let onMountHost;
  /** @type {(paneId: string) => void} */
  export let onSelectPane;
  /** @type {(splitId: string, index: number, leftSize: number, rightSize: number) => void} */
  export let onResizeSplit;

  /** @type {HTMLDivElement | null} */
  let hostElement = null;
  /** @type {HTMLDivElement | null} */
  let splitElement = null;

  $: if (node.type === "pane") {
    onMountHost?.(node.paneId, hostElement);
  }

  $: pane = node.type === "pane"
    ? panes.find((entry) => entry.id === node.paneId)
    : null;

  $: splitTemplate = node.type === "split" ? buildSplitTemplate(node) : "";

  /**
   * @param {SplitNode} splitNode
   */
  function buildSplitTemplate(splitNode) {
    const tokens = [];

    for (let index = 0; index < splitNode.children.length; index += 1) {
      tokens.push(`minmax(0, ${splitNode.sizes[index] ?? 1}fr)`);
      if (index < splitNode.children.length - 1) {
        tokens.push("8px");
      }
    }

    return tokens.join(" ");
  }

  /**
   * @param {PointerEvent} event
   * @param {SplitNode} splitNode
   * @param {number} index
   */
  function startResize(event, splitNode, index) {
    if (!splitElement) {
      return;
    }

    event.preventDefault();
    const rect = splitElement.getBoundingClientRect();
    const totalSize = splitNode.direction === "row" ? rect.width : rect.height;
    const startPosition = splitNode.direction === "row" ? event.clientX : event.clientY;
    const startLeft = splitNode.sizes[index] ?? 1;
    const startRight = splitNode.sizes[index + 1] ?? 1;
    const totalRatio = startLeft + startRight;

    const handlePointerMove = /** @param {PointerEvent} moveEvent */ (moveEvent) => {
      const currentPosition = splitNode.direction === "row" ? moveEvent.clientX : moveEvent.clientY;
      const delta = totalSize > 0 ? (currentPosition - startPosition) / totalSize : 0;
      const nextLeft = Math.max(0.15, Math.min(totalRatio - 0.15, startLeft + delta));
      const nextRight = totalRatio - nextLeft;
      onResizeSplit?.(splitNode.id, index, nextLeft, nextRight);
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }
</script>

{#if node.type === "split"}
  <div
    bind:this={splitElement}
    class={`split split-${node.direction}`}
    style={node.direction === "row"
      ? `grid-template-columns: ${splitTemplate};`
      : `grid-template-rows: ${splitTemplate};`}
  >
    {#each node.children as child, index (child.id)}
      <svelte:self
        {panes}
        {activePaneId}
        {onMountHost}
        {onSelectPane}
        {onResizeSplit}
        node={child}
      />
      {#if index < node.children.length - 1}
        <div
          class={`divider divider-${node.direction}`}
          role="separator"
          tabindex="-1"
          onpointerdown={(event) => startResize(event, node, index)}
        ></div>
      {/if}
    {/each}
  </div>
{:else if pane}
  <div
    class:active={activePaneId === pane.id}
    class="pane-shell"
    role="presentation"
    onmousedown={() => onSelectPane?.(pane.id)}
  >
    <div bind:this={hostElement} class="pane-host"></div>
  </div>
{/if}

<style>
  .split {
    display: grid;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  .split-row {
    grid-auto-flow: column;
  }

  .split-column {
    grid-auto-flow: row;
  }

  .pane-shell {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    overflow: hidden;
    padding: 0;
    color: inherit;
    text-align: left;
    transition:
      box-shadow 140ms ease,
      background 140ms ease;
  }

  .pane-shell.active {
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.06),
      inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  .pane-host {
    min-width: 0;
    min-height: 0;
    height: 100%;
    padding: 10px 12px 12px;
    box-sizing: border-box;
  }

  .divider {
    position: relative;
    z-index: 2;
    transition: background 140ms ease;
  }

  .divider::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.03);
    transition: background 140ms ease;
  }

  .divider-row {
    cursor: col-resize;
  }

  .divider-column {
    cursor: row-resize;
  }

  .divider-row::before {
    left: 2px;
    right: 2px;
  }

  .divider-column::before {
    top: 2px;
    bottom: 2px;
  }

  .divider:hover::before {
    background: rgba(255, 255, 255, 0.12);
  }
</style>
