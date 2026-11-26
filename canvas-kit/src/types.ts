export type CanvasElementKind = "text" | "image" | "stroke" | "connector";

export interface BaseElement {
  id: string;
  kind: CanvasElementKind;
  x: number;
  y: number;
  zIndex?: number;
}

export interface TextElement extends BaseElement {
  kind: "text";
  text: string;
  w: number;
  h: number;
  fontSize?: number;
  color?: string;
}

export interface ImageElement extends BaseElement {
  kind: "image";
  url: string; // Firebase Storage download URL
  storagePath: string;
  w: number;
  h: number;
}

export interface StrokeElement extends BaseElement {
  kind: "stroke";
  path: string; // SVG path d attribute
  color: string;
  width: number;
}

export interface ConnectorElement extends BaseElement {
  kind: "connector";
  fromId?: string; // element or node id (optional if free-floating)
  toId?: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color?: string;
}

export type CanvasElement = TextElement | ImageElement | StrokeElement | ConnectorElement;

export type ToolMode = "select" | "text" | "draw" | "erase" | "connector";
