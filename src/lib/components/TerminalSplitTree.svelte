<script>
  /**
   * @typedef {{ id: string, paneId: string, type: "pane" }} PaneNode
   * @typedef {{ id: string, direction: "row" | "column", type: "split", children: Array<PaneNode | SplitNode> }} SplitNode
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

  /** @type {HTMLDivElement | null} */
  let hostElement = null;

  $: if (node.type === "pane") {
    onMountHost?.(node.paneId, hostElement);
  }

  $: pane = node.type === "pane"
    ? panes.find((entry) => entry.id === node.paneId)
    : null;
</script>

{#if node.type === "split"}
  <div class={`split split-${node.direction}`}>
    {#each node.children as child (child.id)}
      <svelte:self
        {panes}
        {activePaneId}
        {onMountHost}
        {onSelectPane}
        node={child}
      />
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
    gap: 8px;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  .split-row {
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
  }

  .split-column {
    grid-auto-flow: row;
    grid-auto-rows: minmax(0, 1fr);
  }

  .pane-shell {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 14px;
    background: #0d1218;
    overflow: hidden;
    padding: 0;
    color: inherit;
    text-align: left;
  }

  .pane-shell.active {
    border-color: rgba(123, 167, 255, 0.28);
    box-shadow: inset 0 0 0 1px rgba(123, 167, 255, 0.12);
  }

  .pane-host {
    min-width: 0;
    min-height: 0;
    height: 100%;
    padding: 8px 10px;
    box-sizing: border-box;
  }
</style>
