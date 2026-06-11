import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { taskListService } from '../services/taskListService.js';
import { contextService } from '../services/contextService.js';

describe('Task List Integration', () => {
    let testTaskListId: string | null = null;

    beforeEach(async () => {
        const taskList = await taskListService.createTaskList('Test Agent');
        testTaskListId = taskList.id;
    });

    afterEach(async () => {
        if (testTaskListId) {
            await taskListService.deleteTaskList(testTaskListId);
            testTaskListId = null;
        }
    });

    describe('Task List Lifecycle', () => {
        it('should create a task list with initial state', async () => {
            const list = await taskListService.getTaskList(testTaskListId!);
            
            expect(list).toBeDefined();
            expect(list?.name).toBe('Test Agent');
            expect(list?.tasks).toHaveLength(0);
            expect(list?.current_task_index).toBe(-1);
        });

        it('should add tasks to the list', async () => {
            const task1 = await taskListService.addTask(testTaskListId!, 'Test Task 1', 'Description 1');

            const task2 = await taskListService.addTask(testTaskListId!, 'Test Task 2', 'Description 2');

            const list = await taskListService.getTaskList(testTaskListId!);
            
            expect(list?.tasks).toHaveLength(2);
            expect(list?.tasks[0].title).toBe('Test Task 1');
            expect(list?.tasks[1].title).toBe('Test Task 2');
        });

        it('should set and retrieve current task', async () => {
            const task1 = await taskListService.addTask(testTaskListId!, 'Task 1');
            const task2 = await taskListService.addTask(testTaskListId!, 'Task 2');

            await taskListService.setCurrentTask(testTaskListId!, 0);
            
            const current = await taskListService.getCurrentTask(testTaskListId!);
            
            expect(current).toBeDefined();
            expect(current?.id).toBe(task1.id);
        });

        it('should update task status correctly', async () => {
            const task = await taskListService.addTask(testTaskListId!, 'Test Task');
            
            await taskListService.updateTaskStatus(testTaskListId!, task.id, 'in_progress');
            let list = await taskListService.getTaskList(testTaskListId!);
            let updated = list?.tasks.find(t => t.id === task.id);
            expect(updated?.status).toBe('in_progress');

            await taskListService.updateTaskStatus(testTaskListId!, task.id, 'completed');
            list = await taskListService.getTaskList(testTaskListId!);
            updated = list?.tasks.find(t => t.id === task.id);
            expect(updated?.status).toBe('completed');
        });

        it('should auto-advance to next task when current completes', async () => {
            const task1 = await taskListService.addTask(testTaskListId!, 'Task 1');
            const task2 = await taskListService.addTask(testTaskListId!, 'Task 2');

            await taskListService.setCurrentTask(testTaskListId!, 0);
            expect((await taskListService.getCurrentTask(testTaskListId!))?.id).toBe(task1.id);

            await taskListService.updateTaskStatus(testTaskListId!, task1.id, 'completed');
            
            const list = await taskListService.getTaskList(testTaskListId!);
            expect(list?.current_task_index).toBe(0);
        });
    });

    describe('Session Integration', () => {
        it('should link task list to session metadata', async () => {
            const taskList = await taskListService.createTaskList('Integration Test Agent');
            
            try {
                const session = await contextService.createSession('test', { 
                    taskListId: taskList.id 
                }, 'Test Session');

                const retrieved = await contextService.getSession(session.id);
                
                expect(retrieved?.metadata?.taskListId).toBe(taskList.id);
            } finally {
                await taskListService.deleteTaskList(taskList.id);
            }
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty task list gracefully', async () => {
            const current = await taskListService.getCurrentTask(testTaskListId!);
            
            expect(current).toBeNull();
        });

        it('should not advance beyond last task', async () => {
            const task1 = await taskListService.addTask(testTaskListId!, 'Only Task');

            await taskListService.setCurrentTask(testTaskListId!, 0);
            await taskListService.updateTaskStatus(testTaskListId!, task1.id, 'completed');
            
            const list = await taskListService.getTaskList(testTaskListId!);
            expect(list?.current_task_index).toBe(0);
        });

        it('should handle concurrent task updates safely', async () => {
            const task1 = await taskListService.addTask(testTaskListId!, 'Task 1');
            
            await Promise.all([
                taskListService.updateTaskStatus(testTaskListId!, task1.id, 'in_progress'),
                taskListService.updateTaskStatus(testTaskListId!, task1.id, 'in_progress')
            ]);

            const list = await taskListService.getTaskList(testTaskListId!);
            const updated = list?.tasks.find(t => t.id === task1.id);
            expect(updated?.status).toBe('in_progress');
        });
    });
});
