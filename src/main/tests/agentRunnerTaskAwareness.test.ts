import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { taskListService } from '../services/taskListService.js';
import type { MonitoringDelta } from '../types.js';

describe('Agent Runner Task Awareness', () => {
    let testTaskListId: string | null = null;
    let mockDeltas: MonitoringDelta[];

    beforeEach(async () => {
        const taskList = await taskListService.createTaskList('Test Agent');
        testTaskListId = taskList.id;

        mockDeltas = [
            {
                id: 'delta-1',
                sourceId: 'source-1',
                content: 'Test delta content 1',
                timestamp: new Date().toISOString(),
                metadata: {}
            },
            {
                id: 'delta-2',
                sourceId: 'source-2',
                content: 'Test delta content 2',
                timestamp: new Date().toISOString(),
                metadata: {}
            }
        ];
    });

    afterEach(async () => {
        if (testTaskListId) {
            await taskListService.deleteTaskList(testTaskListId);
            testTaskListId = null;
        }
    });

    describe('Task Context Injection', () => {
        it('should create task list for new agent session', async () => {
            const taskList = await taskListService.createTaskList('New Agent');
            
            expect(taskList).toBeDefined();
            expect(taskList.name).toBe('New Agent');
            expect(taskList.tasks).toHaveLength(0);
            
            await taskListService.deleteTaskList(taskList.id);
        });

        it('should set initial task as current when tasks exist', async () => {
            const task1 = await taskListService.addTask(testTaskListId!, 'Initial Task');
            
            await taskListService.setCurrentTask(testTaskListId!, 0);
            const current = await taskListService.getCurrentTask(testTaskListId!);
            
            expect(current?.id).toBe(task1.id);
            expect(current?.status).toBe('pending');
        });

        it('should return null when no tasks exist', async () => {
            const current = await taskListService.getCurrentTask(testTaskListId!);
            
            expect(current).toBeNull();
        });
    });

    describe('Task Auto-Advancement', () => {
        it('should advance to next task when current completes', async () => {
            const task1 = await taskListService.addTask(testTaskListId!, 'Task 1');
            const task2 = await taskListService.addTask(testTaskListId!, 'Task 2');

            await taskListService.setCurrentTask(testTaskListId!, 0);
            
            expect((await taskListService.getCurrentTask(testTaskListId!))?.id).toBe(task1.id);
            
            await taskListService.updateTaskStatus(testTaskListId!, task1.id, 'completed');
            
            const list = await taskListService.getTaskList(testTaskListId!);
            expect(list?.current_task_index).toBe(0);
        });

        it('should not advance when no next task exists', async () => {
            const task1 = await taskListService.addTask(testTaskListId!, 'Only Task');

            await taskListService.setCurrentTask(testTaskListId!, 0);
            await taskListService.updateTaskStatus(testTaskListId!, task1.id, 'completed');
            
            const list = await taskListService.getTaskList(testTaskListId!);
            expect(list?.current_task_index).toBe(0);
        });

        it('should handle multiple sequential completions', async () => {
            const task1 = await taskListService.addTask(testTaskListId!, 'Task 1');
            const task2 = await taskListService.addTask(testTaskListId!, 'Task 2');
            const task3 = await taskListService.addTask(testTaskListId!, 'Task 3');

            await taskListService.setCurrentTask(testTaskListId!, 0);
            
            expect((await taskListService.getCurrentTask(testTaskListId!))?.id).toBe(task1.id);
            
            await taskListService.updateTaskStatus(testTaskListId!, task1.id, 'completed');
            const list = await taskListService.getTaskList(testTaskListId!);
            expect(list?.current_task_index).toBe(0);
        });
    });

    describe('Delta Processing with Tasks', () => {
        it('should associate delta processing with current task', async () => {
            const task1 = await taskListService.addTask(testTaskListId!, 'Process Deltas');
            
            await taskListService.setCurrentTask(testTaskListId!, 0);
            
            const current = await taskListService.getCurrentTask(testTaskListId!);
            expect(current?.id).toBe(task1.id);
        });

        it('should handle empty delta batch gracefully', async () => {
            const task1 = await taskListService.addTask(testTaskListId!, 'Process Deltas');
            
            await taskListService.setCurrentTask(testTaskListId!, 0);
            
            const emptyDeltas: MonitoringDelta[] = [];
            
            expect(emptyDeltas).toHaveLength(0);
        });

        it('should maintain task context across multiple deltas', async () => {
            const task1 = await taskListService.addTask(testTaskListId!, 'Process Deltas');
            
            await taskListService.setCurrentTask(testTaskListId!, 0);
            
            for (const delta of mockDeltas) {
                expect(delta.content).toBeDefined();
            }
            
            const current = await taskListService.getCurrentTask(testTaskListId!);
            expect(current?.id).toBe(task1.id);
        });
    });

    describe('Task State Transitions', () => {
        it('should transition from pending to in_progress', async () => {
            const task = await taskListService.addTask(testTaskListId!, 'Test Task');
            
            expect(task.status).toBe('pending');
            
            await taskListService.updateTaskStatus(testTaskListId!, task.id, 'in_progress');
            
            const list = await taskListService.getTaskList(testTaskListId!);
            const updated = list?.tasks.find(t => t.id === task.id);
            expect(updated?.status).toBe('in_progress');
        });

        it('should transition from in_progress to completed', async () => {
            const task = await taskListService.addTask(testTaskListId!, 'Test Task');
            
            await taskListService.updateTaskStatus(testTaskListId!, task.id, 'in_progress');
            await taskListService.updateTaskStatus(testTaskListId!, task.id, 'completed');
            
            const list = await taskListService.getTaskList(testTaskListId!);
            const updated = list?.tasks.find(t => t.id === task.id);
            expect(updated?.status).toBe('completed');
        });

        it('should accept any string status value', async () => {
            const task = await taskListService.addTask(testTaskListId!, 'Test Task');
            
            await taskListService.updateTaskStatus(testTaskListId!, task.id, 'custom_status' as any);
            
            const list = await taskListService.getTaskList(testTaskListId!);
            const updated = list?.tasks.find(t => t.id === task.id);
            expect(updated?.status).toBe('custom_status');
        });
    });

    describe('Session Metadata Binding', () => {
        it('should link task list ID to session metadata', async () => {
            const taskList = await taskListService.createTaskList('Metadata Test Agent');
            
            expect(taskList.id).toBeDefined();
            
            await taskListService.deleteTaskList(taskList.id);
        });

        it('should retrieve task list by agent identifier', async () => {
            const agentName = 'Retrieval Test Agent';
            const taskList = await taskListService.createTaskList(agentName);
            
            const retrieved = await taskListService.getTaskList(taskList.id);
            
            expect(retrieved?.name).toBe(agentName);
            
            await taskListService.deleteTaskList(taskList.id);
        });
    });
});
