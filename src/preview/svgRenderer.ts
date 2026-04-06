'use strict';

import { ParsedModel, ParsedContextMap, ParsedBoundedContext, RelationshipType } from './cmlParser';

interface LayoutNode {
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    type?: string;
    aggregates: string[];
    implementationTechnology?: string;
}

interface LayoutEdge {
    from: string;
    to: string;
    type: RelationshipType;
    upstreamPatterns: string[];
    downstreamPatterns: string[];
    implementationTechnology?: string;
}

const NODE_WIDTH = 200;
const NODE_MIN_HEIGHT = 80;
const NODE_PADDING = 20;
const AGGREGATE_LINE_HEIGHT = 18;
const HORIZONTAL_SPACING = 80;
const VERTICAL_SPACING = 80;
const MARGIN = 40;

function escapeXml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function computeNodeHeight(node: LayoutNode): number {
    const lines = node.aggregates.length;
    const extraHeight = lines > 0 ? lines * AGGREGATE_LINE_HEIGHT + 10 : 0;
    return Math.max(NODE_MIN_HEIGHT, 50 + extraHeight);
}

function layoutNodes(contextMap: ParsedContextMap, bcMap: Map<string, ParsedBoundedContext>): LayoutNode[] {
    const names = contextMap.boundedContexts;
    const count = names.length;
    if (count === 0) { return []; }

    const nodes: LayoutNode[] = [];
    const cols = Math.ceil(Math.sqrt(count));

    for (let i = 0; i < count; i++) {
        const bcDef = bcMap.get(names[i]);
        const node: LayoutNode = {
            name: names[i],
            x: 0,
            y: 0,
            width: NODE_WIDTH,
            height: NODE_MIN_HEIGHT,
            type: bcDef?.type,
            aggregates: bcDef?.aggregates || [],
            implementationTechnology: bcDef?.implementationTechnology,
        };
        node.height = computeNodeHeight(node);
        nodes.push(node);
    }

    // Layout in a grid
    const colX: number[] = [];
    for (let c = 0; c < cols; c++) {
        colX.push(MARGIN + c * (NODE_WIDTH + HORIZONTAL_SPACING));
    }

    for (let i = 0; i < nodes.length; i++) {
        const col = i % cols;
        const currentRow = Math.floor(i / cols);
        nodes[i].x = colX[col];

        let yOffset = MARGIN;
        for (let r = 0; r < currentRow; r++) {
            const prevIdx = r * cols + col;
            if (prevIdx < nodes.length) {
                yOffset = nodes[prevIdx].y + nodes[prevIdx].height + VERTICAL_SPACING;
            }
        }
        nodes[i].y = yOffset;
    }

    return nodes;
}

function renderNode(node: LayoutNode): string {
    const headerHeight = 36;
    const cornerRadius = 8;
    let svg = '';

    // Drop shadow
    svg += `<rect x="${node.x + 3}" y="${node.y + 3}" width="${node.width}" height="${node.height}" rx="${cornerRadius}" ry="${cornerRadius}" fill="#00000015" />`;

    // Background
    const bgColor = getNodeColor(node.type);
    svg += `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${cornerRadius}" ry="${cornerRadius}" fill="${bgColor}" stroke="#4a5568" stroke-width="1.5" />`;

    // Header bar
    const headerColor = getNodeHeaderColor(node.type);
    svg += `<clipPath id="clip-${escapeXml(node.name)}">`;
    svg += `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${cornerRadius}" ry="${cornerRadius}" />`;
    svg += `</clipPath>`;
    svg += `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${headerHeight}" fill="${headerColor}" clip-path="url(#clip-${escapeXml(node.name)})" />`;

    // Separator line
    svg += `<line x1="${node.x}" y1="${node.y + headerHeight}" x2="${node.x + node.width}" y2="${node.y + headerHeight}" stroke="#4a5568" stroke-width="0.5" />`;

    // Context name
    svg += `<text x="${node.x + node.width / 2}" y="${node.y + 15}" text-anchor="middle" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="11" fill="#a0aec0" font-weight="400">&lt;&lt;Bounded Context&gt;&gt;</text>`;
    svg += `<text x="${node.x + node.width / 2}" y="${node.y + 29}" text-anchor="middle" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="13" fill="#ffffff" font-weight="600">${escapeXml(node.name)}</text>`;

    // Type badge
    if (node.type) {
        const typeLabel = node.type.replace(/_/g, ' ');
        svg += `<text x="${node.x + NODE_PADDING}" y="${node.y + headerHeight + 18}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="10" fill="#718096" font-style="italic">[${escapeXml(typeLabel)}]</text>`;
    }

    // Aggregates
    if (node.aggregates.length > 0) {
        const startY = node.y + headerHeight + (node.type ? 30 : 16);
        for (let i = 0; i < node.aggregates.length; i++) {
            svg += `<text x="${node.x + NODE_PADDING}" y="${startY + i * AGGREGATE_LINE_HEIGHT}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="11" fill="#e2e8f0">▸ ${escapeXml(node.aggregates[i])}</text>`;
        }
    }

    return svg;
}

function getNodeColor(type?: string): string {
    switch (type) {
        case 'TEAM': return '#2d3748';
        case 'SYSTEM': return '#1a365d';
        case 'APPLICATION': return '#22543d';
        case 'FEATURE': return '#553c9a';
        default: return '#2d3748';
    }
}

function getNodeHeaderColor(type?: string): string {
    switch (type) {
        case 'TEAM': return '#4a5568';
        case 'SYSTEM': return '#2a4365';
        case 'APPLICATION': return '#276749';
        case 'FEATURE': return '#6b46c1';
        default: return '#4a5568';
    }
}

function getEdgeMidpoint(fromNode: LayoutNode, toNode: LayoutNode): { startX: number; startY: number; endX: number; endY: number } {
    const fromCx = fromNode.x + fromNode.width / 2;
    const fromCy = fromNode.y + fromNode.height / 2;
    const toCx = toNode.x + toNode.width / 2;
    const toCy = toNode.y + toNode.height / 2;

    const dx = toCx - fromCx;
    const dy = toCy - fromCy;
    const angle = Math.atan2(dy, dx);

    const startX = fromCx + Math.cos(angle) * (fromNode.width / 2);
    const startY = fromCy + Math.sin(angle) * (fromNode.height / 2);
    const endX = toCx - Math.cos(angle) * (toNode.width / 2);
    const endY = toCy - Math.sin(angle) * (toNode.height / 2);

    return { startX, startY, endX, endY };
}

function renderEdge(edge: LayoutEdge, nodeMap: Map<string, LayoutNode>): string {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) { return ''; }

    const { startX, startY, endX, endY } = getEdgeMidpoint(fromNode, toNode);

    let svg = '';
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;

    const edgeColor = getEdgeColor(edge.type);
    const markerEnd = isSymmetric(edge.type) ? '' : 'marker-end="url(#arrowhead)"';

    // Draw line
    svg += `<line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}" stroke="${edgeColor}" stroke-width="2" ${markerEnd} stroke-dasharray="${getDashArray(edge.type)}" />`;

    // Relationship type label
    const label = getRelationshipLabel(edge.type);
    svg += `<rect x="${midX - 60}" y="${midY - 10}" width="120" height="20" rx="4" ry="4" fill="#1a202c" fill-opacity="0.9" />`;
    svg += `<text x="${midX}" y="${midY + 4}" text-anchor="middle" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="10" fill="${edgeColor}" font-weight="500">${escapeXml(label)}</text>`;

    // Pattern labels on upstream and downstream sides
    if (edge.upstreamPatterns.length > 0) {
        const pLabel = `[${edge.upstreamPatterns.join(', ')}]`;
        const pX = startX + (midX - startX) * 0.3;
        const pY = startY + (midY - startY) * 0.3 - 8;
        svg += `<text x="${pX}" y="${pY}" text-anchor="middle" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="9" fill="#a0aec0">${escapeXml(pLabel)}</text>`;
    }
    if (edge.downstreamPatterns.length > 0) {
        const pLabel = `[${edge.downstreamPatterns.join(', ')}]`;
        const pX = endX + (midX - endX) * 0.3;
        const pY = endY + (midY - endY) * 0.3 - 8;
        svg += `<text x="${pX}" y="${pY}" text-anchor="middle" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="9" fill="#a0aec0">${escapeXml(pLabel)}</text>`;
    }

    // U/D labels at endpoints for asymmetric relationships
    if (!isSymmetric(edge.type)) {
        svg += `<text x="${startX}" y="${startY - 8}" text-anchor="middle" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="9" fill="#68d391" font-weight="600">U</text>`;
        svg += `<text x="${endX}" y="${endY - 8}" text-anchor="middle" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="9" fill="#fc8181" font-weight="600">D</text>`;
    }

    return svg;
}

function isSymmetric(type: RelationshipType): boolean {
    return type === RelationshipType.Partnership || type === RelationshipType.SharedKernel;
}

function getEdgeColor(type: RelationshipType): string {
    switch (type) {
        case RelationshipType.Partnership: return '#68d391';
        case RelationshipType.SharedKernel: return '#f6ad55';
        case RelationshipType.CustomerSupplier: return '#63b3ed';
        case RelationshipType.UpstreamDownstream: return '#b794f4';
    }
}

function getDashArray(type: RelationshipType): string {
    if (type === RelationshipType.Partnership || type === RelationshipType.SharedKernel) {
        return '6,3';
    }
    return 'none';
}

function getRelationshipLabel(type: RelationshipType): string {
    switch (type) {
        case RelationshipType.Partnership: return 'Partnership';
        case RelationshipType.SharedKernel: return 'Shared Kernel';
        case RelationshipType.CustomerSupplier: return 'Customer ↔ Supplier';
        case RelationshipType.UpstreamDownstream: return 'Upstream → Downstream';
    }
}

export function renderSvg(model: ParsedModel): string {
    if (model.contextMaps.length === 0 && model.boundedContexts.length === 0) {
        return renderEmptyState();
    }

    const bcMap = new Map<string, ParsedBoundedContext>();
    for (const bc of model.boundedContexts) {
        bcMap.set(bc.name, bc);
    }

    const contextMap = model.contextMaps[0];
    if (!contextMap || contextMap.boundedContexts.length === 0) {
        if (model.boundedContexts.length > 0) {
            return renderBoundedContextsOnly(model.boundedContexts);
        }
        return renderEmptyState();
    }

    const nodes = layoutNodes(contextMap, bcMap);
    const nodeMap = new Map<string, LayoutNode>();
    for (const n of nodes) { nodeMap.set(n.name, n); }

    const edges: LayoutEdge[] = contextMap.relationships.map(r => ({
        from: r.upstream,
        to: r.downstream,
        type: r.type,
        upstreamPatterns: r.upstreamPatterns,
        downstreamPatterns: r.downstreamPatterns,
        implementationTechnology: r.implementationTechnology,
    }));

    // Compute SVG dimensions
    let maxX = 0, maxY = 0;
    for (const n of nodes) {
        maxX = Math.max(maxX, n.x + n.width);
        maxY = Math.max(maxY, n.y + n.height);
    }
    const svgWidth = maxX + MARGIN;
    const svgHeight = maxY + MARGIN;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">`;

    // Definitions (arrowhead marker)
    svg += `<defs>`;
    svg += `<marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto" fill="#b794f4">`;
    svg += `<polygon points="0 0, 10 3.5, 0 7" />`;
    svg += `</marker>`;
    svg += `</defs>`;

    // Background
    svg += `<rect width="100%" height="100%" fill="#1a202c" />`;

    // Title
    if (contextMap.name && contextMap.name !== '(implicit)') {
        svg += `<text x="${svgWidth / 2}" y="25" text-anchor="middle" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="16" fill="#e2e8f0" font-weight="600">Context Map: ${escapeXml(contextMap.name)}</text>`;
        if (contextMap.type || contextMap.state) {
            const meta = [contextMap.type, contextMap.state].filter(Boolean).join(' / ');
            svg += `<text x="${svgWidth / 2}" y="42" text-anchor="middle" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="11" fill="#718096">${escapeXml(meta)}</text>`;
        }
    }

    // Edges first (below nodes)
    for (const edge of edges) {
        svg += renderEdge(edge, nodeMap);
    }

    // Nodes
    for (const node of nodes) {
        svg += renderNode(node);
    }

    // Legend
    svg += renderLegend(edges, svgWidth, svgHeight);

    svg += `</svg>`;
    return svg;
}

function renderLegend(edges: LayoutEdge[], svgWidth: number, svgHeight: number): string {
    const usedTypes = new Set(edges.map(e => e.type));
    if (usedTypes.size === 0) { return ''; }

    const legendItems: { color: string; label: string; dash: string }[] = [];
    if (usedTypes.has(RelationshipType.UpstreamDownstream)) {
        legendItems.push({ color: '#b794f4', label: 'Upstream-Downstream', dash: 'none' });
    }
    if (usedTypes.has(RelationshipType.CustomerSupplier)) {
        legendItems.push({ color: '#63b3ed', label: 'Customer-Supplier', dash: 'none' });
    }
    if (usedTypes.has(RelationshipType.Partnership)) {
        legendItems.push({ color: '#68d391', label: 'Partnership', dash: '6,3' });
    }
    if (usedTypes.has(RelationshipType.SharedKernel)) {
        legendItems.push({ color: '#f6ad55', label: 'Shared Kernel', dash: '6,3' });
    }

    let svg = '';
    const lx = 10;
    const ly = svgHeight - legendItems.length * 20 - 10;
    for (let i = 0; i < legendItems.length; i++) {
        const item = legendItems[i];
        const y = ly + i * 20;
        svg += `<line x1="${lx}" y1="${y}" x2="${lx + 30}" y2="${y}" stroke="${item.color}" stroke-width="2" stroke-dasharray="${item.dash}" />`;
        svg += `<text x="${lx + 38}" y="${y + 4}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="10" fill="#a0aec0">${escapeXml(item.label)}</text>`;
    }

    return svg;
}

function renderBoundedContextsOnly(bcs: ParsedBoundedContext[]): string {
    const tempMap: ParsedContextMap = {
        name: '(implicit)',
        boundedContexts: bcs.map(bc => bc.name),
        relationships: [],
    };
    const bcMap = new Map<string, ParsedBoundedContext>();
    for (const bc of bcs) { bcMap.set(bc.name, bc); }

    const nodes = layoutNodes(tempMap, bcMap);

    let maxX = 0, maxY = 0;
    for (const n of nodes) {
        maxX = Math.max(maxX, n.x + n.width);
        maxY = Math.max(maxY, n.y + n.height);
    }
    const svgWidth = maxX + MARGIN;
    const svgHeight = maxY + MARGIN;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">`;
    svg += `<rect width="100%" height="100%" fill="#1a202c" />`;

    for (const node of nodes) {
        svg += renderNode(node);
    }

    svg += `</svg>`;
    return svg;
}

function renderEmptyState(): string {
    const w = 400;
    const h = 200;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
    svg += `<rect width="100%" height="100%" fill="#1a202c" />`;
    svg += `<text x="${w / 2}" y="${h / 2 - 12}" text-anchor="middle" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="14" fill="#718096">No context map or bounded contexts found.</text>`;
    svg += `<text x="${w / 2}" y="${h / 2 + 12}" text-anchor="middle" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" fill="#4a5568">Define a ContextMap or BoundedContext in your .cml file.</text>`;
    svg += `</svg>`;
    return svg;
}
