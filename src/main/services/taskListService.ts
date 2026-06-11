
import { randomUUID } from 'crypto';
import { Task, TaskList } from '../types.js';
import { loggerService, LogCategory } from './loggerService.js';

export class TaskListService {
  private taskLists: Map<string, TaskList> = new Map();

  async createTaskList(name: string): Promise<TaskList> {
    const id = randomUUID();
    const taskList: TaskList = {
      id,
      name,
      tasks: [],
      current_task_index: -1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    this.taskLists.set(id, taskList);
    loggerService.catInfo(LogCategory.KERNEL, `Task list created`, { id, name });
    return taskList;
  }

  async getTaskList(listId: string): Promise<TaskList | undefined> {
    return this.taskLists.get(listId);
  }

  async addTask(listId: string, title: string, description?: string): Promise<Task> {
    const list = await this.getTaskList(listId);
    if (!list) throw new Error(`Task list ${listId} not found`);

    const task: Task = {
      id: randomUUID(),
      title,
      description,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    list.tasks.push(task);
    list.updated_at = new Date().toISOString();
    
    loggerService.catInfo(LogCategory.KERNEL, `Task added to list`, { 
      listId, taskId: task.id, title 
    });
    
    return task;
  }

  async updateTaskStatus(listId: string, taskId: string, status: Task['status']): Promise<Task> {
    const list = await this.getTaskList(listId);
    if (!list) throw new Error(`Task list ${listId} not found`);

    const taskIndex = list.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) throw new Error(`Task ${taskId} not found in list ${listId}`);

    const task = list.tasks[taskIndex];
    task.status = status;
    task.updated_at = new Date().toISOString();
    list.updated_at = new Date().toISOString();

    loggerService.catInfo(LogCategory.KERNEL, `Task status updated`, { 
      listId, taskId, status 
    });

    return task;
  }

  async setCurrentTask(listId: string, taskIndex: number): Promise<void> {
    const list = await this.getTaskList(listId);
    if (!list) throw new Error(`Task list ${listId} not found`);

    if (taskIndex < -1 || taskIndex >= list.tasks.length) {
      throw new Error(`Invalid task index ${taskIndex} for list ${listId}`);
    }

    list.current_task_index = taskIndex;
    list.updated_at = new Date().toISOString();

    loggerService.catInfo(LogCategory.KERNEL, `Current task set`, { 
      listId, taskIndex 
    });
  }

  async getCurrentTask(listId: string): Promise<Task | null> {
    const list = await this.getTaskList(listId);
    if (!list) return null;

    if (list.current_task_index < 0 || list.current_task_index >= list.tasks.length) {
      return null;
    }

    return list.tasks[list.current_task_index];
  }

  async linkTaskToTrace(listId: string, taskId: string, traceId: string): Promise<void> {
    const list = await this.getTaskList(listId);
    if (!list) throw new Error(`Task list ${listId} not found`);

    const taskIndex = list.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) throw new Error(`Task ${taskId} not found in list ${listId}`);

    list.tasks[taskIndex].task_id = traceId;
    list.tasks[taskIndex].updated_at = new Date().toISOString();
    list.updated_at = new Date().toISOString();

    loggerService.catInfo(LogCategory.KERNEL, `Task linked to trace`, { 
      listId, taskId, traceId 
    });
  }

  async deleteTaskList(listId: string): Promise<void> {
    this.taskLists.delete(listId);
    loggerService.catInfo(LogCategory.KERNEL, `Task list deleted`, { listId });
  }

  async getAllTaskLists(): Promise<TaskList[]> {
    return Array.from(this.taskLists.values());
  }
}

export const taskListService = new TaskListService();
