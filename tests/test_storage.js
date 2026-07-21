const assert = require('node:assert/strict');

const { createStorage } = require('../static/js/dashboard/storage.js');

function runTest(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        throw error;
    }
}

function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, value);
        }
    };
}

runTest('readJson returns valid stored data', () => {
    const storage = createStorage(memoryStorage({ funds: '[{"code":"000001"}]' }));

    assert.deepEqual(storage.readJson('funds', [], Array.isArray), [{ code: '000001' }]);
});

runTest('readJson falls back for malformed or unexpected data', () => {
    const malformed = createStorage(memoryStorage({ funds: '{broken' }));
    const unexpected = createStorage(memoryStorage({ funds: '{"code":"000001"}' }));

    assert.deepEqual(malformed.readJson('funds', [], Array.isArray), []);
    assert.deepEqual(unexpected.readJson('funds', [], Array.isArray), []);
});

runTest('storage access failures do not break application startup', () => {
    const inaccessible = createStorage({
        getItem() {
            throw new Error('blocked');
        },
        setItem() {
            throw new Error('blocked');
        }
    });

    assert.equal(inaccessible.read('activeTab', 'tab-summary'), 'tab-summary');
    assert.equal(inaccessible.write('activeTab', 'tab-group-0'), false);
});

console.log('All storage tests passed.');
