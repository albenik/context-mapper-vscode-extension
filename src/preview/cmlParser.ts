'use strict';

export interface ParsedBoundedContext {
    name: string;
    type?: string;
    domainVisionStatement?: string;
    implementationTechnology?: string;
    responsibilities: string[];
    aggregates: string[];
}

export interface ParsedRelationship {
    upstream: string;
    downstream: string;
    type: RelationshipType;
    upstreamPatterns: string[];
    downstreamPatterns: string[];
    implementationTechnology?: string;
}

export enum RelationshipType {
    UpstreamDownstream = 'Upstream-Downstream',
    CustomerSupplier = 'Customer-Supplier',
    Partnership = 'Partnership',
    SharedKernel = 'Shared-Kernel',
}

export interface ParsedContextMap {
    name: string;
    type?: string;
    state?: string;
    boundedContexts: string[];
    relationships: ParsedRelationship[];
}

export interface ParsedDomain {
    name: string;
    subdomains: string[];
}

export interface ParsedModel {
    contextMaps: ParsedContextMap[];
    boundedContexts: ParsedBoundedContext[];
    domains: ParsedDomain[];
}

function stripComments(text: string): string {
    text = text.replace(/\/\/.*$/gm, '');
    text = text.replace(/\/\*[\s\S]*?\*\//g, '');
    return text;
}

function findBlockBody(text: string, startIndex: number): string {
    let depth = 0;
    let blockStart = -1;
    for (let i = startIndex; i < text.length; i++) {
        if (text[i] === '{') {
            if (depth === 0) { blockStart = i + 1; }
            depth++;
        } else if (text[i] === '}') {
            depth--;
            if (depth === 0) {
                return text.substring(blockStart, i);
            }
        }
    }
    return '';
}

function parseRelationship(line: string): ParsedRelationship | null {
    // Partnership: BC1 [P]<->[P] BC2  or  BC1 Partnership BC2
    let match = line.match(/^\s*(\w+)\s+Partnership\s+(\w+)/);
    if (match) {
        return {
            upstream: match[1],
            downstream: match[2],
            type: RelationshipType.Partnership,
            upstreamPatterns: [],
            downstreamPatterns: [],
        };
    }
    match = line.match(/^\s*(\w+)\s+\[P\]\s*<->\s*\[P\]\s*(\w+)/);
    if (match) {
        return {
            upstream: match[1],
            downstream: match[2],
            type: RelationshipType.Partnership,
            upstreamPatterns: [],
            downstreamPatterns: [],
        };
    }

    // Shared-Kernel: BC1 [SK]<->[SK] BC2  or  BC1 Shared-Kernel BC2
    match = line.match(/^\s*(\w+)\s+Shared-Kernel\s+(\w+)/);
    if (match) {
        return {
            upstream: match[1],
            downstream: match[2],
            type: RelationshipType.SharedKernel,
            upstreamPatterns: [],
            downstreamPatterns: [],
        };
    }
    match = line.match(/^\s*(\w+)\s+\[SK\]\s*<->\s*\[SK\]\s*(\w+)/);
    if (match) {
        return {
            upstream: match[1],
            downstream: match[2],
            type: RelationshipType.SharedKernel,
            upstreamPatterns: [],
            downstreamPatterns: [],
        };
    }

    // Customer-Supplier: BC1 [S,...]<->[C,...] BC2  or  BC1 Customer-Supplier BC2 / Supplier-Customer
    match = line.match(/^\s*(\w+)\s+Customer-Supplier\s+(\w+)/);
    if (match) {
        return {
            upstream: match[2],
            downstream: match[1],
            type: RelationshipType.CustomerSupplier,
            upstreamPatterns: [],
            downstreamPatterns: [],
        };
    }
    match = line.match(/^\s*(\w+)\s+Supplier-Customer\s+(\w+)/);
    if (match) {
        return {
            upstream: match[1],
            downstream: match[2],
            type: RelationshipType.CustomerSupplier,
            upstreamPatterns: [],
            downstreamPatterns: [],
        };
    }

    // Upstream-Downstream with patterns: BC1 [U,OHS,PL] -> [D,ACL] BC2
    match = line.match(/^\s*(\w+)\s+\[([^\]]*)\]\s*->\s*\[([^\]]*)\]\s*(\w+)/);
    if (match) {
        const leftPatterns = match[2].split(',').map(s => s.trim());
        const rightPatterns = match[3].split(',').map(s => s.trim());
        const leftHasD = leftPatterns.includes('D');
        const leftHasS = leftPatterns.includes('S');
        const leftHasC = leftPatterns.includes('C');
        const rightHasU = rightPatterns.includes('U');

        let upstream = match[1];
        let downstream = match[4];
        let upstreamPatterns = leftPatterns.filter(p => !['U', 'D', 'S', 'C'].includes(p));
        let downstreamPatterns = rightPatterns.filter(p => !['U', 'D', 'S', 'C'].includes(p));
        let relType = RelationshipType.UpstreamDownstream;

        if (leftHasS || leftHasC || rightPatterns.includes('S') || rightPatterns.includes('C')) {
            relType = RelationshipType.CustomerSupplier;
        }

        if (leftHasD || rightHasU) {
            upstream = match[4];
            downstream = match[1];
            upstreamPatterns = rightPatterns.filter(p => !['U', 'D', 'S', 'C'].includes(p));
            downstreamPatterns = leftPatterns.filter(p => !['U', 'D', 'S', 'C'].includes(p));
        }

        return { upstream, downstream, type: relType, upstreamPatterns, downstreamPatterns };
    }

    // Simple Upstream-Downstream: BC1 Upstream-Downstream BC2  or  BC1 Downstream-Upstream BC2
    match = line.match(/^\s*(\w+)\s+Upstream-Downstream\s+(\w+)/);
    if (match) {
        return {
            upstream: match[1],
            downstream: match[2],
            type: RelationshipType.UpstreamDownstream,
            upstreamPatterns: [],
            downstreamPatterns: [],
        };
    }
    match = line.match(/^\s*(\w+)\s+Downstream-Upstream\s+(\w+)/);
    if (match) {
        return {
            upstream: match[2],
            downstream: match[1],
            type: RelationshipType.UpstreamDownstream,
            upstreamPatterns: [],
            downstreamPatterns: [],
        };
    }

    return null;
}

function parseContextMap(name: string, body: string): ParsedContextMap {
    const contextMap: ParsedContextMap = {
        name,
        boundedContexts: [],
        relationships: [],
    };

    const typeMatch = body.match(/\btype\s*=\s*(\w+)/);
    if (typeMatch) { contextMap.type = typeMatch[1]; }

    const stateMatch = body.match(/\bstate\s*=\s*(\w+)/);
    if (stateMatch) { contextMap.state = stateMatch[1]; }

    const containsMatch = body.match(/\bcontains\s+([\w\s,]+)/);
    if (containsMatch) {
        contextMap.boundedContexts = containsMatch[1]
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0);
    }

    const lines = body.split('\n');
    for (const line of lines) {
        const rel = parseRelationship(line);
        if (rel) {
            contextMap.relationships.push(rel);
        }
    }

    // Also extract implementation technology from relationships
    const relBlocks = body.split(/(?=\w+\s+(?:\[|Partnership|Shared-Kernel|Upstream-Downstream|Downstream-Upstream|Customer-Supplier|Supplier-Customer))/);
    for (const block of relBlocks) {
        const implTechMatch = block.match(/implementationTechnology\s*=\s*"([^"]+)"/);
        if (implTechMatch) {
            const rel = parseRelationship(block);
            if (rel) {
                rel.implementationTechnology = implTechMatch[1];
            }
        }
    }

    return contextMap;
}

function parseBoundedContext(name: string, body: string): ParsedBoundedContext {
    const bc: ParsedBoundedContext = {
        name,
        responsibilities: [],
        aggregates: [],
    };

    const typeMatch = body.match(/\btype\s*=\s*(\w+)/);
    if (typeMatch) { bc.type = typeMatch[1]; }

    const dvsMatch = body.match(/\bdomainVisionStatement\s*=\s*"([^"]+)"/);
    if (dvsMatch) { bc.domainVisionStatement = dvsMatch[1]; }

    const implMatch = body.match(/\bimplementationTechnology\s*=\s*"([^"]+)"/);
    if (implMatch) { bc.implementationTechnology = implMatch[1]; }

    const aggMatches = body.matchAll(/\bAggregate\s+(\w+)/g);
    for (const m of aggMatches) {
        bc.aggregates.push(m[1]);
    }

    return bc;
}

export function parseCml(text: string): ParsedModel {
    const cleaned = stripComments(text);
    const model: ParsedModel = {
        contextMaps: [],
        boundedContexts: [],
        domains: [],
    };

    // Parse ContextMap blocks
    const cmRegex = /\bContextMap\s+(\w+)/g;
    let match;
    while ((match = cmRegex.exec(cleaned)) !== null) {
        const body = findBlockBody(cleaned, match.index + match[0].length);
        if (body) {
            model.contextMaps.push(parseContextMap(match[1], body));
        }
    }

    // Parse BoundedContext blocks (top-level only)
    const bcRegex = /\bBoundedContext\s+(\w+)/g;
    while ((match = bcRegex.exec(cleaned)) !== null) {
        const body = findBlockBody(cleaned, match.index + match[0].length);
        model.boundedContexts.push(parseBoundedContext(match[1], body || ''));
    }

    // Parse Domain blocks
    const domRegex = /\bDomain\s+(\w+)/g;
    while ((match = domRegex.exec(cleaned)) !== null) {
        const body = findBlockBody(cleaned, match.index + match[0].length);
        const domain: ParsedDomain = { name: match[1], subdomains: [] };
        if (body) {
            const subMatches = body.matchAll(/\bSubdomain\s+(\w+)/g);
            for (const sm of subMatches) {
                domain.subdomains.push(sm[1]);
            }
        }
        model.domains.push(domain);
    }

    // If no context map is defined but there are bounded contexts,
    // synthesize one so the preview shows something useful
    if (model.contextMaps.length === 0 && model.boundedContexts.length > 0) {
        model.contextMaps.push({
            name: '(implicit)',
            boundedContexts: model.boundedContexts.map(bc => bc.name),
            relationships: [],
        });
    }

    return model;
}
