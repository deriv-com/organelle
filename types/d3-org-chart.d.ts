/**
 * Minimal typings for d3-org-chart v3 (the package ships none).
 * Covers only the API surface Organelle uses.
 */

declare module "d3-org-chart" {
  import type { Selection } from "d3-selection";
  import type { ZoomBehavior, ZoomTransform } from "d3-zoom";

  export interface ChartNode<D> {
    id: string;
    depth: number;
    data: D;
    parent: ChartNode<D> | null;
    children?: ChartNode<D>[];
    _children?: ChartNode<D>[];
    _expanded?: boolean;
    _totalSubordinates?: number;
    _directSubordinates?: number;
    _directSubordinatesPaging?: number;
    // Layout fields, assigned by the library during render.
    x: number;
    y: number;
    width: number;
    height: number;
    row?: number;
    col?: number;
    compactEven?: boolean | null;
    firstCompact?: boolean | null;
    firstCompactNode?: ChartNode<D> | null;
    flexCompactDim?: [number, number] | null;
    // GridOrgChart: the node's visible-subtree x-extent, computed bottom-up in
    // calculateCompactFlexDimensions; headers reserve it as their layout slot.
    subtreeExtent?: number | null;
    eachBefore(fn: (node: ChartNode<D>) => void): void;
    eachAfter(fn: (node: ChartNode<D>) => void): void;
    descendants(): ChartNode<D>[];
  }

  export interface LayoutBindings<D> {
    compactDimension: {
      sizeColumn: (node: ChartNode<D>) => number;
      sizeRow: (node: ChartNode<D>) => number;
    };
    linkX: (node: ChartNode<D>) => number;
    linkY: (node: ChartNode<D>) => number;
    linkCompactXStart: (node: ChartNode<D>) => number;
    linkCompactYStart: (node: ChartNode<D>) => number;
    compactLinkMidX: (node: ChartNode<D>, state?: ChartState<D>) => number;
    compactLinkMidY: (node: ChartNode<D>, state?: ChartState<D>) => number;
    diagonal: (
      s: { x: number; y: number },
      t: { x: number; y: number },
      m?: { x: number; y: number } | null,
      offsets?: { sy?: number },
    ) => string;
  }

  export interface ChartState<D> {
    svg: Selection<SVGSVGElement, unknown, null, undefined>;
    zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null;
    lastTransform: { x: number; y: number; k: number } | ZoomTransform;
    allNodes?: ChartNode<D>[];
    svgWidth: number;
    svgHeight: number;
    data: D[] | null;
    layout: "top" | "bottom" | "left" | "right";
    compact: boolean;
    compactMarginPair: (node: ChartNode<D>) => number;
    compactMarginBetween: (node: ChartNode<D>) => number;
    childrenMargin: (node: ChartNode<D>) => number;
    siblingsMargin: (node: ChartNode<D>) => number;
    nodeWidth: (node: ChartNode<D>) => number;
    nodeHeight: (node: ChartNode<D>) => number;
    nodeButtonWidth: (node: ChartNode<D>) => number;
    nodeButtonHeight: (node: ChartNode<D>) => number;
    nodeButtonX: (node: ChartNode<D>) => number;
    nodeButtonY: (node: ChartNode<D>) => number;
    layoutBindings: Record<string, LayoutBindings<D>>;
  }

  export class OrgChart<D = unknown> {
    constructor();
    container(element: HTMLElement | string): this;
    data(rows: D[]): this;
    nodeId(fn: (d: D) => string): this;
    parentNodeId(fn: (d: D) => string | ""): this;
    nodeWidth(fn: (d: ChartNode<D>) => number): this;
    nodeHeight(fn: (d: ChartNode<D>) => number): this;
    nodeContent(fn: (node: ChartNode<D>) => string): this;
    buttonContent(
      fn: (args: { node: ChartNode<D>; state: ChartState<D> }) => string,
    ): this;
    nodeButtonWidth(fn: (d: ChartNode<D>) => number): this;
    nodeButtonHeight(fn: (d: ChartNode<D>) => number): this;
    nodeButtonX(fn: (d: ChartNode<D>) => number): this;
    nodeButtonY(fn: (d: ChartNode<D>) => number): this;
    minPagingVisibleNodes(fn: (d: ChartNode<D>) => number): this;
    pagingStep(fn: (d: ChartNode<D>) => number): this;
    svgWidth(value: number): this;
    svgHeight(value: number): this;
    duration(ms: number): this;
    compact(value: boolean): this;
    layout(value: "top" | "bottom" | "left" | "right"): this;
    scaleExtent(extent: [number, number]): this;
    onNodeClick(fn: (node: ChartNode<D>) => void): this;
    onZoom(
      fn: (event: { sourceEvent?: Event | null; transform: ZoomTransform }) => void,
    ): this;
    render(): this;
    fit(options?: {
      animate?: boolean;
      nodes?: ChartNode<D>[];
      scale?: boolean;
      onCompleted?: () => void;
    }): this;
    setExpanded(id: string, expanded: boolean): this;
    setCentered(id: string): this;
    restyleForeignObjectElements(): this;
    /** Unbind the library's window resize listener and drop SVG contents. */
    clear(): void;
    getChartState(): ChartState<D>;
    // Prototype methods the library calls on `this` during update(); overridable
    // in subclasses (GridOrgChart uses this to change the compact grid width).
    calculateCompactFlexDimensions(root: ChartNode<D>): void;
    calculateCompactFlexPositions(root: ChartNode<D>): void;
    onButtonClick(event: Event, d: ChartNode<D>): void;
    groupBy<T>(
      array: T[],
      accessor: (item: T) => string | number,
      aggregator: (group: T[]) => number,
    ): [string, number][];
  }
}
