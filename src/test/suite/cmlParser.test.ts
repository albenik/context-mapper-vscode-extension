import { strict as assert } from 'assert';
import { parseCml, RelationshipType } from '../../preview/cmlParser';

suite('CML Parser Test Suite', () => {

    test('parses bounded contexts', () => {
        const cml = `
BoundedContext OrderContext {
    type = FEATURE
    Aggregate Orders {
        Entity Order {
            aggregateRoot
        }
    }
}

BoundedContext ShippingContext {
    type = APPLICATION
}
`;
        const model = parseCml(cml);
        assert.equal(model.boundedContexts.length, 2);
        assert.equal(model.boundedContexts[0].name, 'OrderContext');
        assert.equal(model.boundedContexts[0].type, 'FEATURE');
        assert.equal(model.boundedContexts[0].aggregates.length, 1);
        assert.equal(model.boundedContexts[0].aggregates[0], 'Orders');
        assert.equal(model.boundedContexts[1].name, 'ShippingContext');
        assert.equal(model.boundedContexts[1].type, 'APPLICATION');
    });

    test('parses context map with contains clause', () => {
        const cml = `
ContextMap MyMap {
    type = SYSTEM_LANDSCAPE
    state = TO_BE
    contains OrderContext, ShippingContext
}

BoundedContext OrderContext {}
BoundedContext ShippingContext {}
`;
        const model = parseCml(cml);
        assert.equal(model.contextMaps.length, 1);
        assert.equal(model.contextMaps[0].name, 'MyMap');
        assert.equal(model.contextMaps[0].type, 'SYSTEM_LANDSCAPE');
        assert.equal(model.contextMaps[0].state, 'TO_BE');
        assert.equal(model.contextMaps[0].boundedContexts.length, 2);
        assert.ok(model.contextMaps[0].boundedContexts.includes('OrderContext'));
        assert.ok(model.contextMaps[0].boundedContexts.includes('ShippingContext'));
    });

    test('parses upstream-downstream relationship with patterns', () => {
        const cml = `
ContextMap TestMap {
    contains A, B
    A [U,OHS,PL] -> [D,ACL] B
}
BoundedContext A {}
BoundedContext B {}
`;
        const model = parseCml(cml);
        assert.equal(model.contextMaps[0].relationships.length, 1);
        const rel = model.contextMaps[0].relationships[0];
        assert.equal(rel.upstream, 'A');
        assert.equal(rel.downstream, 'B');
        assert.equal(rel.type, RelationshipType.UpstreamDownstream);
        assert.ok(rel.upstreamPatterns.includes('OHS'));
        assert.ok(rel.upstreamPatterns.includes('PL'));
        assert.ok(rel.downstreamPatterns.includes('ACL'));
    });

    test('parses partnership relationship', () => {
        const cml = `
ContextMap TestMap {
    contains A, B
    A Partnership B
}
BoundedContext A {}
BoundedContext B {}
`;
        const model = parseCml(cml);
        assert.equal(model.contextMaps[0].relationships.length, 1);
        assert.equal(model.contextMaps[0].relationships[0].type, RelationshipType.Partnership);
    });

    test('parses shared kernel relationship', () => {
        const cml = `
ContextMap TestMap {
    contains A, B
    A Shared-Kernel B
}
BoundedContext A {}
BoundedContext B {}
`;
        const model = parseCml(cml);
        assert.equal(model.contextMaps[0].relationships.length, 1);
        assert.equal(model.contextMaps[0].relationships[0].type, RelationshipType.SharedKernel);
    });

    test('creates implicit context map when none defined', () => {
        const cml = `
BoundedContext A {}
BoundedContext B {}
`;
        const model = parseCml(cml);
        assert.equal(model.contextMaps.length, 1);
        assert.equal(model.contextMaps[0].name, '(implicit)');
        assert.equal(model.contextMaps[0].boundedContexts.length, 2);
    });

    test('parses domains with subdomains', () => {
        const cml = `
Domain MyDomain {
    Subdomain Sub1
    Subdomain Sub2
}
`;
        const model = parseCml(cml);
        assert.equal(model.domains.length, 1);
        assert.equal(model.domains[0].name, 'MyDomain');
        assert.equal(model.domains[0].subdomains.length, 2);
    });

    test('strips comments before parsing', () => {
        const cml = `
// This is a comment
BoundedContext A {
    /* block comment */
    type = FEATURE
}
`;
        const model = parseCml(cml);
        assert.equal(model.boundedContexts.length, 1);
        assert.equal(model.boundedContexts[0].type, 'FEATURE');
    });

    test('handles empty input', () => {
        const model = parseCml('');
        assert.equal(model.contextMaps.length, 0);
        assert.equal(model.boundedContexts.length, 0);
        assert.equal(model.domains.length, 0);
    });

    test('parses downstream-upstream relationship', () => {
        const cml = `
ContextMap TestMap {
    contains A, B
    A Downstream-Upstream B
}
BoundedContext A {}
BoundedContext B {}
`;
        const model = parseCml(cml);
        assert.equal(model.contextMaps[0].relationships.length, 1);
        const rel = model.contextMaps[0].relationships[0];
        assert.equal(rel.upstream, 'B');
        assert.equal(rel.downstream, 'A');
        assert.equal(rel.type, RelationshipType.UpstreamDownstream);
    });

    test('parses the demo file correctly', () => {
        const cml = `
ContextMap InsuranceContextMap {
    type = SYSTEM_LANDSCAPE
    state = TO_BE
    contains CustomerManagement, PolicyManagement, ClaimManagement, PrintingContext

    CustomerManagement [D,ACL] -> [U,OHS,PL] PolicyManagement
    CustomerManagement [D] -> [U] ClaimManagement
    ClaimManagement [U,OHS] -> [D,ACL] PrintingContext
    PolicyManagement Partnership ClaimManagement
}

BoundedContext CustomerManagement {
    type = FEATURE
    Aggregate Customers {}
    Aggregate Addresses {}
}

BoundedContext PolicyManagement {
    type = APPLICATION
    Aggregate Policies {}
}

BoundedContext ClaimManagement {
    type = APPLICATION
    Aggregate Claims {}
}

BoundedContext PrintingContext {
    type = SYSTEM
}
`;
        const model = parseCml(cml);
        assert.equal(model.contextMaps.length, 1);
        assert.equal(model.contextMaps[0].boundedContexts.length, 4);
        assert.equal(model.contextMaps[0].relationships.length, 4);
        assert.equal(model.boundedContexts.length, 4);

        const custMgmt = model.boundedContexts.find(bc => bc.name === 'CustomerManagement');
        assert.ok(custMgmt);
        assert.equal(custMgmt!.type, 'FEATURE');
        assert.equal(custMgmt!.aggregates.length, 2);
    });
});
