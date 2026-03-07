import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
    getTodosForDate,
    saveTodo,
    updateTodosOrder,
    deleteTodo
} from './data-manager.js';

const testDate = '2099-12-31';
const todoId = `smoke-${randomUUID()}`;

async function run() {
    const createInput = {
        id: todoId,
        title: 'smoke create',
        content: 'hello smoke',
        completed: false,
        order: 0,
        createdAt: Date.now()
    };

    const createRes = await saveTodo(testDate, createInput, null);
    assert.equal(createRes.status, 'saved');
    assert.equal(typeof createRes.updatedAt, 'number');

    const listAfterCreate = await getTodosForDate(testDate);
    const created = listAfterCreate.todos.find(t => t.id === todoId);
    assert.ok(created, 'Created todo should exist.');
    assert.equal(created.title, 'smoke create');

    const updateInput = {
        ...created,
        title: 'smoke updated',
        content: 'updated content'
    };
    const updateRes = await saveTodo(testDate, updateInput, createRes.updatedAt);
    assert.ok(['saved', 'conflict_merged'].includes(updateRes.status));

    const listAfterUpdate = await getTodosForDate(testDate);
    const updated = listAfterUpdate.todos.find(t => t.id === todoId);
    assert.ok(updated, 'Updated todo should exist.');
    assert.ok(
        updated.title.includes('smoke updated') || updated.title.includes('[CONFLICT]'),
        'Title should be updated or conflict-marked.'
    );

    await updateTodosOrder(testDate, [updated]);
    const listAfterReorder = await getTodosForDate(testDate);
    const reordered = listAfterReorder.todos.find(t => t.id === todoId);
    assert.equal(reordered.order, 0);

    await deleteTodo(testDate, todoId);
    const listAfterDelete = await getTodosForDate(testDate);
    const deleted = listAfterDelete.todos.find(t => t.id === todoId);
    assert.equal(deleted, undefined, 'Deleted todo should not exist.');

    console.log('Smoke test passed: storage create/read/update/order/delete is healthy.');
}

run().catch(err => {
    console.error('Smoke test failed:', err.message);
    process.exitCode = 1;
});
